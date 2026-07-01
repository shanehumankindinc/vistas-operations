import { getSupabase } from "@/lib/db";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const SHEET_ID = "10VuBl4aDZci89lHiDLayWNd7U-uznTD24emFFu-F3m0";
const SHEET_NAME = "Tasks";
const MARKET = "deep_creek";

// Minimal RFC-4180-compliant CSV parser (handles quoted fields, embedded commas, escaped quotes).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = "";
      } else if (ch === '\r' && next === '\n') {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
      } else if (ch === '\n') {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Runs at 6am UTC daily.
// Pulls the Tasks sheet from the Deep Creek timesheet Google Sheets doc (public viewer access).
// Splits the Property field into property_name and property_address on " | ".
// Resolves listing_id from guesty_properties.nickname for deep_creek market.
// Full upsert on every run — all historical rows, deduped by the sheet's own ID column.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  // Fetch CSV from public Google Sheet
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const res = await fetch(csvUrl);
  if (!res.ok) {
    return Response.json(
      { error: `Google Sheets fetch failed: ${res.status}` },
      { status: 502 }
    );
  }
  const csvText = await res.text();

  const allRows = parseCSV(csvText);
  if (allRows.length < 2) {
    return Response.json({ ok: true, upserted: 0, reason: "empty sheet" });
  }

  // Map headers by name so column order changes don't break parsing
  const headers = allRows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name) => headers.indexOf(name);

  const idIdx    = col("id");
  const visitIdx = col("visit");
  const dateIdx  = col("date");
  const propIdx  = col("property");
  const taskIdx  = col("task");
  const startIdx = col("start");
  const endIdx   = col("end");
  const totalIdx = col("total_time");
  const userIdx  = col("user");

  // Build nickname -> listing_id lookup for deep_creek
  const { data: properties } = await supabase
    .from("guesty_properties")
    .select("id, nickname")
    .eq("market", MARKET);

  const nicknameMap = {};
  for (const p of properties || []) {
    nicknameMap[p.nickname.trim().toLowerCase()] = p.id;
  }

  const rows = [];
  const unmatched = new Set();

  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    const rowId = r[idIdx]?.trim();
    if (!rowId) continue;

    const propertyRaw = r[propIdx]?.trim() || null;
    let propertyName = null;
    let propertyAddress = null;
    let listingId = null;

    if (propertyRaw) {
      const pipePos = propertyRaw.indexOf(" | ");
      if (pipePos !== -1) {
        propertyName    = propertyRaw.slice(0, pipePos).trim();
        propertyAddress = propertyRaw.slice(pipePos + 3).trim();
      } else {
        propertyName = propertyRaw;
      }
      listingId = nicknameMap[propertyName.toLowerCase()] || null;
      if (!listingId && propertyName !== "Office (HQ)") {
        unmatched.add(propertyName);
      }
    }

    // Parse date string — sheet stores as MM/DD/YYYY
    let dateVal = null;
    const rawDate = r[dateIdx]?.trim();
    if (rawDate) {
      const parts = rawDate.split("/");
      if (parts.length === 3) {
        dateVal = `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
      }
    }

    rows.push({
      id:               rowId,
      market:           MARKET,
      visit_id:         r[visitIdx]?.trim() || null,
      date:             dateVal,
      property_raw:     propertyRaw,
      property_name:    propertyName,
      property_address: propertyAddress,
      listing_id:       listingId,
      task_description: r[taskIdx]?.trim() || null,
      start_time:       r[startIdx]?.trim() || null,
      end_time:         r[endIdx]?.trim() || null,
      total_time:       r[totalIdx]?.trim() || null,
      user_email:       r[userIdx]?.trim() || null,
      pulled_at:        new Date().toISOString(),
    });
  }

  // Upsert in 500-row chunks
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("timesheet_visits")
      .upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(error.message);
    upserted += chunk.length;
  }

  return Response.json({
    ok: true,
    total_rows: rows.length,
    upserted,
    unmatched_property_names: [...unmatched],
  });
}
