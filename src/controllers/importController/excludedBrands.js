/**
 * Brands excluded from all vendor syncs (product import). Case-insensitive match by normalized name.
 */
const { normalizeBrandName } = require("../../utils/normalize");

const EXCLUDED_BRANDS_RAW = ["dolls", "aesop", "floyd"];
const EXCLUDED_NORMALIZED = new Set(
  EXCLUDED_BRANDS_RAW.map((b) => (normalizeBrandName(b) || "").trim()).filter(Boolean)
);

/**
 * Returns true if the given brand name should be excluded from sync (skip product).
 * @param {string} [brandName] - Brand name from product (e.g. "AESOP", "FLOYD")
 * @returns {boolean}
 */
function isBrandExcluded(brandName) {
  if (brandName == null || typeof brandName !== "string") return false;
  const normalized = normalizeBrandName(brandName);
  return normalized ? EXCLUDED_NORMALIZED.has(normalized) : false;
}

module.exports = {
  EXCLUDED_BRANDS_RAW,
  isBrandExcluded,
};
