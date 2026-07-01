import { getSupabase } from "@/lib/db";
import { fetchOwnerReservations } from "@/lib/guesty";
import { MARKET_KEYS } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 8am UTC daily, after guesty-sync (7am) and checkins (7am) have completed.
// Computes per-property per-day occupancy for today through today+14 (15 days).
// Reads guest reservations from guesty_checkins (pre-synced by checkins cron).
// Fetches owner blocks live from /v1/owners-reservations.
// Deletes rows with date < today to keep the table lean.
//
// day_type values (in priority order):
//   turn        — checkout AND checkin for different reservations on same day
//   checkin     — guests arriving today
//   checkout    — guests departing today, no new arrival
//   stayover    — mid-stay (check_in < today < check_out)
//   owner_block — owner block overlaps this day
//   vacant      — nothing scheduled
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const todayStr = todayUTC.toISOString().slice(0, 10);

  const endUTC = new Date(todayUTC);
  endUTC.setDate(todayUTC.getDate() + 14);
  const endStr = endUTC.toISOString().slice(0, 10);

  // Build the 15-day date string array: today through today+14
  const dates = [];
  for (let i = 0; i <= 14; i++) {
    const d = new Date(todayUTC);
    d.setDate(todayUTC.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const results = {};

  for (const market of MARKET_KEYS) {
    try {
      // All listing IDs for this market
      const { data: properties, error: propErr } = await supabase
        .from("guesty_properties")
        .select("id")
        .eq("market", market);
      if (propErr) throw new Error(propErr.message);
      if (!properties.length) {
        results[market] = { skipped: true, reason: "no properties" };
        continue;
      }
      const listingIds = properties.map((p) => p.id);

      // Guest reservations whose stay overlaps [today, today+14]
      // check_in_date <= endStr AND check_out_date >= todayStr
      const { data: checkins, error: cinErr } = await supabase
        .from("guesty_checkins")
        .select("reservation_id, confirmation_code, listing_id, check_in_date, check_out_date")
        .eq("market", market)
        .lte("check_in_date", endStr)
        .gte("check_out_date", todayStr);
      if (cinErr) throw new Error(cinErr.message);

      // Owner blocks from Guesty API (all blocks, filtered per-day below)
      const ownerBlocks = await fetchOwnerReservations(market);

      const pulledAt = new Date().toISOString();
      const calendarRows = [];

      for (const listingId of listingIds) {
        const guestRes = checkins.filter((r) => r.listing_id === listingId);
        const ownerRes = ownerBlocks.filter((b) => b.listingId === listingId);

        for (const dateStr of dates) {
          const checkinsToday = guestRes.filter((r) => r.check_in_date === dateStr);
          const checkoutsToday = guestRes.filter((r) => r.check_out_date === dateStr);
          const stayoversToday = guestRes.filter(
            (r) => r.check_in_date < dateStr && r.check_out_date > dateStr
          );
          // Owner block overlaps if checkIn <= dateStr < checkOut
          const ownerBlockToday = ownerRes.find((b) => {
            const bIn = b.checkIn ? b.checkIn.slice(0, 10) : null;
            const bOut = b.checkOut ? b.checkOut.slice(0, 10) : null;
            return bIn && bOut && bIn <= dateStr && bOut > dateStr;
          });

          let dayType = "vacant";
          let reservationId = null;
          let confirmationCode = null;
          let checkInDate = null;
          let checkOutDate = null;
          let ownerId = null;
          let ownerName = null;

          if (checkinsToday.length > 0 && checkoutsToday.length > 0) {
            // Turn day — attach the departing reservation for context
            dayType = "turn";
            const r = checkoutsToday[0];
            reservationId = r.reservation_id;
            confirmationCode = r.confirmation_code;
            checkInDate = r.check_in_date;
            checkOutDate = r.check_out_date;
          } else if (checkinsToday.length > 0) {
            dayType = "checkin";
            const r = checkinsToday[0];
            reservationId = r.reservation_id;
            confirmationCode = r.confirmation_code;
            checkInDate = r.check_in_date;
            checkOutDate = r.check_out_date;
          } else if (checkoutsToday.length > 0) {
            dayType = "checkout";
            const r = checkoutsToday[0];
            reservationId = r.reservation_id;
            confirmationCode = r.confirmation_code;
            checkInDate = r.check_in_date;
            checkOutDate = r.check_out_date;
          } else if (stayoversToday.length > 0) {
            dayType = "stayover";
            const r = stayoversToday[0];
            reservationId = r.reservation_id;
            confirmationCode = r.confirmation_code;
            checkInDate = r.check_in_date;
            checkOutDate = r.check_out_date;
          } else if (ownerBlockToday) {
            dayType = "owner_block";
            ownerId = ownerBlockToday.ownerId || null;
            ownerName = ownerBlockToday.owner ? ownerBlockToday.owner.fullName || null : null;
            checkInDate = ownerBlockToday.checkIn ? ownerBlockToday.checkIn.slice(0, 10) : null;
            checkOutDate = ownerBlockToday.checkOut ? ownerBlockToday.checkOut.slice(0, 10) : null;
          }

          calendarRows.push({
            listing_id: listingId,
            market,
            date: dateStr,
            day_type: dayType,
            reservation_id: reservationId,
            confirmation_code: confirmationCode,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            owner_id: ownerId,
            owner_name: ownerName,
            pulled_at: pulledAt,
          });
        }
      }

      // Delete rows with date < today to keep the table lean
      const { count: deleted } = await supabase
        .from("property_calendar")
        .delete({ count: "exact" })
        .eq("market", market)
        .lt("date", todayStr);

      // Upsert in 500-row chunks to stay within Supabase payload limits
      const CHUNK = 500;
      for (let i = 0; i < calendarRows.length; i += CHUNK) {
        const chunk = calendarRows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from("property_calendar")
          .upsert(chunk, { onConflict: "listing_id,market,date" });
        if (error) throw new Error(error.message);
      }

      results[market] = {
        properties: listingIds.length,
        guest_reservations: checkins.length,
        owner_blocks: ownerBlocks.length,
        calendar_rows: calendarRows.length,
        deleted: deleted || 0,
      };
    } catch (err) {
      results[market] = { error: err.message };
    }
  }

  return Response.json({
    ok: true,
    date_range: { from: todayStr, to: endStr },
    results,
  });
}
