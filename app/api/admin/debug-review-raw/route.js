import { fetchAllReviews } from "@/lib/guesty";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSessionUser(req) {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/ops_session=([^;]+)/);
  if (!match) return null;
  try {
    const [data] = match[1].split(".");
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch { return null; }
}

// Dumps the first raw review object for each market to inspect all available fields.
export async function GET(req) {
  const session = getSessionUser(req);
  if (!session || session.role !== "admin") return Response.json({ error: "Admin only" }, { status: 403 });

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
