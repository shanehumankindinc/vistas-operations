import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// GET /api/reports?market=branson&period_start=2026-06-01
// Returns report_archive rows the session user is allowed to see, each with a signed URL.
export async function GET(req) {
  const user = getSessionUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const marketParam = searchParams.get("market");
  const periodParam = searchParams.get("period_start");

  const supabase = getSupabase();

  let query = supabase
    .from("report_archive")
    .select("*")
    .order("period_start", { ascending: false })
    .order("generated_at", { ascending: false });

  // Vendors see only their own reports
  if (user.role === "vendor") {
    if (!user.vendor_company) return Response.json({ rows: [] });
    query = query.eq("cleaner_company", user.vendor_company);
    // Lock to their market
    const vendorMarket = (user.markets || [])[0];
    if (vendorMarket) query = query.eq("market", vendorMarket);
  } else {
    if (marketParam) query = query.eq("market", marketParam);
  }

  if (periodParam) query = query.eq("period_start", periodParam);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Generate a signed URL for each row (1-hour TTL)
  const rows = await Promise.all(
    (data || []).map(async (row) => {
      const { data: signedData } = await supabase.storage
        .from("cleaner-reports")
        .createSignedUrl(row.file_url, 3600);
      return { ...row, signed_url: signedData?.signedUrl || null };
    })
  );

  return Response.json({ rows });
}
