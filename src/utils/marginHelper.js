/**
 * Tiered margin for vendor sync. Config loaded from margin_settings (admin-editable).
 * Defaults: >1000 → 28%, 501–1000 → 37%, else 45%.
 */

const DEFAULT_CONFIG = {
  highThreshold: 1000,
  midThreshold: 501,
  marginHigh: 28,
  marginMid: 37,
  marginLow: 45,
};

/**
 * Load margin config from DB for a vendor. Uses vendor-specific row if present, else default (vendor_id IS NULL).
 * @param {object} client - pg client
 * @param {string|null} vendorId - vendor uuid; null = use default only
 * @returns {Promise<{ highThreshold, midThreshold, marginHigh, marginMid, marginLow }>}
 */
async function getMarginSettings(client, vendorId) {
  if (!client) return DEFAULT_CONFIG;
  try {
    let rows = [];
    if (vendorId) {
      const res = await client.query(
        `SELECT high_threshold, mid_threshold, margin_high_percent, margin_mid_percent, margin_low_percent
         FROM margin_settings WHERE vendor_id = $1 LIMIT 1`,
        [vendorId]
      );
      rows = res.rows;
    }
    if (!rows.length) {
      const res = await client.query(
        `SELECT high_threshold, mid_threshold, margin_high_percent, margin_mid_percent, margin_low_percent
         FROM margin_settings WHERE vendor_id IS NULL LIMIT 1`
      );
      rows = res.rows;
    }
    if (!rows.length) return DEFAULT_CONFIG;
    const r = rows[0];
    return {
      highThreshold: Number(r.high_threshold) || DEFAULT_CONFIG.highThreshold,
      midThreshold: Number(r.mid_threshold) || DEFAULT_CONFIG.midThreshold,
      marginHigh: Number(r.margin_high_percent) || DEFAULT_CONFIG.marginHigh,
      marginMid: Number(r.margin_mid_percent) || DEFAULT_CONFIG.marginMid,
      marginLow: Number(r.margin_low_percent) || DEFAULT_CONFIG.marginLow,
    };
  } catch (err) {
    console.warn("marginHelper.getMarginSettings failed, using defaults:", err?.message);
    return DEFAULT_CONFIG;
  }
}

/**
 * Compute our price and MRP from vendor sale price and vendor MRP using tiered margin.
 * @param {number|null} vendorSalePrice
 * @param {number|null} vendorMrp
 * @param {object|null} config - from getMarginSettings(); if null uses DEFAULT_CONFIG
 * @returns {{ ourPrice: number|null, ourMrp: number|null }}
 */
function computeTieredPricing(vendorSalePrice, vendorMrp, config) {
  const salePrice = vendorSalePrice != null ? Number(vendorSalePrice) : null;
  const mrpPrice = vendorMrp != null ? Number(vendorMrp) : null;
  if (!salePrice || Number.isNaN(salePrice) || salePrice <= 0) {
    return { ourPrice: null, ourMrp: null };
  }
  const c = config || DEFAULT_CONFIG;
  let pct;
  if (salePrice > c.highThreshold) {
    pct = c.marginHigh / 100;
  } else if (salePrice >= c.midThreshold) {
    pct = c.marginMid / 100;
  } else {
    pct = c.marginLow / 100;
  }
  const ourPrice = Math.round(salePrice * (1 + pct));
  let ourMrp = ourPrice;
  if (mrpPrice && Number(mrpPrice) > salePrice) {
    const vendorDiscount = (Number(mrpPrice) - salePrice) / Number(mrpPrice);
    ourMrp = Math.round(ourPrice / (1 - vendorDiscount));
  }
  return { ourPrice, ourMrp };
}

module.exports = {
  getMarginSettings,
  computeTieredPricing,
  DEFAULT_CONFIG,
};
