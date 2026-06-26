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

// Fetch scheduled cleaning tasks for a property (by scheduled_date range).
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

// Fetch ALL tasks for a property (no date filter) and return only non-cleaning ones.
// These are maintenance/issue tasks created BY cleaners to report problems.
// They may have no scheduled_date, so we can't use the scheduled_date filter.
// We cap at 3 pages (300 tasks) per property to avoid runaway fetches.
export async function fetchBzMaintenanceTasksForProperty(bzPropertyId, propName, fromDate, toDate, market) {
  const results = [];
  let page = 1;
  const limit = 100;
  const MAX_PAGES = 3;
  const fromMs = new Date(fromDate).getTime();
  const toMs = new Date(toDate + "T23:59:59Z").getTime();

  while (page <= MAX_PAGES) {
    const data = await bzFetch(market, "/inventory/v1/task", {
      reference_property_id: bzPropertyId,
      limit,
      page,
    });
    const rows = Array.isArray(data) ? data : (data.results || data.data || []);
    if (!rows.length) break;

    for (const t of rows) {
      // Filter by task type — maintenance/issue tasks have a non-cleaning type_department
      const type = (t.type_department || t.task_type || t.type || "").toLowerCase();
      const name = (t.name || t.task_title || t.title || "").toLowerCase();
      const isMaintenance = type.includes("maintenance") || type.includes("issue") ||
        type.includes("repair") || name.includes("maintenance") || name.includes("issue") ||
        name.includes("repair") || name.includes("damage") || name.includes("broken");
      if (!isMaintenance) continue;

      // Filter by created_at falling within the date window
      const createdMs = t.created_at ? new Date(t.created_at).getTime() : null;
      if (createdMs && (createdMs < fromMs || createdMs > toMs)) continue;

      results.push({ ...t, _propName: propName, _bzId: bzPropertyId });
    }

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
