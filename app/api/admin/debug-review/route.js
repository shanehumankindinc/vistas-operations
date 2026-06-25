import { getGuestyToken } from "@/lib/guesty";

export const dynamic = "force-dynamic";

// Debug-only: returns raw Guesty /reviews response for one market.
// ?market=branson|deep_creek|poconos  (default: branson)
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "branson";

  try {
    const token = await getGuestyToken(market);
    const res = await fetch("https://open-api.guesty.com/v1/reviews?limit=2&skip=0", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await res.json();

    // Return the raw response + a flattened view of score fields on first review
    const first = raw?.data?.[0] || raw?.results?.[0] || raw?.[0] || null;
    const analysis = first
      ? {
          topLevelKeys: Object.keys(first),
          rawReviewKeys: first.rawReview ? Object.keys(first.rawReview) : "rawReview is null/missing",
          scores: {
            "r.overallScore":      first.overallScore,
            "r.cleanliness":       first.cleanliness,
            "raw.overallRating":   first.rawReview?.overallRating,
            "raw.overallScore":    first.rawReview?.overallScore,
            "raw.cleanliness":     first.rawReview?.cleanliness,
            "raw.accuracy":        first.rawReview?.accuracy,
            "raw.communication":   first.rawReview?.communication,
            "raw.publicReview":    first.rawReview?.publicReview,
            "raw.reviewText":      first.rawReview?.reviewText,
            "r.reviewText":        first.reviewText,
          },
          firstReview: first,
        }
      : { error: "no reviews in response", raw };

    return Response.json({ market, status: res.status, analysis });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
