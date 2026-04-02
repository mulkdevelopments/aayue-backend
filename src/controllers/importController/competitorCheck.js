/**
 * Competitor blacklist check for sync. If product name/description contains a blacklisted name,
 * product is marked suspicious + deleted + inactive and sync skips (does not restore until recovered).
 */

const ProductService = require("../../services/productService");

/** Strip HTML tags for plain-text matching */
function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Load competitor names from competitor_blacklist (lowercase for case-insensitive match).
 * @param {object} client - DB client
 * @returns {Promise<string[]>}
 */
async function getCompetitorNames(client) {
  const { rows } = await client.query(
    "SELECT LOWER(TRIM(name)) AS name FROM competitor_blacklist WHERE TRIM(name) <> ''"
  );
  return rows.map((r) => r.name).filter(Boolean);
}

/**
 * Check if text contains any of the competitor names (case-insensitive, whole-word preferred).
 * @param {string} text - Plain text or HTML (will be stripped)
 * @param {string[]} competitorNames - Lowercase names
 * @returns {string|null} - First matched competitor name or null
 */
function checkTextForCompetitors(text, competitorNames) {
  if (!competitorNames.length) return null;
  const plain = stripHtml(String(text || "")).toLowerCase();
  if (!plain) return null;
  for (const name of competitorNames) {
    if (!name) continue;
    // Whole-word or at boundary (allow "CompetitorName" or "competitorname" in text)
    const re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (re.test(plain)) return name;
    // Also simple includes for multi-word names
    if (plain.includes(name)) return name;
  }
  return null;
}

/**
 * If product (name, title, description) contains a blacklisted competitor:
 * - existing product -> mark suspicious + delete + inactive, return { skipped: "suspicious", reason }.
 * - no existing product -> return { skipped: "suspicious", reason } (do not insert).
 * @param {object} client
 * @param {object} product - { name, title, description }
 * @param {string|null} existingProductId - If we have an existing product to flag
 * @returns {Promise<{ skipped: string, reason?: string }|null>}
 */
async function checkAndMarkSuspiciousIfNeeded(client, product, existingProductId) {
  const names = await getCompetitorNames(client);
  if (!names.length) return null;

  const combined =
    [product.name, product.title, product.description].filter(Boolean).join(" ") || "";
  const matched = checkTextForCompetitors(combined, names);
  if (!matched) return null;

  if (existingProductId) {
    await ProductService.markProductSuspicious(
      existingProductId,
      "competitor_in_content: " + matched,
      client
    );
  }
  return { skipped: "suspicious", reason: matched };
}

module.exports = {
  getCompetitorNames,
  checkTextForCompetitors,
  checkAndMarkSuspiciousIfNeeded,
};
