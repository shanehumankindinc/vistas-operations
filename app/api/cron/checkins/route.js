import { getSupabase } from "@/lib/db";
import { fetchReservationsByCheckIn } from "@/lib/guesty";
import { MARKET_KEYS, MARKETS } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 7am UTC daily.
// Fetches reservations with check-in dates from today-90 to today+16.
// The 90-day lookback supports the scorecard's historical on-time calculations.
// today+16 covers the property-calendar cron's 14-day forward window plus buffer.
// Rows older than 95 days are deleted to keep the table lean.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 90);
  const toDate = new Date(today);
  toDate.setDate(today.getDate() + 16);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  const results = {};

  for (const market of MARKET_KEYS) {
    const cfg = MARKETS[market];
    try {
      const reservations = await fetchReservationsByCheckIn(market, fromStr, toStr);

      const rows = reservations.map((r) => {
        let cleanerFeedback = null;
        if (cfg.cleanerFeedbackFieldId && r.customFields?.length) {
          const field = r.customFields.find((f) => f.fieldId === cfg.cleanerFeedbackFieldId);
          cleanerFeedback = field?.value || null;
        }
        return {
          confirmation_code: r.confirmationCode || r._id,
          reservation_id:    r._id || null,
          market,
          listing_id:        r.listingId || null,
          check_in_date:     r.checkIn ? r.checkIn.slice(0, 10) : null,
          check_out_date:    r.checkOut ? r.checkOut.slice(0, 10) : null,
          status:            r.status || null,
          cleaner_feedback:  cleanerFeedback,
          pulled_at:         new Date().toISOString(),
        };
      });

      if (rows.length > 0) {
        const { error } = await supabase
          .from("guesty_checkins")
          .upsert(rows, { onConflict: "confirmation_code,market" });
        if (error) throw new Error(error.message);
      }

      // Delete stale rows older than 95 days
      const cutoff = new Date(today);
      cutoff.setDate(today.getDate() - 95);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const { count: deleted } = await supabase
        .from("guesty_checkins")
        .delete({ count: "exact" })
        .eq("market", market)
        .lt("check_in_date", cutoffStr);

      results[market] = { fetched: reservations.length, upserted: rows.length, deleted: deleted || 0 };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, results });
}
