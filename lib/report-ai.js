import { hasPositiveKeywords } from "@/lib/keywords";
import { parseTotalTime } from "@/lib/scorecard";

function isShortClean(task) {
  const mins = parseTotalTime(task.total_time);
  return mins != null && mins < 15;
}

// Build a compact brief (~900 tokens) from vendor data.
// Includes all matched reviews so the AI can classify complaints in context
// rather than relying on keyword matching.
export function buildVendorBrief(vendor, market) {
  const enriched = vendor.enriched_tasks || [];

  const marketLabel =
    market === "branson" ? "Branson" :
    market === "deep_creek" ? "Deep Creek" :
    market === "poconos" ? "Poconos" : market;

  // Top review quotes for CELEBRATE: 5-star, positive keywords — max 3
  const topQuotes = enriched
    .filter((t) => t.review?.cleanliness === 5 && t.review.review_text && hasPositiveKeywords(t.review.review_text))
    .slice(0, 3)
    .map((t) => ({
      text: t.review.review_text.slice(0, 180),
      property: t.property_name || null,
    }));

  // All matched reviews with original enriched_tasks index — AI uses this for
  // complaint classification and ADDRESS/one_ask context. Cap at 15 to bound
  // token cost. Index preserved before filter so AI complaint_indices round-trip
  // correctly back to enriched_tasks in buildProactiveReporting.
  const allReviews = enriched
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => t.review)
    .slice(0, 15)
    .map(({ t, idx }) => ({
      _i: idx,
      property: t.property_name || null,
      cleanliness: t.review.cleanliness ?? null,
      text: (t.review.review_text || t.review.private_feedback || "").slice(0, 220),
    }));

  // Short cleans — max 3
  const shortCleans = enriched
    .filter(isShortClean)
    .slice(0, 3)
    .map((t) => ({
      property: t.property_name,
      date: t.scheduled_date,
      minutes: Math.round(parseTotalTime(t.total_time) ?? 0),
    }));

  // Late cleans — max 3
  const lateCleans = enriched
    .filter((t) => t.decided && !t.on_time)
    .slice(0, 3)
    .map((t) => ({
      property: t.property_name,
      date: t.scheduled_date,
      finished: t.finished_cst
        ? `${t.finished_cst.hour}:${String(t.finished_cst.minute).padStart(2, "0")} ${t.tz_abbr || ""}`.trim()
        : "after 4pm",
    }));

  // Maintenance task examples for CELEBRATE — max 2, prefer ones with descriptions
  const maintExamples = (vendor.issues || [])
    .filter((i) => i.task_title || i.description)
    .slice(0, 2)
    .map((i) => ({
      property: i.property_name,
      description: (i.description || i.task_title || "").slice(0, 100),
    }));

  return {
    vendor: vendor.vendor_name,
    market: marketLabel,
    stats: {
      cleans: vendor.total_cleans ?? 0,
      properties: vendor.property_count ?? 0,
      quality: vendor.cleanliness_score != null ? +vendor.cleanliness_score.toFixed(2) : null,
      on_time_pct: vendor.on_time_rate != null ? Math.round(vendor.on_time_rate * 100) : null,
      tasks_filed: vendor.issues_created ?? 0,
      five_star_count: enriched.filter((t) => t.review?.cleanliness === 5).length,
    },
    top_quotes: topQuotes,
    all_reviews: allReviews,
    issues: {
      short_cleans: shortCleans,
      late_cleans: lateCleans,
    },
    maintenance_examples: maintExamples,
  };
}

const SYSTEM_PROMPT = `You write sections of a monthly performance report for vacation rental cleaning vendors. The vendor reads this directly — it is not a management summary.

RULES:
- Second person only: "you", "your", "your team". Never third person or "the vendor".
- No em dashes. Use commas, colons, or short sentences.
- No filler phrases ("We are pleased", "In conclusion", "It is important to note").
- Reference specific property names and numbers from the brief. Never invent facts.
- Output valid JSON with exactly four fields: celebrate, address, one_ask, complaint_indices.
- No markdown in the string fields. Plain text only (no **, no ##, no dashes as bullets).
- Never reference "_i", "idx", field names, or any numeric identifier from the input data in your prose. Use only property names, dates, and scores.

FIELD GUIDANCE:

complaint_indices — array of integers (_i values from all_reviews):
  Identify reviews where the guest text describes a physical condition the cleaner should
  have noticed and reported before leaving: dirty surfaces, missing supplies (soap, toilet
  paper, towels), broken or damaged items, smells, bugs, mold, stains, flooding, clogged
  drains. Include the review's idx value in the array.
  EXCLUDE: access issues (driveway, parking, snow removal), amenity decisions (pool hours,
  HOA policy, hot tub temperature), positive comments even if cleanliness score is low,
  property condition unrelated to cleaning (old furniture, decor), and anything outside
  the cleaner's control. Return [] when nothing qualifies.

celebrate — 2 to 4 sentences:
  Acknowledge the actual work. If five_star_count is high, say so with the number.
  Reference 1 or 2 specific property names from top_quotes when available.
  If tasks_filed > 0, mention that reporting issues protects properties and guests —
  name a specific example from maintenance_examples if present.
  Warm, genuine, specific. Not over-the-top.

address — up to 4 sentences total, or empty string "" if nothing to address:
  Write this only if issues exist: late_cleans, short_cleans, complaint_indices non-empty,
  or all_reviews contains low cleanliness ratings (< 4) with complaint text.
  Cover each issue type in 1 sentence. Name the specific property and date.
  Firm but not punitive. Focus on what needs to change, not on fault.
  Return "" if nothing to address.

one_ask — exactly one imperative sentence:
  The single most important improvement for next month.
  Work through priorities in order, stopping at the FIRST that applies:
  (1) complaint_indices is non-empty — ask them to file a Breezeway task every time they
      notice an issue before leaving. Reference the specific properties. SKIP this priority
      if complaint_indices is [] or absent — do not mention proactive task filing here.
  (2) short_cleans is non-empty — ask them to take the full time each property needs.
      Name the property and how many cleans were short.
  (3) late_cleans is non-empty AND on_time_pct < 90 — ask them to call the office by 2pm
      when running behind. Skip if on_time_pct >= 90.
  (4) all_reviews contains cleanliness < 4 — ask them to address the specific issues.
  (5) tasks_filed = 0 AND cleans >= 10 — ask them to start filing maintenance tasks.
  (6) None of the above apply — name one metric from their data that they can push higher.
  Reference specific property names, counts, or dates when possible.`;

// Call claude-haiku-4-5 with a compact brief. Returns { celebrate, address, one_ask }.
// Throws on API error or malformed response — caller must catch and fall back.
export async function generateAISections(brief, apiKey) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the report sections for this vendor and classify complaint reviews. Return JSON only, no explanation.\n\n${JSON.stringify(brief)}`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Anthropic ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const raw = data.content?.[0]?.text || "";

  // Strip markdown code fences if the model wrapped the JSON
  const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed = JSON.parse(clean);

  if (typeof parsed.celebrate !== "string" || typeof parsed.one_ask !== "string") {
    throw new Error("AI response missing required fields");
  }

  // complaint_indices must be an array of integers — coerce or default to []
  const rawIndices = Array.isArray(parsed.complaint_indices) ? parsed.complaint_indices : [];
  const complaint_indices = rawIndices.filter((v) => typeof v === "number" && Number.isInteger(v) && v >= 0);

  return {
    celebrate: (parsed.celebrate || "").trim(),
    address: (parsed.address || "").trim(),
    one_ask: (parsed.one_ask || "").trim(),
    complaint_indices,
  };
}
