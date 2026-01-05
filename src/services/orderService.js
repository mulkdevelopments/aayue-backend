// src/services/orderService.js
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { generateInvoiceHTML } = require("../template/generateInvoiceHtml");

const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s\W-]+/g, "-");

const OrderService = {
  // generate human-friendly order_no: ORD-YYYYMMDD-<6chars>
  generateOrderNo() {
    const d = new Date();
    const YYYY = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const suffix = uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
    return `ORD-${YYYY}${MM}${DD}-${suffix}`;
  },

  /**
   * createOrderFromItems
   * - items: array of { product_id, variant_id, qty, price, sale_price, sku, name, vendor_id }
   * - user_id
   * - shipping_address, billing_address (optional)
   * - client: pg client (transaction expected to be started/committed by caller)
   */
  async createOrderFromItems(
    {
      user_id,
      items = [],
      shipping_address = null,
      billing_address = null,
      vendor_id = null,
      coupon_id = null,
      coupon_code = null,
      discount = 0,
      currency = "EUR",
      exchange_rate = 1,
      base_currency = "EUR",
      currency_symbol = "€",
    },
    client
  ) {
    if (!user_id) throw new Error("user_id required");
    if (!Array.isArray(items) || items.length === 0)
      throw new Error("items required");
    if (!shipping_address) throw new Error("shipping_address required");

    const orderId = uuidv4();
    const orderNo = this.generateOrderNo();

    // console.log(items, "Calculating total amount...");
    // compute totals
    let total_amount = 0;
    for (const it of items) {
      const unit =
        it.sale_price !== undefined && it.sale_price !== null
          ? Number(it.sale_price)
          : Number(it.price || 0);
      total_amount += unit * Number(it.qty || 1);
    }
    total_amount = Number(total_amount.toFixed(2));

    const insertOrderSQL = `
    INSERT INTO orders (
      id, order_no, user_id, vendor_id, total_amount,
      payment_status, order_status, shipping_address, billing_address, created_at, coupon_id, coupon_code,
      discount, currency, exchange_rate, base_currency, currency_symbol
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb, now(), $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `;

    const insertOrderParams = [
      orderId,
      orderNo,
      user_id,
      vendor_id || null,
      total_amount,
      "pending",
      "created",
      JSON.stringify(shipping_address), // full address JSON from DB
      JSON.stringify(billing_address || shipping_address),
      coupon_id,
      coupon_code,
      Number(discount) || 0,
      currency,
      exchange_rate,
      base_currency,
      currency_symbol,
    ];

    const { rows: orderRows } = await client.query(
      insertOrderSQL,
      insertOrderParams
    );
    const createdOrder = orderRows[0];
    // console.log('Created order:', createdOrder);

    console.log("Inserting order items...", items);
    // insert order_items
    for (const it of items) {
      const productLink = await this.generateProductLink(it.product.id, client);
      console.log("Product link:", productLink);
      const unitPrice =
        it.sale_price !== undefined && it.sale_price !== null
          ? Number(it.sale_price)
          : Number(it.price || 0);
      await client.query(
        `
      INSERT INTO order_items (id, order_id, variant_id, qty, price, vendor_id, product_link, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, now())
      `,
        [
          uuidv4(),
          orderId,
          it.variant_id?.id || null,
          it.qty || 1,
          unitPrice,
          it.vendorId || null,
          productLink,
        ]
      );
    }

    return createdOrder;
  },

  /**
   * finalizePaidOrder
   * - mark order payment_status => 'paid', order_status => 'processing' (or as you want)
   * - ensure stock is decremented & order is not processed twice
   * - client must be connected and transactionally controlled by caller
   */
  async finalizePaidOrder({ order_id, payment_id }, client) {
    // fetch order items
    const { rows: items } = await client.query(
      `SELECT oi.id, oi.variant_id, oi.qty FROM order_items oi WHERE oi.order_id = $1 AND oi.deleted_at IS NULL`,
      [order_id]
    );
    if (!items) throw new Error("Order not found or has no items");

    // idempotency check: if order already marked paid, skip
    const { rows: orows } = await client.query(
      `SELECT payment_status FROM orders WHERE id = $1 FOR UPDATE`,
      [order_id]
    );
    if (orows.length === 0) throw new Error("Order not found");
    const currentPaymentStatus = orows[0].payment_status;
    if (currentPaymentStatus === "paid") {
      return { alreadyPaid: true };
    }
// ------------------------------------------------------------------------------------------------------------------
    // ⚠️ STOCK REDUCTION COMMENTED OUT - Re-enable when inventory management is ready
    // lock each variant and decrement stock
    // for (const it of items) {
    //   if (!it.variant_id) continue;
    //   const vRes = await client.query(
    //     `SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE`,
    //     [it.variant_id]
    //   );
    //   if (vRes.rowCount === 0) {
    //     // missing variant -> log but continue
    //     continue;
    //   }
    //   const currentStock = Number(vRes.rows[0].stock || 0);
    //   const newStock = currentStock - Number(it.qty || 0);
    //   await client.query(
    //     `UPDATE product_variants SET stock = $1 WHERE id = $2`,
    //     [newStock < 0 ? 0 : newStock, it.variant_id]
    //   );

    //   // optional: write inventory transaction
    //   await client.query(
    //     `INSERT INTO inventory_transactions (id, variant_id, change, reason, reference_id, created_at)
    //      VALUES ($1,$2,$3,$4,$5, now())`,
    //     [
    //       uuidv4(),
    //       it.variant_id,
    //       -Math.abs(it.qty || 0),
    //       "order_paid",
    //       order_id,
    //     ]
    //   );
    // }
// ------------------------------------------------------------------------------------------------------------------
    // update orders
    await client.query(
      `UPDATE orders SET payment_status='paid', order_status='processing', deleted_at = NULL  WHERE id = $1`,
      [order_id]
    );

    // store payment id (optional separate column not in older schema; if you have payment_id column, set it)
    // If your orders table has payment_id column, set it here. (Your schema earlier did not have it)
    // await client.query(`UPDATE orders SET payment_id=$1 WHERE id=$2`, [payment_id, order_id]);

    return { ok: true };
  },

  async getUserPaidOrders(options = {}, client) {
    const {
      user_id,
      status = "paid",
      from_date = null,
      to_date = null,
      limit = 20,
      offset = 0,
    } = options;

    const where = ["o.deleted_at IS NULL", "o.user_id = $1"];
    const params = [user_id];
    let idx = 2;

    // payment status filter (exact match) - skip if status is 'all'
    if (status && status.toLowerCase() !== 'all') {
      where.push(`o.payment_status = $${idx}`);
      params.push(status);
      idx++;
    }

    // date filters (created_at)
    if (from_date) {
      where.push(`o.created_at >= $${idx}`);
      params.push(from_date);
      idx++;
    }
    if (to_date) {
      where.push(`o.created_at <= $${idx}`);
      params.push(to_date);
      idx++;
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Count query
    const countSQL = `SELECT COUNT(1) AS total FROM orders o ${whereSQL}`;
    const { rows: countRows } = await client.query(countSQL, params);
    const total = parseInt(countRows[0]?.total || 0, 10);
    if (total === 0) return { total: 0, orders: [] };

    // Main query
    const paramsMain = params.slice();
    paramsMain.push(limit);
    paramsMain.push(offset);

    const mainSQL = `
    SELECT
      o.id,
      o.order_no,
      o.user_id,
      o.vendor_id,
      o.currency,
      o.exchange_rate,
      o.currency_symbol,
      o.total_amount,
      o.payment_status,
      o.order_status,
      o.shipping_address,
      o.billing_address,
      o.created_at,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', oi.id,
            'variant_id', oi.variant_id,
            'qty', oi.qty,
            'price', oi.price,
            'vendor_id', oi.vendor_id,
            'product', jsonb_build_object(
              'id', p.id,
              'name', p.name,
              'product_sku', p.product_sku,
              'product_img', p.product_img
            ),
            'variant', jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'price', pv.price,
              'mrp', pv.mrp,
              'stock', pv.stock,
              'images', pv.images
            )
          )
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
    LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
    ${whereSQL}
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $${paramsMain.length - 1} OFFSET $${paramsMain.length};
  `;

    const { rows: orderRows } = await client.query(mainSQL, paramsMain);

    // Normalize
    const orders = orderRows.map((r) => ({
      id: r.id,
      order_no: r.order_no,
      user_id: r.user_id,
      vendor_id: r.vendor_id,

      currency: r.currency,
      exchange_rate: r.exchange_rate !== null ? Number(r.exchange_rate) : null,
      currency_symbol: r.currency_symbol,

      total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
      payment_status: r.payment_status,
      order_status: r.order_status,
      shipping_address: r.shipping_address,
      billing_address: r.billing_address,
      created_at: r.created_at,
      updated_at: r.updated_at,
      items: (r.items || []).map((it) => ({
        id: it.id,
        variant_id: it.variant_id,
        qty: it.qty,
        price: it.price !== null ? Number(it.price) : null,
        vendor_id: it.vendor_id,
        product: it.product || null,
        variant: it.variant || null,
      })),
    }));

    return { total, orders };
  },

  /**
   * getUserOrderById - get one order and its items (used in getUserOrderById controller)
   */
  // async getUserOrderById({ user_id, order_id }, client) {
  //   const { rows } = await client.query(
  //     `
  //     SELECT
  //       o.*,
  //       COALESCE(jsonb_agg(DISTINCT to_jsonb(jsonb_build_object(
  //         'id', oi.id,
  //         'variant_id', oi.variant_id,
  //         'qty', oi.qty,
  //         'price', oi.price,
  //         'vendor_id', oi.vendor_id,
  //         'product', jsonb_build_object('id', p.id, 'name', p.name, 'product_sku', p.product_sku, 'product_img', p.product_img),
  //         'variant', jsonb_build_object('id', pv.id, 'sku', pv.sku, 'price', pv.price, 'sale_price', pv.sale_price, 'stock', pv.stock, 'images', pv.images),
  //         'user', jsonb_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email)
  //       ))) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
  //     FROM orders o
  //     LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
  //     LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
  //     LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
  //     LEFT JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL
  //     WHERE o.id = $1 AND o.user_id = $2 AND o.deleted_at IS NULL
  //     GROUP BY o.id
  //     LIMIT 1
  //   `,
  //     [order_id, user_id]
  //   );

  //   if (!rows.length) return null;
  //   const r = rows[0];
  //   return {
  //     id: r.id,
  //     order_no: r.order_no,
  //     user_id: r.user_id,
  //     vendor_id: r.vendor_id,
  //     total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
  //     payment_status: r.payment_status,
  //     order_status: r.order_status,
  //     shipping_address: r.shipping_address,
  //     billing_address: r.billing_address,
  //     created_at: r.created_at,
  //     updated_at: r.updated_at,
  //     items: r.items.map((it) => ({
  //       id: it.id,
  //       variant_id: it.variant_id,
  //       qty: it.qty,
  //       price: it.price !== null ? Number(it.price) : null,
  //       vendor_id: it.vendor_id,
  //       product: it.product,
  //       variant: it.variant,
  //     })),
  //   };
  // },

  async getUserOrderById({ user_id, order_id }, client) {
    const { rows } = await client.query(
      `
    SELECT
      o.*,
      jsonb_build_object(
        'id', u.id,
        'full_name', u.full_name,
        'email', u.email,
        'phone', u.phone,
        'created_at', u.created_at
      ) AS user,
      COALESCE(
        jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', oi.id,
            'variant_id', oi.variant_id,
            'qty', oi.qty,
            'price', oi.price,
            'vendor_id', oi.vendor_id,
            'invoice_pdf_path', o.invoice_pdf_path,
            'product', jsonb_build_object(
              'id', p.id,
              'name', p.name,
              'product_sku', p.product_sku,
              'product_img', p.product_img
            ),
            'variant', jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'price', pv.price,
              'mrp', pv.mrp,
              'stock', pv.stock,
              'images', pv.images
            )
          )
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL
    LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
    LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
    WHERE o.id = $1 AND o.user_id = $2 AND o.deleted_at IS NULL
    GROUP BY 
      o.id,
      u.id, u.full_name, u.email, u.phone, u.created_at
    LIMIT 1
    `,
      [order_id, user_id]
    );

    if (!rows.length) return null;

    const r = rows[0];
    return {
      id: r.id,
      order_no: r.order_no,
      user_id: r.user_id,
      vendor_id: r.vendor_id,

      coupon_code: r.coupon_code,
      discount: r.discount !== null ? Number(r.discount) : 0,
      currency: r.currency,
      exchange_rate: r.exchange_rate !== null ? Number(r.exchange_rate) : null,
      currency_symbol: r.currency_symbol,

      total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
      payment_status: r.payment_status,
      order_status: r.order_status,
      shipping_address: r.shipping_address,
      billing_address: r.billing_address,
      created_at: r.created_at,
      updated_at: r.updated_at,
      user: r.user,
      items: r.items.map((it) => ({
        id: it.id,
        variant_id: it.variant_id,
        qty: it.qty,
        price: it.price !== null ? Number(it.price) : null,
        vendor_id: it.vendor_id,
        product: it.product,
        variant: it.variant,
      })),
    };
  },

  async getOrGenerateInvoice({ user_id, order_id }, client, res) {
    // 1️⃣ Fetch order
    const { rows } = await client.query(
      `SELECT id, user_id, order_no, invoice_pdf_path
       FROM orders
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [order_id, user_id]
    );

    if (rows.length === 0) throw new Error("Order not found");

    const order = rows[0];
    const invoicesDir = path.join(__dirname, "../../uploads/invoices");
    const pdfFileName = `invoice-${order.id}.pdf`;
    const pdfFullPath = path.join(invoicesDir, pdfFileName);

    // 2️⃣ If already exists → download
    if (order.invoice_pdf_path && fs.existsSync(pdfFullPath)) {
      return pdfFullPath;
    }

    // 3️⃣ Else Generate New Invoice
    const { rows: items } = await client.query(
      `
      SELECT 
        p.name AS name,
        pv.sku,
        pv.normalized_size AS size,
        oi.qty,
        oi.price,
        o.total_amount,
        o.payment_status,
        o.order_no,
        o.created_at,
        u.full_name AS customer_name,
        u.email AS customer_email
      FROM order_items oi
      JOIN product_variants pv ON pv.id = oi.variant_id
      JOIN products p ON p.id = pv.product_id
      JOIN orders o ON o.id = oi.order_id
      JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      `,
      [order_id]
    );

    if (items.length === 0) throw new Error("Order items not found");

    const invoiceData = {
      orderId: order.order_no,
      orderDate: new Date(items[0].created_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      invoiceStatus: "PAID",
      paymentStatus: items[0].payment_status,
      subtotal: items
        .reduce((acc, item) => acc + item.price * item.qty, 0)
        .toFixed(2),
      shipping: "0.00",
      grandTotal: items
        .reduce((acc, item) => acc + item.price * item.qty, 0)
        .toFixed(2),
      company: {
        name: "FTVAAYEU",
        address:
          "Office 304, Al Saqr Tower Sheikh Zayed Road, Trade Centre 1 Dubai",
        email: "support@ftvaayeu.com",
        phone: "+971-50-1234567",
        logo: "https://yourdomain.com/files/logo.png",
      },
      customer: {
        name: items[0].customer_name,
        email: items[0].customer_email,
        address: "Address not available",
        phone: "N/A",
      },
      items: items.map((i) => ({
        sku: i.sku,
        product_name: i.name,
        size: i.size || "-",
        qty: i.qty,
        unitPrice: Number(i.price).toFixed(2),
        total: (i.qty * Number(i.price)).toFixed(2),
      })),
    };

    // 4️⃣ Generate HTML
    const html = generateInvoiceHTML(invoiceData);

    // 5️⃣ Ensure Directory
    if (!fs.existsSync(invoicesDir))
      fs.mkdirSync(invoicesDir, { recursive: true });

    // 6️⃣ Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({ path: pdfFullPath, format: "A4", printBackground: true });
    await browser.close();

    // 7️⃣ Update DB with path
    const pdfRelativePath = `/uploads/invoices/${pdfFileName}`;
    await client.query(
      `UPDATE orders SET invoice_pdf_path = $1 WHERE id = $2`,
      [pdfRelativePath, order_id]
    );

    // 8️⃣ Download PDF
    return pdfFullPath;
  },

  async generateProductLink(product_id, client) {
    // 1️⃣ Fetch product
    const pRes = await client.query(
      `SELECT id, name, default_category_id FROM products WHERE id = $1 LIMIT 1`,
      [product_id]
    );

    if (pRes.rowCount === 0) return null;

    const product = pRes.rows[0];

    // 2️⃣ Slug
    const slug = slugify(product.name);

    // 3️⃣ Category name
    let category = "all";
    if (product.default_category_id) {
      const cRes = await client.query(
        `SELECT name FROM categories WHERE id = $1 LIMIT 1`,
        [product.default_category_id]
      );
      if (cRes.rowCount > 0) {
        category = cRes.rows[0].name.toLowerCase().replace(/\s+/g, "-");
      }
    }

    // 4️⃣ Final URL
    return `/shop/product/${slug}/${product.id}?cat=${category}`;
  },
};

module.exports = OrderService;
