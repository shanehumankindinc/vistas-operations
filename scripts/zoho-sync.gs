/**
 * Zoho → Supabase sync via vistas-operations intake endpoint.
 *
 * SETUP (one-time):
 *   1. Open the Google Sheet → Extensions → Apps Script → paste this file.
 *   2. Set the two constants below.
 *   3. Run installTrigger() once from the Apps Script editor to register the onChange trigger.
 *   4. Run syncAll() once to backfill all existing rows.
 *
 * After that, every time Zoho writes a new row the trigger fires automatically.
 */

// ── Config ────────────────────────────────────────────────────────────────────

const INTAKE_URL    = "https://vistas-operations.vercel.app/api/onboarding/zoho-intake";
const INTAKE_SECRET = "REPLACE_WITH_ZOHO_INTAKE_SECRET";  // matches Vercel env var ZOHO_INTAKE_SECRET

// Sheet name → market_id (must match server-side map in zoho-intake/route.js)
const SHEET_MARKET_MAP = {
  "Branson_Zoho_Forms_Submissions  (Exported)":   "branson",
  "Branson_Zoho_Forms_Submissions (integration)": "branson",
  "Ozark_Zoho_Forms_Submissions (integration)":   "ozark",
  "Deep_Creek_Zoho_Forms_Submissions":            "deepcreek",
  "Tannersville_Zoho_Forms_Submissions":          "poconos",
};

// ── Install / uninstall trigger ───────────────────────────────────────────────

function installTrigger() {
  // Remove any existing onChange triggers for this script first
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "onZohoWrite")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("onZohoWrite")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  Logger.log("Trigger installed.");
}

function uninstallTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "onZohoWrite")
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("Trigger removed.");
}

// ── onChange handler (fires on every Zoho write) ──────────────────────────────

function onZohoWrite(e) {
  // We re-sync the whole sheet each trigger rather than trying to detect
  // exactly which rows changed — safe, idempotent (server upserts by row index).
  const sheet = e.source.getActiveSheet();
  syncSheet(sheet);
}

// ── Manual backfill (run once after setup, or to re-sync a sheet) ─────────────

function syncAll() {
  const ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (SHEET_MARKET_MAP[name]) {
      Logger.log("Syncing sheet: " + name);
      syncSheet(sheet);
    }
  });
  Logger.log("syncAll complete.");
}

// ── Core sync logic ───────────────────────────────────────────────────────────

function syncSheet(sheet) {
  const name = sheet.getName();
  const market = SHEET_MARKET_MAP[name];
  if (!market) return;  // not a Zoho submission sheet — skip

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;  // header only, nothing to sync

  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const dataRows  = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Build rows payload: row_index is 1-based matching the Sheet row number (row 2 = first data row)
  const rows = dataRows.map((row, i) => {
    const data = {};
    headerRow.forEach((header, col) => {
      if (header) data[String(header)] = row[col] != null ? String(row[col]) : "";
    });
    return { row_index: i + 2, data };
  });

  // Send in batches of 100 to stay under request size limits
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const payload = JSON.stringify({ sheet_name: name, rows: batch });

    const response = UrlFetchApp.fetch(INTAKE_URL, {
      method:  "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + INTAKE_SECRET },
      payload: payload,
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log("ERROR [" + name + "] batch " + i + ": HTTP " + code + " — " + response.getContentText());
    } else {
      Logger.log("OK [" + name + "] rows " + (i + 2) + "–" + (i + 2 + batch.length - 1));
    }
  }
}
