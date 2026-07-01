import { Redis } from "@upstash/redis";
import { MARKETS } from "./markets.js";

const BASE = "https://open-api.guesty.com/v1";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Read-only token fetch — never calls OAuth2.
// Throws if token is missing (do not add a fallback).
export async function getGuestyToken(market) {
  const cfg = MARKETS[market];
  if (!cfg) throw new Error(`Unknown market: ${market}`);
  const token = await kv.get(cfg.kvKey);
  if (!token) {
    throw new Error(
      `Guesty token not in KV cache for market "${market}" (key: ${cfg.kvKey}). ` +
        `Wait for the 7am UTC cron or run it manually.`
    );
  }
  return token;
}

async function guestyFetch(market, path, params = {}) {
  const token = await getGuestyToken(market);
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Guesty ${market} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// Paginate through all listings for a market.
// NOTE: do NOT pass a `fields` param — the `owners` field is suppressed when
// fields are filtered explicitly, but is included in full listing objects.
export async function fetchAllListings(market) {
  const results = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const data = await guestyFetch(market, "/listings", { limit, skip });
    const rows = data.results || [];
    results.push(...rows);
    if (results.length >= data.count || rows.length === 0) break;
    skip += limit;
  }
  return results;
}

// Paginate through all reviews for a market.
// Note: /reviews does not accept a `fields` param — returns full objects.
// Response shape is { data: [...], limit, skip } — NOT { results, count }.
export async function fetchAllReviews(market) {
  const results = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const resp = await guestyFetch(market, "/reviews", { limit, skip });
    const rows = resp.data || [];
    results.push(...rows);
    if (rows.length < limit) break;
    skip += limit;
  }
  return results;
}

// Fetch reservations with check-in within a date range.
// Used for check-in sync (today-90 to today+2) and refund sync.
//
// NOTE: do NOT pass a `fields` param — Guesty strips checkIn/checkOut/confirmationCode
// from the response when field filtering is active. Omitting it returns the full object
// including all date and code fields we need.
export async function fetchReservationsByCheckIn(market, fromDate, toDate) {
  const results = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const data = await guestyFetch(market, "/reservations", {
      limit,
      skip,
      checkInDateFrom: fromDate,
      checkInDateTo: toDate,
      statuses: "confirmed,checked_in,checked_out,closed",
    });
    const rows = data.results || [];
    results.push(...rows);
    if (results.length >= (data.count || 0) || rows.length === 0) break;
    skip += limit;
  }
  return results;
}

// Fetch all owner blocks for a market from /v1/owners-reservations.
// This endpoint is completely separate from /v1/reservations — owner blocks
// do NOT appear in the regular reservations endpoint.
// Returns all records (no date filter — filter on JS side for overlap with your window).
export async function fetchOwnerReservations(market) {
  const results = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const data = await guestyFetch(market, "/owners-reservations", { limit, skip });
    const rows = data.results || data.data || [];
    results.push(...rows);
    const total = data.count ?? data.total ?? 0;
    if (results.length >= total || rows.length === 0) break;
    skip += limit;
  }
  return results;
}

// Fetch owners by ID, one at a time in batches of 10 with 500ms between batches.
// Do NOT paginate /v1/owners — it returns 18k+ records across all accounts and hits 429.
// Extract ownerIds from listing.owners fields before calling this.
export async function fetchOwnersByIds(market, ownerIds) {
  const unique = [...new Set(ownerIds.filter(Boolean))];
  const results = [];
  const BATCH = 10;

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          return await guestyFetch(market, `/owners/${id}`);
        } catch {
          return null;
        }
      })
    );
    results.push(...fetched.filter(Boolean));
    if (i + BATCH < unique.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return results;
}
