import { parseTotalTime, isCleanTask } from "@/lib/scorecard";
import { hasPositiveKeywords, hasPhysicalComplaint } from "@/lib/keywords";

// ─── Status label assignment ──────────────────────────────────────────────────

export function assignStatusLabel(score, onTime, cleans, issuesCreated) {
  if (cleans < 15) return "BUILDING TRACK RECORD";

  const scoreOk = score == null || score >= 4.8;
  const timeOk  = onTime == null || onTime >= 0.9;
  const reports  = issuesCreated >= 3;

  if (scoreOk && timeOk && reports)   return "TOP PERFORMER";
  if (scoreOk && timeOk && !reports)  return "GREAT SCORES — LOG YOUR ISSUES";
  if (scoreOk && !timeOk && reports)  return "STRONG — ONE AREA TO IMPROVE";
  if (scoreOk && !timeOk && !reports) return "GOOD — TWO AREAS TO IMPROVE";
  if (!scoreOk && timeOk && issuesCreated === 0) return "ROOM TO GROW — START LOGGING";
  if (!scoreOk && timeOk)             return "ROOM TO GROW";
  return "ATTENTION NEEDED — LET'S TALK";
}

const STATUS_COLOR = {
  "TOP PERFORMER":                  { bg: "#1a7a3c", text: "#ffffff" },
  "GREAT SCORES — LOG YOUR ISSUES": { bg: "#b91c1c", text: "#ffffff" },
  "STRONG — ONE AREA TO IMPROVE":   { bg: "#0e7490", text: "#ffffff" },
  "GOOD — TWO AREAS TO IMPROVE":    { bg: "#0e7490", text: "#ffffff" },
  "ROOM TO GROW":                   { bg: "#b45309", text: "#ffffff" },
  "ROOM TO GROW — START LOGGING":   { bg: "#b45309", text: "#ffffff" },
  "ATTENTION NEEDED — LET'S TALK":  { bg: "#7f1d1d", text: "#ffffff" },
  "BUILDING TRACK RECORD":          { bg: "#6b7280", text: "#ffffff" },
};

function statusColor(label) {
  return STATUS_COLOR[label] || { bg: "#374151", text: "#ffffff" };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null) return "—";
  return Number(n).toFixed(decimals);
}

function pct(r) {
  if (r == null) return "—";
  return Math.round(r * 100) + "%";
}

function isShortClean(task) {
  const mins = parseTotalTime(task.total_time);
  return mins != null && mins < 15;
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmt12h(hour, minute) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function formatPeriodLabel(start, end) {
  const fmt2 = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${fmt2(start)} – ${fmt2(end)}`;
}

// ─── Excerpt extraction ────────────────────────────────────────────────────────
// Finds the first sentence in a review that contains the actual complaint rather
// than slicing from character 0 (which usually gets the positive opener).

const EXCERPT_NEGATIVE_SIGNALS = [
  "unfortunately", "however,", "but ", "issue", "problem", "concern",
  "disappointed", "not great", "not good", "wasn't clean", "wasn't cleaned",
  "wasn't working", "didn't work", "doesn't work", "couldn't",
  "broken", "broke", "damaged", "missing", "dirty", "filthy",
  "smell", "smelled", "odor", "mold", "mildew",
  "bug", "bugs", "roach", "insect",
  "leak", "leaking", "flooded", "clogged", "stuck",
  "torn", "ripped", "cracked", "stain",
  "ran out", "out of", "no toilet paper", "no paper", "no soap", "no towel",
];

function extractComplaintExcerpt(review) {
  const text =
    (review.review_text || "").trim() || (review.private_feedback || "").trim();
  if (!text) return null;

  // Split on sentence boundaries (period/!/?  followed by space or end)
  const sentences = text.match(/[^.!?]+(?:[.!?]|$)/g) || [text];

  const lower = (s) => s.toLowerCase();
  const complaintSentence = sentences.find((s) =>
    EXCERPT_NEGATIVE_SIGNALS.some((sig) => lower(s).includes(sig))
  );

  const chosen = (complaintSentence || sentences[0]).trim();
  return chosen.length > 160 ? chosen.slice(0, 159) + "…" : chosen;
}

// ─── Proactive Reporting Analysis ─────────────────────────────────────────────
// Cross-references complaint reviews against maintenance tasks filed between
// the vendor's last clean and the review date.
//
// Primary path: AI-classified complaint_indices from generateAISections().
// The AI reads full review context and identifies genuine cleaning complaints,
// eliminating the false-positive problem of pure keyword matching.
//
// Fallback path (aiComplaintIndices === null): keyword matching on enriched_tasks.
// Used when ANTHROPIC_API_KEY is absent or the AI call failed.
//
// Both paths work from vendor.enriched_tasks (review already matched to clean),
// so no second join across allReviews is needed.

// Keyword fallback signals — only used when AI is unavailable.
const COMPLAINT_SENTIMENT = [
  "unfortunately", "however,", "issue", "problem",
  "disappoint", "not great", "not good", "not what",
  "wasn't clean", "wasn't cleaned", "not clean", "not working",
  "didn't work", "wasn't working", "couldn't",
];

export function buildProactiveReporting(vendor, allTasks, aiComplaintIndices = null) {
  const enriched = vendor.enriched_tasks || [];

  // Determine which enriched tasks have complaint reviews
  let complaintTasks;
  if (aiComplaintIndices !== null) {
    // AI path: use exact indices the AI identified as genuine cleaning complaints
    complaintTasks = aiComplaintIndices
      .map((idx) => enriched[idx])
      .filter((t) => t?.review);
  } else {
    // Keyword fallback: physical complaint terms + negative sentiment on low-rated reviews
    complaintTasks = enriched.filter((t) => {
      if (!t.review) return false;
      const fullText = ((t.review.review_text || "") + " " + (t.review.private_feedback || "")).trim();
      const textLower = fullText.toLowerCase();
      const hasLow = t.review.cleanliness != null && t.review.cleanliness < 4;
      const hasNegativeSentiment = COMPLAINT_SENTIMENT.some((sig) => textLower.includes(sig));
      return hasPhysicalComplaint(fullText) || (hasLow && hasNegativeSentiment);
    });
  }

  const vendorIndividuals = new Set(
    enriched.map((t) => t.individual_name).filter(Boolean).map((n) => n.toLowerCase().trim())
  );
  vendorIndividuals.add(vendor.vendor_name.toLowerCase().trim());

  const maintTasks = allTasks.filter((t) =>
    (t.task_type || "").toLowerCase().includes("maintenance")
  );

  const rows = [];
  for (const task of complaintTasks) {
    const review = task.review;
    const reviewDate = review.submitted_at;
    const lastCleanDate = task.scheduled_date;
    if (!reviewDate || !lastCleanDate) continue;

    // Was a maintenance task filed by this vendor's team between the clean and the review?
    const filedTask = maintTasks.find((t) => {
      const propMatch =
        (t.bz_property_id && task.bz_property_id && t.bz_property_id === task.bz_property_id) ||
        (t.property_name && task.property_name && t.property_name === task.property_name);
      if (!propMatch) return false;
      const createdDate = t.created_at?.slice(0, 10);
      if (!createdDate || createdDate < lastCleanDate || createdDate > reviewDate) return false;
      const creator = (t.created_by || "").toLowerCase().trim();
      return vendorIndividuals.has(creator);
    });

    const excerpt = extractComplaintExcerpt(review);
    rows.push({
      property_name: task.property_name || "Unknown property",
      last_clean_date: lastCleanDate,
      review_date: reviewDate,
      cleanliness_score: review.cleanliness,
      complaint_excerpt: excerpt,
      task_filed: !!filedTask,
      task_title: filedTask?.task_title || null,
    });
  }

  // Dedupe: same property + clean date — prefer missed (worst case)
  const byKey = {};
  for (const row of rows) {
    const key = `${row.property_name}::${row.last_clean_date}`;
    if (!byKey[key] || (!row.task_filed && byKey[key].task_filed)) {
      byKey[key] = row;
    }
  }

  return Object.values(byKey).sort((a, b) => a.property_name.localeCompare(b.property_name));
}

// ─── Crew Breakdown ───────────────────────────────────────────────────────────
// Returns null for solo operators (one individual). Returns an array of per-crew
// stats when multiple individuals are found in the vendor's enriched tasks.

export function buildCrewBreakdown(vendor, allTasks) {
  const crewMap = {};

  for (const task of vendor.enriched_tasks || []) {
    const name = task.individual_name || vendor.vendor_name;
    if (!crewMap[name]) {
      crewMap[name] = { name, cleans: 0, scores: [], decided: 0, onTime: 0 };
    }
    const crew = crewMap[name];
    crew.cleans++;
    if (task.review?.cleanliness != null) crew.scores.push(task.review.cleanliness);
    if (task.decided) {
      crew.decided++;
      if (task.on_time) crew.onTime++;
    }
  }

  if (Object.keys(crewMap).length <= 1) return null;

  const maintTasks = allTasks.filter((t) =>
    (t.task_type || "").toLowerCase().includes("maintenance")
  );

  return Object.values(crewMap)
    .filter((c) => c.cleans > 0)
    .sort((a, b) => b.cleans - a.cleans)
    .map((crew) => {
      const nameLower = crew.name.toLowerCase().trim();
      return {
        name: crew.name,
        cleans: crew.cleans,
        quality_score:
          crew.scores.length > 0
            ? crew.scores.reduce((a, b) => a + b, 0) / crew.scores.length
            : null,
        on_time_rate: crew.decided > 0 ? crew.onTime / crew.decided : null,
        tasks_filed: maintTasks.filter(
          (t) => (t.created_by || "").toLowerCase().trim() === nameLower
        ).length,
      };
    });
}

// ─── One clear ask ────────────────────────────────────────────────────────────

function computeOneAsk(vendor, proactiveRows) {
  const missedCount = proactiveRows.filter((r) => !r.task_filed).length;
  if (missedCount > 0) {
    const s = missedCount === 1;
    return `File a Breezeway task immediately any time you notice an issue on a clean — broken items, missing supplies, anything that needs attention. ${s ? "A guest complaint" : `${missedCount} guest complaints`} this period ${s ? "wasn't" : "weren't"} preceded by a task from your team. Section 3 of your agreement makes this a requirement.`;
  }

  const shortCleans = (vendor.enriched_tasks || []).filter(isShortClean);
  if (shortCleans.length > 0) {
    const s = shortCleans.length === 1;
    return `${shortCleans.length} clean${s ? " was" : "s were"} logged in under 15 minutes this period. Take the full time each property needs — a quick run-through is what generates a complaint review.`;
  }

  if (vendor.on_time_rate != null && vendor.on_time_rate < 0.9) {
    const decided = Math.round((vendor.total_cleans || 0));
    const late = decided - Math.round((vendor.on_time_rate || 0) * decided);
    const s = late === 1;
    return `${late} clean${s ? "" : "s"} this period finished after the 4pm deadline. If you're running late, contact the office by 2pm (Section 2a of your agreement) so we can manage the guest.`;
  }

  const lowR = (vendor.enriched_tasks || []).filter(
    (t) => t.review?.cleanliness != null && t.review.cleanliness < 4
  );
  if (lowR.length > 0) {
    const s = lowR.length === 1;
    return `${lowR.length} review${s ? "" : "s"} this period rated cleanliness below 4 stars. Read what the guest said above and address those specific details on every clean.`;
  }

  if ((vendor.issues_created ?? 0) === 0 && (vendor.total_cleans || 0) >= 10) {
    return `You didn't file any Breezeway tasks this period across ${vendor.total_cleans} cleans. Something always needs attention — if you're noticing it and not logging it, that's a Section 3 gap. Start filing.`;
  }

  return `Keep doing what you're doing. Review your numbers with your team and find one thing to get even sharper on next month.`;
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderHeader(vendor, periodLabel, statusLabel, market) {
  const { bg, text } = statusColor(statusLabel);
  const marketLabel = { branson: "Branson Vistas", deep_creek: "Deep Creek Vistas", poconos: "Poconos Vistas" }[market] || market;
  const score = vendor.cleanliness_score != null ? fmt(vendor.cleanliness_score, 2) : null;
  const onTime = vendor.on_time_rate != null ? pct(vendor.on_time_rate) : null;
  const subParts = [
    `${vendor.total_cleans ?? 0} cleans`,
    vendor.property_count ? `${vendor.property_count} properties` : null,
    score ? `${score} quality` : null,
    onTime ? `${onTime} on-time` : null,
    `${vendor.issues_created ?? 0} tasks filed`,
  ].filter(Boolean);

  return `
    <div style="background:${bg};color:${text};padding:28px 32px;border-radius:8px 8px 0 0;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;opacity:0.85;margin-bottom:6px;">${esc(marketLabel)} — ${esc(periodLabel)}</div>
      <div style="font-size:26px;font-weight:700;margin-bottom:10px;">${esc(vendor.vendor_name)}</div>
      <span style="display:inline-block;background:rgba(255,255,255,0.2);color:${text};font-size:11px;font-weight:700;letter-spacing:0.1em;padding:4px 12px;border-radius:20px;">${esc(statusLabel)}</span>
      <div style="margin-top:10px;font-size:12px;opacity:0.8;">${subParts.join(" &nbsp;·&nbsp; ")}</div>
    </div>`;
}

function renderKpiStrip(vendor) {
  const score = vendor.cleanliness_score != null ? fmt(vendor.cleanliness_score, 2) : "—";
  const onTime = pct(vendor.on_time_rate);
  const cleans = vendor.total_cleans ?? 0;
  const issues = vendor.issues_created ?? 0;

  const kpi = (label, value, note, last = false) => `
    <div style="flex:1;text-align:center;padding:18px 10px;${last ? "" : "border-right:1px solid #e5e7eb;"}">
      <div style="font-size:26px;font-weight:700;color:#111827;">${value}</div>
      <div style="font-size:11px;font-weight:600;color:#6b7280;margin-top:4px;letter-spacing:0.05em;">${label}</div>
      ${note ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;">${note}</div>` : ""}
    </div>`;

  return `
    <div style="display:flex;background:#f9fafb;border:1px solid #e5e7eb;border-top:none;">
      ${kpi("QUALITY SCORE", score, "goal: &ge; 4.8")}
      ${kpi("ON-TIME RATE", onTime, "goal: &ge; 90%")}
      ${kpi("CLEANS", cleans, "this period")}
      ${kpi("ISSUES REPORTED", issues, "via Breezeway", true)}
    </div>`;
}

function renderCelebrate(vendor, aiSections) {
  const enriched = vendor.enriched_tasks || [];
  const issues = vendor.issues || [];

  // AI prose when available
  if (aiSections?.celebrate) {
    // Still show the 3 best quotes below the AI paragraph — data, not prose
    const withText = enriched
      .filter((t) => t.review?.cleanliness === 5 && t.review.review_text && hasPositiveKeywords(t.review.review_text))
      .slice(0, 3);

    const quotes = withText.length > 0
      ? `<ul style="margin:12px 0 0;padding-left:20px;">${withText
          .map((t) => `<li style="margin-bottom:8px;">"${esc(t.review.review_text)}"${t.property_name ? ` <span style="color:#6b7280;font-size:12px;">— ${esc(t.property_name)}</span>` : ""}</li>`)
          .join("")}</ul>`
      : "";

    return `
      <div style="border:1px solid #d1fae5;border-top:none;background:#f0fdf4;padding:22px 28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#065f46;margin-bottom:10px;">CELEBRATE</div>
        <div style="color:#1f2937;font-size:14px;line-height:1.6;">
          <p style="margin:0;">${esc(aiSections.celebrate)}</p>
          ${quotes}
        </div>
      </div>`;
  }

  // Template fallback
  const lines = [];
  const fiveStars = enriched.filter((t) => t.review?.cleanliness === 5);

  if (fiveStars.length > 0) {
    lines.push(`<p style="margin:0 0 10px;"><strong>${fiveStars.length} five-star cleanliness rating${fiveStars.length !== 1 ? "s" : ""}</strong> this period.</p>`);
    const withText = fiveStars
      .filter((t) => t.review.review_text && hasPositiveKeywords(t.review.review_text))
      .slice(0, 3);
    if (withText.length > 0) {
      const quotes = withText
        .map((t) => `<li style="margin-bottom:8px;">"${esc(t.review.review_text)}"${t.property_name ? ` <span style="color:#6b7280;font-size:12px;">— ${esc(t.property_name)}</span>` : ""}</li>`)
        .join("");
      lines.push(`<ul style="margin:0 0 12px;padding-left:20px;">${quotes}</ul>`);
    }
  } else {
    lines.push(`<p style="margin:0 0 10px;color:#374151;">No five-star cleanliness reviews this period — keep pushing for that top score.</p>`);
  }

  if (issues.length > 0) {
    const notable = issues.filter((i) => i.task_title || i.description).slice(0, 2);
    if (notable.length > 0) {
      lines.push(`<p style="margin:10px 0 4px;font-weight:600;">You reported ${issues.length} maintenance issue${issues.length !== 1 ? "s" : ""} this period — that protects properties and guests:</p>`);
      const examples = notable
        .map((i) => `<li style="margin-bottom:6px;">${esc(i.property_name)} (${fmtDate(i.created_at?.slice(0, 10))}): ${esc((i.description || i.task_title || "").slice(0, 100))}</li>`)
        .join("");
      lines.push(`<ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">${examples}</ul>`);
    } else {
      lines.push(`<p style="margin:10px 0 0;"><strong>You filed ${issues.length} maintenance issue${issues.length !== 1 ? "s" : ""} via Breezeway.</strong> Reporting problems promptly protects the property and the guest experience.</p>`);
    }
  }

  return `
    <div style="border:1px solid #d1fae5;border-top:none;background:#f0fdf4;padding:22px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#065f46;margin-bottom:10px;">CELEBRATE</div>
      <div style="color:#1f2937;font-size:14px;line-height:1.6;">${lines.join("")}</div>
    </div>`;
}

function renderAddress(vendor, aiSections) {
  const enriched = vendor.enriched_tasks || [];
  const items = [];

  // Low cleanliness reviews (< 4) with property name and excerpt
  const lowR = enriched
    .filter((t) => t.review?.cleanliness != null && t.review.cleanliness < 4)
    .map((t) => ({ review: t.review, property: t.property_name }));

  if (lowR.length > 0) {
    const reviewLines = lowR.slice(0, 3).map(({ review, property }) => {
      const excerpt = extractComplaintExcerpt(review);
      const display = excerpt ? `"${esc(excerpt)}"` : `${review.cleanliness}&#9733; — no written comment`;
      return `<li style="margin-bottom:8px;">${property ? `<strong>${esc(property)}</strong>: ` : ""}${display}</li>`;
    });
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Low cleanliness ratings (${lowR.length})</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">${reviewLines.join("")}</ul>
      </div>`);
  }

  // Short cleans with property + date + duration
  const shortCleans = enriched.filter(isShortClean);
  if (shortCleans.length > 0) {
    const examples = shortCleans.slice(0, 3).map((t) => {
      const mins = parseTotalTime(t.total_time);
      const dur = mins != null ? `${Math.round(mins)} min` : "under 15 min";
      return `<li style="margin-bottom:5px;"><strong>${esc(t.property_name || "Unknown")}</strong> on ${fmtDate(t.scheduled_date)} — logged at ${dur}</li>`;
    });
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Short cleans flagged (${shortCleans.length})</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">${examples.join("")}</ul>
        <p style="margin:8px 0 0;color:#374151;font-size:13px;">A full clean takes longer than 15 minutes. Review your process at these properties.</p>
      </div>`);
  }

  // Late cleans
  const lateCleans = enriched.filter((t) => t.decided && !t.on_time);
  if (lateCleans.length > 0) {
    const examples = lateCleans.slice(0, 3).map((t) => {
      const finTime = t.finished_cst
        ? `finished ${fmt12h(t.finished_cst.hour, t.finished_cst.minute)} ${t.tz_abbr || ""}`.trim()
        : "finished after deadline";
      return `<li style="margin-bottom:5px;"><strong>${esc(t.property_name || "Unknown")}</strong> on ${fmtDate(t.scheduled_date)} — ${finTime}</li>`;
    });
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Late completions (${lateCleans.length}) — Section 2</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">${examples.join("")}</ul>
        <p style="margin:8px 0 0;color:#374151;font-size:13px;">Cleans must be done by 4pm. If you're running late, call the office by 2pm (Section 2a).</p>
      </div>`);
  }

  // GS-filed issues at vendor's properties
  const gsIssues = (vendor.issues || []).filter((i) => {
    const creator = (i.created_by || "").toLowerCase();
    return creator.includes("guest services") || creator.includes("gs ");
  });
  if (gsIssues.length > 0) {
    items.push(`
      <div style="margin-bottom:0;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Issues filed by Guest Services on your properties (${gsIssues.length})</div>
        <p style="margin:0;color:#374151;font-size:14px;">Our team caught these — they should have been caught and reported by you per <strong>Section 3</strong> of your agreement. Review what was missed and report before you leave on every future clean.</p>
      </div>`);
  }

  // AI intro paragraph: a natural-language summary of what needs to change
  // and why, written for the specific vendor. Sits above the factual lists.
  const aiIntro = aiSections?.address
    ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">${esc(aiSections.address)}</p>`
    : "";

  if (items.length === 0 && !aiIntro) {
    return `
      <div style="border:1px solid #fde68a;border-top:none;background:#fffbeb;padding:22px 28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#92400e;margin-bottom:10px;">ADDRESS</div>
        <p style="margin:0;color:#374151;font-size:14px;">Nothing to address this period. Great work — keep it up.</p>
      </div>`;
  }

  return `
    <div style="border:1px solid #fde68a;border-top:none;background:#fffbeb;padding:22px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#92400e;margin-bottom:10px;">ADDRESS</div>
      ${aiIntro}${items.join("")}
    </div>`;
}

function renderProactiveReporting(proactiveRows) {
  const missedRows = proactiveRows.filter((r) => !r.task_filed);
  const protectedRows = proactiveRows.filter((r) => r.task_filed);

  let intro = "";
  if (proactiveRows.length === 0) {
    intro = `<p style="margin:0;color:#374151;font-size:14px;">No guest complaints were flagged at your properties this period. Keep logging what you see on every clean.</p>`;
  } else if (missedRows.length === 0) {
    intro = `<p style="margin:0;color:#374151;font-size:14px;">Every flagged complaint this period had a task filed by your team before the guest surfaced it. That is exactly what Section 3 requires — keep it up.</p>`;
  } else {
    const s = missedRows.length === 1;
    intro = `<p style="margin:0 0 12px;color:#374151;font-size:14px;">Your agreement (Section 3) requires a Breezeway task any time you notice an issue — missing items, damage, anything that needs attention. ${s ? "A guest complaint was" : `${missedRows.length} guest complaints were`} reported this period at ${s ? "a property" : "properties"} you cleaned where no task was filed first.</p>`;
  }

  if (proactiveRows.length === 0) {
    return `
      <div style="border:1px solid #e5e7eb;border-top:none;background:#f9fafb;padding:22px 28px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#374151;margin-bottom:10px;">PROACTIVE REPORTING — SECTION 3</div>
        ${intro}
      </div>`;
  }

  const tableRows = proactiveRows
    .map((r) => {
      const filed = r.task_filed;
      const statusCell = filed
        ? `<td style="padding:8px 10px;color:#065f46;font-weight:600;white-space:nowrap;">&#10003; Filed</td>`
        : `<td style="padding:8px 10px;color:#b91c1c;font-weight:600;white-space:nowrap;">&#10007; Missed</td>`;
      const rowBg = filed ? "#f0fdf4" : "#fef2f2";
      const excerpt = r.complaint_excerpt
        ? `"${esc(r.complaint_excerpt)}"`
        : r.cleanliness_score != null
        ? `${r.cleanliness_score}&#9733; cleanliness`
        : "—";
      return `
        <tr style="background:${rowBg};border-top:1px solid #e5e7eb;">
          <td style="padding:8px 10px;font-weight:600;font-size:13px;">${esc(r.property_name)}</td>
          <td style="padding:8px 10px;white-space:nowrap;font-size:13px;">${fmtDate(r.last_clean_date)}</td>
          <td style="padding:8px 10px;font-size:13px;color:#4b5563;max-width:220px;">${excerpt}</td>
          ${statusCell}
        </tr>`;
    })
    .join("");

  const table = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
      <thead>
        <tr style="background:#f3f4f6;border:1px solid #e5e7eb;">
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">PROPERTY</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">YOUR LAST CLEAN</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">WHAT GUEST SAID</th>
          <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">TASK FILED?</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;

  const protectedNote = protectedRows.length > 0 && missedRows.length > 0
    ? `<p style="margin:10px 0 0;font-size:13px;color:#065f46;">&#10003; ${protectedRows.length} complaint${protectedRows.length !== 1 ? "s" : ""} had a task filed first — that protected the property.</p>`
    : "";

  return `
    <div style="border:1px solid #e5e7eb;border-top:none;background:#ffffff;padding:22px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#374151;margin-bottom:10px;">PROACTIVE REPORTING — SECTION 3</div>
      ${intro}
      ${table}
      ${protectedNote}
    </div>`;
}

function renderCrewBreakdown(crewBreakdown, vendor) {
  if (!crewBreakdown || crewBreakdown.length <= 1) return "";

  const totals = crewBreakdown.reduce(
    (acc, c) => {
      acc.cleans += c.cleans;
      acc.tasks_filed += c.tasks_filed;
      if (c.quality_score != null) { acc.scoreSum += c.quality_score * c.cleans; acc.scoreCount += c.cleans; }
      if (c.on_time_rate != null) { acc.otSum += c.on_time_rate * (c.cleans); acc.otCount += c.cleans; }
      return acc;
    },
    { cleans: 0, tasks_filed: 0, scoreSum: 0, scoreCount: 0, otSum: 0, otCount: 0 }
  );

  const crewRows = crewBreakdown
    .map((c) => {
      const qs = c.quality_score != null ? fmt(c.quality_score, 2) : "—";
      const ot = c.on_time_rate != null ? pct(c.on_time_rate) : "—";
      const smallSample = c.cleans < 3
        ? ` <span style="color:#9ca3af;font-size:11px;font-weight:400;">(limited sample)</span>`
        : "";
      return `
        <tr style="border-top:1px solid #e5e7eb;">
          <td style="padding:8px 10px;font-weight:600;font-size:13px;">${esc(c.name)}${smallSample}</td>
          <td style="padding:8px 10px;text-align:center;font-size:13px;">${c.cleans}</td>
          <td style="padding:8px 10px;text-align:center;font-size:13px;">${qs}</td>
          <td style="padding:8px 10px;text-align:center;font-size:13px;">${ot}</td>
          <td style="padding:8px 10px;text-align:center;font-size:13px;">${c.tasks_filed}</td>
        </tr>`;
    })
    .join("");

  const totalQs = totals.scoreCount > 0 ? fmt(totals.scoreSum / totals.scoreCount, 2) : "—";
  const totalOt = totals.otCount > 0 ? pct(totals.otSum / totals.otCount) : "—";
  const totalsRow = `
    <tr style="border-top:2px solid #d1d5db;background:#f9fafb;font-weight:700;">
      <td style="padding:8px 10px;font-size:13px;">Total</td>
      <td style="padding:8px 10px;text-align:center;font-size:13px;">${totals.cleans}</td>
      <td style="padding:8px 10px;text-align:center;font-size:13px;">${totalQs}</td>
      <td style="padding:8px 10px;text-align:center;font-size:13px;">${totalOt}</td>
      <td style="padding:8px 10px;text-align:center;font-size:13px;">${totals.tasks_filed}</td>
    </tr>`;

  return `
    <div style="border:1px solid #e5e7eb;border-top:none;background:#ffffff;padding:22px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#374151;margin-bottom:10px;">YOUR CREW</div>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;">Here is how each crew member performed this period.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;border:1px solid #e5e7eb;">
            <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">CREW MEMBER</th>
            <th style="padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">CLEANS</th>
            <th style="padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">AVG QUALITY</th>
            <th style="padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">ON-TIME</th>
            <th style="padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.05em;">TASKS FILED</th>
          </tr>
        </thead>
        <tbody>
          ${crewRows}
          ${totalsRow}
        </tbody>
      </table>
    </div>`;
}

function renderOneAsk(vendor, proactiveRows, aiSections) {
  const ask = aiSections?.one_ask || computeOneAsk(vendor, proactiveRows);
  return `
    <div style="border:1px solid #e5e7eb;border-top:none;background:#f9fafb;padding:22px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#374151;margin-bottom:10px;">THIS MONTH, DO THIS</div>
      <p style="margin:0;color:#111827;font-size:14px;line-height:1.7;">${esc(ask)}</p>
    </div>`;
}

function renderDisclaimer() {
  return `
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:16px 28px;background:#ffffff;">
      <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">This report was generated automatically using your Breezeway and Guesty data. We review for accuracy, but it's possible something is missing or context that matters isn't captured here. If anything doesn't match your experience, bring it to your account manager.</p>
    </div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildCleanerReport(vendor, periodStart, periodEnd, { proactiveRows = [], crewBreakdown = null, aiSections = null } = {}) {
  const periodLabel = formatPeriodLabel(periodStart, periodEnd);
  const statusLabel = assignStatusLabel(
    vendor.cleanliness_score,
    vendor.on_time_rate,
    vendor.total_cleans ?? 0,
    vendor.issues_created ?? 0
  );

  const sections = [
    renderHeader(vendor, periodLabel, statusLabel, vendor.market),
    renderKpiStrip(vendor),
    renderCelebrate(vendor, aiSections),
    renderAddress(vendor, aiSections),
    renderProactiveReporting(proactiveRows),
    renderCrewBreakdown(crewBreakdown, vendor),
    renderOneAsk(vendor, proactiveRows, aiSections),
    renderDisclaimer(),
  ];

  const body = sections.filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(vendor.vendor_name)} — Performance Report ${esc(periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .card { max-width: 680px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 8px; overflow: hidden; }
  @media print {
    body { background: white; padding: 0; }
    .card { box-shadow: none; }
  }
</style>
</head>
<body>
<div class="card">
${body}
</div>
</body>
</html>`;
}
