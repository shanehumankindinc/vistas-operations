import { getSupabase } from "@/lib/db";
import { MARKET_KEYS } from "@/lib/markets";
import { buildScorecardData } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

// Supabase PostgREST caps rows at 1000 per request — paginate to get all records.
async function fetchAllRows(baseQuery) {
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

// Returns scorecard data for a given market (or all) + date range.
// Query params:
//   market  = branson | deep_creek | poconos | all  (default: all)
//   from    = YYYY-MM-DD  (default: 90 days ago)
//   to      = YYYY-MM-DD  (default: today)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const marketParam = searchParams.get("market") || "all";
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 90);
  const fromDate = searchParams.get("from") || defaultFrom.toISOString().slice(0, 10);
  const toDate = searchParams.get("to") || today;

  const markets = marketParam === "all" ? MARKET_KEYS : [marketParam];
  const supabase = getSupabase();

  const [tasksRes, reviewsRes, refundsRes, checkInsRes, propertiesRes, vendorMapRes] = await Promise.all([
    fetchAllRows(
      supabase
        .from("breezeway_tasks")
        .select("*")
        .in("market", markets)
        .gte("scheduled_date", fromDate)
        .lte("scheduled_date", toDate)
    ),

    // Reviews can arrive up to 60 days after the clean — fetch from 60 days before fromDate
    (() => {
      const reviewFrom = new Date(fromDate);
      reviewFrom.setDate(reviewFrom.getDate() - 60);
      return supabase
        .from("guesty_reviews")
        .select("*")
        .in("market", markets)
        .gte("submitted_at", reviewFrom.toISOString().slice(0, 10));
    })(),

    supabase
      .from("guesty_refunds")
      .select("*")
      .in("market", markets)
      .gte("check_in", fromDate),

    supabase
      .from("guesty_checkins")
      .select("listing_id, check_in_date")
      .in("market", markets)
      .gte("check_in_date", fromDate)
      .lte("check_in_date", toDate),

    supabase
      .from("guesty_properties")
      .select("id, nickname, market")
      .in("market", markets),

    // Vendor map: individual_name → company_name + excluded flag
    supabase
      .from("vendor_map")
      .select("market, individual_name, company_name, excluded")
      .in("market", markets),
  ]);

  if (tasksRes.error) return Response.json({ error: tasksRes.error.message }, { status: 500 });

  // Build vendor lookup: "market:individual_name" → { company_name, excluded }
  const vendorLookup = {};
  for (const v of vendorMapRes.data || []) {
    vendorLookup[`${v.market}:${v.individual_name}`] = v;
  }

  // Build market:nickname → listing_id map
  const nicknameToListingId = {};
  for (const p of propertiesRes.data || []) {
    if (p.nickname && p.id && p.market) {
      nicknameToListingId[`${p.market}:${p.nickname.toLowerCase().trim()}`] = p.id;
    }
  }

  const rawTasks = tasksRes.data || [];
  const tasks = rawTasks
    .map((t) => {
      const mapKey = `${t.market}:${t.vendor_name}`;
      const entry = vendorLookup[mapKey];

      // Exclude if flagged in vendor_map
      if (entry?.excluded) return null;

      // Apply company_name alias if mapped; otherwise use individual name as-is
      const displayName = entry?.company_name || t.vendor_name;

      const propKey = t.market && t.property_name
        ? `${t.market}:${t.property_name.toLowerCase().trim()}`
        : null;

      return {
        ...t,
        vendor_name: displayName,
        listing_id: t.listing_id || (propKey ? nicknameToListingId[propKey] : null) || null,
      };
    })
    .filter(Boolean);

  const reviews = reviewsRes.data || [];
  const refunds = refundsRes.data || [];
  const checkIns = checkInsRes.data || [];

  const scorecard = buildScorecardData({ tasks, reviews, refunds, checkIns, startDate: fromDate, endDate: toDate });

  const pulledDates = rawTasks.map((t) => t.pulled_at).filter(Boolean).sort().reverse();

  // Debug: per-market breakdown of raw vs filtered tasks
  const rawByMarket = {};
  const filteredByMarket = {};
  for (const t of rawTasks) { rawByMarket[t.market] = (rawByMarket[t.market] || 0) + 1; }
  for (const t of tasks)    { filteredByMarket[t.vendor_name] = (filteredByMarket[t.vendor_name] || 0) + 1; }

  return Response.json({
    scorecard,
    meta: {
      markets,
      fromDate,
      toDate,
      lastSynced: pulledDates[0] || null,
      taskCount: tasks.length,
      rawTaskCount: rawTasks.length,
      rawByMarket,
      reviewCount: reviews.length,
    },
  });
}
