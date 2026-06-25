import { Redis } from "@upstash/redis";
import { MARKETS } from "./markets.js";

const BASE = "https://api.breezeway.io/public";
const BZ_KV_KEY = "breezeway:access_token";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Each Breezeway identity (1110, 1394, 1368) uses the same OAuth2 credentials
// but represents a different company/portfolio within Breezeway.
// The identity is passed as part of the request to scope results correctly.

async function getBzToken() {
  const cached = await kv.get(BZ_KV_KEY);
  if (cached) return cached;

  // Fetch new token — only when cache is empty
  const res = await fetch(`${BASE}/auth/v1/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.BREEZEWAY_CLIENT_ID,
      client_secret: process.env.BREEZEWAY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Breezeway auth failed: ${res.status}`);
  const data = await res.json();
  const token = data.access_token;
  // Cache for 23 hours (rate limit: 1 auth req/min — only refresh when expired)
  await kv.set(BZ_KV_KEY, token, { ex: 82800 });
  return token;
}

async function bzFetch(path, params = {}, retry = true) {
  const token = await getBzToken();
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  // On 401, clear the cached token and retry once with a fresh one
  if (res.status === 401 && retry) {
    await kv.del(BZ_KV_KEY);
    return bzFetch(path, params, false);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Breezeway ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// Fetch cleaning tasks for a specific market identity within a date range.
// date format: "YYYY-MM-DD"
export async function fetchBzTasks(market, fromDate, toDate) {
  const { bzIdentity } = MARKETS[market];
  const results = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const data = await bzFetch("/inventory/v1/task", {
      company_id: bzIdentity,
      scheduled_date: `${fromDate},${toDate}`,
      limit,
      page,
    });
    const rows = Array.isArray(data) ? data : (data.results || []);
    results.push(...rows);
    if (rows.length < limit) break;
    page++;
  }
  return results;
}

// Fetch all properties for a market identity
export async function fetchBzProperties(market) {
  const { bzIdentity } = MARKETS[market];
  const results = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const data = await bzFetch("/inventory/v1/property", {
      company_id: bzIdentity,
      limit,
      page,
    });
    const rows = Array.isArray(data) ? data : (data.results || []);
    results.push(...rows);
    if (rows.length < limit) break;
    page++;
  }
  return results;
}
