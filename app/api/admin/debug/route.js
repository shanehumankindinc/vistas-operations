import { Redis } from "@upstash/redis";
import { MARKETS } from "@/lib/markets";

export const dynamic = "force-dynamic";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out = {};

  // --- Breezeway: state distribution across all properties ---
  try {
    const bzToken = await kv.get("breezeway:access_token");
    if (!bzToken) throw new Error("No BZ token in KV");

    // Fetch all pages to tally state codes
    const stateCounts = {};
    let page = 1;
    let total = 0;
    while (true) {
      const bzRes = await fetch(`https://api.breezeway.io/public/inventory/v1/property?limit=100&page=${page}`, {
        headers: { Authorization: `JWT ${bzToken}`, Accept: "application/json" },
      });
      const bzData = await bzRes.json();
      const rows = Array.isArray(bzData) ? bzData : (bzData.results || []);
      if (rows.length === 0) break;
      rows.forEach((p) => {
        const s = p.state || "null";
        stateCounts[s] = (stateCounts[s] || 0) + 1;
      });
      total += rows.length;
      if (rows.length < 100) break;
      page++;
    }
    out.breezeway_state_distribution = { total, stateCounts };
  } catch (e) {
    out.breezeway_error = e.message;
  }

  // --- Guesty: peek at first review and first listing for branson ---
  try {
    const gToken = await kv.get(MARKETS.branson.kvKey);
    if (!gToken) throw new Error("No Guesty token in KV for branson");

    const [revRes, listRes, listFullRes] = await Promise.all([
      fetch("https://open-api.guesty.com/v1/reviews?limit=1&skip=0", {
        headers: { Authorization: `Bearer ${gToken}` },
      }),
      fetch("https://open-api.guesty.com/v1/listings?limit=1&skip=0&fields=_id,nickname,owners", {
        headers: { Authorization: `Bearer ${gToken}` },
      }),
      // Fetch without fields filter to see ALL available fields
      fetch("https://open-api.guesty.com/v1/listings?limit=1&skip=0", {
        headers: { Authorization: `Bearer ${gToken}` },
      }),
    ]);

    const revData = await revRes.json();
    const listData = await listRes.json();
    const listFullData = await listFullRes.json();

    out.guesty_reviews_sample = {
      status: revRes.status,
      top_keys: revData ? Object.keys(revData) : [],
      // Check both common patterns
      data_key: revData.data ? `array[${revData.data.length}]` : "missing",
      results_key: revData.results ? `array[${revData.results.length}]` : "missing",
      first_via_data: revData.data?.[0] ? Object.keys(revData.data[0]) : [],
    };
    out.guesty_listing_with_fields = {
      status: listRes.status,
      first_keys: listData.results?.[0] ? Object.keys(listData.results[0]) : [],
    };
    out.guesty_listing_full_keys = {
      status: listFullRes.status,
      first_keys: listFullData.results?.[0] ? Object.keys(listFullData.results[0]) : [],
      owners_field: listFullData.results?.[0]?.owners,
      ownerIds_field: listFullData.results?.[0]?.ownerIds,
    };
  } catch (e) {
    out.guesty_error = e.message;
  }

  return Response.json(out);
}
