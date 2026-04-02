/**
 * VendorServiceFactory - Creates appropriate vendor service based on vendor configuration
 *
 * Determines which service class to use based on vendor's integration_type and capabilities
 */

const dbPool = require('../../db/dbConnection');
const LuxuryDistributionService = require('./LuxuryDistributionService');
const BrandsgatewayService = require('./BrandsgatewayService');
const BdroppyOrderService = require('./BdroppyOrderService');
const ManualVendorService = require('./ManualVendorService');

class VendorServiceFactory {
  /**
   * Get vendor service instance for a specific vendor
   *
   * @param {String} vendorId - Vendor UUID
   * @returns {Promise<BaseVendorService>} Vendor service instance
   */
  static async getVendorService(vendorId) {
    // Fetch vendor configuration from database
    const { rows } = await dbPool.query(`
      SELECT
        id,
        name,
        integration_type,
        capabilities,
        status
      FROM vendors
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `, [vendorId]);

    if (rows.length === 0) {
      throw new Error(`Vendor not found: ${vendorId}`);
    }

    const vendor = rows[0];

    // Check if vendor is active
    if (vendor.status !== 'active') {
      throw new Error(`Vendor is inactive: ${vendor.name}`);
    }

    const capabilities = vendor.capabilities || {};

    // Determine which service to use based on integration_type
    switch (vendor.integration_type) {
      case 'api':
        // Brandsgateway uses API order placement even if capability is not updated yet
        if (vendor.name.toLowerCase().includes('brandsgateway')) {
          return new BrandsgatewayService(vendor.id, vendor.name, capabilities);
        }

        // Check if vendor has order placement API
        if (capabilities.has_order_placement_api) {
          return this.getApiVendorService(vendor);
        } else {
          // API vendor but no order placement support
          console.warn(`⚠️  Vendor ${vendor.name} has API but no order placement - using manual`);
          return new ManualVendorService(vendor.id, vendor.name, capabilities);
        }

      case 'csv':
      case 'manual':
      default:
        // CSV or manual vendors
        return new ManualVendorService(vendor.id, vendor.name, capabilities);
    }
  }

  /**
   * Get API-based vendor service
   * Maps specific vendors to their service classes
   */
  static getApiVendorService(vendor) {
    // Map vendor name to service class
    const vendorNameLower = (vendor.name || '').toLowerCase();
    const vendorId = (vendor.id || '').toLowerCase();

    if (vendorNameLower.includes('luxury-distribution') || vendorNameLower.includes('luxury distribution')) {
      return new LuxuryDistributionService(vendor.id, vendor.name, vendor.capabilities);
    }

    if (vendorNameLower.includes('brandsgateway')) {
      return new BrandsgatewayService(vendor.id, vendor.name, vendor.capabilities);
    }

    if (vendorNameLower.includes('bdroppy') || vendorId === 'a6bdd96b-0e2c-4f3e-b644-4e088b1778e0'.toLowerCase()) {
      return new BdroppyOrderService(vendor.id, vendor.name, vendor.capabilities);
    }

    // Add more API vendors here in future:
    // else if (vendorNameLower.includes('shopify')) {
    //   return new ShopifyVendorService(vendor.id, vendor.name, vendor.capabilities);
    // }
    // else if (vendorNameLower.includes('brandsgateway')) {
    //   return new BrandsgatewayService(vendor.id, vendor.name, vendor.capabilities);
    // }

    // Unknown API vendor - fall back to manual
    console.warn(`⚠️  Unknown API vendor: ${vendor.name} - using manual fallback`);
    return new ManualVendorService(vendor.id, vendor.name, vendor.capabilities);
  }

  /**
   * Check if vendor supports order placement
   */
  static async hasOrderPlacementSupport(vendorId) {
    const { rows } = await dbPool.query(`
      SELECT capabilities->>'has_order_placement_api' AS has_api
      FROM vendors
      WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
    `, [vendorId]);

    return rows.length > 0 && rows[0].has_api === 'true';
  }
}

module.exports = VendorServiceFactory;
