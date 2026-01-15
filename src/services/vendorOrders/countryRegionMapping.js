/**
 * Country and Region Code Mapping for Luxury Distribution API
 *
 * LD requires ISO 3166-2 region codes in format: "COUNTRY-REGION"
 * Example: "AE-DU" for Dubai, UAE
 *
 * Our system operates in: UAE, Europe, India, Pakistan
 */

/**
 * Country Code Mapping
 * Maps full country names to ISO 3166-1 alpha-2 codes
 */
const COUNTRY_CODES = {
  // UAE
  'united arab emirates': 'AE',
  'uae': 'AE',
  'dubai': 'AE',
  'abu dhabi': 'AE',
  'sharjah': 'AE',

  // Europe
  'france': 'FR',
  'germany': 'DE',
  'italy': 'IT',
  'spain': 'ES',
  'united kingdom': 'GB',
  'uk': 'GB',
  'netherlands': 'NL',
  'belgium': 'BE',
  'austria': 'AT',
  'switzerland': 'CH',
  'portugal': 'PT',
  'poland': 'PL',
  'sweden': 'SE',
  'denmark': 'DK',
  'norway': 'NO',
  'finland': 'FI',

  // India
  'india': 'IN',

  // Pakistan
  'pakistan': 'PK',

  // Others (common)
  'united states': 'US',
  'usa': 'US',
  'canada': 'CA',
  'australia': 'AU',
  'new zealand': 'NZ',
  'singapore': 'SG',
  'hong kong': 'HK',
  'south korea': 'KR',
  'japan': 'JP',
  'china': 'CN',
};

/**
 * Region/State Code Mapping for major countries
 * Format: { countryCode: { stateName: stateCode } }
 */
const REGION_CODES = {
  // UAE Emirates
  'AE': {
    'abu dhabi': 'AZ',
    'dubai': 'DU',
    'sharjah': 'SH',
    'ajman': 'AJ',
    'umm al quwain': 'UQ',
    'ras al khaimah': 'RK',
    'fujairah': 'FU',
    // Fallback
    'default': 'DU'
  },

  // India States (major ones)
  'IN': {
    'delhi': 'DL',
    'maharashtra': 'MH',
    'karnataka': 'KA',
    'tamil nadu': 'TN',
    'west bengal': 'WB',
    'telangana': 'TG',
    'uttar pradesh': 'UP',
    'gujarat': 'GJ',
    'rajasthan': 'RJ',
    'punjab': 'PB',
    'haryana': 'HR',
    'kerala': 'KL',
    'andhra pradesh': 'AP',
    'madhya pradesh': 'MP',
    'bihar': 'BR',
    'default': 'DL'
  },

  // Pakistan Provinces
  'PK': {
    'punjab': 'PB',
    'sindh': 'SD',
    'khyber pakhtunkhwa': 'KP',
    'balochistan': 'BA',
    'islamabad': 'IS',
    'gilgit-baltistan': 'GB',
    'azad kashmir': 'JK',
    'default': 'PB'
  },

  // France Regions (simplified)
  'FR': {
    'île-de-france': 'IDF',
    'paris': 'IDF',
    'default': 'IDF'
  },

  // Germany States
  'DE': {
    'berlin': 'BE',
    'bavaria': 'BY',
    'north rhine-westphalia': 'NW',
    'default': 'BE'
  },

  // UK (countries)
  'GB': {
    'england': 'ENG',
    'scotland': 'SCT',
    'wales': 'WLS',
    'northern ireland': 'NIR',
    'default': 'ENG'
  },

  // Italy Regions
  'IT': {
    'lazio': 'LZ',
    'lombardy': 'LM',
    'lombardia': 'LM',
    'rome': 'LZ',
    'milan': 'LM',
    'default': 'LM'
  },

  // Spain
  'ES': {
    'madrid': 'MD',
    'catalonia': 'CT',
    'barcelona': 'CT',
    'default': 'MD'
  },

  // Default for other countries
  'default': {
    'default': '01'
  }
};

/**
 * Currency to Country mapping
 * Maps currency codes to default country codes
 */
const CURRENCY_TO_COUNTRY = {
  'AED': 'AE',  // UAE Dirham
  'EUR': 'FR',  // Euro (default to France)
  'INR': 'IN',  // Indian Rupee
  'PKR': 'PK',  // Pakistani Rupee
  'USD': 'US',  // US Dollar
  'GBP': 'GB',  // British Pound
  'CHF': 'CH',  // Swiss Franc
};

/**
 * Get ISO country code from country name
 * @param {String} countryName - Full country name or code
 * @returns {String} ISO 3166-1 alpha-2 code (e.g., "AE")
 */
function getCountryCode(countryName) {
  if (!countryName) return 'AE'; // Default to UAE

  const normalized = countryName.toLowerCase().trim();

  // Check if already a valid code (2 letters)
  if (/^[A-Z]{2}$/i.test(countryName)) {
    return countryName.toUpperCase();
  }

  // Look up in mapping
  return COUNTRY_CODES[normalized] || 'AE';
}

/**
 * Get region code for a country/state combination
 * @param {String} countryCode - ISO country code (e.g., "AE")
 * @param {String} stateName - State/region name
 * @returns {String} Region code (e.g., "DU")
 */
function getRegionCode(countryCode, stateName) {
  if (!stateName) {
    // No state provided, use default for country
    const countryRegions = REGION_CODES[countryCode] || REGION_CODES['default'];
    return countryRegions['default'] || '01';
  }

  const normalized = stateName.toLowerCase().trim();
  const countryRegions = REGION_CODES[countryCode] || REGION_CODES['default'];

  return countryRegions[normalized] || countryRegions['default'] || '01';
}

/**
 * Build LD region_code in format "COUNTRY-REGION"
 * @param {String} countryName - Country name or code
 * @param {String} stateName - State/province/emirate name
 * @returns {String} LD region code (e.g., "AE-DU")
 */
function buildRegionCode(countryName, stateName) {
  const countryCode = getCountryCode(countryName);
  const regionCode = getRegionCode(countryCode, stateName);

  return `${countryCode}-${regionCode}`;
}

/**
 * Get country code from currency
 * @param {String} currency - Currency code (e.g., "AED")
 * @returns {String} Country code (e.g., "AE")
 */
function getCountryFromCurrency(currency) {
  if (!currency) return 'AE';

  const normalized = currency.toUpperCase().trim();
  return CURRENCY_TO_COUNTRY[normalized] || 'AE';
}

/**
 * Parse and normalize phone number
 * @param {String} phone - Phone number (may include country code)
 * @returns {String} Cleaned phone number
 */
function normalizePhoneNumber(phone) {
  if (!phone) return '0000000000';

  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');

  // Ensure at least 10 digits
  if (cleaned.length < 10) {
    cleaned = cleaned.padEnd(10, '0');
  }

  return cleaned;
}

module.exports = {
  COUNTRY_CODES,
  REGION_CODES,
  CURRENCY_TO_COUNTRY,
  getCountryCode,
  getRegionCode,
  buildRegionCode,
  getCountryFromCurrency,
  normalizePhoneNumber
};
