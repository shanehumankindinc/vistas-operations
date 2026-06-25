import { sql } from "@vercel/postgres";
import { fetchAllListings, fetchAllReviews, fetchAllOwners, fetchReservationsByCheckIn } from "@/lib/guesty";
import { MARKET_KEYS, MARKETS } from "@/lib/markets";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs at 7am UTC daily.
// Syncs Guesty reviews, properties, owners, and refunds for all markets.
// Each market is isolated — Deep Creek data never bleeds into Branson, etc.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {};

  for (const market of MARKET_KEYS) {
    const cfg = MARKETS[market];
    const marketResult = { reviews: 0, properties: 0, owners: 0, refunds: 0, errors: [] };

    try {
      // --- REVIEWS ---
      const reviews = await fetchAllReviews(market);
      for (const r of reviews) {
        await sql`
          INSERT INTO guesty_reviews (
            review_id, market, submitted_at, channel, listing_id,
            overall_score, cleanliness, accuracy, checkin_score,
            communication, location, value,
            review_text, private_feedback, pulled_at
          ) VALUES (
            ${r._id}, ${market},
            ${r.submittedAt ? r.submittedAt.slice(0, 10) : null},
            ${r.channel || null}, ${r.listingId || null},
            ${r.overallScore ?? null}, ${r.cleanliness ?? null}, ${r.accuracy ?? null},
            ${r.checkin ?? null}, ${r.communication ?? null},
            ${r.location ?? null}, ${r.value ?? null},
            ${r.reviewText || null}, ${r.privateFeedback || null}, NOW()
          )
          ON CONFLICT (review_id, market) DO UPDATE SET
            cleanliness      = EXCLUDED.cleanliness,
            review_text      = EXCLUDED.review_text,
            private_feedback = EXCLUDED.private_feedback,
            pulled_at        = NOW()
        `;
      }
      marketResult.reviews = reviews.length;
    } catch (err) {
      marketResult.errors.push(`reviews: ${err.message}`);
    }

    try {
      // --- PROPERTIES ---
      const listings = await fetchAllListings(market);
      for (const l of listings) {
        await sql`
          INSERT INTO guesty_properties (
            id, market, nickname, title, address,
            accommodates, bedrooms, bathrooms, property_type, tags, pulled_at
          ) VALUES (
            ${l._id}, ${market}, ${l.nickname || null}, ${l.title || null},
            ${JSON.stringify(l.address || {})},
            ${l.accommodates || null}, ${l.bedrooms || null},
            ${l.bathrooms || null}, ${l.propertyType || null},
            ${l.tags || []}, NOW()
          )
          ON CONFLICT (id, market) DO UPDATE SET
            nickname      = EXCLUDED.nickname,
            title         = EXCLUDED.title,
            address       = EXCLUDED.address,
            accommodates  = EXCLUDED.accommodates,
            bedrooms      = EXCLUDED.bedrooms,
            bathrooms     = EXCLUDED.bathrooms,
            property_type = EXCLUDED.property_type,
            tags          = EXCLUDED.tags,
            pulled_at     = NOW()
        `;
      }
      marketResult.properties = listings.length;
    } catch (err) {
      marketResult.errors.push(`properties: ${err.message}`);
    }

    try {
      // --- OWNERS ---
      const owners = await fetchAllOwners(market);
      for (const o of owners) {
        await sql`
          INSERT INTO guesty_owners (
            id, market, first_name, last_name, full_name,
            email, phone, active, listing_ids, pulled_at
          ) VALUES (
            ${o._id}, ${market}, ${o.firstName || null}, ${o.lastName || null},
            ${o.fullName || null}, ${o.email || null}, ${o.phone || null},
            ${o.active ?? null}, ${o.listings || []}, NOW()
          )
          ON CONFLICT (id, market) DO UPDATE SET
            full_name   = EXCLUDED.full_name,
            email       = EXCLUDED.email,
            phone       = EXCLUDED.phone,
            active      = EXCLUDED.active,
            listing_ids = EXCLUDED.listing_ids,
            pulled_at   = NOW()
        `;
      }
      marketResult.owners = owners.length;
    } catch (err) {
      marketResult.errors.push(`owners: ${err.message}`);
    }

    try {
      // --- REFUNDS ---
      // Only sync refunds if this market has a confirmed refund_reason custom field.
      // If refundReasonFieldId is null, skip — we will NOT fall back to another market's field.
      if (!cfg.refundReasonFieldId) {
        marketResult.refunds = `skipped (no refundReasonFieldId configured for ${market})`;
      } else {
        // Fetch reservations from the last year with customFields to find refund_reason
        const today = new Date();
        const fromDate = new Date(today);
        fromDate.setDate(today.getDate() - 365);
        const reservations = await fetchReservationsByCheckIn(
          market,
          fromDate.toISOString().slice(0, 10),
          today.toISOString().slice(0, 10),
          "customFields,guestId,guests"
        );

        let refundCount = 0;
        for (const r of reservations) {
          if (!r.customFields?.length) continue;
          const reasonField = r.customFields.find((f) => f.fieldId === cfg.refundReasonFieldId);
          if (!reasonField?.value) continue;
          // Only store if it contains a refund reason value
          const checkIn = r.checkIn ? r.checkIn.slice(0, 10) : null;
          const checkOut = r.checkOut ? r.checkOut.slice(0, 10) : null;
          await sql`
            INSERT INTO guesty_refunds (
              confirmation_code, market, listing_id, refund_reason,
              check_in, check_out, pulled_at
            ) VALUES (
              ${r.confirmationCode || r._id}, ${market}, ${r.listingId || null},
              ${reasonField.value}, ${checkIn}, ${checkOut}, NOW()
            )
            ON CONFLICT (confirmation_code, market) DO UPDATE SET
              refund_reason = EXCLUDED.refund_reason,
              pulled_at     = NOW()
          `;
          refundCount++;
        }
        marketResult.refunds = refundCount;
      }
    } catch (err) {
      marketResult.errors.push(`refunds: ${err.message}`);
    }

    results[market] = marketResult;
  }

  return Response.json({ ok: true, results });
}
