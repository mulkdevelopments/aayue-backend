/**
 * Size normalization for multi-vendor fashion e-commerce.
 *
 * Returns { canonical, sizeType, detectedSystem }
 *   canonical     – the display-ready normalised value:
 *                   Clothing → alpha label (XS, S, M, L, XL …) or waist (W30)
 *                   Footwear → EU numeric  (35, 36, 37 … 47)
 *                   One Size → "One Size"
 *                   Accessory → belt cm (80, 85 …)
 *   sizeType      – "Clothing" | "Footwear" | "One Size" | "Accessory"
 *   detectedSystem – "alpha" | "eu" | "uk" | "us" | "waist" | "uni" | "belt"
 *
 * @param {string}  rawSize       – raw vendor size string
 * @param {string}  [categoryHint]  – "clothing" | "footwear" (from category path)
 * @param {string}  [genderHint]    – "men" | "women" (from product / category)
 */

const {
  ALPHA_CANONICAL,
  clothingAlphaFromEU,
  clothingAlphaFromUK,
  clothingAlphaFromUS,
  shoeEuFromUK,
  shoeEuFromUS,
  isPlausibleShoeEU,
  isBeltSize,
} = require("./sizeConversion");

const UNI_VALUES = new Set(
  ["one size", "onesize", "nosize", "uni", "unisex", "no size", "os", "osfm", "tu"].map((s) => s.toLowerCase())
);

function trimAndCollapse(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .replace(/[\u00BD\u00BC\u00BE]/g, (m) => ({ "\u00BD": ".5", "\u00BC": ".25", "\u00BE": ".75" }[m] || m))
    .replace(/½/g, ".5")
    .replace(/¾/g, ".75")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

const NONE = { canonical: null, sizeType: null, detectedSystem: null };

function normalizeSize(rawSize, categoryHint, genderHint) {
  if (!rawSize || typeof rawSize !== "string") return NONE;
  const s = trimAndCollapse(rawSize);
  if (!s) return NONE;

  const lower = s.toLowerCase().replace(/\s/g, "");
  const cat = (categoryHint || "clothing").toLowerCase();
  const gen = (genderHint || "").toLowerCase();
  const isShoe = cat === "footwear" || cat === "shoes";
  const isRing = cat === "ring";
  const isNoSizeAccessory = cat === "accessory_nosize";

  // ── One Size / NOSIZE / UNI ───────────────────────────────────
  if (UNI_VALUES.has(lower)) {
    return { canonical: "One Size", sizeType: "One Size", detectedSystem: "uni" };
  }

  // ── No-size accessories (watches, glasses, cufflinks, etc.) ───
  if (isNoSizeAccessory) {
    return { canonical: "UNI", sizeType: "One Size", detectedSystem: "uni" };
  }

  // ── Ring sizes: extract US number from compound EU|US formats ──
  if (isRing) {
    if (lower === "" || !s) return { canonical: "UNI", sizeType: "One Size", detectedSystem: "uni" };
    const usFromPipe = s.match(/US\s*(\d+)/i);
    if (usFromPipe) return { canonical: usFromPipe[1], sizeType: "Accessory", detectedSystem: "us" };
    const plainNum = s.match(/^(\d+)$/);
    if (plainNum) {
      const n = parseInt(plainNum[1]);
      if (n >= 3 && n <= 15) return { canonical: String(n), sizeType: "Accessory", detectedSystem: "us" };
    }
    const alphaKey2 = lower.replace(/\s/g, "");
    const alpha2 = ALPHA_CANONICAL[alphaKey2];
    if (alpha2) {
      const alphaToUS = { S: "6", M: "8", L: "10" };
      return { canonical: alphaToUS[alpha2] || s, sizeType: "Accessory", detectedSystem: "us" };
    }
    return { canonical: s, sizeType: "Accessory", detectedSystem: "us" };
  }

  // ── Explicit waist-inseam: "30W-32L", "31W 32L", "30W/32L" ──
  const wlMatch = s.match(/^(\d{2})W\s*[-\/]?\s*(\d{2})L$/i);
  if (wlMatch) {
    return { canonical: `W${wlMatch[1]}`, sizeType: "Clothing", detectedSystem: "waist" };
  }

  // ── Waist sizes: W30, W32, W30|L32 ───────────────────────────
  const waistFull = s.match(/^W\s*(\d+)\s*(?:[\|\/]?\s*L\s*(\d+))?$/i);
  if (waistFull) {
    return { canonical: `W${waistFull[1]}`, sizeType: "Clothing", detectedSystem: "waist" };
  }

  // ── Compound with parens waist: "52/36 (w38)", "54/38 (w40)" ─
  const parenWaist = s.match(/\(\s*w\s*(\d+)\s*\)/i);
  if (parenWaist) {
    return { canonical: `W${parenWaist[1]}`, sizeType: "Clothing", detectedSystem: "waist" };
  }

  // ── Suffix IT/FR/EU: "54 IT", "56 IT", "54 FR", "40 EU" ─────
  const numSuffixEU = s.match(/^(\d+(?:\.\d+)?)\s+(IT|FR|EU)$/i);
  if (numSuffixEU) {
    const euNum = numSuffixEU[1];
    if (isShoe) {
      const n = parseFloat(euNum);
      if (isPlausibleShoeEU(n)) return { canonical: String(n), sizeType: "Footwear", detectedSystem: "eu" };
    }
    const alpha = clothingAlphaFromEU(euNum, gen);
    if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: "eu" };
    const n = parseFloat(euNum);
    if (isPlausibleShoeEU(n)) return { canonical: String(n), sizeType: "Footwear", detectedSystem: "eu" };
    return { canonical: String(n), sizeType: "Clothing", detectedSystem: "eu" };
  }

  // ── Suffix US/UK: "6 US", "7.5 US", "8 UK", "3.5 UK" ────────
  const numSuffixSys = s.match(/^(\d+(?:\.\d+)?)\s+(US|UK)$/i);
  if (numSuffixSys) {
    const num = numSuffixSys[1];
    const sys = numSuffixSys[2].toUpperCase();
    if (isShoe) {
      const eu = sys === "UK" ? shoeEuFromUK(num, gen) : shoeEuFromUS(num, gen);
      if (eu) return { canonical: eu, sizeType: "Footwear", detectedSystem: sys.toLowerCase() };
      return { canonical: num, sizeType: "Footwear", detectedSystem: sys.toLowerCase() };
    }
    const alpha = sys === "UK" ? clothingAlphaFromUK(num, gen) : clothingAlphaFromUS(num, gen);
    if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: sys.toLowerCase() };
    const eu = sys === "UK" ? shoeEuFromUK(num, gen) : shoeEuFromUS(num, gen);
    if (eu) return { canonical: eu, sizeType: "Footwear", detectedSystem: sys.toLowerCase() };
    return { canonical: num, sizeType: "Clothing", detectedSystem: sys.toLowerCase() };
  }

  // ── Explicit UK prefix: "UK 8", "8UK", "3.5UK" ───────────────
  const ukMatch = s.match(/^UK\s*(\d+(?:\.\d+)?)\s*$/i) || s.match(/^(\d+(?:\.\d+)?)\s*UK$/i);
  if (ukMatch) {
    const ukNum = ukMatch[1];
    if (isShoe) {
      const eu = shoeEuFromUK(ukNum, gen) || ukNum;
      return { canonical: eu, sizeType: "Footwear", detectedSystem: "uk" };
    }
    const alpha = clothingAlphaFromUK(ukNum, gen);
    if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: "uk" };
    return { canonical: ukNum, sizeType: "Clothing", detectedSystem: "uk" };
  }

  // ── Explicit US prefix/suffix: "US 7", "US 10.5", "7US" ──────
  const usMatch = s.match(/^US\s*(\d+(?:\.\d+)?)\s*$/i) || s.match(/^(\d+(?:\.\d+)?)\s*US$/i);
  if (usMatch) {
    const usNum = usMatch[1];
    if (isShoe) {
      const eu = shoeEuFromUS(usNum, gen) || usNum;
      return { canonical: eu, sizeType: "Footwear", detectedSystem: "us" };
    }
    const alpha = clothingAlphaFromUS(usNum, gen);
    if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: "us" };
    return { canonical: usNum, sizeType: "Clothing", detectedSystem: "us" };
  }

  // ── M/W shoe format: M8/W9.5 ─────────────────────────────────
  if (/^M\d/i.test(s) && /\/\s*W\d/i.test(s)) {
    const mMatch = s.match(/M(\d+(?:\.\d+)?)/i);
    if (mMatch) {
      const usNum = mMatch[1];
      const eu = shoeEuFromUS(usNum, "men") || usNum;
      return { canonical: eu, sizeType: "Footwear", detectedSystem: "us" };
    }
  }

  // ── EU/IT/FR prefix: "EU36", "IT48|XL", "FR40", "EU 40" ──────
  const euItMatch = s.match(/^(?:EU|IT|FR)\s*(\d+(?:\.\d+)?)/i);
  if (euItMatch) {
    const euNum = euItMatch[1];
    const letterPart = s.match(/[\|\/]\s*([A-Za-z]+)\s*$/);
    if (letterPart) {
      const alphaKey = letterPart[1].trim().toLowerCase();
      const alpha = ALPHA_CANONICAL[alphaKey];
      if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: "eu" };
    }
    if (isShoe) {
      return { canonical: String(parseFloat(euNum)), sizeType: "Footwear", detectedSystem: "eu" };
    }
    const alpha = clothingAlphaFromEU(euNum, gen);
    if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: "eu" };
    const n = parseFloat(euNum);
    if (isPlausibleShoeEU(n)) {
      return { canonical: String(n), sizeType: "Footwear", detectedSystem: "eu" };
    }
    return { canonical: String(n), sizeType: "Clothing", detectedSystem: "eu" };
  }

  // ── Compound alpha: "S-M", "L/XL", "XS-S", "XXS/XS", "M-L" ──
  const compAlpha = s.match(/^([A-Z0-9]+)\s*[-\/]\s*([A-Z0-9]+)$/i);
  if (compAlpha) {
    const a1 = ALPHA_CANONICAL[compAlpha[1].toLowerCase()];
    const a2 = ALPHA_CANONICAL[compAlpha[2].toLowerCase()];
    if (a1 && a2) return { canonical: a2, sizeType: "Clothing", detectedSystem: "alpha" };
    if (a1) return { canonical: a1, sizeType: "Clothing", detectedSystem: "alpha" };
    if (a2) return { canonical: a2, sizeType: "Clothing", detectedSystem: "alpha" };
  }

  // ── Compound: "34 | XXS", "44 | M", "48 | XL" ────────────────
  const comboMatch = s.match(/^(\d+(?:\.\d+)?)\s*[\|\/]\s*([A-Za-z]+)\s*$/);
  if (comboMatch) {
    const alphaKey = comboMatch[2].toLowerCase();
    const alpha = ALPHA_CANONICAL[alphaKey];
    if (alpha) return { canonical: alpha, sizeType: "Clothing", detectedSystem: "eu" };
    return { canonical: alphaKey.toUpperCase(), sizeType: "Clothing", detectedSystem: "eu" };
  }

  // ── Jeans waist/inseam slash: "29/32", "30/34", "32/30" ──────
  const waistSlash = s.match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (waistSlash) {
    const w = parseInt(waistSlash[1]);
    if (w >= 24 && w <= 60) {
      return { canonical: `W${w}`, sizeType: "Clothing", detectedSystem: "waist" };
    }
  }

  // ── Pure alpha: S, M, L, XL, XXL, 2XL, XXXL, P ──────────────
  const alphaKey = lower.replace(/\s/g, "");
  const alpha = ALPHA_CANONICAL[alphaKey];
  if (alpha) {
    return { canonical: alpha, sizeType: "Clothing", detectedSystem: "alpha" };
  }
  if (alphaKey === "p" || alphaKey === "petit" || alphaKey === "petite") {
    return { canonical: "S", sizeType: "Clothing", detectedSystem: "alpha" };
  }
  const xlMatch = alphaKey.match(/^(x+)l(?:arge)?$/);
  if (xlMatch) {
    const n = xlMatch[1].length;
    const canon = n <= 1 ? "XL" : `${n}XL`;
    if (ALPHA_CANONICAL[canon.toLowerCase()] || n <= 10) {
      return { canonical: canon, sizeType: "Clothing", detectedSystem: "alpha" };
    }
  }
  const sMatch = alphaKey.match(/^(x+)s(?:mall)?$/);
  if (sMatch) {
    const n = sMatch[1].length;
    const canon = n <= 1 ? "XS" : n === 2 ? "XXS" : "XXS";
    return { canonical: canon, sizeType: "Clothing", detectedSystem: "alpha" };
  }

  // ── Plain numeric ─────────────────────────────────────────────
  const numOnlyMatch = s.match(/^(\d+(?:\.\d+)?)\s*$/);
  if (numOnlyMatch) {
    const n = parseFloat(numOnlyMatch[1]);

    if (isShoe) {
      if (isPlausibleShoeEU(n)) {
        return { canonical: String(n), sizeType: "Footwear", detectedSystem: "eu" };
      }
      const euFromUK = shoeEuFromUK(String(n), gen);
      if (euFromUK) return { canonical: euFromUK, sizeType: "Footwear", detectedSystem: "uk" };
      const euFromUS = shoeEuFromUS(String(n), gen);
      if (euFromUS) return { canonical: euFromUS, sizeType: "Footwear", detectedSystem: "us" };
      return { canonical: String(n), sizeType: "Footwear", detectedSystem: "eu" };
    }

    // Clothing context: try EU → alpha first
    const alphaFromEU = clothingAlphaFromEU(String(n), gen);
    if (alphaFromEU) {
      return { canonical: alphaFromEU, sizeType: "Clothing", detectedSystem: "eu" };
    }

    // Try US → alpha (handles women's 0, 2, 4, 6, 8, 10…)
    const alphaFromUS = clothingAlphaFromUS(String(n), gen);
    if (alphaFromUS) {
      return { canonical: alphaFromUS, sizeType: "Clothing", detectedSystem: "us" };
    }

    // Belt size: 65-150, divisible by 5
    if (isBeltSize(n)) {
      return { canonical: String(n), sizeType: "Accessory", detectedSystem: "belt" };
    }

    // Plausible waist size (24-60, integer, not matched by EU/US charts)
    if (Number.isInteger(n) && n >= 24 && n <= 60) {
      return { canonical: `W${n}`, sizeType: "Clothing", detectedSystem: "waist" };
    }

    // Half-sizes or shoe-range numbers → probably footwear miscategorized
    if (isPlausibleShoeEU(n)) {
      return { canonical: String(n), sizeType: "Footwear", detectedSystem: "eu" };
    }

    return { canonical: String(n), sizeType: "Clothing", detectedSystem: "eu" };
  }

  // ── cm/inches: "90 cm", "36 Inches", "80cm" ──────────────────
  const cmMatch = s.match(/^(\d+)\s*cm/i);
  if (cmMatch) {
    const n = parseInt(cmMatch[1]);
    if (isBeltSize(n)) {
      return { canonical: String(n), sizeType: "Accessory", detectedSystem: "belt" };
    }
    return { canonical: String(n), sizeType: "Clothing", detectedSystem: "eu" };
  }

  // ── Hat fractions: "7 1/2", "7 1/4", "6 7/8" ────────────────
  const hatFrac = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (hatFrac) {
    const whole = parseInt(hatFrac[1]);
    if (whole >= 6 && whole <= 8) {
      return { canonical: s, sizeType: "Accessory", detectedSystem: "us" };
    }
  }

  // ── Collar sizes: "15.5", "15 1/2", "16.5" in inches ─────────
  // (Already handled by plain numeric for pure decimal numbers)

  // ── Fallback: cleaned string, assume clothing ─────────────────
  const cleaned = s.replace(/\s+/g, " ").trim();
  return { canonical: cleaned, sizeType: isShoe ? "Footwear" : "Clothing", detectedSystem: "eu" };
}

module.exports = { normalizeSize };
