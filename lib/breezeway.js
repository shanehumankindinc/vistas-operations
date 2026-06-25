import { Redis } from "@upstash/redis";
import { MARKETS } from "./markets.js";

const BASE = "https://api.breezeway.io/public";
const BZ_AUTH_URL = "https://api.breezeway.io/public/auth/v1/";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Get a valid Breezeway JWT for the given market.
// Branson: reads from KV (token seeded by branson-dashboard revenue-pipeline cron).
// DC / Poconos: reads from KV first; if missing, calls OAuth2 using Vercel env vars
//   (BREEZEWAY_CLIENT_ID_DEEPCREEK / _POCONOS etc.) and caches result in KV for 23h.
export async function getBzToken(market) {
  const cfg = MARKETS[market];
  if (!cfg) throw new Error(`Unknown market: ${market}`);

  const { bzKvKey, bzClientIdEnv, bzClientSecretEnv } = cfg;

  // Always try KV first — avoids redundant OAuth2 calls
  const cached = await kv.get(bzKvKey);
  if (cached) return cached;

  // Branson token must come from KV (refreshed by branson-dashboard) — never call OAuth2 here
  if (!bzClientIdEnv || !bzClientSecretEnv) {
    throw new Error(
      `Breezeway token not in KV (key: ${bzKvKey}). ` +
        `Wait for the 5am UTC branson-dashboard cron or run /api/admin/refresh-bz-token.`
    );
  }

  const clientId = process.env[bzClientIdEnv];
  const clientSecret = process.env[bzClientSecretEnv];

  if (!clientId || !clientSecret) {
    throw new Error(
      `Breezeway credentials not configured for market "${market}". ` +
        `Set ${bzClientIdEnv} and ${bzClientSecretEnv} in Vercel environment variables.`
    );
  }

  const resp = await fetch(BZ_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(
      resp.status === 429
        ? `Breezeway rate limit (1 req/min) hit for market "${market}". Wait 60s and retry.`
        : (body?.message || body?.error || `Breezeway auth error (${resp.status}) for ${market}`)
    );
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error(`Breezeway returned no access_token for ${market}`);

  // Cache in KV for 25h — slightly over the 24h cron interval so the daily cron
  // always finds a valid token. The cron will extend it each time it runs.
  await kv.set(bzKvKey, data.access_token, { ex: 25 * 60 * 60 });

  return data.access_token;
}

async function bzFetch(market, path, params = {}) {
  const token = await getBzToken(market);
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `JWT ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Breezeway [${market}] ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// Fetch tasks for a single property by its reference_property_id.
export async function fetchBzTasksForProperty(bzPropertyId, propName, fromDate, toDate, market) {
  const results = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const data = await bzFetch(market, "/inventory/v1/task", {
      reference_property_id: bzPropertyId,
      scheduled_date: `${fromDate},${toDate}`,
      limit,
      page,
    });
    const rows = Array.isArray(data) ? data : (data.results || data.data || []);
    results.push(...rows.map((t) => ({ ...t, _propName: propName, _bzId: bzPropertyId })));
    if (rows.length < limit) break;
    page++;
  }
  return results;
}

// Fetch ALL Breezeway properties for a specific market's BZ account.
export async function fetchAllBzPropertiesForMarket(market) {
  const all = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const data = await bzFetch(market, "/inventory/v1/property", { limit, page });
    const rows = Array.isArray(data) ? data : (data.results || []);
    all.push(...rows);
    if (rows.length < limit) break;
    page++;
  }

  return all;
}
