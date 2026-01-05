const dbPool = require('../../db/dbConnection');
const AppError = require('../../errorHandling/AppError');

/**
 * @route   GET /api/v1/currency/rates
 * @desc    Get all EUR exchange rates
 * @access  Public
 */
exports.getExchangeRates = async (req, res, next) => {
  try {
    const client = await dbPool.connect();

    try {
      const result = await client.query(`
        SELECT
          from_currency,
          to_currency,
          rate,
          updated_at
        FROM currency_exchange_rates
        WHERE from_currency = 'EUR'
        ORDER BY to_currency
      `); 

      // Format response as { EUR: 1, AED: rate, INR: rate, PKR: rate }
      const rates = { EUR: 1 }; // EUR to EUR is always 1
      result.rows.forEach(row => {
        rates[row.to_currency] = parseFloat(row.rate);
      });

      res.status(200).json({
        success: true,
        data: {
          base: 'EUR',
          rates,
          updated_at: result.rows[0]?.updated_at || null
        }
      });

    } finally {
      client.release();
    }
 
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    return next(new AppError('Failed to fetch exchange rates', 500));
  }
};
