// Ported from branson-dashboard src/App.jsx
// All on-time logic, review matching, and stat computation lives here
// so it can be used both in API routes (server) and client components.

// Deep Creek and Poconos are Eastern time; Branson is Central.
const MARKET_TZ = {
  branson: "America/Chicago",
  deep_creek: "America/New_York",
  poconos: "America/New_York",
};

export function marketTZ(market) {
  return MARKET_TZ[market] || "America/Chicago";
}

// Returns the short abbreviation (CST/CDT or EST/EDT) for a given market at a given UTC time.
export function tzAbbr(market, utcDateStr) {
  const tz = marketTZ(market);
  try {
    const dt = new Date(utcDateStr || Date.now());
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(dt)
      .find(p => p.type === "timeZoneName")?.value || (tz === "America/New_York" ? "ET" : "CT");
  } catch {
    return tz === "America/New_York" ? "ET" : "CT";
  }
}

function toUTCStr(dtStr) {
  if (!dtStr) return null;
  if (dtStr.endsWith("Z")) return dtStr;
  // Supabase returns "YYYY-MM-DD HH:MM:SS+00" — normalize to valid ISO 8601
  return dtStr.replace(" ", "T").replace(/\+00(:00)?$/, "Z");
}

export function toLocalParts(dtStr, tz) {
  const utcStr = toUTCStr(dtStr);
  if (!utcStr) return null;
  try {
    const dt = new Date(utcStr);
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(dt)
      .forEach((p) => {
        parts[p.type] = p.value;
      });
    return {
      dateStr: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parseInt(parts.hour),
      minute: parseInt(parts.minute),
    };
  } catch {
    return null;
  }
}

// Kept for backwards compatibility — callers without a market context use Chicago time.
export function toCSTparts(dtStr) {
  return toLocalParts(dtStr, "America/Chicago");
}

export function isCleanTask(t) {
  // All tasks fetched from Breezeway are cleaning tasks; task_title may be null
  if (!t.task_title) return true;
  return t.task_title.toLowerCase().includes("clean");
}

export function isCleanerTask(t) {
  // All tasks fetched from Breezeway are cleaning tasks; fields may be null
  if (!t.task_title && !t.task_type) return true;
  const title = (t.task_title || "").toLowerCase();
  const type = (t.task_type || "").toLowerCase();
  return title.includes("clean") || type.includes("clean") || type.includes("issue");
}

// checkIns: array of { listing_id, check_in_date } for a given property
// Returns the check-in on the same day as t.scheduled_date, if any
export function getCiInfo(t, checkIns) {
  if (!t.scheduled_date || !checkIns?.length) return null;
  return checkIns.find(
    (ci) => ci.listing_id === t.listing_id && ci.check_in_date === t.scheduled_date
  ) || null;
}

// Returns the next check-in date after the task's scheduled_date
export function getNextCheckInDate(t, checkIns) {
  if (!t.scheduled_date || !checkIns?.length) return null;
  const future = checkIns
    .filter((ci) => ci.listing_id === t.listing_id && ci.check_in_date > t.scheduled_date)
    .map((ci) => ci.check_in_date)
    .sort();
  return future[0] || null;
}

export function isOnTime(t, checkIns, tz) {
  if (!t.finished_at || !t.scheduled_date) return false;
  const local = toLocalParts(t.finished_at, tz || marketTZ(t.market));
  if (!local) return false;

  if (local.dateStr < t.scheduled_date) return true;

  const ciInfo = getCiInfo(t, checkIns);
  if (ciInfo) {
    if (local.dateStr > t.scheduled_date) return false;
    return local.hour < 16 || (local.hour === 16 && local.minute === 0);
  }

  const nextCi = getNextCheckInDate(t, checkIns);
  if (!nextCi) return true;
  if (local.dateStr < nextCi) return true;
  if (local.dateStr === nextCi) return local.hour < 16 || (local.hour === 16 && local.minute === 0);
  return false;
}

export function isDecided(t, tz) {
  if (t.finished_at) return true;
  // Past 4PM in the market's local time and no finish → decided as overdue
  const today = toLocalParts(new Date().toISOString(), tz || marketTZ(t.market));
  if (!today) return false;
  if (t.scheduled_date < today.dateStr) return true;
  if (t.scheduled_date === today.dateStr && today.hour >= 16) return true;
  return false;
}

export function parseTotalTime(totalTime) {
  if (!totalTime) return null;
  const parts = totalTime.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calcStats(tasks, checkIns) {
  const cleans = tasks.filter(isCleanTask);
  const decided = cleans.filter((t) => isDecided(t));
  const onTimeTasks = decided.filter((t) => isOnTime(t, checkIns));
  const overdue = tasks.filter((t) => t.clean_status === "Overdue");
  return {
    total_cleans: cleans.length,
    total_tasks: tasks.filter(isCleanerTask).length,
    on_time: onTimeTasks.length,
    decided: decided.length,
    on_time_rate: decided.length > 0 ? onTimeTasks.length / decided.length : null,
    tasks_overdue: overdue.length,
  };
}

export function computeMedianTime(tasks) {
  const mins = tasks.filter(isCleanTask).map((t) => parseTotalTime(t.total_time)).filter(Boolean);
  return median(mins);
}

// Build bz_property_id → listing_id bridge from reviews (most reliable source)
export function buildPropertyBridge(reviews) {
  const bridge = {};
  for (const r of reviews) {
    if (r.bz_property_id && r.listing_id) {
      bridge[r.bz_property_id] = r.listing_id;
    }
  }
  return bridge;
}

// Match reviews to tasks — each review assigned to at most one task
export function buildTaskReviewMap(tasks, reviews, bridge) {
  const taskReviewMap = {};
  const claimedReviewIds = new Set();

  // Sort tasks by scheduled_date desc so newest task gets priority
  const sortedTasks = [...tasks].filter(isCleanTask).sort((a, b) =>
    b.scheduled_date.localeCompare(a.scheduled_date)
  );

  for (const task of sortedTasks) {
    // task.listing_id is pre-enriched by api/data/route.js via guesty_properties nickname match
    const taskListingId = task.listing_id || (task.bz_property_id ? bridge[task.bz_property_id] : null);
    const taskDate = task.scheduled_date;

    // Find the closest review for this property submitted 0-60 days after the clean.
    // submitted_at is a date-only field, so a guest who checks out and reviews on the
    // same calendar day as the clean has daysDiff = 0 — these are valid reviews to include.
    // We use >= 0 (not >= 1) because same-day reviews are common and legitimate.
    // Anchor taskDate at noon UTC so date subtraction is timezone-neutral.
    const taskDateMs = new Date(taskDate + "T12:00:00Z").getTime();
    const candidates = reviews.filter((r) => {
      if (claimedReviewIds.has(r.review_id)) return false;
      const rListingId = r.listing_id;
      const propertyMatch =
        (taskListingId && rListingId && taskListingId === rListingId) ||
        (r.property_name && task.property_name && r.property_name === task.property_name);
      if (!propertyMatch) return false;
      const daysDiff = (new Date(r.submitted_at).getTime() - taskDateMs) / 86400000;
      return daysDiff >= 0 && daysDiff <= 60;
    });

    if (candidates.length > 0) {
      // Pick the closest review
      candidates.sort(
        (a, b) =>
          Math.abs(new Date(a.submitted_at).getTime() - taskDateMs) -
          Math.abs(new Date(b.submitted_at).getTime() - taskDateMs)
      );
      const winner = candidates[0];
      taskReviewMap[task.task_id] = winner;
      claimedReviewIds.add(winner.review_id);
    }
  }

  return taskReviewMap;
}

// Get the check-in deadline info for a task (for display in drill-down)
export function getDeadlineInfo(t, checkIns) {
  const ciInfo = getCiInfo(t, checkIns);
  if (ciInfo) return { date: t.scheduled_date, type: "same-day" };
  const nextCi = getNextCheckInDate(t, checkIns);
  if (nextCi) return { date: nextCi, type: "next-ci" };
  return { date: null, type: "none" };
}

// Determine if a refund should be attributed to cleaner fault
export function isCleanerFaultRefund(refund) {
  return (refund.refund_reason || "").toLowerCase().includes("cleaner fault");
}

// Get refunds linked to a specific task (within 45-day window, same property)
export function getLinkedRefunds(task, refunds, bridge) {
  if (!isCleanTask(task) || !task.scheduled_date) return [];
  const d0 = task.scheduled_date;
  const cutoff = new Date(d0 + "T12:00:00Z");
  cutoff.setDate(cutoff.getDate() + 45);
  const d1 = cutoff.toISOString().slice(0, 10);
  const taskListingId = task.listing_id || (task.bz_property_id ? bridge[task.bz_property_id] : null);

  return refunds.filter((r) => {
    if (!isCleanerFaultRefund(r)) return false;
    // CRITICAL: refund.listing_id must come from the same market — enforced by market-scoped queries
    const idMatch = taskListingId && r.listing_id && taskListingId === r.listing_id;
    const nameMatch = !idMatch && r.property_name && r.property_name === task.property_name;
    if (!idMatch && !nameMatch) return false;
    return r.refund_date >= d0 && r.refund_date <= d1;
  });
}

// Annotate each clean task with on_time, deadline, matched review, and linked refunds
export function buildEnrichedTasks(tasks, checkIns, taskReviewMap, refunds, bridge) {
  return tasks.filter(isCleanTask).map((t) => {
    const tz = marketTZ(t.market);
    const review = taskReviewMap[t.task_id] || null;
    const linkedRefunds = getLinkedRefunds(t, refunds, bridge);
    const deadlineInfo = getDeadlineInfo(t, checkIns);
    const finished_cst = t.finished_at ? toLocalParts(t.finished_at, tz) : null;
    const tz_abbr = tzAbbr(t.market, t.finished_at || new Date().toISOString());
    return {
      ...t,
      on_time: isOnTime(t, checkIns, tz),
      decided: isDecided(t, tz),
      finished_cst,
      tz_abbr,
      deadline: deadlineInfo.date,
      deadline_type: deadlineInfo.type,
      review,
      linked_refunds: linkedRefunds,
    };
  });
}

// Build the full per-cleaner scorecard from raw data
export function buildScorecardData({ tasks, reviews, refunds, checkIns, startDate, endDate }) {
  const bridge = buildPropertyBridge(reviews);
  const taskReviewMap = buildTaskReviewMap(tasks, reviews, bridge);

  // Filter to date range
  const rangedTasks = tasks.filter(
    (t) => t.scheduled_date >= startDate && t.scheduled_date <= endDate
  );

  // Group by vendor
  const vendors = {};
  for (const t of rangedTasks) {
    const v = t.vendor_name || "Unassigned";
    if (!vendors[v]) vendors[v] = { vendor_name: v, tasks: [] };
    vendors[v].tasks.push(t);
  }

  return Object.values(vendors)
    .filter((v) => v.tasks.filter(isCleanTask).length > 0)
    .map((v) => {
      const stats = calcStats(v.tasks, checkIns);
      const cleanTasks = v.tasks.filter(isCleanTask);

      // Reviews for this cleaner's tasks
      const vendorReviews = cleanTasks
        .map((t) => taskReviewMap[t.task_id])
        .filter(Boolean);

      const cleanlinessScores = vendorReviews
        .map((r) => r.cleanliness)
        .filter((s) => s != null);
      const cleanliness_score =
        cleanlinessScores.length > 0
          ? cleanlinessScores.reduce((a, b) => a + b, 0) / cleanlinessScores.length
          : null;

      // Refunds
      const vendorRefunds = cleanTasks.flatMap((t) => getLinkedRefunds(t, refunds, bridge));
      const refund_amount = vendorRefunds.reduce((s, r) => s + (r.refund_amount || 0), 0);

      const propertySet = new Set(v.tasks.map((t) => t.property_name).filter(Boolean));
      const median_time = computeMedianTime(v.tasks);

      const enrichedTasks = buildEnrichedTasks(v.tasks, checkIns, taskReviewMap, refunds, bridge);

      return {
        vendor_name: v.vendor_name,
        ...stats,
        cleanliness_score,
        review_count: vendorReviews.length,
        refund_count: vendorRefunds.length,
        refund_amount,
        property_count: propertySet.size,
        properties: [...propertySet],
        median_time,
        enriched_tasks: enrichedTasks,
      };
    });
}
