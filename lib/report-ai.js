import { hasPositiveKeywords } from "@/lib/keywords";
import { parseTotalTime } from "@/lib/scorecard";

function isShortClean(task) {
  const mins = parseTotalTime(task.total_time);
  return mins != null && mins < 15;
}

// Build a compact brief (~400 tokens) from pre-computed vendor data.
// The LLM never sees raw task arrays — only the facts our code already verified.
export function buildVendorBrief(vendor, proactiveRows, market) {
  const enriched = vendor.enriched_tasks || [];

  const marketLabel =
    market === "branson" ? "Branson" :
    market === "deep_creek" ? "Deep Creek" :
    market === "poconos" ? "Poconos" : market;

  // Top review quotes: 5-star, has text, positive keywords — max 3
  const topQuotes = enriched
    .filter((t) => t.review?.cleanliness === 5 && t.review.review_text && hasPositiveKeywords(t.review.review_text))
    .slice(0, 3)
    .map((t) => ({
      text: t.review.review_text.slice(0, 180),
      property: t.property_name || null,
    }));

  // Low reviews with complaint excerpt — max 3
  const lowReviews = enriched
    .filter((t) => t.review?.cleanliness != null && t.review.cleanliness < 4)
    .slice(0, 3)
    .map((t) => {
      const txt = (t.review.review_text || t.review.private_feedback || "").slice(0, 150);
      return { property: t.property_name, rating: t.review.cleanliness, excerpt: txt };
    });

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

  // Maintenance task examples for celebrate — max 2, prefer ones with descriptions
  const maintExamples = (vendor.issues || [])
    .filter((i) => i.task_title || i.description)
    .slice(0, 2)
    .map((i) => ({
      property: i.property_name,
      description: (i.description || i.task_title || "").slice(0, 100),
    }));

  const missedCount = proactiveRows.filter((r) => !r.task_filed).length;

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
    issues: {
      low_reviews: lowReviews,
      short_cleans: shortCleans,
      late_cleans: lateCleans,
    },
    maintenance_examples: maintExamples,
    proactive_misses: missedCount,
  };
}

const SYSTEM_PROMPT = `You write three sections of a monthly performance report for vacation rental cleaning vendors. The vendor reads this report directly — it is not a management summary.

RULES:
- Second person only: "you", "your", "your team". Never third person or "the vendor".
- No em dashes. Use commas, colons, or short sentences.
- No filler phrases ("We are pleased", "In conclusion", "It is important to note").
- Reference specific property names and numbers from the brief. Never invent facts.
- Output valid JSON with exactly three string fields: celebrate, address, one_ask.
- No markdown in the strings. Plain text only (no **, no ##, no dashes as bullets).

SECTION GUIDANCE:

celebrate — 2 to 4 sentences:
  Acknowledge the actual work. If five_star_count is high, say so with the number.
  Reference 1 or 2 specific property names from top_quotes when available.
  If tasks_filed > 0, mention in one sentence that reporting issues protects properties
  and guests — name a specific example from maintenance_examples if present.
  Warm, genuine, specific. Not over-the-top.

address — up to 4 sentences total, or empty string "" if nothing to address:
  Write this only if issues exist: late_cleans, short_cleans, low_reviews, or proactive_misses > 0.
  Cover each issue type present in 1 sentence. Name the specific property and date.
  Firm but not punitive. Focus on what needs to change, not on fault.
  If all issue arrays are empty and proactive_misses is 0, return "".

one_ask — exactly one imperative sentence:
  The single most important improvement for next month.
  Priority: (1) proactive_misses > 0 — file a Breezeway task every time you notice an issue
  before leaving the property; (2) short_cleans — take the full time each property needs;
  (3) late_cleans and on_time_pct < 90 — call the office by 2pm when running behind;
  (4) low_reviews — read the specific guest feedback and address those details every clean;
  (5) tasks_filed = 0 with many cleans — start filing maintenance tasks in Breezeway;
  (6) everything looks strong — name one metric to push even higher.
  Reference the specific issue (property name, count, etc.) when possible.`;

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
      max_tokens: 450,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write the three report sections for this vendor. Return JSON only, no explanation.\n\n${JSON.stringify(brief)}`,
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

  return {
    celebrate: (parsed.celebrate || "").trim(),
    address: (parsed.address || "").trim(),
    one_ask: (parsed.one_ask || "").trim(),
  };
}
