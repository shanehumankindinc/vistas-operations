import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

// Fields to exclude from the AI prompt (operational, not listing-relevant)
const EXCLUDE_KEYS = new Set([
  "IP Address", "Added Time", "Entry Id", "Submit Date", "Submit Time",
]);

export async function POST(req) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { submission_id } = body;
  if (!submission_id) {
    return NextResponse.json({ error: "submission_id required" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data: sub, error } = await sb
    .from("zoho_submissions")
    .select("property_name, address, market_id, data")
    .eq("id", submission_id)
    .single();

  if (error || !sub) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  // Build a clean field list for the prompt
  const fields = Object.entries(sub.data || {})
    .filter(([k, v]) => !EXCLUDE_KEYS.has(k) && v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const prompt = `You are an expert vacation rental copywriter. Based on the property inspection data below, write high-converting listing copy for both Airbnb and VRBO.

Property: ${sub.property_name || "Unknown"}
Address: ${sub.address || "Unknown"}
Market: ${sub.market_id}

Inspection Data:
${fields}

Write the following (return ONLY valid JSON, no markdown):
{
  "airbnb_title": "max 50 characters, punchy, highlight the best feature",
  "airbnb_description": "engaging description, 3-4 paragraphs, mention top amenities, local area, ideal guests",
  "vrbo_title": "max 80 characters, family/group friendly emphasis",
  "vrbo_description": "similar depth to airbnb but slightly more formal, mention sleeping capacity and group suitability"
}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const result = await resp.json();

  if (!resp.ok) {
    return NextResponse.json({ error: result?.error?.message || "Anthropic error" }, { status: resp.status });
  }

  const text = result.content?.[0]?.text || "";
  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON", raw: text }, { status: 500 });
  }

  return NextResponse.json(parsed);
}
