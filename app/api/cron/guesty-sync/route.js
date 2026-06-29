import { getSupabase } from "@/lib/db";
import { fetchAllListings, fetchAllReviews, fetchOwnersByIds, fetchReservationsByCheckIn } from "@/lib/guesty";
import { MARKET_KEYS, MARKETS } from "@/lib/markets";
import { computeScorecard } from "@/lib/scorecard-data";

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

    // Fetch listings and reviews in parallel — listings are needed for both
    // the properties write and the review property_name enrichment.
    let listings = [];
    let reviews = [];
    try {
      [listings, reviews] = await Promise.all([
        fetchAllListings(market),
        fetchAllReviews(market),
      ]);
    } catch (err) {
      marketResult.errors.push(`fetch: ${err.message}`);
      results[market] = marketResult;
      continue;
    }

    // Build listing_id → nickname map for property_name enrichment on reviews
    const listingMap = {};
    for (const l of listings) {
      if (l._id && l.nickname) listingMap[l._id] = l.nickname;
    }

    // --- REVIEWS ---
    // Guesty Open API /v1/reviews structure (confirmed 2026-06-25):
    //   root: _id, listingId, channelId, createdAt, rawReview
    //   rawReview keys: overall_rating, public_review, reviewee_response,
    //     submitted_at, first_completed_at,
    //     category_ratings_cleanliness, category_ratings_accuracy,
    //     category_ratings_checkin, category_ratings_communication,
    //     category_ratings_location, category_ratings_value
    try {
      const rows = reviews.map((r) => {
        const raw = r.rawReview || {};
        return {
          review_id:           r._id,
          market,
          submitted_at:        (raw.submitted_at || raw.first_completed_at || r.createdAt || "").slice(0, 10) || null,
          channel:             r.channelId || null,
          listing_id:          r.listingId || null,
          property_name:       r.listingId ? (listingMap[r.listingId] || null) : null,
          // externalReservationId = platform confirmation code (e.g. Airbnb HMEMXPQZ2Z).
          // Matches confirmation_code in guesty_checkins, enabling exact review→clean attribution.
          confirmation_code:   r.externalReservationId || raw.reservation_confirmation_code || null,
          overall_score:       raw.overall_rating ?? null,
          cleanliness:         raw.category_ratings_cleanliness ?? null,
          accuracy:            raw.category_ratings_accuracy ?? null,
          checkin_score:       raw.category_ratings_checkin ?? null,
          communication:       raw.category_ratings_communication ?? null,
          location:            raw.category_ratings_location ?? null,
          value:               raw.category_ratings_value ?? null,
          review_text:         raw.public_review || null,
          private_feedback:    raw.reviewee_response || null,
          pulled_at:           new Date().toISOString(),
        };
      });

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
    try {
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

  // Warm the scorecard cache for the default 30-day window.
  // Runs after all market syncs complete so tasks (from BZ at 5am) and
  // reviews (just synced above) are both fresh.
  // Warms: "all markets" + each individual market, covering all dropdown options.
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const cacheTargets = [
    { key: "all", markets: MARKET_KEYS },
    ...MARKET_KEYS.map((m) => ({ key: m, markets: [m] })),
  ];

  const cacheResults = {};
  for (const target of cacheTargets) {
    try {
      const result = await computeScorecard({
        markets: target.markets,
        fromDate: fromStr,
        toDate: today,
        supabase,
      });
      await supabase
        .from("scorecard_cache")
        .upsert(
          {
            market: target.key,
            from_date: fromStr,
            to_date: today,
            computed_at: new Date().toISOString(),
            payload: result,
          },
          { onConflict: "market,from_date,to_date" }
        );
      cacheResults[target.key] = "ok";
    } catch (err) {
      cacheResults[target.key] = `error: ${err.message}`;
    }
  }

  return Response.json({ ok: true, results, cache_warmed: cacheResults });
}
