import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";
import { getBzToken } from "@/lib/breezeway";

const BZ_MARKET_MAP = {
  branson:   "branson",
  ozark:     "branson",
  deepcreek: "deep_creek",
  poconos:   "poconos",
};

// POST: suggest tags for a submission OR apply approved tags to a BZ property
export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, submission_id, bz_id, market, tags } = body;

  // action=suggest: generate AI tag suggestions
  if (action === "suggest") {
    if (!submission_id) return NextResponse.json({ error: "submission_id required" }, { status: 400 });

    const sb = getSupabase();
    const { data: sub, error } = await sb
      .from("zoho_submissions")
      .select("property_name, address, data")
      .eq("id", submission_id)
      .single();

    if (error || !sub) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

    const fields = Object.entries(sub.data || {})
      .filter(([, v]) => v !== null && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const prompt = `You are a vacation rental operations expert. Analyze this property inspection data and suggest relevant Breezeway operational tags.

Property: ${sub.property_name || "Unknown"}
${fields}

Return ONLY a valid JSON object (no markdown):
{
  "tags": ["tag1", "tag2", ...],
  "reasoning": "brief explanation of tag choices"
}

Tags should be short, operational labels cleaners and managers use. Examples: "Pool", "Hot Tub", "Pet Friendly", "Large Group", "Waterfront", "Mountain View", "EV Charger", "No Stairs", "Steep Driveway", "Gate Code Required", "Keypad Entry", "Propane", "Well Water", "Septic", "Bear Box Required", "Fireplace", "Steam Room", "Game Room", "Theater Room", "Bunk Beds", etc.
Only suggest tags that are clearly supported by the inspection data.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await resp.json();
    if (!resp.ok) return NextResponse.json({ error: result?.error?.message || "AI error" }, { status: resp.status });

    const text = result.content?.[0]?.text || "";
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: text }, { status: 500 });
    }
  }

  // action=apply: push approved tags to Breezeway property
  if (action === "apply") {
    if (!market || !bz_id || !Array.isArray(tags)) {
      return NextResponse.json({ error: "market, bz_id, tags[] required" }, { status: 400 });
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
        body: JSON.stringify({ tags }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return NextResponse.json({ error: `Breezeway PATCH failed (${resp.status}): ${errText}` }, { status: resp.status });
      }

      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "action must be 'suggest' or 'apply'" }, { status: 400 });
}
