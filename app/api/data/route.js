import { getSupabase } from "@/lib/db";
import { MARKET_KEYS } from "@/lib/markets";
import { isExcludedVendor } from "@/lib/markets";
import { buildScorecardData } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

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

  const [tasksRes, reviewsRes, refundsRes, checkInsRes, propertiesRes] = await Promise.all([
    supabase
      .from("breezeway_tasks")
      .select("*")
      .in("market", markets)
      .gte("scheduled_date", fromDate)
      .lte("scheduled_date", toDate),

    supabase
      .from("guesty_reviews")
      .select("*")
      .in("market", markets)
      .gte("submitted_at", fromDate),

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
      .select("id, nickname")
      .in("market", markets),
  ]);

  if (tasksRes.error) return Response.json({ error: tasksRes.error.message }, { status: 500 });

  // Build nickname → listing_id map for review/checkin matching
  const nicknameToListingId = {};
  for (const p of propertiesRes.data || []) {
    if (p.nickname && p.id) nicknameToListingId[p.nickname.toLowerCase().trim()] = p.id;
  }

  const rawTasks = (tasksRes.data || []).filter((t) => !isExcludedVendor(t.vendor_name));
  // Enrich tasks with listing_id so scorecard can match to reviews and checkins
  const tasks = rawTasks.map((t) => ({
    ...t,
    listing_id: t.listing_id || (t.property_name ? nicknameToListingId[t.property_name.toLowerCase().trim()] : null) || null,
  }));
  const reviews = reviewsRes.data || [];
  const refunds = refundsRes.data || [];
  const checkIns = checkInsRes.data || [];

  const scorecard = buildScorecardData({ tasks, reviews, refunds, checkIns, startDate: fromDate, endDate: toDate });

  const pulledDates = (tasksRes.data || []).map((t) => t.pulled_at).filter(Boolean).sort().reverse();

  return Response.json({
    scorecard,
    meta: {
      markets,
      fromDate,
      toDate,
      lastSynced: pulledDates[0] || null,
      taskCount: tasks.length,
      reviewCount: reviews.length,
    },
  });
}
