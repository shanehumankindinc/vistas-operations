// Single source of truth for all market configuration.
// Every market-sensitive operation must derive credentials from here.
// Never hard-code market data outside this file.

export const MARKETS = {
  branson: {
    label: "Branson / Ozarks",
    // Guesty
    kvKey: "guesty:access_token",
    guestyAccountId: "6979849d97c71aa6720b0d0e",
    refundReasonFieldId: "69e92df43e89c40010c58025",
    cleanerFeedbackFieldId: "69efa455004a8900145395f4",
    // Breezeway — Branson token is refreshed daily by branson-dashboard revenue-pipeline cron
    bzKvKey: "breezeway:access_token",
    bzClientIdEnv: null,     // Branson uses KV only — no separate OAuth2 creds needed here
    bzClientSecretEnv: null,
    bzIdentity: 1110,
    bzState: "MO",
  },
  deep_creek: {
    label: "Deep Creek",
    // Guesty
    kvKey: "guesty:access_token:deepcreek",
    guestyAccountId: "69f4b3c098a33844c5504a52",
    refundReasonFieldId: "6a20d2e3f908c8001480d65a",
    cleanerFeedbackFieldId: "6a20d2b46ab284001357b7f0",
    // Breezeway — separate DC account, credentials stored as Vercel env vars
    bzKvKey: "breezeway:access_token:deepcreek",
    bzClientIdEnv: "BREEZEWAY_CLIENT_ID_DEEPCREEK",
    bzClientSecretEnv: "BREEZEWAY_CLIENT_SECRET_DEEPCREEK",
    bzIdentity: 1394,
    bzState: "MD",
  },
  poconos: {
    label: "Poconos",
    // Guesty
    kvKey: "guesty:access_token:poconos",
    guestyAccountId: "69f656ec98a33844c5504a52",
    refundReasonFieldId: "6a20d1fe9e162b001339a9a9",
    cleanerFeedbackFieldId: "6a20d20ef1ce860013b6c54c",
    // Breezeway — separate Poconos account, credentials stored as Vercel env vars
    bzKvKey: "breezeway:access_token:poconos",
    bzClientIdEnv: "BREEZEWAY_CLIENT_ID_POCONOS",
    bzClientSecretEnv: "BREEZEWAY_CLIENT_SECRET_POCONOS",
    bzIdentity: 1368,
    bzState: "PA",
  },
};

export const MARKET_KEYS = Object.keys(MARKETS);

// Vendor exclusions are now managed dynamically via the vendor_map table in Supabase.
// The cron auto-registers new vendor names; set excluded=true in vendor_map to hide them.
// This stub is kept for the cron's pre-filter of obviously system-level names only.
export function isExcludedVendor(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower === "unassigned" || lower === "";
}
