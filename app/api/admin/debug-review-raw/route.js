import { fetchAllReviews } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dumps the first raw review object for each market to inspect all available fields.
// Auth: ?secret=CRON_SECRET
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { MARKET_KEYS } = await import("@/lib/markets");
  const samples = {};

  for (const market of MARKET_KEYS) {
    try {
      const reviews = await fetchAllReviews(market);
      const sample = reviews[0] || null;
      samples[market] = {
        total: reviews.length,
        root_keys: sample ? Object.keys(sample) : [],
        rawReview_keys: sample?.rawReview ? Object.keys(sample.rawReview) : [],
        sample_root: sample
          ? Object.fromEntries(
              Object.entries(sample).filter(([k]) => k !== "rawReview")
            )
          : null,
        sample_rawReview: sample?.rawReview || null,
      };
    } catch (err) {
      samples[market] = { error: err.message };
    }
  }

  return Response.json({ ok: true, samples });
}
