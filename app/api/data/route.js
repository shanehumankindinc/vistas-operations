import { sql } from "@vercel/postgres";
import { MARKET_KEYS } from "@/lib/markets";
import { buildScorecardData } from "@/lib/scorecard";
import { isExcludedVendor } from "@/lib/markets";

export const dynamic = "force-dynamic";

// Returns scorecard data for a given market (or all markets) + date range.
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

  const [tasksRes, reviewsRes, refundsRes, checkInsRes] = await Promise.all([
    sql`
      SELECT * FROM breezeway_tasks
      WHERE market = ANY(${markets})
        AND scheduled_date >= ${fromDate}
        AND scheduled_date <= ${toDate}
      ORDER BY scheduled_date DESC
    `,
    sql`
      SELECT * FROM guesty_reviews
      WHERE market = ANY(${markets})
        AND submitted_at >= ${fromDate}
      ORDER BY submitted_at DESC
    `,
    sql`
      SELECT * FROM guesty_refunds
      WHERE market = ANY(${markets})
        AND check_in >= ${fromDate}
    `,
    sql`
      SELECT listing_id, check_in_date FROM guesty_checkins
      WHERE market = ANY(${markets})
        AND check_in_date >= ${fromDate}
        AND check_in_date <= ${toDate}
    `,
  ]);

  const tasks = tasksRes.rows.filter((t) => !isExcludedVendor(t.vendor_name));
  const reviews = reviewsRes.rows;
  const refunds = refundsRes.rows;
  const checkIns = checkInsRes.rows;

  // Build scorecard per market then merge
  const allScorecard = buildScorecardData({
    tasks,
    reviews,
    refunds,
    checkIns,
    startDate: fromDate,
    endDate: toDate,
  });

  // Determine data freshness
  const pulledDates = tasksRes.rows.map((t) => t.pulled_at).filter(Boolean).sort().reverse();
  const lastSynced = pulledDates[0] || null;

  return Response.json({
    scorecard: allScorecard,
    meta: {
      markets,
      fromDate,
      toDate,
      lastSynced,
      taskCount: tasks.length,
      reviewCount: reviews.length,
    },
  });
}
