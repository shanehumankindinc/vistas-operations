import { getSupabase } from "@/lib/db";
import { computeScorecard } from "@/lib/scorecard-data";
import { buildCleanerReport, buildProactiveReporting, buildCrewBreakdown } from "@/lib/report-builder";
import { buildVendorBrief, generateAISections } from "@/lib/report-ai";
import { MARKET_KEYS } from "@/lib/markets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// POST /api/reports/generate
// Body: { market, period_start, period_end }
// Cron path: GET /api/reports/generate?market=branson&auto=1 (Bearer CRON_SECRET)
export async function POST(req) {
  const user = getSessionUser(req);
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  return runGenerate(body, user.name || "admin");
}

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market");
  if (!market || !MARKET_KEYS.includes(market)) {
    return Response.json({ error: "Invalid market" }, { status: 400 });
  }

  // Auto-mode: generate for the prior calendar month
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfLastMonth = new Date(firstOfThisMonth - 1);
  const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);

  const period_start = firstOfLastMonth.toISOString().slice(0, 10);
  const period_end = lastOfLastMonth.toISOString().slice(0, 10);

  return runGenerate({ market, period_start, period_end }, "cron");
}

async function runGenerate({ market, period_start, period_end }, createdBy) {
  if (!market || !MARKET_KEYS.includes(market)) {
    return Response.json({ error: "market must be one of: " + MARKET_KEYS.join(", ") }, { status: 400 });
  }
  if (!period_start || !period_end || period_end < period_start) {
    return Response.json({ error: "period_start and period_end are required and must be valid dates" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Compute scorecard for the period
  let result;
  try {
    result = await computeScorecard({ markets: [market], fromDate: period_start, toDate: period_end, supabase });
  } catch (err) {
    return Response.json({ error: "Scorecard computation failed: " + err.message }, { status: 500 });
  }

  const vendors = result.scorecard || [];
  const allReviews = result.reviews || [];
  const allTasks = result.tasks || [];
  console.log(`[reports/generate] market=${market} period=${period_start}..${period_end} vendors=${vendors.length}`);
  if (vendors.length === 0) {
    return Response.json({ ok: true, generated: 0, message: "No vendor data found for this period" });
  }

  // Phase 1: pre-compute proactive rows and briefs for all vendors (no I/O)
  const vendorData = vendors.map((vendor) => {
    const proactiveRows = buildProactiveReporting(vendor, allReviews, allTasks);
    const crewBreakdown = buildCrewBreakdown(vendor, allTasks);
    const brief = buildVendorBrief(vendor, proactiveRows, market);
    return { vendor, proactiveRows, crewBreakdown, brief };
  });

  // Phase 2: fire all AI calls in parallel — failures fall back to template silently
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let aiResults = vendorData.map(() => null); // default: no AI sections
  if (apiKey) {
    const settled = await Promise.allSettled(
      vendorData.map(({ brief }) => generateAISections(brief, apiKey))
    );
    aiResults = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      console.warn(`[reports/generate] AI failed for "${vendorData[i].vendor.vendor_name}": ${r.reason?.message}`);
      return null;
    });
  }

  const generated = [];
  const errors = [];

  for (let i = 0; i < vendorData.length; i++) {
    const { vendor, proactiveRows, crewBreakdown } = vendorData[i];
    const aiSections = aiResults[i];
    const slug = slugify(vendor.vendor_name);
    const filePath = `${market}/${period_start}/${slug}.html`;

    try {
      const html = buildCleanerReport(vendor, period_start, period_end, { proactiveRows, crewBreakdown, aiSections });

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("cleaner-reports")
        .upload(filePath, Buffer.from(html, "utf-8"), {
          contentType: "text/html",
          upsert: true,
        });

      if (uploadError) throw new Error("Storage upload failed: " + uploadError.message);

      // Record in archive table
      const { error: dbError } = await supabase
        .from("report_archive")
        .upsert(
          {
            market,
            period_start,
            period_end,
            generated_at: new Date().toISOString(),
            report_type: "cleaner",
            cleaner_company: vendor.vendor_name,
            file_url: filePath,
            created_by: createdBy,
          },
          { onConflict: "market,period_start,cleaner_company" }
        );

      if (dbError) throw new Error("Archive insert failed: " + dbError.message);

      generated.push(vendor.vendor_name);
    } catch (err) {
      console.error(`[reports/generate] vendor="${vendor.vendor_name}" error:`, err.message);
      errors.push({ vendor: vendor.vendor_name, error: err.message });
    }
  }

  console.log(`[reports/generate] market=${market} vendors=${vendors.length} generated=${generated.length} errors=${errors.length}`);
  return Response.json({ ok: true, generated: generated.length, vendors: generated, errors });
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
