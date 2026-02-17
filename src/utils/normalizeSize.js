/**
 * Size normalization: returns { normalized_size, size_country } for filtering and display.
 * size_country: EU | UK | US | UNI (letter sizes, One Size, NOSIZE)
 * normalized_size: clean value within that system
 */
const UNI_VALUES = new Set(
  ["one size", "nosize", "uni", "unisex", "no size", "os", "one size", "osfm"].map((s) => s.toLowerCase())
);

const LETTER_TO_CANONICAL = {
  xxs: "XXS",
  xxxs: "XXS",
  "3xs": "XXS",
  xs: "XS",
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
  xxl: "2XL",
  "2xl": "2XL",
  xxxl: "3XL",
  "3xl": "3XL",
  "4xl": "4XL",
  "5xl": "5XL",
  "6xl": "6XL",
};

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

/**
 * @param {string} rawSize - Raw variant_size from vendor
 * @returns {{ normalized_size: string | null, size_country: string | null }}
 */
function normalizeSize(rawSize) {
  if (!rawSize || typeof rawSize !== "string") {
    return { normalized_size: null, size_country: null };
  }
  const s = trimAndCollapse(rawSize);
  if (!s) return { normalized_size: null, size_country: null };

  const lower = s.toLowerCase();

  // One Size / NOSIZE / UNI
  if (UNI_VALUES.has(lower.replace(/\s/g, "")) || UNI_VALUES.has(lower)) {
    return { normalized_size: "One Size", size_country: "UNI" };
  }

  // UK sizes: UK 10, UK 6.5
  const ukMatch = s.match(/^UK\s*(\d+(?:\.\d+)?)\s*$/i) || s.match(/^UK\s*(\d+(?:\.\d+)?)/i);
  if (ukMatch) {
    const num = ukMatch[1];
    return { normalized_size: num, size_country: "UK" };
  }

  // US sizes: US 7, US 10.5
  const usMatch = s.match(/^US\s*(\d+(?:\.\d+)?)/i);
  if (usMatch) {
    return { normalized_size: usMatch[1], size_country: "US" };
  }

  // Waist/Inseam: W30 | L32, W30|L32
  if (/^W\d+/i.test(s) && /L\d+/i.test(s)) {
    const cleaned = s.replace(/\s*\|\s*/g, " | ").replace(/\s+/g, " ");
    return { normalized_size: cleaned, size_country: "US" };
  }
  if (/^W\d+/i.test(s)) {
    const wMatch = s.match(/^W\s*(\d+)/i);
    return { normalized_size: wMatch ? `W${wMatch[1]}` : s, size_country: "US" };
  }

  // M/W shoe: M8/W9.5, M8.5/W10
  if (/^M\d/i.test(s) && /\/\s*W\d/i.test(s)) {
    return { normalized_size: s.replace(/\s+/g, ""), size_country: "US" };
  }

  // EU/IT: EU36/US6, IT40|S, EU 40, plain 40, IT 48 | M
  const euItMatch =
    s.match(/^(?:EU|IT)\s*(\d+(?:\.\d+)?)/i) ||
    s.match(/^(?:EU|IT)(\d+(?:\.\d+)?)/i) ||
    s.match(/(?:EU|IT)\s*(\d+(?:\.\d+)?)\s*[\|\/]/i) ||
    s.match(/^(\d+(?:\.\d+)?)\s*[\|\/]/);
  if (euItMatch) {
    const num = euItMatch[1];
    const letterPart = s.match(/[\|\/]\s*([A-Za-z\d\s]+)$/);
    if (letterPart && /^[A-Za-z]+$/.test(letterPart[1].trim())) {
      const letter = LETTER_TO_CANONICAL[letterPart[1].trim().toLowerCase()] || letterPart[1].trim();
      return { normalized_size: letter, size_country: "EU" };
    }
    return { normalized_size: num, size_country: "EU" };
  }

  // EU36/US6, EU40/US10 - extract EU number
  const euUsMatch = s.match(/^EU\s*(\d+(?:\.\d+)?)\s*\/\s*US/i) || s.match(/^EU(\d+(?:\.\d+)?)\/US/i);
  if (euUsMatch) {
    return { normalized_size: euUsMatch[1], size_country: "EU" };
  }

  // Plain EU 40 or EU40
  const euOnlyMatch = s.match(/^EU\s*(\d+(?:\.\d+)?)\s*$/i) || s.match(/^EU\s*(\d+(?:\.\d+)?)/i);
  if (euOnlyMatch) {
    return { normalized_size: euOnlyMatch[1], size_country: "EU" };
  }

  // Numeric EU (34-70 range typical for clothing/shoes)
  const numOnlyMatch = s.match(/^(\d+(?:\.\d+)?)\s*$/);
  if (numOnlyMatch) {
    const n = parseFloat(numOnlyMatch[1]);
    if (n >= 24 && n <= 70) return { normalized_size: String(n), size_country: "EU" };
    if (n >= 0 && n <= 20) return { normalized_size: String(n), size_country: "UK" };
    return { normalized_size: String(n), size_country: "EU" };
  }

  // Letter sizes: S, M, L, XL, XXL, 2XL, XXXL
  const letterOnly = s.replace(/\s/g, "");
  const canon = LETTER_TO_CANONICAL[letterOnly.toLowerCase()];
  if (canon) {
    return { normalized_size: canon, size_country: "UNI" };
  }

  // Combined: 34 | XXS, 44 | M, IT52 | XL → use letter only to avoid confusion
  const comboMatch = s.match(/^(\d+(?:\.\d+)?)\s*\|\s*([A-Za-z]+)\s*$/);
  if (comboMatch) {
    const letter = LETTER_TO_CANONICAL[comboMatch[2].toLowerCase()] || comboMatch[2];
    return { normalized_size: letter, size_country: "EU" };
  }

  // cm/inches: 90 cm / 36 Inches -> 90
  const cmMatch = s.match(/^(\d+)\s*cm/i);
  if (cmMatch) {
    return { normalized_size: cmMatch[1], size_country: "EU" };
  }

  // Range or complex: keep cleaned, default EU
  return { normalized_size: s, size_country: "EU" };
}

module.exports = {
  normalizeSize,
};
