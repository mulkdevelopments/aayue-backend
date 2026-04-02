const BaseVendorService = require("./BaseVendorService");
const dbPool = require("../../db/dbConnection");
const {
  getApiClient,
  requestWithRetry,
} = require("../../controllers/importController/brandsgateway/brandsgatewayHelper");
const { getCountryCode, getRegionCode } = require("./countryRegionMapping");

const STORE_ID = Number(process.env.BRANDSGATEWAY_STORE_ID || 0) || 0;

function splitName(fullName = "") {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first: "Customer", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function buildNumericOrderId(orderData) {
  const fallback = Number(String(Date.now()).slice(-9));
  if (!orderData) return fallback;
  const source = orderData.orderNo || orderData.orderId || "";
  const digits = String(source).replace(/\D/g, "");
  if (!digits) return fallback;
  return Number(digits.slice(-9)) || fallback;
}

class BrandsgatewayService extends BaseVendorService {
  constructor(vendorId, vendorName, capabilities) {
    super(vendorId, vendorName, capabilities);
    // Ensure capability is enabled for runtime checks
    this.capabilities = {
      ...(capabilities || {}),
      has_order_placement_api: true,
      has_order_tracking_api: true,
    };
  }

  async submitOrder(orderData) {
    console.log(`📤 [${this.vendorName}] Submitting order ${orderData.orderNo}...`);

    try {
      if (!STORE_ID) {
        throw new Error("BRANDSGATEWAY_STORE_ID is not configured");
      }
      const payload = await this.transformOrderData(orderData);
      const client = getApiClient();

      const response = await requestWithRetry(() =>
        client.post("/orders", payload, {
          params: { store_id: STORE_ID },
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        })
      );

      const data = response?.data || {};
      const vendorOrderId = data.id ? String(data.id) : null;

      if (!vendorOrderId) {
        console.error(
          `❌ [${this.vendorName}] Order placement failed (missing order id):`,
          data
        );
        return {
          success: false,
          vendorOrderId: null,
          vendorReference: null,
          message: "Brandsgateway order placement failed (missing order id)",
          response: data,
        };
      }

      return {
        success: true,
        vendorOrderId,
        vendorReference: orderData.orderNo || orderData.orderId,
        message: "Order placed successfully",
        response: data,
      };
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data || {};
      const message = data?.message || data?.error || error.message;

      // 422 "order id has already been taken" on retry: order was already placed; treat as success with existing id
      const orderIdMsg = [message, data?.errors?.order_id].flat().filter(Boolean).join(" ");
      const orderIdAlreadyTaken =
        status === 422 &&
        String(orderIdMsg).toLowerCase().includes("order id") &&
        String(orderIdMsg).toLowerCase().includes("already been taken");
      if (orderIdAlreadyTaken && orderData.existingVendorOrderId) {
        console.log(`   ℹ️  [${this.vendorName}] Order already placed (order id taken); keeping vendor order ID: ${orderData.existingVendorOrderId}`);
        return {
          success: true,
          vendorOrderId: String(orderData.existingVendorOrderId),
          vendorReference: orderData.orderNo || orderData.orderId,
          message: "Order already placed with vendor",
          response: data,
        };
      }

      if (error.response) {
        console.error(
          `❌ [${this.vendorName}] API Error ${status}:`,
          data
        );
      } else {
        console.error(`❌ [${this.vendorName}] API Error:`, error.message);
      }
      const errorMessage =
        message || "Brandsgateway order placement failed";

      return {
        success: false,
        vendorOrderId: null,
        vendorReference: null,
        message: errorMessage,
        response: error.response?.data || { error: error.message },
      };
    }
  }

  async transformOrderData(orderData) {
    const { items, shippingAddress, customer } = orderData;

    if (!items || items.length === 0) {
      throw new Error("No items available for Brandsgateway order placement");
    }

    const variantIds = items.map((item) => item.variant_id);
    const { rows } = await dbPool.query(
      `SELECT
         pv.id AS variant_id,
         pv.vendor_product_id AS variation_id,
         p.productid AS product_id,
         p.name AS product_name
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.id = ANY($1::uuid[])`,
      [variantIds]
    );

    const variantMap = new Map(rows.map((row) => [row.variant_id, row]));

    const lineItems = items.map((item) => {
      const variant = variantMap.get(item.variant_id);
      if (!variant?.product_id) {
        throw new Error(
          `Missing Brandsgateway product id for variant ${item.variant_id}`
        );
      }

      const payload = {
        product_id: Number(variant.product_id),
        quantity: Number(item.qty || 1),
      };

      if (variant.variation_id) {
        payload.variation_id = Number(variant.variation_id);
      }

      return payload;
    });

    const name = splitName(customer?.full_name || "");
    const addr = shippingAddress || {};
    const countryCode = getCountryCode(addr.country || "");
    const stateCode = getRegionCode(countryCode, addr.state || "");

    return {
      order_id: buildNumericOrderId(orderData),
      line_items: lineItems,
      coupon_lines: [],
      shipping: {
        first_name: customer?.firstName || name.first,
        last_name: customer?.lastName || name.last,
        address_1: addr.street || addr.address_1 || "",
        address_2: addr.street2 || addr.address_2 || "",
        city: addr.city || "",
        state: stateCode,
        postcode: addr.postal_code || addr.postcode || "",
        country: countryCode,
        phone: addr.mobile || customer?.phone || "",
        email: customer?.email || "",
      },
    };
  }

  /**
   * GET /orders/{order_id}?store_id=… — response includes tracking_info[]:
   * { company, number, vendor_id, line_items[] }
   */
  async getTracking(vendorOrderId) {
    if (!vendorOrderId || !STORE_ID) return [];

    try {
      const client = getApiClient();
      const response = await requestWithRetry(() =>
        client.get(`/orders/${encodeURIComponent(String(vendorOrderId))}`, {
          params: { store_id: STORE_ID },
        })
      );
      const data = response?.data || {};
      const infos = Array.isArray(data.tracking_info) ? data.tracking_info : [];
      const tracking = [];
      for (const row of infos) {
        const num =
          row.number ?? row.tracking_number ?? row.trackingNumber ?? row.tracking_code;
        if (!num) continue;
        tracking.push({
          trackingCode: String(num),
          carrier: row.company ? String(row.company) : null,
          trackingUrl: row.tracking_url ?? row.url ?? null,
          shippedAt: row.shipped_at ?? data.shipped_at ?? data.completed_at ?? null,
          source: "brandsgateway",
          bg_vendor_id: row.vendor_id != null ? row.vendor_id : null,
          lineItems: Array.isArray(row.line_items) ? row.line_items : undefined,
        });
      }
      return tracking;
    } catch (error) {
      const status = error.response?.status;
      console.warn(
        `   ⚠️  [${this.vendorName}] getTracking(${vendorOrderId}) failed:`,
        status || error.message
      );
      return [];
    }
  }
}

module.exports = BrandsgatewayService;
