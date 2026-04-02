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
      const ratesResult = await client.query(`
        SELECT from_currency, to_currency, rate, updated_at
        FROM currency_exchange_rates
        WHERE from_currency = 'EUR'
        ORDER BY to_currency
      `);

      let duties = {};
      try {
        const dutiesResult = await client.query(
          `SELECT currency_code, duty_percent FROM custom_duties ORDER BY currency_code`
        );
        dutiesResult.rows.forEach(row => {
          duties[row.currency_code] = parseFloat(row.duty_percent) || 0;
        });
      } catch (dutyErr) {
        // custom_duties table may not exist before migration
      }

      const rates = { EUR: 1 };
      ratesResult.rows.forEach(row => {
        rates[row.to_currency] = parseFloat(row.rate);
      });

      res.status(200).json({
        success: true,
        data: {
          base: 'EUR',
          rates,
          duties,
          updated_at: ratesResult.rows[0]?.updated_at || null
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
