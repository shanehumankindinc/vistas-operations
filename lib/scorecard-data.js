import { buildScorecardData } from "@/lib/scorecard";
import { MARKET_KEYS } from "@/lib/markets";

// Supabase PostgREST caps responses at 1000 rows — paginate to get all records.
export async function fetchAllRows(baseQuery) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await baseQuery.range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return { data: all, error: null };
}

// Fetch all data for the given markets + date window, run the scorecard, and
// return { scorecard, meta } — same shape the data API route returns to clients.
//
// This is the single source of truth for scorecard computation. Both the API
// route (live requests) and the guesty-sync cron (cache warming) call this.
export async function computeScorecard({ markets, fromDate, toDate, supabase }) {
  const allMarkets = markets || MARKET_KEYS;

  // Reviews are fetched 60 days back so late reviews for pre-window cleans are captured.
  // Tasks must cover the same lookback so those reviews can find their cleaner.
  const reviewLookback = 60;
  const preWindowFrom = new Date(fromDate);
  preWindowFrom.setDate(preWindowFrom.getDate() - reviewLookback);
  const preWindowFromStr = preWindowFrom.toISOString().slice(0, 10);

  const [tasksRes, preWindowTasksRes, maintTasksRes, reviewsRes, refundsRes, checkInsRes, propertiesRes, vendorMapRes] =
    await Promise.all([
      // Cleaning tasks in the scorecard window — filtered by scheduled_date
      fetchAllRows(
        supabase
          .from("breezeway_tasks")
          .select("*")
          .in("market", allMarkets)
          .gte("scheduled_date", fromDate)
          .lte("scheduled_date", toDate)
      ),

      // Pre-window cleaning tasks — for review attribution only, not counted in stats.
      // Reviews are fetched 60 days back; tasks need the same lookback so reviews
      // submitted during the window for cleans just before it can find their cleaner.
      fetchAllRows(
        supabase
          .from("breezeway_tasks")
          .select("*")
          .in("market", allMarkets)
          .gte("scheduled_date", preWindowFromStr)
          .lt("scheduled_date", fromDate)
      ),

      // Maintenance tasks — no scheduled_date, use created_at (hits idx_tasks_maint_created)
      fetchAllRows(
        supabase
          .from("breezeway_tasks")
          .select("*")
          .in("market", allMarkets)
          .eq("task_type", "maintenance")
          .gte("created_at", fromDate)
          .lte("created_at", toDate + "T23:59:59Z")
      ),

      // Reviews — fetched from 60 days before the window so reviews submitted during
      // the window for cleans just before it are available for attribution.
      (() => {
        return supabase
          .from("guesty_reviews")
          .select("*")
          .in("market", allMarkets)
          .gte("submitted_at", preWindowFromStr);
      })(),

      supabase
        .from("guesty_refunds")
        .select("*")
        .in("market", allMarkets)
        .gte("check_in", fromDate),

      (() => {
        // Extend lower bound 30 days before the window to capture stays that checked
        // in before the window but checked out within it — needed for review matching
        // via reservation_id → check_out_date → task.scheduled_date.
        const checkInFrom = new Date(fromDate);
        checkInFrom.setDate(checkInFrom.getDate() - 30);
        return supabase
          .from("guesty_checkins")
          .select("listing_id, check_in_date, check_out_date, cleaner_feedback, confirmation_code, reservation_id")
          .in("market", allMarkets)
          .gte("check_in_date", checkInFrom.toISOString().slice(0, 10))
          .lte("check_in_date", toDate);
      })(),

      supabase
        .from("guesty_properties")
        .select("id, nickname, market")
        .in("market", allMarkets),

      supabase
        .from("vendor_map")
        .select("market, individual_name, company_name, excluded")
        .in("market", allMarkets),
    ]);

  if (tasksRes.error) throw new Error(`tasks query failed: ${tasksRes.error.message}`);

  // Build vendor lookup: "market:individual_name" → { company_name, excluded }
  const vendorLookup = {};
  for (const v of vendorMapRes.data || []) {
    vendorLookup[`${v.market}:${v.individual_name}`] = v;
  }

  // Build market:nickname → listing_id map (name-based fallback)
  const nicknameToListingId = {};
  for (const p of propertiesRes.data || []) {
    if (p.nickname && p.id && p.market) {
      nicknameToListingId[`${p.market}:${p.nickname.toLowerCase().trim()}`] = p.id;
    }
  }

  // Merge window tasks + pre-window tasks + maintenance tasks, dedupe by task_id.
  // Pre-window tasks are used only for review attribution (buildTaskReviewMap),
  // not for vendor stats (buildScorecardData filters to startDate..endDate).
  const rawTasks = tasksRes.data || [];
  const rawPreWindowTasks = preWindowTasksRes.data || [];
  const seenTaskIds = new Set(rawTasks.map((t) => t.task_id));
  const preWindowOnly = rawPreWindowTasks.filter((t) => !seenTaskIds.has(t.task_id));
  preWindowOnly.forEach((t) => seenTaskIds.add(t.task_id));
  const maintOnly = (maintTasksRes.data || []).filter((t) => !seenTaskIds.has(t.task_id));
  const allRawTasks = [...rawTasks, ...preWindowOnly, ...maintOnly];

  const tasks = allRawTasks
    .map((t) => {
      const mapKey = `${t.market}:${t.vendor_name}`;
      const entry = vendorLookup[mapKey];
      const isMaintTask = (t.task_type || "").toLowerCase().includes("maintenance");

      if (!isMaintTask && entry?.excluded) return null;

      const displayName = entry?.company_name || t.vendor_name;
      const propKey =
        t.market && t.property_name
          ? `${t.market}:${t.property_name.toLowerCase().trim()}`
          : null;

      return {
        ...t,
        individual_name: t.vendor_name,
        vendor_name: displayName,
        // bz_property_id IS the Guesty listing ID — use it directly as primary join key.
        // Stored listing_id (from reference_external_property_id) takes precedence when set.
        // Name-based lookup is a last-resort fallback for legacy rows.
        listing_id:
          t.listing_id ||
          t.bz_property_id ||
          (propKey ? nicknameToListingId[propKey] : null) ||
          null,
      };
    })
    .filter(Boolean);

  const reviews = reviewsRes.data || [];
  const refunds = refundsRes.data || [];
  const checkIns = checkInsRes.data || [];

  const scorecard = buildScorecardData({
    tasks,
    reviews,
    refunds,
    checkIns,
    startDate: fromDate,
    endDate: toDate,
  });

  const pulledDates = allRawTasks.map((t) => t.pulled_at).filter(Boolean).sort().reverse();

  const rawByMarket = {};
  for (const t of allRawTasks) rawByMarket[t.market] = (rawByMarket[t.market] || 0) + 1;

  return {
    scorecard,
    meta: {
      markets: allMarkets,
      fromDate,
      toDate,
      lastSynced: pulledDates[0] || null,
      taskCount: tasks.length,
      rawTaskCount: allRawTasks.length,
      preWindowTaskCount: preWindowOnly.length,
      maintTaskCount: maintOnly.length,
      rawByMarket,
      reviewCount: reviews.length,
    },
  };
}
