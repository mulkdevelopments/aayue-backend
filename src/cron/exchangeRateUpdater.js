const cron = require('node-cron');
const axios = require('axios');
const dbPool = require('../db/dbConnection');

/**
 * Cron Job: Update currency exchange rates from EUR to other currencies
 * Runs every 6 hours to keep rates fresh
 */
async function updateExchangeRates() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     🔄 UPDATING CURRENCY EXCHANGE RATES                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    // Fetch latest EUR exchange rates from free API
    // Alternative APIs:
    // - https://open.er-api.com/v6/latest/EUR (no key required)
    // - https://api.exchangerate-api.com/v4/latest/EUR
    // - https://api.freecurrencyapi.com (requires API key)

    const response = await axios.get('https://api.exchangerate-api.com/v4/latest/EUR', {
      timeout: 10000
    });

    if (!response.data || !response.data.rates) {
      throw new Error('Invalid response from exchange rate API');
    }

    const rates = response.data.rates;
    console.log(`✅ Fetched exchange rates (base: EUR)`);
    console.log(`   → AED: ${rates.AED}`);
    console.log(`   → INR: ${rates.INR}`);
    console.log(`   → PKR: ${rates.PKR}`);

    // Update database with new rates
    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');

      // Update AED
      await client.query(`
        INSERT INTO currency_exchange_rates (from_currency, to_currency, rate, updated_at)
        VALUES ('EUR', 'AED', $1, NOW())
        ON CONFLICT (from_currency, to_currency)
        DO UPDATE SET rate = $1, updated_at = NOW()
      `, [rates.AED]);

      // Update INR
      await client.query(`
        INSERT INTO currency_exchange_rates (from_currency, to_currency, rate, updated_at)
        VALUES ('EUR', 'INR', $1, NOW())
        ON CONFLICT (from_currency, to_currency)
        DO UPDATE SET rate = $1, updated_at = NOW()
      `, [rates.INR]);

      // Update PKR
      await client.query(`
        INSERT INTO currency_exchange_rates (from_currency, to_currency, rate, updated_at)
        VALUES ('EUR', 'PKR', $1, NOW())
        ON CONFLICT (from_currency, to_currency)
        DO UPDATE SET rate = $1, updated_at = NOW()
      `, [rates.PKR]);

      await client.query('COMMIT');
      console.log('✅ Exchange rates updated in database\n');

    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error('❌ Failed to update exchange rates:', err.message);
    console.error('   Retrying in next scheduled run...\n');
  }
}

// Run immediately on server start
updateExchangeRates();

// Schedule to run every 6 hours
// Cron syntax: '0 */6 * * *' = At minute 0 past every 6th hour (12am, 6am, 12pm, 6pm)
cron.schedule('0 */6 * * *', () => {
  updateExchangeRates();
});

console.log('🕒 Exchange rate updater scheduled (runs every 6 hours)');

module.exports = { updateExchangeRates };
