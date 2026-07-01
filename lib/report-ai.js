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
  // complaint classification, excerpt extraction, and ADDRESS/one_ask context.
  // Cap at 30 so high-volume vendors (60 cleans, 20+ reviews) don't have
  // complaints slip past the window. Index preserved before filter so AI
  // complaint_indices and complaint_excerpts round-trip correctly back to
  // enriched_tasks in buildProactiveReporting.
  const allReviews = enriched
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => t.review)
    .slice(0, 30)
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

  // Properties cleaned 3+ times this period with zero maintenance tasks filed by this vendor's
  // team there. Used by the AI to write stronger address prose when a complaint hits one of
  // these properties — the cleaner has been here repeatedly and never documented conditions.
  const propCleans = {};
  for (const t of enriched) {
    if (t.property_name) propCleans[t.property_name] = (propCleans[t.property_name] || 0) + 1;
  }
  const issuedProps = new Set((vendor.issues || []).map((i) => i.property_name).filter(Boolean));
  const lowActivityProperties = Object.entries(propCleans)
    .filter(([p, c]) => c >= 3 && !issuedProps.has(p))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([p, cleans]) => ({ property: p, cleans }));

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
    low_activity_properties: lowActivityProperties,
  };
}

const SYSTEM_PROMPT = `You write sections of a monthly performance report for vacation rental cleaning vendors. The vendor reads this directly — it is not a management summary.

RULES:
- Second person only: "you", "your", "your team". Never third person or "the vendor".
- No em dashes. Use commas, colons, or short sentences.
- No filler phrases ("We are pleased", "In conclusion", "It is important to note").
- Reference specific property names and numbers from the brief. Never invent facts.
- Output valid JSON with exactly six fields: celebrate, address, one_ask, complaint_indices, complaint_excerpts, complaint_tiers.
- No markdown in the string fields. Plain text only (no **, no ##, no dashes as bullets).
- Never reference "_i", "idx", field names, or any numeric identifier from the input data in your prose. Use only property names, dates, and scores.

FIELD GUIDANCE:

complaint_indices — array of integers (_i values from all_reviews):
  Identify reviews where the guest text describes a physical condition the cleaner should
  have noticed and reported before leaving: dirty surfaces, missing supplies (soap, toilet
  paper, towels), broken or damaged items, smells, bugs, mold, stains, flooding, clogged
  drains, non-working appliances or electronics the cleaner could have tested, power issues
  (unplugged router, dead lamp). Include the review's _i value in the array.
  HARD GATE: Only include a review if you can also quote a specific physical sentence for
  complaint_excerpts. If the guest only expresses vague dissatisfaction without naming what
  was physically wrong ("we had problems", "issues from the start", "wasn't what we
  expected", "disappointing stay", "not ready for us") — EXCLUDE it. Vague complaints
  give the cleaner nothing actionable to work on and must not be flagged.
  EXCLUDE: access issues (driveway, parking, snow removal), amenity decisions (pool hours,
  HOA policy, hot tub temperature), positive comments even if cleanliness score is low,
  property condition unrelated to cleaning (old furniture, decor), and anything outside
  the cleaner's control. Return [] when nothing qualifies.

complaint_excerpts — object, keys are _i values as strings, values are excerpt strings:
  For every _i in complaint_indices, find and quote the sentence(s) that name a specific
  physical object or condition: carpet, stain, smell, odor, router, internet, power, broken
  item, missing supply, mold, bug, dirty surface, etc.
  HARD RULE: Never start the excerpt with a sentence that only expresses disappointment or
  sets general context without naming something physical. These openers must be skipped
  entirely, even if they are the first sentence: "Unfortunately...", "The unit was not
  ready...", "I rarely leave bad reviews...", "We were disappointed...", "I hate to say...".
  Start at the FIRST sentence that names the actual physical problem.
  Good example: "The carpet was heavily stained and had a musty/smoky odor. The router had
  no power and wi-fi was not working upon check-in."
  Bad example (do NOT do this): "Unfortunately the unit was not ready for occupancy. The
  carpet was stained." — the first sentence names nothing specific, skip it.
  If two specific sentences fit under 240 characters combined, include both. Quote exactly.
  Return {} if complaint_indices is empty.

complaint_tiers — object, keys are _i values as strings, values are integers 1, 2, or 3:
  For every _i in complaint_indices, classify what the cleaner should have done when they
  encountered this issue during the clean. Use these tiers:
  Tier 1 — Fix it yourself, no task needed: dirty surface, trash left behind, loose item,
    missing consumable (soap, toilet paper, towels) the cleaner can restock, anything
    the cleaner can fully resolve in under 5 minutes with no parts or tools.
  Tier 2 — Try to fix, then file a Breezeway task if unable: TV not working, pilot light
    out, wi-fi router needs reboot or is unplugged, appliance not working, light bulb out,
    remote battery dead. Attempt it; if it can't be fixed in the moment, file a task.
  Tier 3 — Do NOT attempt. File an urgent Breezeway task and call Guest Services
    immediately: loose deck railing, broken step, gas smell, structural damage, anything
    that is a safety risk to a guest. Cleaner should not try to fix it.
  Return {} if complaint_indices is empty.

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
  For low-score reviews: say "Pointe Royale scored a 3 for cleanliness" — never "Review _i 5"
  or any reference to field names or array positions. Property name + score only.
  If a complaint property also appears in low_activity_properties, mention the cleaning
  frequency: "You've cleaned The 10th Hole 7 times this period with no maintenance tasks
  filed there — the carpet and odor guests are reporting need to be documented."
  Return "" if nothing to address.

one_ask — exactly one imperative sentence:
  The single most important improvement for next month.
  Work through priorities in order, stopping at the FIRST that applies:
  (1) complaint_indices is non-empty — ask them to file a Breezeway task every time they
      notice an issue before leaving. If the complaint property appears in
      low_activity_properties, name the property and its clean count: "You've cleaned
      [property] [N] times this period — start filing tasks for what you're seeing there."
      SKIP this priority if complaint_indices is [] or absent.
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
      max_tokens: 1100,
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

  // complaint_excerpts must be an object mapping string keys to string values
  const rawExcerpts = parsed.complaint_excerpts && typeof parsed.complaint_excerpts === "object" && !Array.isArray(parsed.complaint_excerpts)
    ? parsed.complaint_excerpts
    : {};
  const complaint_excerpts = {};
  for (const [k, v] of Object.entries(rawExcerpts)) {
    const idx = parseInt(k, 10);
    if (!isNaN(idx) && typeof v === "string" && v.trim().length > 3) {
      complaint_excerpts[idx] = v.trim();
    }
  }

  // complaint_tiers must be an object mapping string keys to tier integers (1, 2, or 3)
  const rawTiers = parsed.complaint_tiers && typeof parsed.complaint_tiers === "object" && !Array.isArray(parsed.complaint_tiers)
    ? parsed.complaint_tiers
    : {};
  const complaint_tiers = {};
  for (const [k, v] of Object.entries(rawTiers)) {
    const idx = parseInt(k, 10);
    const tier = parseInt(v, 10);
    if (!isNaN(idx) && [1, 2, 3].includes(tier)) {
      complaint_tiers[idx] = tier;
    }
  }

  return {
    celebrate: (parsed.celebrate || "").trim(),
    address: (parsed.address || "").trim(),
    one_ask: (parsed.one_ask || "").trim(),
    complaint_indices,
    complaint_excerpts,
    complaint_tiers,
  };
}
