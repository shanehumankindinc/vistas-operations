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
    refundReasonFieldId: null,
    cleanerFeedbackFieldId: "69efa455004a8900145395f4",
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
    refundReasonFieldId: null,
    cleanerFeedbackFieldId: null,
    // Breezeway — separate Poconos account, credentials stored as Vercel env vars
    bzKvKey: "breezeway:access_token:poconos",
    bzClientIdEnv: "BREEZEWAY_CLIENT_ID_POCONOS",
    bzClientSecretEnv: "BREEZEWAY_CLIENT_SECRET_POCONOS",
    bzIdentity: 1368,
    bzState: "PA",
  },
};

export const MARKET_KEYS = Object.keys(MARKETS);

// Names excluded from the vendor scorecard — internal staff, admins, supervisors, and unassigned tasks.
// Uses substring match (lowercase), so "shane" catches "Shane Brooks", etc.
export const EXCLUDED_VENDORS = [
  // Branson internal staff
  "linda", "charles", "brandon", "grime time", "shawn",
  // Admin / supervisor accounts across all markets (not service providers)
  "unassigned", "guest services", "shane brooks", "marissa albright",
  "richard bryson", "taylor moriarity", "ashish dev",
];

export function isExcludedVendor(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return EXCLUDED_VENDORS.some((ex) => lower.includes(ex));
}
