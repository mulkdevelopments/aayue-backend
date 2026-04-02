/**
 * BDroppy order placement and tracking.
 * API: POST /api/order (Create order), GET /api/order/:id (Get order by order ID).
 * Uses same Bearer token and base URL as product sync (BDROPPY_TOKEN, BDROPPY_BASE_URL).
 */

const BaseVendorService = require("./BaseVendorService");
const dbPool = require("../../db/dbConnection");
const {
  getApiClient,
  requestWithRetry,
} = require("../../controllers/importController/bdroppy/bdroppyHelper");
const { getCountryCode } = require("./countryRegionMapping");

const BDROPPY_VENDOR_ID = "a6bdd96b-0e2c-4f3e-b644-4e088b1778e0";

/** Parse "+cCnnn" into { prefix: "+cC", number: "nnn" } for BDroppy recipient.phone */
function parsePhoneForBdroppy(mobile) {
  const raw = String(mobile || "").trim().replace(/\s+/g, " ");
  const plusMatch = raw.match(/^(\+\d{1,4})\s*(.*)$/);
  if (plusMatch) {
    return { prefix: plusMatch[1], number: (plusMatch[2] || "").trim() || "0" };
  }
  return { prefix: "", number: raw || "0" };
}

class BdroppyOrderService extends BaseVendorService {
  constructor(vendorId, vendorName, capabilities) {
    super(vendorId, vendorName, capabilities);
    this.capabilities = {
      ...(capabilities || {}),
      has_order_placement_api: true,
      has_order_tracking_api: true,
    };
  }

  /**
   * Submit order to BDroppy.
   * Body: { items: [ { quantity, stockId } ] } — stockId = product_variants.vendor_product_id (BDroppy model id).
   */
  async submitOrder(orderData) {
    console.log(`📤 [${this.vendorName}] Submitting order ${orderData.orderNo}...`);

    try {
      const payload = await this.buildOrderPayload(orderData);
      if (!payload.items || payload.items.length === 0) {
        return {
          success: false,
          vendorOrderId: null,
          vendorReference: null,
          message: "No valid BDroppy items (stockId required)",
          response: null,
        };
      }

      const client = getApiClient();
      const response = await requestWithRetry(() =>
        client.post("/api/order", payload, { timeout: 30000 })
      );

      const data = response?.data || {};
      // BDroppy response: id may be in _id, id, or ids.platform / ids.user (per their Example Response)
      const vendorOrderId =
        data._id != null
          ? String(data._id)
          : data.id != null
            ? String(data.id)
            : data.ids?.platform != null
              ? String(data.ids.platform)
              : data.ids?.user != null
                ? String(data.ids.user)
                : data.ids?.external != null
                  ? String(data.ids.external)
                  : null;

      if (!vendorOrderId) {
        console.error(
          `❌ [${this.vendorName}] Order placement failed (missing order id):`,
          data
        );
        return {
          success: false,
          vendorOrderId: null,
          vendorReference: null,
          message: "BDroppy order placement failed (no order id in response)",
          response: data,
        };
      }

      console.log(`   ✅ [${this.vendorName}] Order placed. BDroppy order ID: ${vendorOrderId}`);
      return {
        success: true,
        vendorOrderId,
        vendorReference: orderData.orderNo || orderData.orderId,
        message: "Order placed successfully",
        response: data,
      };
    } catch (error) {
      const res = error.response;
      const errMsg =
        (res?.data?.message || res?.data?.error || error.message) ||
        "BDroppy order placement failed";
      console.error(`❌ [${this.vendorName}] Order placement error:`, errMsg);
      if (res?.data) console.error("   Response:", res.data);
      return {
        success: false,
        vendorOrderId: null,
        vendorReference: null,
        message: errMsg,
        response: res?.data || { error: error.message },
      };
    }
  }

  /**
   * Build BDroppy Create order body per their API docs:
   * items, source: "api", recipient: { address, phone, email, recipient, ... }, carrierId?, isRecipient.
   * userCatalogId ties the order to the merchant's catalog so it appears in their BDroppy dashboard.
   */
  async buildOrderPayload(orderData) {
    const { items, shippingAddress = {}, customer = {} } = orderData;
    const addr = shippingAddress;
    const countrycode = getCountryCode(addr.country || "");
    const phoneParsed = parsePhoneForBdroppy(addr.mobile || customer.phone);

    const payload = {
      items: [],
      source: "api",
      ...(process.env.BDROPPY_USER_CATALOG && {
        userCatalogId: process.env.BDROPPY_USER_CATALOG.trim(),
      }),
      recipient: {
        address: {
          apartment: addr.apartment || "",
          streetName: addr.street || " ",
          zip: addr.postal_code || addr.postalCode || "",
          city: addr.city || "",
          province: addr.state || "",
          countrycode,
        },
        careof: addr.label || "",
        email: customer.email || "",
        phone: {
          prefix: phoneParsed.prefix || "+00",
          number: phoneParsed.number || "0",
        },
        recipient: customer.full_name || customer.name || "Customer",
        notes: addr.notes || "",
      },
      isRecipient: true,
    };

    // Optional: BDROPPY_DEFAULT_CARRIER_ID in .env if BDroppy requires it
    const carrierId = process.env.BDROPPY_DEFAULT_CARRIER_ID;
    if (carrierId !== undefined && carrierId !== "") {
      const num = parseInt(carrierId, 10);
      if (!Number.isNaN(num)) payload.carrierId = num;
    }

    if (!items || items.length === 0) {
      return payload;
    }

    const variantIds = items.map((i) => i.variant_id);
    const { rows } = await dbPool.query(
      `SELECT id AS variant_id, vendor_product_id, sku
       FROM product_variants
       WHERE id = ANY($1::uuid[])
         AND vendor_id = $2
         AND deleted_at IS NULL`,
      [variantIds, this.vendorId]
    );

    const variantMap = new Map(rows.map((r) => [r.variant_id, r]));
    const itemsPayload = [];

    for (const item of items) {
      const pv = variantMap.get(item.variant_id);
      if (!pv || pv.vendor_product_id == null || pv.vendor_product_id === "") {
        console.warn(
          `   ⚠️  Variant ${item.variant_id} has no vendor_product_id (BDroppy stockId) - skipping`
        );
        continue;
      }
      const stockId = Number(pv.vendor_product_id);
      if (Number.isNaN(stockId)) {
        console.warn(
          `   ⚠️  Variant ${item.variant_id} vendor_product_id "${pv.vendor_product_id}" is not numeric - skipping`
        );
        continue;
      }
      const qty = Math.max(1, parseInt(item.qty, 10) || 1);
      itemsPayload.push({ stockId, quantity: qty });
    }

    payload.items = itemsPayload;
    return payload;
  }

  /**
   * Get order status and tracking from BDroppy (GET /api/order/:id).
   * Example response has top-level trackingCode, trackingUrl.
   */
  async getTracking(vendorOrderId) {
    if (!vendorOrderId) return [];

    try {
      const client = getApiClient();
      const response = await requestWithRetry(() =>
        client.get(`/api/order/${encodeURIComponent(vendorOrderId)}`)
      );
      const data = response?.data || {};
      const tracking = [];
      const trackingNo =
        data.trackingCode ??
        data.tracking_code ??
        data.trackingNumber ??
        data.tracking_number;
      const trackingUrl = data.trackingUrl ?? data.tracking_url;
      const carrier =
        data.carrier ??
        data.carrierName ??
        data.carrier_name ??
        data.shippingCarrier ??
        (data.shippingCost && data.shippingCost.carrier ? String(data.shippingCost.carrier) : null);
      if (trackingNo) {
        tracking.push({
          trackingCode: String(trackingNo),
          carrier: carrier ? String(carrier) : null,
          trackingUrl: trackingUrl ? String(trackingUrl) : null,
          shippedAt: data.shippedAt ?? data.shipped_at ?? data.shipmentDate ?? null,
        });
      }
      return tracking;
    } catch (error) {
      console.warn(
        `   ⚠️  [${this.vendorName}] getTracking(${vendorOrderId}) failed:`,
        error.message
      );
      return [];
    }
  }
}

module.exports = BdroppyOrderService;
module.exports.BDROPPY_VENDOR_ID = BDROPPY_VENDOR_ID;
