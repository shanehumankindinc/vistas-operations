import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";
import { fetchAllBzPropertiesForMarket, getBzToken } from "@/lib/breezeway";

// Map Supabase onboarding market IDs → lib/markets.js keys for Breezeway API calls
const BZ_MARKET_MAP = {
  branson:   "branson",
  ozark:     "branson",   // Ozark shares the Branson BZ account (identity 1110)
  deepcreek: "deep_creek",
  poconos:   "poconos",
};

// Normalise a name for fuzzy matching (lowercase, strip punctuation/whitespace)
function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// GET: list Breezeway properties for a market and match with zoho_submissions
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market");
  if (!market) return NextResponse.json({ error: "market required" }, { status: 400 });

  const bzMarket = BZ_MARKET_MAP[market];
  if (!bzMarket) return NextResponse.json({ error: `Unknown market: ${market}` }, { status: 400 });

  // Fetch BZ properties + Zoho submissions in parallel
  const [bzResult, sbResult] = await Promise.allSettled([
    fetchAllBzPropertiesForMarket(bzMarket),
    (async () => {
      const sb = getSupabase();
      const { data } = await sb
        .from("zoho_submissions")
        .select("id, property_name, address, submitted_at, data")
        .eq("market_id", market)
        .order("submitted_at", { ascending: false });
      return data || [];
    })(),
  ]);

  const bzProps = bzResult.status === "fulfilled" ? bzResult.value : [];
  const zohoSubs = sbResult.status === "fulfilled" ? sbResult.value : [];
  const bzError = bzResult.status === "rejected" ? bzResult.reason?.message : null;

  // Build zoho lookup map by normalised name
  const zohoByName = new Map();
  for (const sub of zohoSubs) {
    const key = normName(sub.property_name);
    if (key && !zohoByName.has(key)) zohoByName.set(key, sub);
  }

  // Match each BZ property to a Zoho submission
  const properties = bzProps.map(p => {
    const bzName = p.name || p.unit_name || "";
    const matched = zohoByName.get(normName(bzName)) || null;
    return {
      bz_id: p.id,
      bz_name: bzName,
      bz_address: p.address || null,
      bz_notes: p.notes || null,
      bz_tags: p.tags || [],
      zoho_submission: matched ? {
        id: matched.id,
        property_name: matched.property_name,
        address: matched.address,
        submitted_at: matched.submitted_at,
      } : null,
    };
  });

  return NextResponse.json({
    properties,
    total: properties.length,
    matched: properties.filter(p => p.zoho_submission).length,
    zoho_count: zohoSubs.length,
    bz_error: bzError,
  });
}

// POST: push notes from a Zoho submission to a Breezeway property
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market, bz_id, notes } = body;
  if (!market || !bz_id || notes === undefined) {
    return NextResponse.json({ error: "market, bz_id, notes required" }, { status: 400 });
  }

  const bzMarket = BZ_MARKET_MAP[market];
  if (!bzMarket) return NextResponse.json({ error: `Unknown market: ${market}` }, { status: 400 });

  try {
    const token = await getBzToken(bzMarket);
    const resp = await fetch(`https://api.breezeway.io/public/inventory/v1/property/${bz_id}/`, {
      method: "PATCH",
      headers: {
        Authorization: `JWT ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ notes }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return NextResponse.json({ error: `Breezeway PATCH failed (${resp.status}): ${errText}` }, { status: resp.status });
    }

    const data = await resp.json().catch(() => ({}));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
