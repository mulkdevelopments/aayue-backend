/**
 * Vendor Orders Module - Main exports
 *
 * Usage:
 *   const { VendorOrderManager } = require('./services/vendorOrders');
 *   await VendorOrderManager.placeOrderItems(orderId);
 */

const VendorOrderManager = require('./VendorOrderManager');
const VendorServiceFactory = require('./VendorServiceFactory');
const BaseVendorService = require('./BaseVendorService');
const LuxuryDistributionService = require('./LuxuryDistributionService');
const ManualVendorService = require('./ManualVendorService');
const BrandsgatewayService = require('./BrandsgatewayService');

module.exports = {
  // Main API
  VendorOrderManager,

  // Factory
  VendorServiceFactory,

  // Service classes (for extension)
  BaseVendorService,
  LuxuryDistributionService,
  ManualVendorService,
  BrandsgatewayService
};
