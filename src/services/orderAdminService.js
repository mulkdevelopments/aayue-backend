// services/orderAdminService.js
const { randomUUID } = require("crypto");
const OrderAdminService = {
  /**
   * listOrders - admin listing with filters & pagination
   * returns { total, orders: [ {order..., items: [...] } ] }
   */
  async listOrders(opts, client) {
    const {
      page = 1,
      limit = 20,
      offset = 0,
      payment_status,
      order_status,
      vendor_id,
      user_id,
      from_date,
      to_date,
      q,
    } = opts;

    const where = ["o.deleted_at IS NULL"];
    const params = [];
    let i = 1;

    if (q) {
      where.push(`(o.order_no ILIKE $${i} OR o.id::text = $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    if (payment_status) {
      where.push(`o.payment_status = $${i}`);
      params.push(payment_status);
      i++;
    }

    if (order_status) {
      where.push(`o.order_status = $${i}`);
      params.push(order_status);
      i++;
    }

    if (vendor_id) {
      where.push(`o.vendor_id = $${i}`);
      params.push(vendor_id);
      i++;
    }

    if (user_id) {
      where.push(`o.user_id = $${i}`);
      params.push(user_id);
      i++;
    }

    if (from_date) {
      where.push(`o.created_at >= $${i}`);
      params.push(from_date);
      i++;
    }
    if (to_date) {
      where.push(`o.created_at <= $${i}`);
      params.push(to_date);
      i++;
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // count
    const countSql = `SELECT COUNT(1) AS total FROM orders o ${whereSQL}`;
    const { rows: countRows } = await client.query(countSql, params);
    const total = parseInt(countRows[0]?.total || 0, 10);
    if (total === 0) return { total: 0, orders: [] };

    // main query: aggregate items + product/variant info
    const paramsMain = params.slice();
    paramsMain.push(limit);
    paramsMain.push(offset);

    const mainSql = `
      SELECT
        o.id, o.order_no, o.user_id, o.vendor_id, o.total_amount, o.payment_status, o.order_status,
        o.shipping_address, o.billing_address, o.created_at, o.coupon_code, o.coupon_id, o.discount,
        o.currency, o.exchange_rate, o.base_currency, o.currency_symbol, 
        COALESCE(jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', oi.id,
            'variant_id', oi.variant_id,
            'qty', oi.qty,
            'price', oi.price,
            'vendor_id', oi.vendor_id,
            'product', jsonb_build_object('id', p.id, 'name', p.name, 'product_sku', p.product_sku, 'product_img', p.product_img),
            'variant', jsonb_build_object('id', pv.id, 'sku', pv.sku, 'price', pv.price, 'mrp', pv.mrp, 'stock', pv.stock, 'images', pv.images)
          )
        ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
      LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
      ${whereSQL}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${paramsMain.length - 1} OFFSET $${paramsMain.length};
    `;

    const { rows: orderRows } = await client.query(mainSql, paramsMain);

    // normalize
    const orders = orderRows.map((r) => ({
      id: r.id,
      order_no: r.order_no,
      user_id: r.user_id,
      vendor_id: r.vendor_id,
      total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
      payment_status: r.payment_status,
      order_status: r.order_status,
      shipping_address: r.shipping_address,
      billing_address: r.billing_address,
      created_at: r.created_at,
      coupon_code: r.coupon_code,
      coupon_id: r.coupon_id,
      discount: r.discount !== null ? Number(r.discount) : null,
      currency: r.currency,
      exchange_rate: r.exchange_rate !== null ? Number(r.exchange_rate) : null,
      base_currency: r.base_currency,
      currency_symbol: r.currency_symbol,
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

  async listOrdersDashboard(opts, client) {
    const {
      page = 1,
      limit = 20,
      offset = 0,
      payment_status,
      order_status,
      vendor_id,
      user_id,
      from_date,
      to_date,
      q,
    } = opts;

    const where = ["o.deleted_at IS NULL"];
    const params = [];
    let i = 1;

    // 🔍 Search filter
    if (q) {
      where.push(`(o.order_no ILIKE $${i} OR o.id::text = $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    // 💰 Payment status filter
    if (payment_status) {
      where.push(`o.payment_status = $${i}`);
      params.push(payment_status);
      i++;
    }

    // 📦 Order status filter
    if (order_status) {
      where.push(`o.order_status = $${i}`);
      params.push(order_status);
      i++;
    }

    // 🏪 Vendor filter
    if (vendor_id) {
      where.push(`o.vendor_id = $${i}`);
      params.push(vendor_id);
      i++;
    }

    // 👤 User filter
    if (user_id) {
      where.push(`o.user_id = $${i}`);
      params.push(user_id);
      i++;
    }

    // 📅 Date range filters
    if (from_date) {
      where.push(`o.created_at >= $${i}`);
      params.push(from_date);
      i++;
    }

    if (to_date) {
      where.push(`o.created_at <= $${i}`);
      params.push(to_date);
      i++;
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // 📊 Count total orders
    const countSql = `SELECT COUNT(1) AS total FROM orders o ${whereSQL}`;
    const { rows: countRows } = await client.query(countSql, params);
    const total = parseInt(countRows[0]?.total || 0, 10);
    if (total === 0) return { total: 0, orders: [] };

    // 🧮 Pagination params
    const paramsMain = params.slice();
    paramsMain.push(limit);
    paramsMain.push(offset);

    // 🧠 Detect if no filters applied
    const noFilters =
      !q &&
      !payment_status &&
      !order_status &&
      !vendor_id &&
      !user_id &&
      !from_date &&
      !to_date;

    // 🧾 Dynamic ORDER BY condition
    // agar koi filter nahi hai → paid orders first
    const orderBySQL = noFilters
      ? `ORDER BY 
        CASE 
          WHEN o.payment_status = 'paid' THEN 1
          ELSE 2
        END,
        o.created_at DESC`
      : `ORDER BY o.created_at DESC`;

    // 📦 Main query
    const mainSql = `
    SELECT
      o.id, o.order_no, o.user_id, o.vendor_id, o.total_amount, o.payment_status, o.order_status,
      o.shipping_address, o.billing_address, o.created_at, o.coupon_code, o.coupon_id, o.discount,
      o.currency, o.exchange_rate, o.base_currency, o.currency_symbol,
      COALESCE(jsonb_agg(
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
      ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
    LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
    LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
    ${whereSQL}
    GROUP BY o.id
    ${orderBySQL}
    LIMIT $${paramsMain.length - 1} OFFSET $${paramsMain.length};
  `;

    const { rows: orderRows } = await client.query(mainSql, paramsMain);

    // 🧹 Normalize response
    const orders = orderRows.map((r) => ({
      id: r.id,
      order_no: r.order_no,
      user_id: r.user_id,
      vendor_id: r.vendor_id,
      total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
      payment_status: r.payment_status,
      order_status: r.order_status,
      shipping_address: r.shipping_address,
      billing_address: r.billing_address,
      created_at: r.created_at,
      coupon_code: r.coupon_code,
      coupon_id: r.coupon_id,
      discount: r.discount !== null ? Number(r.discount) : null,
      currency: r.currency,
      exchange_rate: r.exchange_rate !== null ? Number(r.exchange_rate) : null,
      base_currency: r.base_currency,
      currency_symbol: r.currency_symbol,
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
   * getOrderById - returns full order info for admin (including items)
   */
  /* async getOrderById(orderId, client) {
        const sql = `
      SELECT
        o.*,
        COALESCE(jsonb_agg(
          DISTINCT jsonb_build_object(
            'id', oi.id,
            'variant_id', oi.variant_id,
            'qty', oi.qty,
            'price', oi.price,
            'vendor_id', oi.vendor_id,
            'product', jsonb_build_object('id', p.id, 'name', p.name, 'product_sku', p.product_sku, 'product_img', p.product_img),
            'variant', jsonb_build_object('id', pv.id, 'sku', pv.sku, 'price', pv.price, 'mrp', pv.mrp, 'stock', pv.stock, 'images', pv.images)
          )
        ) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
      LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
      WHERE o.id = $1 AND o.deleted_at IS NULL
      GROUP BY o.id
      LIMIT 1
    `;
        const { rows } = await client.query(sql, [orderId]);
        if (!rows || rows.length === 0) return null;

        const r = rows[0];
        return {
            id: r.id,
            order_no: r.order_no,
            user_id: r.user_id,
            vendor_id: r.vendor_id,
            total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
            payment_status: r.payment_status,
            order_status: r.order_status,
            shipping_address: r.shipping_address,
            billing_address: r.billing_address,
            created_at: r.created_at,
            items: (r.items || []).map(it => ({
                id: it.id,
                variant_id: it.variant_id,
                qty: it.qty,
                price: it.price !== null ? Number(it.price) : null,
                vendor_id: it.vendor_id,
                product: it.product || null,
                variant: it.variant || null
            }))
        };
    }, 
    */

  // async getOrderById(orderId, client) {
  //   const sql = `
  //   SELECT
  //     o.*,
  //     jsonb_build_object(
  //       'id', u.id,
  //       'name', u.full_name,
  //       'email', u.email,
  //       'mobile', u.phone
  //     ) AS "user",
  //     jsonb_build_object(
  //       'id', v.id,
  //       'name', v.name,
  //       'slug', v.slug
  //     ) AS vendor,
  //     jsonb_build_object(
  //       'id', pay.id,
  //       'amount', pay.amount,
  //       'method', pay.method,
  //       'status', pay.status,
  //       'provider_response', pay.provider_response,
  //       'created_at', pay.created_at
  //     ) AS payment,
  //     COALESCE(
  //       jsonb_agg(
  //         DISTINCT jsonb_build_object(
  //           'id', oi.id,
  //           'variant_id', oi.variant_id,
  //           'qty', oi.qty,
  //           'price', oi.price,
  //           'vendor_id', oi.vendor_id,
  //           'product', jsonb_build_object(
  //             'id', p.id,
  //             'name', p.name,
  //             'product_sku', p.product_sku,
  //             'product_img', p.product_img,
  //             'is_newest', p.is_newest,
  //            'is_our_picks', p.is_our_picks
  //           ),
  //           'variant', jsonb_build_object(
  //             'id', pv.id,
  //             'sku', pv.sku,
  //             'price', pv.price,
  //             'sale_price', pv.sale_price,
  //             'stock', pv.stock,
  //             'images', pv.images,
  //             'mrp', pv.mrp,
  //             'vendorsaleprice', pv.vendorsaleprice,
  //             'vendormrp', pv.vendormrp
  //           )
  //         )
  //       ) FILTER (WHERE oi.id IS NOT NULL),
  //       '[]'
  //     ) AS items
  //   FROM orders o
  //   LEFT JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL
  //   LEFT JOIN vendors v ON v.id = o.vendor_id AND v.deleted_at IS NULL
  //   LEFT JOIN payments pay ON pay.order_id = o.id AND pay.deleted_at IS NULL
  //   LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
  //   LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
  //   LEFT JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
  //   WHERE o.id = $1 AND o.deleted_at IS NULL
  //   GROUP BY o.id, u.id, v.id, pay.id
  //   LIMIT 1
  // `;

  //   const { rows } = await client.query(sql, [orderId]);
  //   if (!rows || rows.length === 0) return null;

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
  //     user: r.user || null,
  //     vendor: r.vendor || null,
  //     payment: r.payment || null, // ✅ Added payment info here
  //     items: (r.items || []).map((it) => ({
  //       id: it.id,
  //       variant_id: it.variant_id,
  //       qty: it.qty,
  //       price: it.price !== null ? Number(it.price) : null,
  //       vendor_id: it.vendor_id,
  //       product: it.product || null,
  //       variant: it.variant || null,
  //     })),
  //   };
  // },

  async getOrderById(orderId, client) {
    const sql = `
SELECT
  o.*,
  COALESCE(
    jsonb_build_object(
      'id', u.id,
      'name', u.full_name,
      'email', u.email,
      'mobile', u.phone
    ), '{}'::jsonb
  ) AS "user",
  COALESCE(
    jsonb_build_object(
      'id', pay.id,
      'amount', pay.amount,
      'method', pay.method,
      'status', pay.status,
      'transaction_id', pay.stripe_charge_id,
      'refrence_no', pay.transaction_reference,
      'currency', pay.currency,
      'created_at', pay.created_at
    ), '{}'::jsonb
  ) AS payment,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'id', oi.id,
        'variant_id', oi.variant_id,
        'qty', oi.qty,
        'price', oi.price,
        'product_link', oi.product_link,
        'vendor_id', prod.vendor_id,
        'vendor_order_status', oi.vendor_order_status,
        'vendor_order_id', oi.vendor_order_id,
        'vendor_reference_number', oi.vendor_reference_number,
        'vendor_paid_at', oi.vendor_paid_at,
        'tracking_codes', oi.tracking_codes,
        'product', jsonb_build_object(
          'id', prod.id,
          'name', prod.name,
          'product_sku', prod.product_sku,
          'product_img', prod.product_img,
          'is_newest', prod.is_newest,
          'is_our_picks', prod.is_our_picks
        ),
        'variant', jsonb_build_object(
          'id', pv.id,
          'sku', pv.sku,
          'price', pv.price,
          'mrp', pv.mrp,
          'stock', pv.stock,
          'images', pv.images,
          'vendorsaleprice', pv.vendorsaleprice,
          'vendormrp', pv.vendormrp
        ),
        'vendor', jsonb_build_object(
          'id', v.id,
          'name', v.name,
          'slug', v.slug,
          'contact_email', v.contact_email,
          'merchant_dashboard_url', v.merchant_dashboard_url
        )
      )
    ) FILTER (WHERE oi.id IS NOT NULL),
    '[]'
  ) AS items
FROM orders o
LEFT JOIN users u ON u.id = o.user_id
LEFT JOIN payments pay ON pay.order_id = o.id AND pay.deleted_at IS NULL
LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
LEFT JOIN products prod ON prod.id = pv.product_id AND prod.deleted_at IS NULL
LEFT JOIN vendors v ON v.id = prod.vendor_id AND v.deleted_at IS NULL
WHERE o.id = $1
  AND o.deleted_at IS NULL
  AND (u.deleted_at IS NULL OR u.deleted_at IS NOT NULL) -- ensure user still joins
GROUP BY o.id, u.id, pay.id
LIMIT 1;
`;

    //   const sql = `
    //   SELECT
    //     o.*,
    //     jsonb_build_object(
    //       'id', u.id,
    //       'name', u.full_name,
    //       'email', u.email,
    //       'mobile', u.phone
    //     ) AS "user",
    //     jsonb_build_object(
    //       'id', pay.id,
    //       'amount', pay.amount,
    //       'method', pay.method,
    //       'status', pay.status,
    //       'transaction_id', pay.stripe_charge_id,
    //       'refrence_no', pay.transaction_reference,
    //       'currency', pay.currency,
    //       'created_at', pay.created_at
    //     ) AS payment,
    //     COALESCE(
    //       jsonb_agg(
    //         DISTINCT jsonb_build_object(
    //           'id', oi.id,
    //           'variant_id', oi.variant_id,
    //           'qty', oi.qty,
    //           'price', oi.price,
    //           'vendor_id', prod.vendor_id, -- ✅ take vendor_id from product
    //           'product', jsonb_build_object(
    //             'id', prod.id,
    //             'name', prod.name,
    //             'product_sku', prod.product_sku,
    //             'product_img', prod.product_img,
    //             'is_newest', prod.is_newest,
    //             'is_our_picks', prod.is_our_picks
    //           ),
    //           'variant', jsonb_build_object(
    //             'id', pv.id,
    //             'sku', pv.sku,
    //             'price', pv.price,
    //             'sale_price', pv.sale_price,
    //             'stock', pv.stock,
    //             'images', pv.images,
    //             'mrp', pv.mrp,
    //             'vendorsaleprice', pv.vendorsaleprice,
    //             'vendormrp', pv.vendormrp
    //           ),
    //           -- ✅ add vendor details inside each item
    //           'vendor', jsonb_build_object(
    //             'id', v.id,
    //             'name', v.name,
    //             'slug', v.slug,
    //             'contact_email', v.contact_email
    //           )
    //         )
    //       ) FILTER (WHERE oi.id IS NOT NULL),
    //       '[]'
    //     ) AS items
    //   FROM orders o
    //   LEFT JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL
    //   LEFT JOIN payments pay ON pay.order_id = o.id AND pay.deleted_at IS NULL
    //   LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.deleted_at IS NULL
    //   LEFT JOIN product_variants pv ON pv.id = oi.variant_id AND pv.deleted_at IS NULL
    //   LEFT JOIN products prod ON prod.id = pv.product_id AND prod.deleted_at IS NULL
    //   LEFT JOIN vendors v ON v.id = prod.vendor_id AND v.deleted_at IS NULL -- ✅ correct vendor join
    //   WHERE o.id = $1 AND o.deleted_at IS NULL
    //   GROUP BY o.id, u.id, pay.id
    //   LIMIT 1;
    // `;

    const { rows } = await client.query(sql, [orderId]);
    console.log("getOrderById - rows:", rows);
    if (!rows || rows.length === 0) return null;

    const r = rows[0];
    return {
      id: r.id,
      order_no: r.order_no,
      user_id: r.user_id,
      invoice_pdf_path: r?.invoice_pdf_path,
      coupon_code: r?.coupon_code,
      coupon_id: r?.coupon_id,
      discount: r.discount !== null ? Number(r.discount) : null,
      total_amount: r.total_amount !== null ? Number(r.total_amount) : null,
      payment_status: r.payment_status,
      order_status: r.order_status,
      shipping_address: r.shipping_address,
      billing_address: r.billing_address,
      created_at: r.created_at,
      updated_at: r.updated_at,
      currency: r.currency,
      exchange_rate: r.exchange_rate !== null ? Number(r.exchange_rate) : null,
      base_currency: r.base_currency,
      currency_symbol: r.currency_symbol,
      user: r.user || null,
      payment: r.payment || null,
      items: (r.items || []).map((it) => ({
        id: it.id,
        variant_id: it.variant_id,
        qty: it.qty,
        price: it.price !== null ? Number(it.price) : null,
        product: it.product || null,
        variant: it.variant || null,
        vendor: it.vendor || null, // ✅ vendor info per item
        product_link: it.product_link || null,
        vendor_order_status: it.vendor_order_status || 'pending',
        vendor_order_id: it.vendor_order_id || null,
        vendor_reference_number: it.vendor_reference_number || null,
        vendor_paid_at: it.vendor_paid_at || null,
        tracking_codes: it.tracking_codes || [],
      })),
    };
  },

  /**
   * updateOrderStatus - admin updates order_status and/or payment_status
   * Also records an audit row in audit_logs (optional)
   */
  async updateOrderStatus(
    { order_id, order_status, payment_status, note },
    client
  ) {
    // lock order row
    const { rows: existing } = await client.query(
      "SELECT id, order_status, payment_status FROM orders WHERE id = $1 FOR UPDATE",
      [order_id]
    );
    if (existing.length === 0) throw new Error("Order not found");

    const updatedFields = [];
    const params = [];
    let i = 1;

    if (order_status !== undefined && order_status !== null) {
      updatedFields.push(`order_status = $${i}`);
      params.push(order_status);
      i++;
    }
    if (payment_status !== undefined && payment_status !== null) {
      updatedFields.push(`payment_status = $${i}`);
      params.push(payment_status);
      i++;
    }

    if (updatedFields.length === 0)
      return { ok: false, message: "Nothing to update" };

    params.push(order_id); // last param
    const updateSQL = `UPDATE orders SET ${updatedFields.join(
      ", "
    )} WHERE id = $${i} RETURNING *`;
    const { rows: updatedRows } = await client.query(updateSQL, params);

    // Optional: insert audit log
    try {
      await client.query(
        `INSERT INTO audit_logs (id, table_name, record_id, action, payload, performed_by, created_at) VALUES ($1,$2,$3,$4,$5,$6, now())`,
        [
          randomUUID(),
          "orders",
          order_id,
          "admin_update_status",
          JSON.stringify({ order_status, payment_status, note }),
          null,
        ]
      );
    } catch (e) {
      // don't fail main flow if audit fails
      console.warn("audit log insert failed", e.message || e);
    }

    // return updated order
    return this.getOrderById(order_id, client);
  },
};

module.exports = OrderAdminService;
