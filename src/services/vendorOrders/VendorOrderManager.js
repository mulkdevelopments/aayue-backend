/**
 * VendorOrderManager - Main orchestrator for vendor order placement
 *
 * Handles:
 * - Grouping order items by vendor
 * - Placing orders with each vendor
 * - Updating order_items status
 * - Error handling and retry logic
 */

const dbPool = require('../../db/dbConnection');
const VendorServiceFactory = require('./VendorServiceFactory');

class VendorOrderManager {
  /**
   * Place orders with vendors for all items in an order
   *
   * @param {String} orderId - Order UUID
   * @returns {Promise<Object>} Placement results
   */
  static async placeOrderItems(orderId) {
    console.log(`\n🚀 ========================================`);
    console.log(`📦 Starting vendor order placement for order: ${orderId}`);
    console.log(`========================================\n`);

    const client = await dbPool.connect();

    try {
      await client.query('BEGIN');

      // Step 1: Get order details
      const { rows: orderRows } = await client.query(`
        SELECT
          o.id,
          o.order_no,
          o.shipping_address,
          o.payment_status,
          u.id AS user_id,
          u.email,
          u.full_name,
          u.phone
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
      `, [orderId]);

      if (orderRows.length === 0) {
        throw new Error(`Order not found: ${orderId}`);
      }

      const order = orderRows[0];

      // Check payment status
      if (order.payment_status !== 'paid') {
        console.warn(`⚠️  Order ${order.order_no} is not paid (status: ${order.payment_status})`);
        await client.query('COMMIT');
        return {
          success: false,
          message: 'Order not paid yet',
          results: []
        };
      }

      // Step 2: Get order items grouped by vendor
      const { rows: items } = await client.query(`
        SELECT
          oi.id AS order_item_id,
          oi.variant_id,
          oi.qty,
          oi.price,
          oi.vendor_id,
          oi.vendor_order_status,
          v.name AS vendor_name,
          v.integration_type,
          v.capabilities,
          p.name AS product_name,
          pv.sku AS variant_sku
        FROM order_items oi
        JOIN vendors v ON v.id = oi.vendor_id
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE oi.order_id = $1
          AND oi.deleted_at IS NULL
          AND v.status = 'active'
        ORDER BY v.name, oi.created_at
      `, [orderId]);

      if (items.length === 0) {
        console.warn(`⚠️  No items found for order ${order.order_no}`);
        await client.query('COMMIT');
        return {
          success: true,
          message: 'No items to process',
          results: []
        };
      }

      console.log(`📋 Found ${items.length} items across vendors\n`);

      // Step 3: Group items by vendor
      const itemsByVendor = items.reduce((acc, item) => {
        if (!acc[item.vendor_id]) {
          acc[item.vendor_id] = {
            vendorId: item.vendor_id,
            vendorName: item.vendor_name,
            integrationType: item.integration_type,
            capabilities: item.capabilities,
            items: []
          };
        }
        acc[item.vendor_id].items.push(item);
        return acc;
      }, {});

      const vendorCount = Object.keys(itemsByVendor).length;
      console.log(`🏪 Order split across ${vendorCount} vendor(s)\n`);

      // Step 4: Process each vendor's items
      const results = [];

      for (const [vendorId, vendorData] of Object.entries(itemsByVendor)) {
        console.log(`\n┌─────────────────────────────────────────────────────`);
        console.log(`│ Vendor: ${vendorData.vendorName}`);
        console.log(`│ Type: ${vendorData.integrationType}`);
        console.log(`│ Items: ${vendorData.items.length}`);
        console.log(`└─────────────────────────────────────────────────────\n`);

        // Check if any items already placed
        const alreadyPlaced = vendorData.items.filter(i => i.vendor_order_status === 'placed');
        if (alreadyPlaced.length > 0) {
          console.log(`   ℹ️  ${alreadyPlaced.length} item(s) already placed - skipping`);
          results.push({
            vendorId,
            vendorName: vendorData.vendorName,
            success: true,
            skipped: true,
            message: 'Items already placed',
            itemCount: alreadyPlaced.length
          });
          continue;
        }

        // Get vendor service
        let vendorService;
        try {
          vendorService = await VendorServiceFactory.getVendorService(vendorId);
        } catch (error) {
          console.error(`   ❌ Failed to get vendor service:`, error.message);
          results.push({
            vendorId,
            vendorName: vendorData.vendorName,
            success: false,
            message: error.message,
            itemCount: vendorData.items.length
          });
          continue;
        }

        // Check if vendor has order placement support
        if (!vendorService.hasCapability('has_order_placement_api')) {
          console.log(`   ℹ️  Vendor doesn't have order placement API - marking as pending for manual processing`);
          results.push({
            vendorId,
            vendorName: vendorData.vendorName,
            success: true,
            manual: true,
            message: 'Manual fulfillment required',
            itemCount: vendorData.items.length
          });
          continue;
        }

        // Prepare order data
        const orderData = {
          orderId: order.id,
          orderNo: order.order_no,
          items: vendorData.items,
          shippingAddress: order.shipping_address,
          customer: {
            userId: order.user_id,
            email: order.email,
            full_name: order.full_name,
            phone: order.phone
          }
        };

        // Submit order to vendor
        const result = await vendorService.submitOrder(orderData);

        // Update order_items based on result
        if (result.success) {
          // Success - update all items for this vendor
          const itemIds = vendorData.items.map(i => i.order_item_id);

          await client.query(`
            UPDATE order_items
            SET
              vendor_order_status = 'placed',
              vendor_order_id = $1,
              vendor_reference_number = $2,
              updated_at = NOW()
            WHERE id = ANY($3::uuid[])
          `, [result.vendorOrderId, result.vendorReference, itemIds]);

          console.log(`\n   ✅ Updated ${itemIds.length} items with vendor order ID: ${result.vendorOrderId}\n`);

          results.push({
            vendorId,
            vendorName: vendorData.vendorName,
            success: true,
            vendorOrderId: result.vendorOrderId,
            vendorReference: result.vendorReference,
            message: result.message,
            itemCount: itemIds.length,
            response: result.response
          });

        } else {
          // Failure - mark items as failed
          const itemIds = vendorData.items.map(i => i.order_item_id);

          await client.query(`
            UPDATE order_items
            SET
              vendor_order_status = 'failed',
              updated_at = NOW()
            WHERE id = ANY($1::uuid[])
          `, [itemIds]);

          console.log(`\n   ❌ Marked ${itemIds.length} items as failed\n`);

          results.push({
            vendorId,
            vendorName: vendorData.vendorName,
            success: false,
            message: result.message,
            itemCount: itemIds.length,
            response: result.response
          });

          // TODO: Send notification to admin about failed order
        }
      }

      await client.query('COMMIT');

      // Summary
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      console.log(`\n========================================`);
      console.log(`📊 Vendor Order Placement Summary`);
      console.log(`========================================`);
      console.log(`Order: ${order.order_no}`);
      console.log(`Total Vendors: ${results.length}`);
      console.log(`✅ Success: ${successCount}`);
      console.log(`❌ Failed: ${failCount}`);
      console.log(`========================================\n`);

      return {
        success: failCount === 0,
        orderId: order.id,
        orderNo: order.order_no,
        vendorResults: results,
        summary: {
          totalVendors: results.length,
          successCount,
          failCount
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`\n❌ ========================================`);
      console.error(`Error placing vendor orders:`, error);
      console.error(`========================================\n`);

      throw error;

    } finally {
      client.release();
    }
  }

  /**
   * Retry failed vendor order
   *
   * @param {String} orderId - Order UUID
   * @param {String} vendorId - Vendor UUID (optional - if not provided, retry all failed vendors)
   */
  static async retryFailedOrder(orderId, vendorId = null) {
    console.log(`\n🔄 Retrying failed vendor orders for order: ${orderId}`);

    const client = await dbPool.connect();

    try {
      // Reset failed items to pending
      let query = `
        UPDATE order_items
        SET vendor_order_status = 'pending', updated_at = NOW()
        WHERE order_id = $1 AND vendor_order_status = 'failed'
      `;
      const params = [orderId];

      if (vendorId) {
        query += ` AND vendor_id = $2`;
        params.push(vendorId);
      }

      query += ` RETURNING id`;

      const { rows } = await client.query(query, params);

      console.log(`   📝 Reset ${rows.length} items to pending status`);

      // Re-run placement
      return await this.placeOrderItems(orderId);

    } finally {
      client.release();
    }
  }

  /**
   * Sync tracking information for an order
   *
   * @param {String} orderId - Order UUID
   */
  static async syncTracking(orderId) {
    console.log(`\n🔍 Syncing tracking for order: ${orderId}`);

    const client = await dbPool.connect();

    try {
      // Get all placed items with vendor_order_id
      const { rows: items } = await client.query(`
        SELECT DISTINCT
          oi.vendor_id,
          oi.vendor_order_id,
          v.name AS vendor_name
        FROM order_items oi
        JOIN vendors v ON v.id = oi.vendor_id
        WHERE oi.order_id = $1
          AND oi.vendor_order_status = 'placed'
          AND oi.vendor_order_id IS NOT NULL
      `, [orderId]);

      const trackingResults = [];

      for (const item of items) {
        console.log(`   📦 Fetching tracking from ${item.vendor_name}...`);

        const vendorService = await VendorServiceFactory.getVendorService(item.vendor_id);

        if (!vendorService.hasCapability('has_order_tracking_api')) {
          console.log(`      ℹ️  Vendor doesn't support tracking API`);
          continue;
        }

        const tracking = await vendorService.getTracking(item.vendor_order_id);

        if (tracking.length > 0) {
          // Update all items with this vendor_order_id
          await client.query(`
            UPDATE order_items
            SET
              tracking_codes = $1::jsonb,
              updated_at = NOW()
            WHERE vendor_order_id = $2
          `, [JSON.stringify(tracking), item.vendor_order_id]);

          console.log(`      ✅ Updated ${tracking.length} tracking code(s)`);

          trackingResults.push({
            vendorName: item.vendor_name,
            vendorOrderId: item.vendor_order_id,
            tracking
          });
        } else {
          console.log(`      ℹ️  No tracking available yet`);
        }
      }

      return {
        success: true,
        trackingResults
      };

    } finally {
      client.release();
    }
  }
}

module.exports = VendorOrderManager;
