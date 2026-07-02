import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

// Sheet name → market_id mapping (mirrors what branson-tools uses)
const SHEET_MARKET_MAP = {
  "Branson_Zoho_Forms_Submissions  (Exported)":      "branson",
  "Branson_Zoho_Forms_Submissions (integration)":    "branson",
  "Ozark_Zoho_Forms_Submissions (integration)":      "ozark",
  "Deep_Creek_Zoho_Forms_Submissions":               "deepcreek",
  "Tannersville_Zoho_Forms_Submissions":             "poconos",
};

export async function POST(req) {
  // Verify shared secret
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.ZOHO_INTAKE_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sheet_name, rows } = body;
  // rows: [{ row_index: number, data: Record<string, string> }]

  if (!sheet_name || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "sheet_name and rows[] required" }, { status: 400 });
  }

  const market_id = SHEET_MARKET_MAP[sheet_name];
  if (!market_id) {
    return NextResponse.json({ error: `Unknown sheet: ${sheet_name}` }, { status: 400 });
  }

  const records = rows.map(r => ({
    market_id,
    sheet_row:    r.row_index,
    property_name: r.data["Property name:"] || r.data["Property Name"] || null,
    address:       r.data["Address:"] || r.data["Address"] || null,
    data:          r.data,
    synced_at:     new Date().toISOString(),
  }));

  const sb = getSupabase();
  const { error, count } = await sb
    .from("zoho_submissions")
    .upsert(records, {
      onConflict: "market_id,sheet_row",
      ignoreDuplicates: false,  // update existing rows when Zoho edits a submission
    })
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[zoho-intake]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, upserted: count ?? records.length });
}
