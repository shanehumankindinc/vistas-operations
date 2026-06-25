import { getSupabase } from "@/lib/db";
import { fetchAllListings, fetchAllReviews, fetchOwnersByIds, fetchReservationsByCheckIn } from "@/lib/guesty";
import { MARKET_KEYS, MARKETS } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 7am UTC daily.
// Syncs Guesty reviews, properties, owners, and refunds for all markets.
// Each market is fully isolated — tokens, account IDs, and custom field IDs
// are sourced from lib/markets.js per market. No cross-market fallback.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const results = {};

  for (const market of MARKET_KEYS) {
    const cfg = MARKETS[market];
    const marketResult = { reviews: 0, properties: 0, owners: 0, refunds: 0, errors: [] };

    // --- REVIEWS ---
    try {
      const reviews = await fetchAllReviews(market);
      const rows = reviews.map((r) => ({
        review_id:        r._id,
        market,
        submitted_at:     r.submittedAt ? r.submittedAt.slice(0, 10) : null,
        channel:          r.channel || null,
        listing_id:       r.listingId || null,
        overall_score:    r.overallScore ?? null,
        cleanliness:      r.cleanliness ?? null,
        accuracy:         r.accuracy ?? null,
        checkin_score:    r.checkin ?? null,
        communication:    r.communication ?? null,
        location:         r.location ?? null,
        value:            r.value ?? null,
        review_text:      r.reviewText || null,
        private_feedback: r.privateFeedback || null,
        pulled_at:        new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("guesty_reviews")
          .upsert(rows, { onConflict: "review_id,market" });
        if (error) throw new Error(error.message);
      }
      marketResult.reviews = rows.length;
    } catch (err) {
      marketResult.errors.push(`reviews: ${err.message}`);
    }

    // --- PROPERTIES ---
    // Store listings so we can extract owner IDs without a second API call.
    let listings = [];
    try {
      listings = await fetchAllListings(market);
      const rows = listings.map((l) => ({
        id:            l._id,
        market,
        nickname:      l.nickname || null,
        title:         l.title || null,
        address:       l.address || {},
        accommodates:  l.accommodates || null,
        bedrooms:      l.bedrooms || null,
        bathrooms:     l.bathrooms || null,
        property_type: l.propertyType || null,
        tags:          l.tags || [],
        pulled_at:     new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("guesty_properties")
          .upsert(rows, { onConflict: "id,market" });
        if (error) throw new Error(error.message);
      }
      marketResult.properties = rows.length;
    } catch (err) {
      marketResult.errors.push(`properties: ${err.message}`);
    }

    // --- OWNERS ---
    // Extract unique owner IDs from the listings we already fetched.
    // Never paginate /v1/owners directly — it returns 18k+ records and hits 429.
    try {
      const ownerIds = listings.flatMap((l) => l.owners || []).filter(Boolean);
      const owners = await fetchOwnersByIds(market, ownerIds);
      const rows = owners.map((o) => ({
        id:          o._id,
        market,
        first_name:  o.firstName || null,
        last_name:   o.lastName || null,
        full_name:   o.fullName || null,
        email:       o.email || null,
        phone:       o.phone || null,
        active:      o.active ?? null,
        listing_ids: o.listings || [],
        pulled_at:   new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("guesty_owners")
          .upsert(rows, { onConflict: "id,market" });
        if (error) throw new Error(error.message);
      }
      marketResult.owners = rows.length;
    } catch (err) {
      marketResult.errors.push(`owners: ${err.message}`);
    }

    // --- REFUNDS ---
    // Only sync if this market has a confirmed refundReasonFieldId.
    // If null, skip entirely — never fall back to another market's field ID.
    try {
      if (!cfg.refundReasonFieldId) {
        marketResult.refunds = `skipped — refundReasonFieldId not yet confirmed for ${market}`;
      } else {
        const today = new Date();
        const fromDate = new Date(today);
        fromDate.setDate(today.getDate() - 365);
        const reservations = await fetchReservationsByCheckIn(
          market,
          fromDate.toISOString().slice(0, 10),
          today.toISOString().slice(0, 10),
          "customFields"
        );

        const rows = [];
        for (const r of reservations) {
          if (!r.customFields?.length) continue;
          const reasonField = r.customFields.find((f) => f.fieldId === cfg.refundReasonFieldId);
          if (!reasonField?.value) continue;
          rows.push({
            confirmation_code: r.confirmationCode || r._id,
            market,
            listing_id:    r.listingId || null,
            refund_reason: reasonField.value,
            check_in:      r.checkIn ? r.checkIn.slice(0, 10) : null,
            check_out:     r.checkOut ? r.checkOut.slice(0, 10) : null,
            pulled_at:     new Date().toISOString(),
          });
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from("guesty_refunds")
            .upsert(rows, { onConflict: "confirmation_code,market" });
          if (error) throw new Error(error.message);
        }
        marketResult.refunds = rows.length;
      }
    } catch (err) {
      marketResult.errors.push(`refunds: ${err.message}`);
    }

    results[market] = marketResult;
  }

  return Response.json({ ok: true, results });
}
