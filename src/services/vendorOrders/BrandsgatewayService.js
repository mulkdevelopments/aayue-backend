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
      if (error.response) {
        console.error(
          `❌ [${this.vendorName}] API Error ${error.response.status}:`,
          error.response.data
        );
      } else {
        console.error(`❌ [${this.vendorName}] API Error:`, error.message);
      }
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error ||
        error.message ||
        "Brandsgateway order placement failed";

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

  async getTracking() {
    // Brandsgateway tracking API not implemented yet
    return [];
  }
}

module.exports = BrandsgatewayService;
