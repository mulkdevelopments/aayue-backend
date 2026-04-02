/**
 * Get custom duty percent for a currency (for order emails, invoice, etc.)
 * @param {object} client - pg client
 * @param {string} currencyCode - e.g. "INR", "AED"
 * @returns {Promise<number>} duty percent (0 if not set or table missing)
 */
async function getCustomDutyForCurrency(client, currencyCode) {
  if (!currencyCode || !client) return 0;
  try {
    const { rows } = await client.query(
      `SELECT duty_percent FROM custom_duties WHERE currency_code = $1 LIMIT 1`,
      [String(currencyCode).toUpperCase()]
    );
    const pct = rows[0]?.duty_percent;
    return pct != null ? Number(pct) : 0;
  } catch {
    return 0;
  }
}

/**
 * Apply exchange rate and duty to an EUR amount for display.
 * @param {number} eurAmount
 * @param {number} exchangeRate
 * @param {number} dutyPercent
 * @returns {number}
 */
function toDisplayAmount(eurAmount, exchangeRate, dutyPercent = 0) {
  const rate = Number(exchangeRate) || 1;
  const duty = Number(dutyPercent) || 0;
  let amount = (eurAmount || 0) * rate;
  if (duty > 0) amount = amount * (1 + duty / 100);
  return Math.round(amount * 100) / 100;
}

module.exports = { getCustomDutyForCurrency, toDisplayAmount };
