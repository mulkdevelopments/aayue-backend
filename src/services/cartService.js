// src/services/cartService.js
const { randomUUID } = require("crypto");
const CartService = {
  /**
   * getOrCreateCartForUser - returns cart row for user (creates if missing)
   */
  async getOrCreateCartForUser(user_id, client) {
    // try find existing active cart (not soft-deleted)
    const { rows } = await client.query(
      `SELECT * FROM carts WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [user_id]
    );
    if (rows.length) return rows[0];

    const id = randomUUID();
    const ins = await client.query(
      `INSERT INTO carts (id, user_id, metadata, created_at) VALUES ($1,$2,$3, now()) RETURNING *`,
      [id, user_id, null]
    );
    return ins.rows[0];
  },

  /**
   * addItem - add variant to cart. If exists, increase qty by provided qty.
   * Returns current cart (enriched)
   */
  async addItem({ user_id, variant_id, qty = 1 }, client) {
    if (!user_id) throw new Error("user_id required");
    if (!variant_id) throw new Error("variant_id required");
    qty = Number(qty) || 1;
    if (qty <= 0) throw new Error("qty must be > 0");

    // Start transaction is responsibility of caller usually; we assume caller wraps (controllers below do)
    // But we still keep operations atomic here when used alone

    // Validate variant & fetch product/stock/price
    const variantRes = await client.query(
      `SELECT pv.id, pv.sku, pv.price, pv.mrp, pv.stock, pv.product_id, pv.images, p.name AS product_name
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.id = $1 AND pv.deleted_at IS NULL AND p.deleted_at IS NULL
       LIMIT 1`,
      [variant_id]
    );
    if (variantRes.rowCount === 0) throw new Error("Variant not found");
    const pv = variantRes.rows[0];
    if (pv.stock !== null && Number(pv.stock) < qty)
      throw new Error("Insufficient stock");

    // find applicable discount_percent (max) for the product if any active sale
    const discRes = await client.query(
      `SELECT MAX(discount_percent) AS discount_percent
       FROM sales s
       WHERE s.product_id = $1 AND s.deleted_at IS NULL AND s.active = true
         AND (s.start_at IS NULL OR s.start_at <= now())
         AND (s.end_at IS NULL OR s.end_at >= now())`,
      [pv.product_id]
    );
    const discount_percent = Number(discRes.rows[0].discount_percent || 0);

    // compute final price after discount (rounded to 2 decimals)
    const final_price = +(
      Number(pv.price) -
      (Number(pv.price) * discount_percent) / 100
    ).toFixed(2);

    // get/create cart
    const cart = await this.getOrCreateCartForUser(user_id, client);

    // upsert cart_item
    const existing = await client.query(
      `SELECT id, qty FROM cart_items WHERE cart_id = $1 AND variant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [cart.id, variant_id]
    );
    if (existing.rowCount) {
      const newQty = Number(existing.rows[0].qty) + qty;
      if (pv.stock !== null && newQty > pv.stock)
        throw new Error("Insufficient stock for requested total quantity");

      await client.query(
        `UPDATE cart_items SET qty = $1, price = $2 WHERE id = $3`,
        [newQty, final_price, existing.rows[0].id]
      );
    } else {
      // insert
      await client.query(
        `INSERT INTO cart_items (id, cart_id, variant_id, qty, price, created_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [randomUUID(), cart.id, variant_id, qty, final_price]
      );
    }

    // return enriched cart
    return await this.getCart({ user_id }, client);
  },

  /**
   * updateItem - set qty for an existing cart item
   */
  async updateItem({ user_id, item_id, qty }, client) {
    if (!user_id) throw new Error("user_id required");
    qty = Number(qty);
    if (!item_id) throw new Error("item_id required");
    if (!Number.isInteger(qty) || qty < 0)
      throw new Error("qty must be integer >= 0");

    // find cart
    const cart = await this.getOrCreateCartForUser(user_id, client);

    const { rows: itemRows } = await client.query(
      `SELECT ci.id, ci.qty, ci.variant_id, pv.stock, pv.price, pv.product_id
       FROM cart_items ci
       JOIN product_variants pv ON pv.id = ci.variant_id
       WHERE ci.id = $1 AND ci.cart_id = $2 AND ci.deleted_at IS NULL
       LIMIT 1`,
      [item_id, cart.id]
    );
    if (itemRows.length === 0) throw new Error("Cart item not found");

    const it = itemRows[0];

    if (qty === 0) {
      // remove
      await client.query(`DELETE FROM cart_items WHERE id = $1`, [item_id]);
    } else {
      if (it.stock !== null && qty > Number(it.stock))
        throw new Error("Insufficient stock");
      // re-evaluate sale price snapshot
      const discRes = await client.query(
        `SELECT MAX(discount_percent) AS discount_percent
         FROM sales s
         WHERE s.product_id = $1 AND s.deleted_at IS NULL AND s.active = true
           AND (s.start_at IS NULL OR s.start_at <= now())
           AND (s.end_at IS NULL OR s.end_at >= now())`,
        [it.product_id]
      );
      const discount_percent = Number(discRes.rows[0].discount_percent || 0);

      // compute final price from variant price
      const variantRes = await client.query(
        `SELECT price FROM product_variants WHERE id=$1`,
        [it.variant_id]
      );
      const variantPrice = variantRes.rows[0].price;
      const final_price = +(
        Number(variantPrice) -
        (Number(variantPrice) * discount_percent) / 100
      ).toFixed(2);

      await client.query(
        `UPDATE cart_items SET qty=$1, price=$2 WHERE id = $3`,
        [qty, final_price, item_id]
      );
    }

    return await this.getCart({ user_id }, client);
  },

  /**
   * removeItem - remove a cart item by id
   */
  async removeItem({ user_id, item_id }, client) {
    if (!user_id) throw new Error("user_id required");
    if (!item_id) throw new Error("item_id required");

    const cart = await this.getOrCreateCartForUser(user_id, client);

    await client.query(
      `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`,
      [item_id, cart.id]
    );

    return await this.getCart({ user_id }, client);
  },

  /**
   * clearCart - deletes all items for the user's cart
   */
  async clearCart({ user_id }, client) {
    if (!user_id) throw new Error("user_id required");
    const cart = await this.getOrCreateCartForUser(user_id, client);
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cart.id]);
    return { ok: true };
  },

  /**
   * getCart - returns enriched cart for user (items with calculated sale_price & totals)
   */
  async getCart({ user_id }, client) {
    if (!user_id) throw new Error("user_id required");

    const cart = await this.getOrCreateCartForUser(user_id, client);

    // ITEMS QUERY WITH price AS BASE PRICE (pv.price)
    const itemsSql = `
    SELECT
      ci.id AS cart_item_id,
      ci.qty,
      ci.price AS snapshot_price,

      pv.id AS variant_id,
      pv.sku,
      pv.price AS variant_price,      -- ✔ BASE PRICE (our selling price)
      pv.mrp,
      pv.stock,
      pv.images,
      pv.variant_size AS size,
      pv.variant_color AS color,
      pv.vendor_product_id,

      p.id AS product_id,
      p.name AS product_name,
      p.product_img,
      p.brand_name,
      p.gender,
      p.vendor_id,

      v.capabilities AS vendor_capabilities,

      COALESCE(smax.discount_percent, 0)::numeric AS discount_percent,

      -- ✔ DISCOUNT APPLIED ON pv.price
      ROUND(
        (pv.price * (1 - (COALESCE(smax.discount_percent,0) / 100)))::numeric,
        2
      ) AS sale_price,

      -- ✔ LINE TOTAL FROM UPDATED sale_price
      ROUND(
        (
          ROUND((pv.price * (1 - (COALESCE(smax.discount_percent,0) / 100)))::numeric, 2)
          * ci.qty
        )::numeric,
        2
      ) AS line_total

    FROM cart_items ci
    JOIN product_variants pv
      ON pv.id = ci.variant_id AND pv.deleted_at IS NULL
    JOIN products p
      ON p.id = pv.product_id AND p.deleted_at IS NULL

    LEFT JOIN vendors v ON v.id = (
      SELECT DISTINCT c2.vendor_id
      FROM product_categories pc2
      INNER JOIN categories c2 ON c2.id = pc2.category_id
      WHERE pc2.product_id = p.id AND pc2.deleted_at IS NULL
      LIMIT 1
    )

    LEFT JOIN LATERAL (
      SELECT MAX(discount_percent) AS discount_percent
      FROM sales s
      WHERE s.product_id = p.id
        AND s.deleted_at IS NULL
        AND s.active = true
        AND (s.start_at IS NULL OR s.start_at <= NOW())
        AND (s.end_at IS NULL OR s.end_at >= NOW())
    ) AS smax ON TRUE

    WHERE ci.cart_id = $1 AND ci.deleted_at IS NULL
    ORDER BY ci.created_at ASC
  `;

    const { rows: items } = await client.query(itemsSql, [cart.id]);

    // --------------------------------------
    // TOTALS CALCULATION (ALL UPDATED)
    // --------------------------------------
    let subtotal = 0;
    let discount_total = 0;
    let total_items = 0;

    for (const it of items) {
      const basePrice = Number(it.variant_price); // pv.price (our selling price)
      const finalSale = Number(it.sale_price);

      subtotal += basePrice * Number(it.qty);
      discount_total += (basePrice - finalSale) * Number(it.qty);
      total_items += Number(it.qty);
    }

    const total_payable = +(subtotal - discount_total).toFixed(2);

    // --------------------------------------
    // FINAL CART RESPONSE
    // --------------------------------------
    return {
      cart_id: cart.id,
      user_id: cart.user_id,

      items: items.map((it) => ({
        cart_item_id: it.cart_item_id,

        variant_id: {
          id: it.variant_id,
          size: it.size,
          color: it.color,
        },

        sku: it.sku,

        product: {
          id: it.product_id,
          name: it.product_name,
          image: it.product_img,
        },

        qty: Number(it.qty),

        variant_price: Number(it.variant_price),  // ✔ now pv.price (our selling price)
        sale_price: Number(it.sale_price),
        discount_percent: Number(it.discount_percent),

        line_total: Number(it.line_total),

        stock: it.stock,
        images: it.images,
        brand_name: it.brand_name,
        gender: it.gender,
        vendorId: it.vendor_id,
        vendor_product_id: it.vendor_product_id,
        vendor_capabilities: it.vendor_capabilities,
      })),

      subtotal: +subtotal.toFixed(2),
      discount_total: +discount_total.toFixed(2),
      total_items,
      total_payable,
    };
  },


  /*   async getCart({ user_id }, client) {
      if (!user_id) throw new Error("user_id required");
  
      const cart = await this.getOrCreateCartForUser(user_id, client);
  
      // build items with live sale price via lateral join for discount_percent
      const itemsSql = `
        SELECT
          ci.id AS cart_item_id,
          ci.qty,
          ci.price AS snapshot_price,
          pv.id AS variant_id,
          pv.sku,
          pv.price AS variant_price,
          pv.mrp,
          pv.stock,
          pv.images,
          pv.variant_size AS size,
          pv.variant_color AS color,
          p.id AS product_id,
          p.name AS product_name,
          p.product_img,
          p.brand_name,
          p.gender,
          p.vendor_id,
          COALESCE(smax.discount_percent, 0)::numeric AS discount_percent,
          ROUND((pv.price - (pv.price * COALESCE(smax.discount_percent,0) / 100))::numeric, 2) AS sale_price,
          ROUND( (ROUND((pv.price - (pv.price * COALESCE(smax.discount_percent,0) / 100))::numeric, 2) * ci.qty)::numeric, 2) AS line_total
        FROM cart_items ci
        JOIN product_variants pv ON pv.id = ci.variant_id AND pv.deleted_at IS NULL
        JOIN products p ON p.id = pv.product_id AND p.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT MAX(discount_percent) AS discount_percent
          FROM sales s
          WHERE s.product_id = p.id AND s.deleted_at IS NULL AND s.active = true
            AND (s.start_at IS NULL OR s.start_at <= now())
            AND (s.end_at IS NULL OR s.end_at >= now())
        ) smax ON true
        WHERE ci.cart_id = $1 AND ci.deleted_at IS NULL
        ORDER BY ci.created_at ASC
      `;
  
      const { rows: items } = await client.query(itemsSql, [cart.id]);
  
      // compute totals
      let subtotal = 0;
      let discount_total = 0;
      let total_items = 0;
      for (const it of items) {
        subtotal += Number(it.variant_price) * Number(it.qty);
        const lineSale = Number(it.sale_price) * Number(it.qty);
        const lineNormal = Number(it.variant_price) * Number(it.qty);
        discount_total += lineNormal - lineSale;
        total_items += Number(it.qty);
      }
      const total_payable = +(subtotal - discount_total).toFixed(2);
  
      return {
        cart_id: cart.id,
        user_id: cart.user_id,
        items: items.map((it) => ({
          cart_item_id: it.cart_item_id,
          variant_id: {
            id: it.variant_id,
            size: it.size,
            color: it.color,
          },
          sku: it.sku,
          product: {
            id: it.product_id,
            name: it.product_name,
            image: it.product_img,
          },
          qty: Number(it.qty),
          variant_price: Number(it.variant_price),
          sale_price: Number(it.sale_price),
          discount_percent: Number(it.discount_percent),
          line_total: Number(it.line_total),
          stock: it.stock,
          images: it.images,
          brand_name: it.brand_name,
          gender: it.gender,
          vendorId: it.vendor_id,
        })),
        subtotal: +subtotal.toFixed(2),
        discount_total: +discount_total.toFixed(2),
        total_items,
        total_payable,
      };
    }, */
  /**
   * 
   * syncGuestCart - merges guest localStorage cart items into user cart on login
   *  - If item already exists → increment qty
   *  - If new → insert
   *  - Validates variant stock before adding
   */
  /*   async syncGuestCart({ user_id, items }, client) {
      if (!user_id) throw new Error("user_id required");
      if (!Array.isArray(items)) throw new Error("Invalid cart items");
  
      // Get or create cart for logged-in user
      const cart = await this.getOrCreateCartForUser(user_id, client);
  
      for (const it of items) {
        const variant_id = it.variant_id.id;
        const qty = Number(it.qty) || 1;
  
        if (!variant_id || qty <= 0) continue;
  
        // Validate variant
        const variantRes = await client.query(
          `SELECT pv.id, pv.stock, pv.price, pv.product_id
               FROM product_variants pv
               JOIN products p ON p.id = pv.product_id
               WHERE pv.id = $1 AND pv.deleted_at IS NULL AND p.deleted_at IS NULL
               LIMIT 1`,
          [variant_id]
        );
        if (variantRes.rowCount === 0) continue;
        const pv = variantRes.rows[0];
  
        if (pv.stock !== null && pv.stock < qty) continue; // skip if insufficient stock
  
        // Find existing cart item
        const existing = await client.query(
          `SELECT id, qty FROM cart_items WHERE cart_id = $1 AND variant_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [cart.id, variant_id]
        );
  
        // Get max discount if active
        const discRes = await client.query(
          `SELECT MAX(discount_percent) AS discount_percent
               FROM sales s
               WHERE s.product_id = $1 AND s.deleted_at IS NULL AND s.active = true
                 AND (s.start_at IS NULL OR s.start_at <= now())
                 AND (s.end_at IS NULL OR s.end_at >= now())`,
          [pv.product_id]
        );
        const discount_percent = Number(discRes.rows[0].discount_percent || 0);
        const sale_price = +(
          pv.price -
          pv.price * (discount_percent / 100)
        ).toFixed(2);
  
        if (existing.rowCount) {
          // update quantity (sum)
          const newQty = Number(existing.rows[0].qty) + qty;
          if (pv.stock !== null && newQty > pv.stock) continue; // skip if overstock
          await client.query(
            `UPDATE cart_items SET qty = $1, price = $2 WHERE id = $3`,
            [newQty, sale_price, existing.rows[0].id]
          );
        } else {
          // insert new item
          await client.query(
            `INSERT INTO cart_items (id, cart_id, variant_id, qty, price, created_at)
                   VALUES ($1, $2, $3, $4, $5, now())`,
            [randomUUID(), cart.id, variant_id, qty, sale_price]
          );
        }
      }
  
      // return merged cart
      return await this.getCart({ user_id }, client);
    }, */

  async syncGuestCart({ user_id, items }, client) {
    if (!user_id) throw new Error("user_id required");
    if (!Array.isArray(items)) throw new Error("Invalid cart items");

    // Get or create cart for logged-in user
    const cart = await this.getOrCreateCartForUser(user_id, client);

    for (const it of items) {
      const variant_id = it.variant_id.id;
      const qty = Number(it.qty) || 1;

      if (!variant_id || qty <= 0) continue;

      // Validate variant
      const variantRes = await client.query(
        `SELECT pv.id, pv.stock, pv.price, pv.product_id, pv.mrp
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.id = $1 AND pv.deleted_at IS NULL AND p.deleted_at IS NULL
       LIMIT 1`,
        [variant_id]
      );

      if (variantRes.rowCount === 0) continue;
      const pv = variantRes.rows[0];

      if (pv.stock !== null && pv.stock < qty) continue; // skip if insufficient stock

      // Find existing cart item
      const existing = await client.query(
        `SELECT id, qty
       FROM cart_items
       WHERE cart_id = $1 AND variant_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
        [cart.id, variant_id]
      );

      // Get max discount if active
      const discRes = await client.query(
        `SELECT MAX(discount_percent) AS discount_percent
       FROM sales s
       WHERE s.product_id = $1
         AND s.deleted_at IS NULL
         AND s.active = true
         AND (s.start_at IS NULL OR s.start_at <= NOW())
         AND (s.end_at IS NULL OR s.end_at >= NOW())`,
        [pv.product_id]
      );

      const discount_percent = Number(discRes.rows[0].discount_percent || 0);

      // -------------------------
      // Correct Final Price Logic
      // -------------------------
      let final_price;

      if (discount_percent > 0) {
        final_price = +(
          pv.price * (1 - discount_percent / 100)
        ).toFixed(2);
      } else {
        final_price = pv.price; // use original price
      }

      console.log({ discount_percent, original_price: pv.price, final_price });

      if (existing.rowCount) {
        // update quantity (sum)
        const newQty = Number(existing.rows[0].qty) + qty;

        if (pv.stock !== null && newQty > pv.stock) continue; // skip if overstock

        await client.query(
          `UPDATE cart_items
         SET qty = $1, price = $2
         WHERE id = $3`,
          [newQty, final_price, existing.rows[0].id]
        );
      } else {
        // insert new item
        await client.query(
          `INSERT INTO cart_items (id, cart_id, variant_id, qty, price, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
          [randomUUID(), cart.id, variant_id, qty, final_price]
        );
      }
    }

    // return merged cart
    return await this.getCart({ user_id }, client);
  }

};

module.exports = CartService;
