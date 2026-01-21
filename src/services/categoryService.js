const dbPool = require("../db/dbConnection");
const categoryQueries = require("../dbQueries/categoryQueries");
const AppError = require("../errorHandling/AppError");
const { v4: uuidv4 } = require("uuid");

const CategoryService = {
    // fetch category by id (useful for validation)
    async getCategoryById(id, client) {
        const { rows } = await client.query(categoryQueries.getById, [id]);
        return rows[0] || null;
    },

    // create category,, maintaining nested-set (lft/rgt) and path.
    //
    // rules:
    // - if parent_id provided: insert as last child of parent (parent.rgt)
    // - if no parent: append as new root at max_rgt+1
    //
    // returns created category row.
    async createCategory({ name, slug, parent_id = null, metadata = null, is_active = true, is_our_category = false, our_category = null, priority, image_url }, client) {
        const id = uuidv4();

        if (parent_id) {
            const { rows: parentRows } = await client.query(categoryQueries.getById, [parent_id]);
            const parent = parentRows[0];
            if (!parent) throw new Error('Parent not found during insertion');

            const insertAt = parent.rgt;
            await client.query(categoryQueries.updateShiftRight, [insertAt]);
            await client.query(categoryQueries.updateShiftLeft, [insertAt]);

            const path = (parent.path ? `${parent.path}/${slug}` : `${parent.slug}/${slug}`);
            const lft = insertAt;
            const rgt = insertAt + 1;

            const { rows } = await client.query(categoryQueries.insertCategory, [
                id,
                name,
                slug,
                parent_id,
                lft,
                rgt,
                path,
                is_active,
                metadata ? JSON.stringify(metadata) : null,
                our_category,
                is_our_category,
                priority,
                image_url
            ]);
            return rows[0];
        } else {
            const { rows } = await client.query(categoryQueries.getMaxRgt);
            const maxRgt = Number(rows[0].max_rgt || 0);
            const lft = maxRgt + 1;
            const rgt = maxRgt + 2;
            const path = slug; // root path
            const result = await client.query(categoryQueries.insertCategory, [
                id,
                name,
                slug,
                null,
                lft,
                rgt,
                path,
                is_active,
                metadata ? JSON.stringify(metadata) : null,
                our_category,
                is_our_category,
                priority,
                image_url  // ✅ Added missing image_url parameter
            ]);
            return result.rows[0];
        }
    },
    // service
    async getOnlyOurCategories(client) {
        const { rows } = await client.query(`
        SELECT id, name, slug, parent_id, lft, rgt, path, is_active, metadata, our_category, is_our_category,priority
        FROM categories
        WHERE deleted_at IS NULL
          AND is_our_category = TRUE
        ORDER BY priority ASC
      `);
        return rows;
    },

    async getAllOurCategories(client, isOurCategory = null) {
        let query = `
        SELECT id, name, slug, parent_id, lft, rgt, path, is_active, metadata, our_category, is_our_category, vendor_id, priority,image_url
        FROM categories
        WHERE deleted_at IS NULL
    `;

        const values = [];

        if (isOurCategory === true) {
            query += ` AND is_our_category = true`;
        } else if (isOurCategory === false) {
            query += ` AND (is_our_category = false OR is_our_category IS NULL)`;
        }

        query += ` ORDER BY COALESCE(path, name) ASC`;

        const { rows } = await client.query(query, values);
        return rows;
    },

    //     async getAllOurCategories(client) {
    //         const { rows } = await client.query(`
    //     SELECT id, name, slug, parent_id, lft, rgt, path, is_active, metadata, our_category, is_our_category,vendor_id
    //     FROM categories
    //     WHERE deleted_at IS NULL
    //     ORDER BY COALESCE(path, name) ASC
    //   `);
    //         return rows;
    //     },
    async getAllChildCategories(client) {
        const { rows } = await client.query(`
    SELECT id, name, slug, parent_id, lft, rgt, path, is_active, metadata
    FROM categories
    WHERE deleted_at IS NULL
    ORDER BY COALESCE(path, name) ASC
  `);
        return rows;
    },
    // inside CategoryService object
    async updateCategory(id, { name, slug, parent_id = null, metadata = null, is_active = true, priority }, client) {
        // Fetch existing category
        const { rows: existingRows } = await client.query(categoryQueries.getById, [id]);
        const existing = existingRows[0];
        if (!existing) throw new Error("Category not found");

        // If parent_id changed, update path accordingly (but NOT moving tree here, just basic update)
        let newPath;
        if (parent_id) {
            const { rows: parentRows } = await client.query(categoryQueries.getById, [parent_id]);
            const parent = parentRows[0];
            if (!parent) throw new Error("Parent not found during update");

            newPath = (parent.path ? `${parent.path}/${slug}` : `${parent.slug}/${slug}`);
        } else {
            // root level
            newPath = slug;
        }

        const { rows } = await client.query(categoryQueries.updateCategory, [
            id,
            name,
            slug,
            parent_id,
            newPath,
            is_active,
            metadata ? JSON.stringify(metadata) : null,
            existing.our_category,
            existing.is_our_category,
            priority
        ]);
        return rows[0];
    },

    // services/categoryService.js

    async mapVendorCategory({ vendor_category_id, our_category_id }, client) {
        // ensure vendor_category_id is not itself an our category
        const { rows } = await client.query('SELECT id, is_our_category FROM categories WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [vendor_category_id]);
        if (!rows[0]) throw new Error('Vendor category not found');
        if (rows[0].is_our_category) throw new Error('Cannot map an "our" category as vendor category');

        const upd = await client.query('UPDATE categories SET our_category = $1 WHERE id = $2 RETURNING id, name, slug, parent_id, path, is_our_category, our_category', [our_category_id, vendor_category_id]);
        return upd.rows[0];
    },
    /* async deleteOurCategory(id, client) {
        // validate category exists and is an "our" category
        const { rows: existingRows } = await client.query('SELECT id, is_our_category, lft, rgt FROM categories WHERE id=$1 AND deleted_at IS NULL', [id]);
        const existing = existingRows[0];
        if (!existing) throw new Error('Category not found');
        if (!existing.is_our_category) throw new Error('Category is not an "our" category');

        // delete category
        const { rows } = await client.query('UPDATE categories SET deleted_at = NOW() WHERE id = $1 RETURNING id, name, slug, parent_id, path, is_our_category, our_category', [id]);
        return rows[0];
    }, */


    // CategoryService.deleteOurCategory (replace existing implementation)
    async deleteOurCategory(id, client) {
        if (!id) throw new Error('Category id required');

        // We'll manage transaction here to make deletion atomic.
        await client.query('BEGIN');
        try {
            // Lock the target category row so concurrent ops are safe
            const { rows: existingRows } = await client.query(
                `SELECT id, is_our_category, lft, rgt, path
       FROM categories
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
                [id]
            );

            const existing = existingRows[0];
            if (!existing) {
                throw new Error('Category not found');
            }
            if (!existing.is_our_category) {
                throw new Error('Category is not an "our" category');
            }

            let deletedRows = [];

            // If nested-set values available -> use them to delete subtree
            if (existing.lft !== null && existing.rgt !== null) {
                const { rows: dr } = await client.query(
                    `UPDATE categories
         SET deleted_at = NOW()
         WHERE lft >= $1 AND rgt <= $2 AND deleted_at IS NULL
         RETURNING id, name, slug, parent_id, path, is_our_category, our_category`,
                    [existing.lft, existing.rgt]
                );
                deletedRows = dr;
            } else if (existing.path) {
                // fallback to path-based deletion (covers path and descendants)
                const path = existing.path;
                const { rows: dr } = await client.query(
                    `UPDATE categories
         SET deleted_at = NOW()
         WHERE deleted_at IS NULL AND (path = $1 OR path LIKE $2)
         RETURNING id, name, slug, parent_id, path, is_our_category, our_category`,
                    [path, `${path}/%`]
                );
                deletedRows = dr;
            } else {
                // As a last-resort: just soft-delete the single row
                const { rows: dr } = await client.query(
                    `UPDATE categories
         SET deleted_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, name, slug, parent_id, path, is_our_category, our_category`,
                    [id]
                );
                deletedRows = dr;
            }

            // Unmap vendor categories that mapped to this our-category
            // (so they won't point to a deleted our-category)
            await client.query(
                `UPDATE categories
       SET our_category = NULL
       WHERE our_category = $1`,
                [id]
            );

            await client.query('COMMIT');

            return {
                ok: true,
                deleted_count: deletedRows.length,
                deleted: deletedRows
            };
        } catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        }
    },

    async unmapVendorCategory({ vendor_category_id }, client) {
        if (!vendor_category_id) throw new Error('vendor_category_id required');

        // We accept either single id or array — normalize to array for consistency
        const ids = Array.isArray(vendor_category_id) ? vendor_category_id : [vendor_category_id];

        // validate outside if needed (controller already does)
        // Clear our_category column and return updated rows
        const sql = `
    UPDATE categories
    SET our_category = NULL
    WHERE id = ANY($1::uuid[])
      AND deleted_at IS NULL
    RETURNING id, name, slug, parent_id, path, is_our_category, our_category;
  `;
        const { rows } = await client.query(sql, [ids]);
        return rows;
    },

    async updateImageInCategory(id, imageUrl, client) {
        const { rows } = await client.query(
            `UPDATE categories
       SET image_url = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, name, slug, parent_id, path, is_our_category, our_category, image_url`,
            [imageUrl, id]
        );
        return rows[0];
    }
};

module.exports = CategoryService;