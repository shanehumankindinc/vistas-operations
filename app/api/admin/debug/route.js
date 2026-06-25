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

  // --- Breezeway: peek at first 2 properties ---
  try {
    const bzToken = await kv.get("breezeway:access_token");
    if (!bzToken) throw new Error("No BZ token in KV");

    const bzRes = await fetch("https://api.breezeway.io/public/inventory/v1/property?limit=2&page=1", {
      headers: { Authorization: `JWT ${bzToken}`, Accept: "application/json" },
    });
    const bzData = await bzRes.json();
    out.breezeway_sample = {
      status: bzRes.status,
      type: Array.isArray(bzData) ? "array" : "object",
      count: Array.isArray(bzData) ? bzData.length : bzData.count,
      first_keys: (Array.isArray(bzData) ? bzData[0] : bzData.results?.[0]) ? Object.keys(Array.isArray(bzData) ? bzData[0] : bzData.results[0]) : [],
      first: Array.isArray(bzData) ? bzData[0] : bzData.results?.[0],
      market_ids: { branson: MARKETS.branson.bzIdentity, deep_creek: MARKETS.deep_creek.bzIdentity, poconos: MARKETS.poconos.bzIdentity },
    };
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
