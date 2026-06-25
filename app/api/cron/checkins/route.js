import { sql } from "@vercel/postgres";
import { fetchReservationsByCheckIn } from "@/lib/guesty";
import { MARKET_KEYS, MARKETS } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 7am UTC daily (alongside guesty-sync).
// Fetches reservations with check-in dates from today-90 to today+2.
// Only today + next two days matter for on-time deadline logic on pending tasks.
// The 90-day lookback keeps historical check-in data accurate for the scorecard window.
// Deletes rows older than 95 days to keep the table lean.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 90);
  const toDate = new Date(today);
  toDate.setDate(today.getDate() + 2);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);

  const results = {};

  for (const market of MARKET_KEYS) {
    const cfg = MARKETS[market];
    try {
      // Fetch reservations + the cleaner_feedback custom field for this market
      const extraFields = cfg.cleanerFeedbackFieldId
        ? `customFields`
        : "";

      const reservations = await fetchReservationsByCheckIn(market, fromStr, toStr, extraFields);
      let upserted = 0;

      for (const r of reservations) {
        const checkIn = r.checkIn ? r.checkIn.slice(0, 10) : null;
        const checkOut = r.checkOut ? r.checkOut.slice(0, 10) : null;

        // Extract cleaner feedback from market-specific custom field
        let cleanerFeedback = null;
        if (cfg.cleanerFeedbackFieldId && r.customFields?.length) {
          const field = r.customFields.find((f) => f.fieldId === cfg.cleanerFeedbackFieldId);
          cleanerFeedback = field?.value || null;
        }

        await sql`
          INSERT INTO guesty_checkins (
            confirmation_code, market, listing_id, check_in_date, check_out_date,
            status, cleaner_feedback, pulled_at
          ) VALUES (
            ${r.confirmationCode || r._id}, ${market}, ${r.listingId || null},
            ${checkIn}, ${checkOut}, ${r.status || null}, ${cleanerFeedback}, NOW()
          )
          ON CONFLICT (confirmation_code, market) DO UPDATE SET
            check_in_date    = EXCLUDED.check_in_date,
            check_out_date   = EXCLUDED.check_out_date,
            status           = EXCLUDED.status,
            cleaner_feedback = EXCLUDED.cleaner_feedback,
            pulled_at        = NOW()
        `;
        upserted++;
      }

      // Delete stale check-ins older than 95 days to keep the table lean
      const cutoff = new Date(today);
      cutoff.setDate(today.getDate() - 95);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const deleted = await sql`
        DELETE FROM guesty_checkins
        WHERE market = ${market} AND check_in_date < ${cutoffStr}
      `;

      results[market] = {
        fetched: reservations.length,
        upserted,
        deleted: deleted.rowCount,
      };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, results });
}
