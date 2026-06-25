import { Redis } from "@upstash/redis";
import { MARKETS } from "./markets.js";

const BASE = "https://api.breezeway.io/public";
const BZ_KV_KEY = "breezeway:access_token";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// KV-read-only — never calls OAuth2 from here.
// Token is seeded by /api/admin/refresh-bz-token and refreshed daily
// by branson-dashboard's revenue-pipeline cron at 5am UTC.
async function getBzToken() {
  const token = await kv.get(BZ_KV_KEY);
  if (!token) {
    throw new Error(
      `Breezeway token not in KV (key: ${BZ_KV_KEY}). ` +
        `Run /api/admin/refresh-bz-token to seed it, or wait for the 5am UTC cron.`
    );
  }
  return token;
}

async function bzFetch(path, params = {}) {
  const token = await getBzToken();
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `JWT ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Breezeway ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// Fetch tasks for a single property by its reference_property_id.
// This matches the branson-dashboard pattern exactly.
// propName is attached to each task for display purposes.
export async function fetchBzTasksForProperty(bzPropertyId, propName, fromDate, toDate) {
  const results = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const data = await bzFetch("/inventory/v1/task", {
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
