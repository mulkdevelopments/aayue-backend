/**
 * Kids product filter for sync. Products whose gender indicates kids (kids, kid, boy, boys, girl, girls, children, child)
 * are skipped during sync and never imported.
 */

const KIDS_GENDER_VALUES = new Set([
  "kids",
  "kid",
  "boys",
  "boy",
  "girls",
  "girl",
  "children",
  "child",
]);

/**
 * Normalize gender string for comparison (lowercase, trim).
 * @param {*} value
 * @returns {string|null}
 */
function normalizeGender(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  return s || null;
}

/**
 * Returns true if the product should be blocked from sync because it is a kids product
 * (gender is kids, kid, boy, boys, girl, girls, children, or child).
 * Checks product.gender and product.attributes?.gender.
 * @param {object} product - Product object with optional gender and attributes
 * @returns {boolean}
 */
function isKidsProduct(product) {
  if (!product || typeof product !== "object") return false;

  const genderFromProduct = normalizeGender(product.gender);
  if (genderFromProduct && KIDS_GENDER_VALUES.has(genderFromProduct)) return true;

  const attrs = product.attributes;
  if (attrs && typeof attrs === "object") {
    const genderFromAttrs = normalizeGender(attrs.gender);
    if (genderFromAttrs && KIDS_GENDER_VALUES.has(genderFromAttrs)) return true;
  }

  return false;
}

module.exports = {
  isKidsProduct,
  KIDS_GENDER_VALUES,
};
