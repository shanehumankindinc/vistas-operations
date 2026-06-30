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
  // Explicitly exclude maintenance tasks — they have task_type containing "maintenance"
  if ((t.task_type || "").toLowerCase().includes("maintenance")) return false;
  // All other tasks fetched from Breezeway are cleaning tasks; task_title may be null
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

// Count maintenance/issue tasks created BY a specific individual across all tasks.
// Cleaners report issues by creating tasks — created_by is the reporter, not the assignee.
export function countIssuesCreated(individualName, allTasks) {
  if (!individualName) return 0;
  const name = individualName.toLowerCase().trim();
  return allTasks.filter((t) => {
    const creator = (t.created_by || "").toLowerCase().trim();
    return creator === name;
  }).length;
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

// Match reviews to tasks — each review assigned to at most one task.
//
// Primary path (exact): review.confirmation_code → checkin.check_out_date → task.scheduled_date
//   A guest's platform confirmation code (e.g. Airbnb HMEMXPQZ2Z) links their reservation to
//   its checkout date, which is the exact date the property was cleaned for the next guest.
//   This eliminates date-window guessing entirely.
//
// Fallback path (heuristic): listing_id match + 1-60 day window after scheduled_date.
//   Used for reviews where confirmation_code is missing or no checkin row exists.
export function buildTaskReviewMap(tasks, reviews, checkIns, bridge) {
  const taskReviewMap = {};
  const claimedReviewIds = new Set();

  // Build reservation_id → check_out_date map from checkins.
  // Uses Guesty's internal reservation ObjectID (stored as reservation_id on both tables)
  // so the join is exact regardless of channel-specific confirmation code formats.
  const reservationToCheckout = {};
  for (const ci of checkIns || []) {
    if (ci.reservation_id && ci.check_out_date) {
      reservationToCheckout[ci.reservation_id] = ci.check_out_date;
    }
  }

  // Build task lookup: "listing_id:scheduled_date" → task (for exact match path)
  const taskByListingDate = {};
  const cleanTasks = [...tasks].filter(isCleanTask).filter(t => t.scheduled_date);
  for (const t of cleanTasks) {
    const taskListingId = t.listing_id || (t.bz_property_id ? bridge[t.bz_property_id] : null);
    if (taskListingId && t.scheduled_date) {
      const key = `${taskListingId}:${t.scheduled_date}`;
      // If multiple tasks on same property+date, keep the one with a vendor (not Unassigned)
      if (!taskByListingDate[key] || (t.vendor_name && t.vendor_name !== "Unassigned")) {
        taskByListingDate[key] = t;
      }
    }
  }

  // Pass 1: exact match via reservation_id → checkout date → task
  for (const review of reviews) {
    if (!review.reservation_id) continue;
    const checkoutDate = reservationToCheckout[review.reservation_id];
    if (!checkoutDate) continue;
    const key = `${review.listing_id}:${checkoutDate}`;
    const task = taskByListingDate[key];
    if (!task) continue;
    if (claimedReviewIds.has(review.review_id)) continue;
    // Only claim the task slot once — first review wins if multiple share a confirmation code
    if (taskReviewMap[task.task_id]) continue;
    taskReviewMap[task.task_id] = review;
    claimedReviewIds.add(review.review_id);
  }

  // Pass 2: heuristic fallback for reviews not matched in pass 1.
  // Sort tasks newest-first so the most recent clean gets priority when a review
  // falls within the 1-60 day window of multiple tasks at the same property.
  const sortedTasks = [...cleanTasks].sort((a, b) =>
    b.scheduled_date.localeCompare(a.scheduled_date)
  );

  for (const task of sortedTasks) {
    if (taskReviewMap[task.task_id]) continue; // already matched in pass 1
    const taskListingId = task.listing_id || (task.bz_property_id ? bridge[task.bz_property_id] : null);
    const taskDateMs = new Date(task.scheduled_date + "T00:00:00Z").getTime();

    const candidates = reviews.filter((r) => {
      if (claimedReviewIds.has(r.review_id)) return false;
      const propertyMatch =
        (taskListingId && r.listing_id && taskListingId === r.listing_id) ||
        (r.property_name && task.property_name && r.property_name === task.property_name);
      if (!propertyMatch) return false;
      const daysDiff = (new Date(r.submitted_at + "T00:00:00Z").getTime() - taskDateMs) / 86400000;
      // >= 1: same-day review (gap = 0) is from the outgoing guest whose stay was prepared
      // by an EARLIER clean; it should match that prior clean, not the same-day turnover.
      return daysDiff >= 1 && daysDiff <= 60;
    });

    if (candidates.length > 0) {
      candidates.sort(
        (a, b) =>
          Math.abs(new Date(a.submitted_at + "T00:00:00Z").getTime() - taskDateMs) -
          Math.abs(new Date(b.submitted_at + "T00:00:00Z").getTime() - taskDateMs)
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

// Annotate each clean task with on_time, deadline, matched review, linked refunds, linked issues, and cleaner_feedback.
// maintenanceTasks: all tasks with task_type='maintenance' for this vendor — matched by property + date.
export function buildEnrichedTasks(tasks, checkIns, taskReviewMap, refunds, bridge, maintenanceTasks = []) {
  // Build a lookup: listing_id:check_in_date → cleaner_feedback for fast per-task lookup
  const feedbackByKey = {};
  for (const ci of checkIns) {
    if (ci.cleaner_feedback && ci.listing_id && ci.check_in_date) {
      feedbackByKey[`${ci.listing_id}:${ci.check_in_date}`] = ci.cleaner_feedback;
    }
  }
  // Index maintenance tasks by bz_property_id for fast lookup
  const maintByProp = {};
  for (const m of maintenanceTasks) {
    const key = m.bz_property_id || m.property_name;
    if (!key) continue;
    if (!maintByProp[key]) maintByProp[key] = [];
    maintByProp[key].push(m);
  }

  return tasks.filter(isCleanTask).map((t) => {
    const tz = marketTZ(t.market);
    const review = taskReviewMap[t.task_id] || null;
    const linkedRefunds = getLinkedRefunds(t, refunds, bridge);
    const deadlineInfo = getDeadlineInfo(t, checkIns);
    const finished_cst = t.finished_at ? toLocalParts(t.finished_at, tz) : null;
    const tz_abbr = tzAbbr(t.market, t.finished_at || new Date().toISOString());

    // Link maintenance issues: same property, created_at within 1 day before to 2 days after scheduled_date
    const propKey = t.bz_property_id || t.property_name;
    const taskDateMs = t.scheduled_date ? new Date(t.scheduled_date + "T00:00:00Z").getTime() : null;
    const linked_issues = (taskDateMs && propKey)
      ? (maintByProp[propKey] || []).filter((m) => {
          if (!m.created_at) return false;
          const mMs = new Date(m.created_at).getTime();
          const daysDiff = (mMs - taskDateMs) / 86400000;
          return daysDiff >= -1 && daysDiff <= 2;
        }).map((m) => ({ task_id: m.task_id, title: m.task_title, created_by: m.created_by }))
      : [];

    const feedbackKey = t.listing_id && t.scheduled_date ? `${t.listing_id}:${t.scheduled_date}` : null;
    const cleaner_feedback = feedbackKey ? (feedbackByKey[feedbackKey] || null) : null;

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
      linked_issues,
      cleaner_feedback,
    };
  });
}

// Build the full per-cleaner scorecard from raw data
export function buildScorecardData({ tasks, reviews, refunds, checkIns, startDate, endDate }) {
  const bridge = buildPropertyBridge(reviews);
  const taskReviewMap = buildTaskReviewMap(tasks, reviews, checkIns, bridge);

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

  // Collect all individual names per vendor (for issues_created lookup)
  // individual_name is populated by data/route.js before calling buildScorecardData
  const vendorIndividuals = {};
  for (const t of rangedTasks) {
    const v = t.vendor_name || "Unassigned";
    if (t.individual_name) {
      if (!vendorIndividuals[v]) vendorIndividuals[v] = new Set();
      vendorIndividuals[v].add(t.individual_name);
    }
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

      // All maintenance tasks (linked to clean rows by property + date proximity)
      const allMaintTasks = tasks.filter((t) => t.task_type === "maintenance");
      const enrichedTasks = buildEnrichedTasks(v.tasks, checkIns, taskReviewMap, refunds, bridge, allMaintTasks);

      const feedback_count = enrichedTasks.filter(t => t.cleaner_feedback).length;

      // Count issues/maintenance tasks created BY this vendor's individual workers.
      // Search across ALL tasks (not just ranged) to catch maintenance tasks
      // that may lack a scheduled_date and got stored with created_at only.
      const individuals = vendorIndividuals[v.vendor_name] || new Set();
      // Also include vendor_name itself as a fallback (single-person vendors)
      individuals.add(v.vendor_name);
      const issues_created = [...individuals].reduce(
        (sum, name) => sum + countIssuesCreated(name, tasks),
        0
      );

      // Collect the full maintenance task objects created by this vendor's individuals
      // for the issues drill-down panel. Uses the same matching logic as issues_created.
      const individualSet = [...individuals].map(n => n.toLowerCase().trim());
      const issues = tasks
        .filter((t) => (t.task_type || "").toLowerCase().includes("maintenance"))
        .filter((t) => {
          const creator = (t.created_by || "").toLowerCase().trim();
          return individualSet.includes(creator);
        })
        .map((t) => ({
          task_id: t.task_id,
          created_at: t.created_at,
          property_name: t.property_name,
          task_title: t.task_title,
          description: t.description || null,
          clean_status: t.clean_status,
          priority: t.priority || null,
          created_by: t.created_by,
        }));

      return {
        vendor_name: v.vendor_name,
        market: v.tasks[0]?.market || null,
        ...stats,
        cleanliness_score,
        review_count: vendorReviews.length,
        refund_count: vendorRefunds.length,
        refund_amount,
        property_count: propertySet.size,
        properties: [...propertySet],
        median_time,
        issues_created,
        issues,
        feedback_count,
        enriched_tasks: enrichedTasks,
      };
    });
}
