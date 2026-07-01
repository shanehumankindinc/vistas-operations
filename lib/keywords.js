// Keyword categories for review text scanning in cleaner performance reports.
// Each term is matched case-insensitively as a substring of the review text.

export const CLEANLINESS_POSITIVE = [
  "spotless", "immaculate", "sparkling", "pristine", "impeccable",
  "squeaky clean", "super clean", "very clean", "so clean", "perfectly clean",
  "spotlessly clean", "beautifully clean", "wonderfully clean", "incredibly clean",
  "spotless", "gleaming", "fresh", "tidy", "well-maintained", "well maintained",
  "cleaned thoroughly", "thoroughly cleaned", "deep clean", "great job cleaning",
  "excellent cleaning", "amazing cleaning", "outstanding cleaning",
];

// Maps keyword terms to the cleaning agreement section they reference.
// Used to build the ADDRESS block with specific contract callouts.
export const SUPPLY_ISSUE = {
  section: "1b",
  label: "Supplies",
  terms: [
    "toilet paper", "paper towels", "paper towel", "hand soap", "dish soap",
    "coffee", "creamer", "sugar", "dishwasher", "sponge",
    "shampoo", "conditioner", "body wash", "trash bag", "garbage bag",
    "hot tub", "bromine",
  ],
};

export const EXTERIOR_ISSUE = {
  section: "1c",
  label: "Exterior / Grounds",
  terms: [
    "outside", "outdoor", "exterior", "deck", "porch", "patio",
    "trash", "garbage", "cobweb", "cobwebs", "spider web",
    "dust fan", "dusty fan", "dirty fan", "blinds", "baseboard",
  ],
};

export const MAINTENANCE_ISSUE = {
  section: "3",
  label: "Unreported Issue",
  terms: [
    "broken", "not working", "wouldn't work", "didn't work", "doesn't work",
    "stuck", "missing", "damaged", "cracked", "leaking", "leak",
    "burned out", "burnt out", "flickering",
  ],
};

// All issue categories in order for ADDRESS block rendering
export const ISSUE_CATEGORIES = [SUPPLY_ISSUE, EXTERIOR_ISSUE, MAINTENANCE_ISSUE];

// Scan text for keyword hits, returning matched terms grouped by category.
// Returns: [{ section, label, matches: string[] }, ...]  — only categories with hits.
export function scanReviewText(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const results = [];
  for (const cat of ISSUE_CATEGORIES) {
    const matches = cat.terms.filter((term) => lower.includes(term));
    if (matches.length > 0) {
      results.push({ section: cat.section, label: cat.label, matches: [...new Set(matches)] });
    }
  }
  return results;
}

export function hasPositiveKeywords(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return CLEANLINESS_POSITIVE.some((term) => lower.includes(term));
}

// Physical issues a cleaner should notice and report (Agreement Section 3).
// Used for proactive reporting analysis — detects complaints in review text
// that indicate something was wrong that the cleaner should have caught and filed.
const PHYSICAL_COMPLAINT_TERMS = [
  "broken", "broke", "cracked", "damaged", "damage", "torn", "ripped",
  "not working", "doesn't work", "didn't work", "wasn't working", "wouldn't work",
  "leaking", "leak", "flooded", "flooding", "clogged", "stuck",
  "missing", "no towel", "no soap", "no coffee", "no toilet paper", "no paper towel",
  "ran out", "out of",
  "dirty", "not clean", "wasn't clean", "wasn't cleaned", "uncleaned", "filthy",
  "dusty", "stained", "stain", "stains",
  "smell", "smelled", "smells", "odor", "mold", "mildew",
  "bug", "bugs", "insect", "roach", "spider",
];

export function hasPhysicalComplaint(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PHYSICAL_COMPLAINT_TERMS.some((term) => lower.includes(term));
}
