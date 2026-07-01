import { getSupabase } from "@/lib/db";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const SHEET_ID = "10VuBl4aDZci89lHiDLayWNd7U-uznTD24emFFu-F3m0";
const SHEET_NAME = "Tasks";
const PROPERTIES_SHEET = "Properties";
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

// Fetch a sheet from the public Google Sheets doc and return parsed rows.
async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Sheets fetch failed for "${sheetName}": ${res.status}`);
  return parseCSV(await res.text());
}

// Build listing_id lookup maps from the Properties sheet.
// Returns { displayMap, nameMap } where keys are lowercased strings.
// displayMap: "Property Display" value -> guesty_id (exact match on the Tasks "Property" field)
// nameMap: "Property Name" -> guesty_id (fallback)
// Skips rows where Guesty ID is LOCAL-HQ (Office HQ placeholder).
// For duplicate property names, last row wins (most recently added entry in the sheet).
function buildPropertyMaps(rows) {
  if (rows.length < 2) return { displayMap: {}, nameMap: {} };

  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const nameIdx    = headers.indexOf("property_name");
  const guestyIdx  = headers.indexOf("guesty_id");
  const displayIdx = headers.indexOf("property_display");

  const displayMap = {};
  const nameMap = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const guestyId = r[guestyIdx]?.trim();
    if (!guestyId || guestyId === "LOCAL-HQ") continue;

    const propName    = r[nameIdx]?.trim();
    const propDisplay = r[displayIdx]?.trim();

    if (propDisplay) displayMap[propDisplay.toLowerCase()] = guestyId;
    if (propName)    nameMap[propName.toLowerCase()]       = guestyId;
  }

  return { displayMap, nameMap };
}

// Runs at 6am UTC daily.
// Pulls the Tasks sheet from the Deep Creek timesheet Google Sheets doc (public viewer access).
// Pulls the Properties sheet to resolve listing_id directly from the sheet's Guesty ID column.
// Splits the Property field into property_name and property_address on " | ".
// Full upsert on every run -- all historical rows, deduped by the sheet's own ID column.
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  // Fetch both sheets concurrently
  const [tasksRows, propertiesRows] = await Promise.all([
    fetchSheet(SHEET_NAME),
    fetchSheet(PROPERTIES_SHEET),
  ]);

  if (tasksRows.length < 2) {
    return Response.json({ ok: true, upserted: 0, reason: "empty tasks sheet" });
  }

  // Build property lookup maps from the Properties sheet (authoritative Guesty ID source)
  const { displayMap, nameMap } = buildPropertyMaps(propertiesRows);

  // Map headers by name so column order changes don't break parsing
  const headers = tasksRows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
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

  const rows = [];
  const unmatched = new Set();

  for (let i = 1; i < tasksRows.length; i++) {
    const r = tasksRows[i];
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

      // Match by full "Property Display" value first (exact), then by property name alone
      listingId =
        displayMap[propertyRaw.toLowerCase()] ||
        (propertyName ? nameMap[propertyName.toLowerCase()] : null) ||
        null;

      if (!listingId && propertyName !== "Office (HQ)") {
        unmatched.add(propertyName);
      }
    }

    // Parse date string -- sheet format is DD/MM/YYYY
    let dateVal = null;
    const rawDate = r[dateIdx]?.trim();
    if (rawDate) {
      const parts = rawDate.split("/");
      if (parts.length === 3) {
        dateVal = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
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
    properties_mapped: Object.keys(displayMap).length,
    unmatched_property_names: [...unmatched],
  });
}
