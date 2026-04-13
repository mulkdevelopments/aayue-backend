/**
 * Size conversion charts for fashion e-commerce.
 *
 * Canonical representations:
 *   Clothing  → alpha label  (XS, S, M, L, XL …)
 *   Footwear  → EU numeric   (35, 36, 37 … 47)
 *   One Size  → "One Size"
 */

/* ───────────────────────────────────────────────────────────────
   Clothing — alpha ↔ EU ↔ UK ↔ US  (per gender)
   ─────────────────────────────────────────────────────────────── */

const WOMEN_CLOTHING = [
  { sort: 1,  alpha: "XXS",  eu: "32", uk: "4",  us: "0"  },
  { sort: 2,  alpha: "XS",   eu: "34", uk: "6",  us: "2"  },
  { sort: 3,  alpha: "S",    eu: "36", uk: "8",  us: "4"  },
  { sort: 4,  alpha: "M",    eu: "38", uk: "10", us: "6"  },
  { sort: 5,  alpha: "L",    eu: "40", uk: "12", us: "8"  },
  { sort: 6,  alpha: "XL",   eu: "42", uk: "14", us: "10" },
  { sort: 7,  alpha: "2XL",  eu: "44", uk: "16", us: "12" },
  { sort: 8,  alpha: "3XL",  eu: "46", uk: "18", us: "14" },
  { sort: 9,  alpha: "4XL",  eu: "48", uk: "20", us: "16" },
  { sort: 10, alpha: "5XL",  eu: "50", uk: "22", us: "18" },
  { sort: 11, alpha: "6XL",  eu: "52", uk: "24", us: "20" },
];

const MEN_CLOTHING = [
  { sort: 1,  alpha: "XXS",  eu: "40", uk: "32", us: "32" },
  { sort: 2,  alpha: "XS",   eu: "42", uk: "34", us: "34" },
  { sort: 3,  alpha: "S",    eu: "44", uk: "36", us: "36" },
  { sort: 4,  alpha: "M",    eu: "46", uk: "38", us: "38" },
  { sort: 5,  alpha: "L",    eu: "48", uk: "40", us: "40" },
  { sort: 6,  alpha: "XL",   eu: "50", uk: "42", us: "42" },
  { sort: 7,  alpha: "2XL",  eu: "52", uk: "44", us: "44" },
  { sort: 8,  alpha: "3XL",  eu: "54", uk: "46", us: "46" },
  { sort: 9,  alpha: "4XL",  eu: "56", uk: "48", us: "48" },
  { sort: 10, alpha: "5XL",  eu: "58", uk: "50", us: "50" },
  { sort: 11, alpha: "6XL",  eu: "60", uk: "52", us: "52" },
  { sort: 12, alpha: "7XL",  eu: "62", uk: "54", us: "54" },
  { sort: 13, alpha: "8XL",  eu: "64", uk: "56", us: "56" },
  { sort: 14, alpha: "9XL",  eu: "66", uk: "58", us: "58" },
  { sort: 15, alpha: "10XL", eu: "68", uk: "60", us: "60" },
];

/* ───────────────────────────────────────────────────────────────
   Shoes — EU (canonical) ↔ UK ↔ US  (per gender)
   ─────────────────────────────────────────────────────────────── */

const WOMEN_SHOES = [
  { sort: 1,  eu: "34",   uk: "1",    us: "4"    },
  { sort: 2,  eu: "34.5", uk: "1.5",  us: "4.5"  },
  { sort: 3,  eu: "35",   uk: "2",    us: "5"    },
  { sort: 4,  eu: "35.5", uk: "2.5",  us: "5.5"  },
  { sort: 5,  eu: "36",   uk: "3",    us: "6"    },
  { sort: 6,  eu: "36.5", uk: "3.5",  us: "6.5"  },
  { sort: 7,  eu: "37",   uk: "4",    us: "7"    },
  { sort: 8,  eu: "37.5", uk: "4.5",  us: "7.5"  },
  { sort: 9,  eu: "38",   uk: "5",    us: "8"    },
  { sort: 10, eu: "38.5", uk: "5.5",  us: "8.5"  },
  { sort: 11, eu: "39",   uk: "6",    us: "9"    },
  { sort: 12, eu: "39.5", uk: "6.5",  us: "9.5"  },
  { sort: 13, eu: "40",   uk: "7",    us: "10"   },
  { sort: 14, eu: "40.5", uk: "7.5",  us: "10.5" },
  { sort: 15, eu: "41",   uk: "8",    us: "11"   },
  { sort: 16, eu: "42",   uk: "9",    us: "12"   },
];

const MEN_SHOES = [
  { sort: 1,  eu: "38",   uk: "4",    us: "5"    },
  { sort: 2,  eu: "38.5", uk: "4.5",  us: "5.5"  },
  { sort: 3,  eu: "39",   uk: "5",    us: "6"    },
  { sort: 4,  eu: "39.5", uk: "5.5",  us: "6.5"  },
  { sort: 5,  eu: "40",   uk: "6",    us: "7"    },
  { sort: 6,  eu: "40.5", uk: "6.5",  us: "7.5"  },
  { sort: 7,  eu: "41",   uk: "7",    us: "8"    },
  { sort: 8,  eu: "41.5", uk: "7.5",  us: "8.5"  },
  { sort: 9,  eu: "42",   uk: "8",    us: "9"    },
  { sort: 10, eu: "42.5", uk: "8.5",  us: "9.5"  },
  { sort: 11, eu: "43",   uk: "9",    us: "10"   },
  { sort: 12, eu: "43.5", uk: "9.5",  us: "10.5" },
  { sort: 13, eu: "44",   uk: "10",   us: "11"   },
  { sort: 14, eu: "44.5", uk: "10.5", us: "11.5" },
  { sort: 15, eu: "45",   uk: "11",   us: "12"   },
  { sort: 16, eu: "45.5", uk: "11.5", us: "12.5" },
  { sort: 17, eu: "46",   uk: "12",   us: "13"   },
  { sort: 18, eu: "47",   uk: "13",   us: "14"   },
];

/* ───────────────────────────────────────────────────────────────
   Pre-built reverse-lookup maps  (built once at module load)
   ─────────────────────────────────────────────────────────────── */

function buildClothingMaps(chart) {
  const euToAlpha = new Map();
  const ukToAlpha = new Map();
  const usToAlpha = new Map();
  for (const row of chart) {
    euToAlpha.set(row.eu, row.alpha);
    ukToAlpha.set(row.uk, row.alpha);
    usToAlpha.set(row.us, row.alpha);
  }
  return { euToAlpha, ukToAlpha, usToAlpha };
}

function buildShoeMaps(chart) {
  const ukToEu = new Map();
  const usToEu = new Map();
  for (const row of chart) {
    ukToEu.set(row.uk, row.eu);
    usToEu.set(row.us, row.eu);
  }
  return { ukToEu, usToEu };
}

const WOMEN_CLOTHING_MAPS = buildClothingMaps(WOMEN_CLOTHING);
const MEN_CLOTHING_MAPS   = buildClothingMaps(MEN_CLOTHING);
const WOMEN_SHOE_MAPS     = buildShoeMaps(WOMEN_SHOES);
const MEN_SHOE_MAPS       = buildShoeMaps(MEN_SHOES);

/* ───────────────────────────────────────────────────────────────
   Canonical alpha letters (normalised lowercase key → display)
   ─────────────────────────────────────────────────────────────── */

const ALPHA_CANONICAL = {
  xxxs: "XXS", "3xs": "XXS",
  xxs: "XXS",
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
  xxl: "2XL", "2xl": "2XL",
  xxxl: "3XL", "3xl": "3XL",
  "4xl": "4XL",
  "5xl": "5XL",
  "6xl": "6XL",
  "7xl": "7XL",
  "8xl": "8XL",
  "9xl": "9XL",
  "10xl": "10XL",
};

const ALPHA_SORT_ORDER = [
  "XXS", "XS", "S", "M", "L", "XL",
  "2XL", "3XL", "4XL", "5XL", "6XL",
  "7XL", "8XL", "9XL", "10XL",
];

/* ───────────────────────────────────────────────────────────────
   Category-hint detection from category path
   ─────────────────────────────────────────────────────────────── */

const FOOTWEAR_KEYWORDS = [
  "shoe", "shoes", "sneaker", "sneakers", "boot", "boots",
  "sandal", "sandals", "slipper", "slippers", "loafer", "loafers",
  "mule", "mules", "pump", "pumps", "heel", "heels", "clog", "clogs",
  "espadrille", "espadrilles", "flat shoes", "flat-shoes",
  "derby", "oxford", "trainer", "trainers",
];

function categoryHintFromPath(categoryPath) {
  if (!categoryPath) return "clothing";
  const lc = String(categoryPath).toLowerCase();
  if (FOOTWEAR_KEYWORDS.some((kw) => lc.includes(kw))) return "footwear";
  return "clothing";
}

function genderHintFromPath(categoryPath) {
  if (!categoryPath) return null;
  const lc = String(categoryPath).toLowerCase();
  if (/\bwomen\b|\bwoman\b|\bfemale\b/.test(lc)) return "women";
  if (/\bmen\b|\bman\b|\bmale\b/.test(lc)) return "men";
  return null;
}

/* ───────────────────────────────────────────────────────────────
   Public helpers
   ─────────────────────────────────────────────────────────────── */

/**
 * Find the alpha canonical for a EU clothing size.
 * Tries women's chart first (covers EU 32-52), then men's (EU 40-60).
 * For the overlapping EU 40-52 range, genderHint breaks the tie.
 */
function clothingAlphaFromEU(euStr, genderHint) {
  const eu = String(euStr).trim();
  const g = (genderHint || "").toLowerCase();
  if (g === "men" || g === "male") {
    return MEN_CLOTHING_MAPS.euToAlpha.get(eu) || WOMEN_CLOTHING_MAPS.euToAlpha.get(eu) || null;
  }
  return WOMEN_CLOTHING_MAPS.euToAlpha.get(eu) || MEN_CLOTHING_MAPS.euToAlpha.get(eu) || null;
}

function clothingAlphaFromUK(ukStr, genderHint) {
  const uk = String(ukStr).trim();
  const g = (genderHint || "").toLowerCase();
  if (g === "men" || g === "male") {
    return MEN_CLOTHING_MAPS.ukToAlpha.get(uk) || WOMEN_CLOTHING_MAPS.ukToAlpha.get(uk) || null;
  }
  return WOMEN_CLOTHING_MAPS.ukToAlpha.get(uk) || MEN_CLOTHING_MAPS.ukToAlpha.get(uk) || null;
}

function clothingAlphaFromUS(usStr, genderHint) {
  const us = String(usStr).trim();
  const g = (genderHint || "").toLowerCase();
  if (g === "men" || g === "male") {
    return MEN_CLOTHING_MAPS.usToAlpha.get(us) || WOMEN_CLOTHING_MAPS.usToAlpha.get(us) || null;
  }
  return WOMEN_CLOTHING_MAPS.usToAlpha.get(us) || MEN_CLOTHING_MAPS.usToAlpha.get(us) || null;
}

/**
 * Find the EU canonical for a UK/US shoe size.
 */
function shoeEuFromUK(ukStr, genderHint) {
  const uk = String(ukStr).trim();
  const g = (genderHint || "").toLowerCase();
  if (g === "women" || g === "female") {
    return WOMEN_SHOE_MAPS.ukToEu.get(uk) || MEN_SHOE_MAPS.ukToEu.get(uk) || null;
  }
  return MEN_SHOE_MAPS.ukToEu.get(uk) || WOMEN_SHOE_MAPS.ukToEu.get(uk) || null;
}

function shoeEuFromUS(usStr, genderHint) {
  const us = String(usStr).trim();
  const g = (genderHint || "").toLowerCase();
  if (g === "women" || g === "female") {
    return WOMEN_SHOE_MAPS.usToEu.get(us) || MEN_SHOE_MAPS.usToEu.get(us) || null;
  }
  return MEN_SHOE_MAPS.usToEu.get(us) || WOMEN_SHOE_MAPS.usToEu.get(us) || null;
}

/**
 * Check if a numeric value plausibly sits in the EU shoe range (34-50).
 */
function isPlausibleShoeEU(num) {
  return num >= 34 && num <= 50;
}

/**
 * Check if a numeric value is a belt/accessory size (65-140cm, step 5).
 */
function isBeltSize(num) {
  return Number.isInteger(num) && num >= 65 && num <= 150 && num % 5 === 0;
}

/**
 * Build the full conversion display for a shoe EU size (for frontend).
 */
function shoeConversionForEU(euStr, genderHint) {
  const eu = String(euStr).trim();
  const g = (genderHint || "").toLowerCase();
  const chart = g === "women" || g === "female" ? WOMEN_SHOES : MEN_SHOES;
  const row = chart.find((r) => r.eu === eu);
  if (row) return { eu: row.eu, uk: row.uk, us: row.us };
  const alt = g === "women" || g === "female" ? MEN_SHOES : WOMEN_SHOES;
  const altRow = alt.find((r) => r.eu === eu);
  if (altRow) return { eu: altRow.eu, uk: altRow.uk, us: altRow.us };
  return { eu, uk: null, us: null };
}

/**
 * Build the full conversion display for a clothing alpha size (for frontend).
 */
function clothingConversionForAlpha(alpha, genderHint) {
  const g = (genderHint || "").toLowerCase();
  const chart = g === "men" || g === "male" ? MEN_CLOTHING : WOMEN_CLOTHING;
  const row = chart.find((r) => r.alpha === alpha);
  if (row) return { alpha: row.alpha, eu: row.eu, uk: row.uk, us: row.us };
  const alt = g === "men" || g === "male" ? WOMEN_CLOTHING : MEN_CLOTHING;
  const altRow = alt.find((r) => r.alpha === alpha);
  if (altRow) return { alpha: altRow.alpha, eu: altRow.eu, uk: altRow.uk, us: altRow.us };
  return { alpha, eu: null, uk: null, us: null };
}

module.exports = {
  WOMEN_CLOTHING,
  MEN_CLOTHING,
  WOMEN_SHOES,
  MEN_SHOES,
  ALPHA_CANONICAL,
  ALPHA_SORT_ORDER,
  categoryHintFromPath,
  genderHintFromPath,
  clothingAlphaFromEU,
  clothingAlphaFromUK,
  clothingAlphaFromUS,
  shoeEuFromUK,
  shoeEuFromUS,
  isPlausibleShoeEU,
  isBeltSize,
  shoeConversionForEU,
  clothingConversionForAlpha,
};
