import { parseTotalTime } from "@/lib/scorecard";
import { scanReviewText, hasPositiveKeywords } from "@/lib/keywords";

// ─── Status label assignment ──────────────────────────────────────────────────

// Thresholds for status labels. These match the logic from the sample report.
// score: cleanliness_score (0-5), onTime: on_time_rate (0-1), cleans: total_cleans
export function assignStatusLabel(score, onTime, cleans, issuesCreated) {
  if (cleans < 15) return "WATCH — SMALL SAMPLE";

  const scoreOk  = score == null || score >= 4.8;
  const timeOk   = onTime == null || onTime >= 0.9;
  const reports  = issuesCreated >= 3;

  if (scoreOk && timeOk && reports)  return "TOP PERFORMER";
  if (scoreOk && timeOk && !reports) return "FLAG — NOT REPORTING ISSUES";
  if (scoreOk && !timeOk && reports) return "STRONG — ONE GAP";
  if (scoreOk && !timeOk && !reports) return "STRONG — TWO ISSUES TO DISCUSS";
  if (!scoreOk && timeOk && issuesCreated === 0) return "NEEDS ATTENTION — NOT REPORTING";
  if (!scoreOk && timeOk)             return "NEEDS COACHING";
  return "NEEDS ATTENTION — FORMAL CONVERSATION";
}

// ─── Colour map for status labels ────────────────────────────────────────────

const STATUS_COLOR = {
  "TOP PERFORMER":                    { bg: "#1a7a3c", text: "#ffffff" },
  "FLAG — NOT REPORTING ISSUES":      { bg: "#b91c1c", text: "#ffffff" },
  "STRONG — ONE GAP":                 { bg: "#0e7490", text: "#ffffff" },
  "STRONG — TWO ISSUES TO DISCUSS":   { bg: "#0e7490", text: "#ffffff" },
  "NEEDS COACHING":                   { bg: "#b45309", text: "#ffffff" },
  "NEEDS ATTENTION — NOT REPORTING":  { bg: "#7f1d1d", text: "#ffffff" },
  "NEEDS ATTENTION — FORMAL CONVERSATION": { bg: "#7f1d1d", text: "#ffffff" },
  "WATCH — SMALL SAMPLE":             { bg: "#6b7280", text: "#ffffff" },
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

// Returns reviews rated <= 3 stars (cleanliness score)
function lowReviews(enrichedTasks) {
  return enrichedTasks
    .map((t) => t.review)
    .filter((r) => r && r.cleanliness != null && r.cleanliness <= 3);
}

// Returns reviews rated 5 stars
function highReviews(enrichedTasks) {
  return enrichedTasks
    .map((t) => t.review)
    .filter((r) => r && r.cleanliness === 5);
}

// Escape HTML entities in user-generated text
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderHeader(vendor, periodLabel, statusLabel, market) {
  const { bg, text } = statusColor(statusLabel);
  const marketLabel = { branson: "Branson Vistas", deep_creek: "Deep Creek Vistas", poconos: "Poconos Vistas" }[market] || market;
  return `
    <div style="background:${bg};color:${text};padding:28px 32px;border-radius:8px 8px 0 0;">
      <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;opacity:0.85;margin-bottom:6px;">${esc(marketLabel)} — ${esc(periodLabel)}</div>
      <div style="font-size:26px;font-weight:700;margin-bottom:10px;">${esc(vendor.vendor_name)}</div>
      <span style="display:inline-block;background:rgba(255,255,255,0.2);color:${text};font-size:11px;font-weight:700;letter-spacing:0.1em;padding:4px 12px;border-radius:20px;">${esc(statusLabel)}</span>
    </div>`;
}

function renderKpiStrip(vendor) {
  const score = vendor.cleanliness_score != null ? fmt(vendor.cleanliness_score, 2) : "—";
  const onTime = pct(vendor.on_time_rate);
  const cleans = vendor.total_cleans ?? 0;
  const issues = vendor.issues_created ?? 0;

  const kpi = (label, value, note) => `
    <div style="flex:1;text-align:center;padding:20px 12px;border-right:1px solid #e5e7eb;">
      <div style="font-size:28px;font-weight:700;color:#111827;">${value}</div>
      <div style="font-size:11px;font-weight:600;color:#6b7280;margin-top:4px;letter-spacing:0.05em;">${label}</div>
      ${note ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;">${note}</div>` : ""}
    </div>`;

  return `
    <div style="display:flex;background:#f9fafb;border:1px solid #e5e7eb;border-top:none;">
      ${kpi("QUALITY SCORE", score, "avg cleanliness")}
      ${kpi("ON-TIME RATE", onTime, "4 PM deadline")}
      ${kpi("CLEANS", cleans, "this period")}
      <div style="flex:1;text-align:center;padding:20px 12px;">
        <div style="font-size:28px;font-weight:700;color:#111827;">${issues}</div>
        <div style="font-size:11px;font-weight:600;color:#6b7280;margin-top:4px;letter-spacing:0.05em;">ISSUES FILED</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:2px;">via Breezeway</div>
      </div>
    </div>`;
}

function renderCelebrate(vendor) {
  const fiveStars = highReviews(vendor.enriched_tasks || []);
  const proactiveTasks = vendor.issues_created ?? 0;

  const lines = [];

  if (fiveStars.length > 0) {
    lines.push(`<p style="margin:0 0 10px;">You earned <strong>${fiveStars.length} five-star cleanliness rating${fiveStars.length !== 1 ? "s" : ""}</strong> this period. Here are some of the things guests noticed:</p>`);
    const withText = fiveStars.filter((r) => r.review_text && hasPositiveKeywords(r.review_text)).slice(0, 3);
    if (withText.length > 0) {
      const quotes = withText.map((r) => `<li style="margin-bottom:8px;">"${esc(r.review_text)}"</li>`).join("");
      lines.push(`<ul style="margin:0 0 12px;padding-left:20px;">${quotes}</ul>`);
    } else if (fiveStars.length > 0) {
      lines.push(`<p style="margin:0 0 10px;color:#374151;">${fiveStars.length} guest${fiveStars.length !== 1 ? "s" : ""} gave you top marks for cleanliness this period.</p>`);
    }
  } else {
    lines.push(`<p style="margin:0;color:#374151;">No five-star cleanliness reviews this period — keep pushing for that top score.</p>`);
  }

  if (proactiveTasks > 0) {
    lines.push(`<p style="margin:10px 0 0;"><strong>You filed ${proactiveTasks} maintenance issue${proactiveTasks !== 1 ? "s" : ""} via Breezeway.</strong> Reporting problems promptly protects the property and the guest experience — this is exactly what we ask for.</p>`);
  }

  return `
    <div style="border:1px solid #d1fae5;border-top:none;background:#f0fdf4;padding:24px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#065f46;margin-bottom:12px;">CELEBRATE</div>
      <div style="color:#1f2937;font-size:14px;line-height:1.6;">${lines.join("")}</div>
    </div>`;
}

function renderAddress(vendor) {
  const lowR = lowReviews(vendor.enriched_tasks || []);
  const shortCleans = (vendor.enriched_tasks || []).filter(isShortClean);
  const gsIssues = (vendor.issues || []).filter((i) => {
    const creator = (i.created_by || "").toLowerCase();
    return creator.includes("guest services") || creator.includes("gs ");
  });

  // Keyword hits from low reviews
  const keywordHits = [];
  const catMap = {};
  for (const r of lowR) {
    const hits = scanReviewText(r.review_text || r.private_feedback || "");
    for (const hit of hits) {
      if (!catMap[hit.section]) {
        catMap[hit.section] = { ...hit, count: 0 };
        keywordHits.push(catMap[hit.section]);
      }
      catMap[hit.section].count++;
    }
  }

  const items = [];

  if (lowR.length > 0) {
    const reviewLines = lowR.slice(0, 3).map((r) => {
      const txt = r.review_text || r.private_feedback || "";
      return `<li style="margin-bottom:8px;">${txt ? `"${esc(txt)}"` : `${r.cleanliness}-star rating (no written comment)`} — ${r.cleanliness}&#9733;</li>`;
    });
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Low cleanliness ratings (${lowR.length})</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">${reviewLines.join("")}</ul>
      </div>`);
  }

  if (keywordHits.length > 0) {
    const hitLines = keywordHits.map((h) =>
      `<li style="margin-bottom:6px;">Guests mentioned <strong>${h.matches.slice(0, 3).join(", ")}</strong> — review <strong>Section ${h.section}</strong> of your cleaning agreement (${h.label}).</li>`
    ).join("");
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Agreement reminders from guest feedback</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">${hitLines}</ul>
      </div>`);
  }

  if (shortCleans.length > 0) {
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Short cleans flagged (${shortCleans.length})</div>
        <p style="margin:0;color:#374151;font-size:14px;">${shortCleans.length} clean${shortCleans.length !== 1 ? "s" : ""} completed in under 15 minutes. A full clean typically takes longer — please review your process and ensure the property meets standards on every visit.</p>
      </div>`);
  }

  if (gsIssues.length > 0) {
    items.push(`
      <div style="margin-bottom:16px;">
        <div style="font-weight:600;color:#111827;margin-bottom:6px;">Issues filed by Guest Services on your properties (${gsIssues.length})</div>
        <p style="margin:0;color:#374151;font-size:14px;">These are issues our team caught that should have been reported through Breezeway per <strong>Section 3</strong> of your agreement. Please review and ensure your crew is reporting all property issues before leaving.</p>
      </div>`);
  }

  if (items.length === 0) {
    items.push(`<p style="margin:0;color:#374151;font-size:14px;">Nothing to address this period. Great work — keep it up.</p>`);
  }

  return `
    <div style="border:1px solid #fde68a;border-top:none;background:#fffbeb;padding:24px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#92400e;margin-bottom:12px;">ADDRESS</div>
      ${items.join("")}
    </div>`;
}

function renderWhatsNext() {
  return `
    <div style="border:1px solid #e5e7eb;border-top:none;background:#f9fafb;padding:24px 28px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#374151;margin-bottom:12px;">WHAT'S NEXT</div>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">Please review your report card, dig through your results, celebrate the wins (especially if you have crews), and devise a plan for ever better results next month. A member of our team will connect with you about your findings so be ready with your action plan if one is needed.</p>
    </div>`;
}

function renderDisclaimer() {
  return `
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:16px 28px;background:#ffffff;">
      <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">This report was generated automatically using your Breezeway and Guesty data. We review for accuracy, but it's possible something is missing or context that matters isn't captured here. If anything doesn't match your experience, bring it to your account manager.</p>
    </div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function buildCleanerReport(vendor, periodStart, periodEnd) {
  const periodLabel = formatPeriodLabel(periodStart, periodEnd);
  const statusLabel = assignStatusLabel(
    vendor.cleanliness_score,
    vendor.on_time_rate,
    vendor.total_cleans ?? 0,
    vendor.issues_created ?? 0
  );

  const body = [
    renderHeader(vendor, periodLabel, statusLabel, vendor.market),
    renderKpiStrip(vendor),
    renderCelebrate(vendor),
    renderAddress(vendor),
    renderWhatsNext(),
    renderDisclaimer(),
  ].join("\n");

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

function formatPeriodLabel(start, end) {
  const fmt = (d) => {
    const dt = new Date(d + "T12:00:00Z");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}
