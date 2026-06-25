// Single source of truth for all market configuration.
// Every market-sensitive operation must derive credentials from here.
// Never hard-code market data outside this file.

export const MARKETS = {
  branson: {
    label: "Branson / Ozarks",
    kvKey: "guesty:access_token",
    guestyAccountId: "6979849d97c71aa6720b0d0e",
    bzIdentity: 1110,
    // Breezeway uses state code to scope properties — bzIdentity doesn't match
    // the company_id field on property objects (those use a different ID range)
    bzState: "MO",
    // Custom field IDs on this Guesty account
    refundReasonFieldId: "69e92df43e89c40010c58025", // enum: refund_reason
    cleanerFeedbackFieldId: "69efa455004a8900145395f4", // longtext: gs_cleaner_feedback
  },
  deep_creek: {
    label: "Deep Creek",
    kvKey: "guesty:access_token:deepcreek",
    guestyAccountId: "69f4b3c098a33844c5504a52",
    bzIdentity: 1394,
    bzState: "MD",
    refundReasonFieldId: null, // Set when confirmed for this account
    cleanerFeedbackFieldId: "69efa455004a8900145395f4",
  },
  poconos: {
    label: "Poconos",
    kvKey: "guesty:access_token:poconos",
    guestyAccountId: "69f656ec98a33844c5504a52",
    bzIdentity: 1368,
    bzState: "PA",
    refundReasonFieldId: null, // Set when confirmed for this account
    cleanerFeedbackFieldId: null, // Set when confirmed for this account
  },
};

export const MARKET_KEYS = Object.keys(MARKETS);

// Cleaners who are internal staff — excluded from vendor scorecard
export const EXCLUDED_VENDORS = ["linda", "charles", "brandon", "grime time", "shawn"];

export function isExcludedVendor(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return EXCLUDED_VENDORS.some((ex) => lower.includes(ex));
}
