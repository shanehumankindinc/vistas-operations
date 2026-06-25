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

// Paginate through all listings for a market
export async function fetchAllListings(market) {
  const results = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const data = await guestyFetch(market, "/listings", { limit, skip, fields: "_id,nickname,title,address,accommodates,bathrooms,bedrooms,propertyType,tags,owners" });
    const rows = data.results || [];
    results.push(...rows);
    if (results.length >= data.count || rows.length === 0) break;
    skip += limit;
  }
  return results;
}

// Paginate through all reviews for a market
export async function fetchAllReviews(market) {
  const results = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const data = await guestyFetch(market, "/reviews", { limit, skip, fields: "_id,submittedAt,listingId,accountId,reservationId,channel,overallScore,cleanliness,accuracy,checkin,communication,location,value,reviewText,privateFeedback" });
    const rows = data.results || [];
    results.push(...rows);
    if (results.length >= data.count || rows.length === 0) break;
    skip += limit;
  }
  return results;
}

// Fetch reservations with check-in within a date range.
// Used for check-in sync (today-90 to today+2) and refund sync.
export async function fetchReservationsByCheckIn(market, fromDate, toDate, extraFields = "") {
  const results = [];
  let skip = 0;
  const limit = 100;
  const baseFields = "_id,listingId,checkIn,checkOut,status,confirmationCode,money";
  const fields = extraFields ? `${baseFields},${extraFields}` : baseFields;

  while (true) {
    const data = await guestyFetch(market, "/reservations", {
      limit,
      skip,
      fields,
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

// Fetch all owners for a market
export async function fetchAllOwners(market) {
  const results = [];
  let skip = 0;
  const limit = 100;
  while (true) {
    const data = await guestyFetch(market, "/owners", { limit, skip });
    const rows = data.results || [];
    results.push(...rows);
    if (results.length >= (data.count || 0) || rows.length === 0) break;
    skip += limit;
  }
  return results;
}
