import { getGuestyToken } from "@/lib/guesty";

export const dynamic = "force-dynamic";

// Debug: shows raw Guesty /reviews response and what the cron would extract.
// ?market=branson|deep_creek|poconos  (default: branson)
// ?skip=0  — page offset for pagination
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "branson";
  const skip = parseInt(searchParams.get("skip") || "0", 10);

  try {
    const token = await getGuestyToken(market);
    const res = await fetch(`https://open-api.guesty.com/v1/reviews?limit=3&skip=${skip}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const rows = body?.data || body?.results || body || [];

    const parsed = rows.map((r) => {
      const raw = r.rawReview || {};
      return {
        review_id:    r._id,
        channel:      r.channelId,
        listing_id:   r.listingId,
        rawReview_keys: Object.keys(raw),
        rawReview_submitted: raw.submitted,
        extracted: {
          submitted_at:  (raw.submitted_at || raw.first_completed_at || r.createdAt || "").slice(0, 10),
          overall_score: raw.overall_rating ?? null,
          cleanliness:   raw.category_ratings_cleanliness ?? null,
          accuracy:      raw.category_ratings_accuracy ?? null,
          review_text:   raw.public_review ? raw.public_review.slice(0, 80) : null,
        },
      };
    });

    return Response.json({ market, skip, total_in_page: rows.length, parsed });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
