// Ported from branson-dashboard src/App.jsx
// All on-time logic, review matching, and stat computation lives here
// so it can be used both in API routes (server) and client components.

const BZ_TZ = "America/Chicago";

function toUTCStr(dtStr) {
  if (!dtStr) return null;
  return dtStr.endsWith("Z") ? dtStr : dtStr + "Z";
}

export function toCSTparts(dtStr) {
  const utcStr = toUTCStr(dtStr);
  if (!utcStr) return null;
  try {
    const dt = new Date(utcStr);
    const parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: BZ_TZ,
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

export function isCleanTask(t) {
  return (t.task_title || "").toLowerCase().includes("clean");
}

export function isCleanerTask(t) {
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

export function isOnTime(t, checkIns) {
  if (!t.finished_at || !t.scheduled_date) return false;
  const cst = toCSTparts(t.finished_at);
  if (!cst) return false;

  if (cst.dateStr < t.scheduled_date) return true;

  const ciInfo = getCiInfo(t, checkIns);
  if (ciInfo) {
    if (cst.dateStr > t.scheduled_date) return false;
    return cst.hour < 16 || (cst.hour === 16 && cst.minute === 0);
  }

  const nextCi = getNextCheckInDate(t, checkIns);
  if (!nextCi) return true;
  if (cst.dateStr < nextCi) return true;
  if (cst.dateStr === nextCi) return cst.hour < 16 || (cst.hour === 16 && cst.minute === 0);
  return false;
}

export function isDecided(t) {
  if (t.finished_at) return true;
  // Past 4PM CST today and no finish → decided as overdue
  const today = toCSTparts(new Date().toISOString());
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
  const decided = cleans.filter((t) => isDecided(t, checkIns));
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
    const taskListingId = task.bz_property_id ? bridge[task.bz_property_id] : null;
    const taskDate = task.scheduled_date;

    // Find the closest review for this property submitted 1-60 days after the clean
    const candidates = reviews.filter((r) => {
      if (claimedReviewIds.has(r.review_id)) return false;
      const rListingId = r.listing_id;
      const propertyMatch =
        (taskListingId && rListingId && taskListingId === rListingId) ||
        (r.property_name && task.property_name && r.property_name === task.property_name);
      if (!propertyMatch) return false;
      const daysDiff = (new Date(r.submitted_at) - new Date(taskDate)) / 86400000;
      return daysDiff >= 1 && daysDiff <= 60;
    });

    if (candidates.length > 0) {
      // Pick the closest review
      candidates.sort(
        (a, b) =>
          Math.abs(new Date(a.submitted_at) - new Date(taskDate)) -
          Math.abs(new Date(b.submitted_at) - new Date(taskDate))
      );
      const winner = candidates[0];
      taskReviewMap[task.task_id] = winner;
      claimedReviewIds.add(winner.review_id);
    }
  }

  return taskReviewMap;
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
  const taskListingId = task.bz_property_id ? bridge[task.bz_property_id] : null;

  return refunds.filter((r) => {
    if (!isCleanerFaultRefund(r)) return false;
    // CRITICAL: refund.listing_id must come from the same market — enforced by market-scoped queries
    const idMatch = taskListingId && r.listing_id && taskListingId === r.listing_id;
    const nameMatch = !idMatch && r.property_name && r.property_name === task.property_name;
    if (!idMatch && !nameMatch) return false;
    return r.refund_date >= d0 && r.refund_date <= d1;
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
        tasks: v.tasks,
        reviews: vendorReviews,
        refunds: vendorRefunds,
      };
    });
}
