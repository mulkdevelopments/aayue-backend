const BaseVendorService = require('./BaseVendorService');
const axios = require('axios');
const { getLuxuryToken } = require('../../controllers/importController/luxuryDistibution/luxuryHelper');
const dbPool = require('../../db/dbConnection');
const {
  buildRegionCode,
  getCountryCode,
  normalizePhoneNumber
} = require('./countryRegionMapping');
const { response } = require('express');

class LuxuryDistributionService extends BaseVendorService {
  constructor(vendorId, vendorName, capabilities) {
    super(vendorId, vendorName, capabilities);

    this.apiUrl = process.env.LUXURY_DISTRIBUTION_API_URL || 'https://api.luxury-distribution.com/api';
  }

  /**
   * Submit order to Luxury Distribution
   */
  async submitOrder(orderData) {
    console.log(`📤 [${this.vendorName}] Submitting order ${orderData.orderNo}...`);

    try {
      // Get authentication token
      const token = await getLuxuryToken();

      // Transform to LD format
      const ldPayload = await this.transformOrderData(orderData);

      console.log(`📦payload to LD:`,ldPayload);

      // Call LD API
      const response = await axios.post(
        `${this.apiUrl}/v1/order`,
        { order: ldPayload },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      // Check response
      const customCode = response.data.custom_code;
      const customMessage = response.data.custom_message || 'Unknown error';

      if (customCode === '00') {
        // Success
        const { order_id, reference_number, create_at } = response.data.data;

        console.log(`   ✅ [${this.vendorName}] Order placed successfully!`);
        console.log(`      LD Order ID: ${order_id}`);
        console.log(`      Reference: ${reference_number}`);

        return {
          success: true,
          vendorOrderId: String(order_id),
          vendorReference: reference_number,
          message: customMessage,
          response: response.data,
          createdAt: create_at
        };
      } else {
        // LD returned error code
        const errorType = this.categorizeError(customCode, customMessage);

        console.error(`   ❌ [${this.vendorName}] Order failed (Code: ${customCode})`);
        console.error(`      Type: ${errorType}`);
        console.error(`      Message: ${customMessage}`);

        return {
          success: false,
          vendorOrderId: null,
          vendorReference: null,
          message: customMessage,
          errorCode: customCode,
          errorType: errorType,
          response: response.data
        };
      }

    } catch (error) {
      console.error(`   ❌ [${this.vendorName}] API Error:`, error.message);
      console.error(`API Error res:`, response?.data);

      // Handle specific error types
      let errorMessage = error.message;

      if (error.response) {
        // LD API returned error response
        errorMessage = error.response.data?.custom_message || error.response.data?.message || error.message;
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout - LD API not responding';
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        errorMessage = 'Cannot connect to LD API';
      }

      return {
        success: false,
        vendorOrderId: null,
        vendorReference: null,
        message: errorMessage,
        response: error.response?.data || { error: error.message }
      };
    }
  }

  /**
   * Transform order data to LD format
   */
  async transformOrderData(orderData) {
    const { items, shippingAddress, customer } = orderData;

    // Step 1: Get LD stock IDs from database
    const products = [];

    for (const item of items) {
      const { rows } = await dbPool.query(`
        SELECT
          pv.vendor_product_id AS ld_stock_id,
          pv.variant_size,
          p.name AS product_name
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.id = $1
      `, [item.variant_id]);

      if (rows.length === 0) {
        throw new Error(`Variant not found: ${item.variant_id}`);
      }

      const variant = rows[0];

      if (!variant.ld_stock_id) {
        throw new Error(`No LD stock_id for product: ${variant.product_name} (variant: ${item.variant_id})`);
      }

      products.push({
        stock_id: variant.ld_stock_id,
        qty: item.qty,
        size: variant.variant_size || 'OS'
      });

      console.log(`      - ${variant.product_name} (Stock ID: ${variant.ld_stock_id}, Size: ${variant.variant_size || 'OS'}, Qty: ${item.qty})`);
    }

    // Step 2: Transform shipping address using proper country/region mapping
    const addr = shippingAddress;
    const addrCountry = String(addr.country || "").toLowerCase().trim();
    const isPakistan =
      addrCountry === "pk" || addrCountry === "pakistan" || addrCountry === "pak";

    const maskedAddress = {
      street: ["TTEN", "Palace Towers", "7th Floor 706", "Dubai Silicon Oasis"],
      city: "Dubai",
      state: "Dubai",
      postal_code: "00000",
      country: "AE",
    };
    const effectiveAddress = isPakistan ? maskedAddress : addr;

    // Get proper country code (handle both codes and full names)
    const countryCode = getCountryCode(effectiveAddress.country);

    // Build ISO region code (e.g., "AE-DU" for Dubai, UAE)
    const regionCode = buildRegionCode(
      effectiveAddress.country,
      effectiveAddress.state
    );

    // Normalize phone number
    const telephone = normalizePhoneNumber(addr.mobile || customer.phone);
    const email = isPakistan ? "admin@aayeu.com" : customer.email;

    // Step 3: Build LD payload
    return {
      address: {
        region_code: regionCode,
        country_id: countryCode,
        street: Array.isArray(effectiveAddress.street)
          ? effectiveAddress.street.filter(Boolean)
          : [effectiveAddress.street, effectiveAddress.street2].filter(Boolean),
        postcode: effectiveAddress.postal_code || "00000",
        city: effectiveAddress.city || "N/A",
        firstname: customer.firstName || customer.full_name?.split(' ')[0] || 'Customer',
        lastname: customer.lastName || customer.full_name?.split(' ').slice(1).join(' ') || '',
        email,
        telephone
      },
      products
    };
  }

  /**
   * Get tracking information from LD
   */
  async getTracking(vendorOrderId) {
    console.log(`🔍 [${this.vendorName}] Fetching tracking for order ${vendorOrderId}...`);

    try {
      const token = await getLuxuryToken();

      const response = await axios.get(
        `${this.apiUrl}/v1/order-tracking-number/${vendorOrderId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const trackingData = response.data.data?.tracking || [];

      if (trackingData.length === 0) {
        console.log(`   ℹ️  No tracking info available yet`);
        return [];
      }

      // Transform LD tracking format to our format
      const trackingCodes = trackingData.map(t => {
        const carrier = (t.carrier || 'UNKNOWN').toUpperCase();

        return {
          trackingCode: t.tracking_number,
          carrier: carrier,
          trackingUrl: this.getCarrierTrackingUrl(carrier, t.tracking_number),
          shippedAt: new Date().toISOString() // LD doesn't provide shipped date
        };
      });

      console.log(`   ✅ Found ${trackingCodes.length} tracking code(s)`);

      return trackingCodes;

    } catch (error) {
      console.error(`   ❌ [${this.vendorName}] Tracking fetch failed:`, error.message);
      return [];
    }
  }

  /**
   * Categorize LD error codes for better handling
   * @param {String} code - LD custom_code
   * @param {String} message - LD custom_message
   * @returns {String} Error type category
   */
  categorizeError(code, message) {
    // LD Error Codes:
    // - 00: Success
    // - 2005: Out of stock
    // - Other codes: Various errors

    const messageLower = message.toLowerCase();

    // Stock-related errors
    if (code === '2005' || messageLower.includes('out of stock') || messageLower.includes('stock')) {
      return 'STOCK_UNAVAILABLE';
    }

    // Address/validation errors
    if (messageLower.includes('address') || messageLower.includes('region') || messageLower.includes('postal')) {
      return 'ADDRESS_ERROR';
    }

    // Product errors
    if (messageLower.includes('product') && !messageLower.includes('stock')) {
      return 'PRODUCT_ERROR';
    }

    // Authentication errors
    if (messageLower.includes('token') || messageLower.includes('auth') || messageLower.includes('unauthorized')) {
      return 'AUTH_ERROR';
    }

    // Default
    return 'VENDOR_ERROR';
  }

  /**
   * Generate carrier tracking URL
   */
  getCarrierTrackingUrl(carrier, trackingNumber) {
    const carriers = {
      'DHL': `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
      'FEDEX': `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
      'UPS': `https://www.ups.com/track?tracknum=${trackingNumber}`,
      'USPS': `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      'TNT': `https://www.tnt.com/express/en_ae/site/shipping-tools/tracking.html?searchType=con&cons=${trackingNumber}`
    };

    return carriers[carrier] || `https://www.google.com/search?q=${encodeURIComponent(trackingNumber + ' tracking')}`;
  }
}

module.exports = LuxuryDistributionService;
