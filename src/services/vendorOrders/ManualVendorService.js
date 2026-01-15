/**
 * ManualVendorService - For vendors without API integration
 *
 * Used for:
 * - CSV-based vendors (Peppela, Brandsgateway, etc.)
 * - Manual fulfillment
 *
 * Orders are marked as pending for manual processing
 */

const BaseVendorService = require('./BaseVendorService');

class ManualVendorService extends BaseVendorService {
  constructor(vendorId, vendorName, capabilities) {
    super(vendorId, vendorName, capabilities);
  }

  /**
   * Submit order (manual vendors - no API call)
   */
  async submitOrder(orderData) {
    console.log(`📝 [${this.vendorName}] Manual vendor - order will be processed manually`);
    console.log(`   Order: ${orderData.orderNo}`);
    console.log(`   Items: ${orderData.items.length}`);

    // For manual vendors, we just log the order
    // Admin will process these orders manually
    return {
      success: true,
      vendorOrderId: null, // No vendor order ID for manual
      vendorReference: `MANUAL-${Date.now()}`,
      message: 'Order queued for manual fulfillment',
      response: {
        manual: true,
        items: orderData.items.map(i => i.variant_id)
      }
    };
  }

  /**
   * Get tracking (manual vendors - no API)
   */
  async getTracking(vendorOrderId) {
    console.log(`ℹ️  [${this.vendorName}] Manual vendor - tracking must be entered manually`);
    return [];
  }

  /**
   * Transform order data (pass-through for manual)
   */
  async transformOrderData(orderData) {
    return orderData;
  }
}

module.exports = ManualVendorService;
