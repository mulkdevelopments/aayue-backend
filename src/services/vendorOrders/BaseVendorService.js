/**
 * BaseVendorService - Abstract base class for vendor integrations
 *
 * All vendor-specific services (LD, Shopify, etc.) must extend this class
 * and implement the required methods.
 */

class BaseVendorService {
  constructor(vendorId, vendorName, capabilities = {}) {
    if (this.constructor === BaseVendorService) {
      throw new Error('BaseVendorService is abstract and cannot be instantiated directly');
    }

    this.vendorId = vendorId;
    this.vendorName = vendorName;
    this.capabilities = capabilities;
  }

  /**
   * Submit order to vendor API
   *
   * @param {Object} orderData
   * @param {String} orderData.orderId - Your internal order UUID
   * @param {String} orderData.orderNo - Your order number (e.g., "ORD-12345")
   * @param {Array} orderData.items - Array of order items
   * @param {Object} orderData.shippingAddress - Customer shipping address
   * @param {Object} orderData.customer - Customer info (email, name, phone)
   *
   * @returns {Promise<Object>} Result object:
   * {
   *   success: true/false,
   *   vendorOrderId: "1203",              // Vendor's order ID
   *   vendorReference: "16000124545",     // Vendor's reference number
   *   message: "Order placed successfully",
   *   response: { ... }                   // Full vendor API response
   * }
   */
  async submitOrder(orderData) {
    throw new Error('submitOrder() must be implemented by subclass');
  }

  /**
   * Get tracking information for a vendor order
   *
   * @param {String} vendorOrderId - Vendor's order ID
   *
   * @returns {Promise<Array>} Array of tracking objects:
   * [
   *   {
   *     trackingCode: "DHL123456789",
   *     carrier: "DHL",
   *     trackingUrl: "https://...",
   *     shippedAt: "2026-01-07T10:00:00Z"
   *   }
   * ]
   */
  async getTracking(vendorOrderId) {
    throw new Error('getTracking() must be implemented by subclass');
  }

  /**
   * Transform order data from your format to vendor's format
   * This is called internally by submitOrder()
   *
   * @param {Object} orderData - Your order data
   * @returns {Object} Vendor-specific formatted payload
   */
  async transformOrderData(orderData) {
    throw new Error('transformOrderData() must be implemented by subclass');
  }

  /**
   * Check if vendor supports a specific capability
   *
   * @param {String} capability - Capability name (e.g., 'has_order_placement_api')
   * @returns {Boolean}
   */
  hasCapability(capability) {
    return this.capabilities[capability] === true;
  }

  /**
   * Get vendor info for logging
   */
  toString() {
    return `${this.vendorName} (${this.vendorId})`;
  }
}

module.exports = BaseVendorService;
