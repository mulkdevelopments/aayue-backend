const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const CategoryService = require('../../services/categoryService');
const { isValidUUID } = require("../../utils/basicValidation");
const dbPool = require("../../db/dbConnection");

function buildNested(categories, parentId = null) {
    return categories
        .filter(cat => cat.parent_id === parentId)
        .map(cat => ({
            ...cat,
            children: buildNested(categories, cat.id)
        }));
}

// controllers/admin/categoryController.js

module.exports.createCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        // Admin-only route — ensure middleware already checked role
        const { name, slug, parent_id = null, metadata = null, is_active = true, priority = 1, image_url } = req.body;
        if (!name || !slug) return next(new AppError('Name & slug required', 400));

        // Force our categories to be marked as our category
        const is_our_category = true;
        const our_category = null; // not applicable for our categories

        // validate parent if provided
        await client.query('BEGIN');

        if (parent_id) {
            if (!isValidUUID(parent_id)) {
                await client.query('ROLLBACK');
                return next(new AppError('Invalid parent_id format', 400));
            }
            const parent = await CategoryService.getCategoryById(parent_id, client);
            if (!parent) {
                await client.query('ROLLBACK');
                return next(new AppError('Parent category not found', 404));
            }
        }

        const category = await CategoryService.createCategory(
            { name, slug, parent_id, metadata, is_active, is_our_category, our_category, priority, image_url },
            client
        );

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'Category created', category);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(error.message || 'Failed to create category', 500));
    } finally {
        client.release();
    }
});

// module.exports.createCategory = catchAsync(async (req, res, next) => {
//     const client = await dbPool.connect();
//     try {
//         const { name, slug, parent_id = null, metadata = null, is_active = true } = req.body;
//         if (!name || !slug) return next(new AppError('Name & slug required', 400));

//         await client.query('BEGIN');

//         if (parent_id !== null && parent_id !== undefined) {
//             if (!isValidUUID(parent_id)) {
//                 await client.query('ROLLBACK');
//                 return next(new AppError('Invalid parent_id format', 400));
//             }

//             const parent = await CategoryService.getCategoryById(parent_id, client);
//             if (!parent) {
//                 await client.query('ROLLBACK');
//                 return next(new AppError('Parent category not found', 404));
//             }
//         }

//         const category = await CategoryService.createCategory(
//             { name, slug, parent_id, metadata, is_active },
//             client
//         );

//         await client.query('COMMIT');
//         return sendResponse(res, 201, true, 'Category created', category);
//     } catch (error) {
//         await client.query('ROLLBACK');
//         return next(new AppError(error.message || 'Failed to create category', 500));
//     } finally {
//         client.release();
//     }
// });
// controller
module.exports.getOurCategories = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        // ✅ Fetch only our categories (is_our_category = true)
        const flat = await CategoryService.getOnlyOurCategories(client);

        // Build map (id -> node)
        const map = new Map();
        for (const node of flat) {
            map.set(node.id, {
                id: node.id,
                name: node.name,
                slug: node.slug,
                parent_id: node.parent_id,
                lft: node.lft ?? null,
                rgt: node.rgt ?? null,
                path: node.path,
                is_active: node.is_active,
                metadata: node.metadata,
                is_our_category: !!node.is_our_category,
                our_category: node.our_category || null,
                priority: node.priority || null,
                image_url: node.image_url || null,
                children: []
            });
        }

        // Assemble tree
        const roots = [];
        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                map.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        // Sort consistently
        // function sortTree(nodes) {
        //     nodes.sort((a, b) => (a.path || a.name || '').localeCompare(b.path || b.name || ''));
        //     for (const n of nodes) {
        //         if (n.children?.length) sortTree(n.children);
        //     }
        // }
        // sortTree(roots);

        return sendResponse(res, 200, true, 'Our categories fetched', roots);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

/**
module.exports.getAllCategories = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        // ✅ Fetch only our categories (is_our_category = true)
        const flat = await CategoryService.getAllOurCategories(client);

        // Build map (id -> node)
        const map = new Map();
        for (const node of flat) {
            map.set(node.id, {
                id: node.id,
                name: node.name,
                slug: node.slug,
                parent_id: node.parent_id,
                lft: node.lft ?? null,
                rgt: node.rgt ?? null,
                path: node.path,
                is_active: node.is_active,
                metadata: node.metadata,
                is_our_category: !!node.is_our_category,
                our_category: node.our_category || null,
                vendor_id: node.vendor_id || null,
                children: []
            });
        }

        // Assemble tree
        const roots = [];
        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                map.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        // Sort consistently
        function sortTree(nodes) {
            nodes.sort((a, b) => (a.path || a.name || '').localeCompare(b.path || b.name || ''));
            for (const n of nodes) {
                if (n.children?.length) sortTree(n.children);
            }
        }
        sortTree(roots);

        return sendResponse(res, 200, true, 'Our categories fetched', roots);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});
*/

module.exports.getAllCategories = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        // 🧭 Parse query param (can be "true" | "false" | undefined)
        const isOurCategory = req.query.is_our_category === "true"
            ? true
            : req.query.is_our_category === "false"
                ? false
                : null;

        // 🗂 Fetch categories according to query
        const flat = await CategoryService.getAllOurCategories(client, isOurCategory);

        // 🧱 Build map
        const map = new Map();
        for (const node of flat) {
            map.set(node.id, {
                id: node.id,
                name: node.name,
                slug: node.slug,
                parent_id: node.parent_id,
                lft: node.lft ?? null,
                rgt: node.rgt ?? null,
                path: node.path,
                is_active: !!node.is_active,
                metadata: node.metadata,
                is_our_category: !!node.is_our_category,
                our_category: node.our_category || null,
                vendor_id: node.vendor_id || null,
                priority: node.priority || null,
                image_url: node.image_url || null,
                children: []
            });
        }

        // 🌳 Assemble tree
        const roots = [];
        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                map.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        // 🔠 Sort consistently
        const sortTree = (nodes) => {
            nodes.sort((a, b) => (a.path || a.name || "").localeCompare(b.path || b.name || ""));
            for (const n of nodes) {
                if (n.children?.length) sortTree(n.children);
            }
        };
        sortTree(roots);

        const msg = isOurCategory === true
            ? "Our categories fetched"
            : isOurCategory === false
                ? "Vendor categories fetched"
                : "All categories fetched";

        return sendResponse(res, 200, true, msg, roots);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.editCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { category_id, name, slug, parent_id = null, metadata = null, is_active = true, priority, image_url } = req.body;

        if (!category_id || !isValidUUID(category_id)) {
            return next(new AppError('Valid category id is required', 400));
        }

        await client.query('BEGIN');

        // Check if category exists
        const category = await CategoryService.getCategoryById(category_id, client);
        if (!category) {
            await client.query('ROLLBACK');
            return next(new AppError('Category not found', 404));
        }
        if (!category.is_our_category) {
            await client.query('ROLLBACK');
            return next(new AppError('Category is not an "our" category', 400));
        }

        // Prevent setting parent as itself
        if (parent_id && parent_id === category.id) {
            await client.query('ROLLBACK');
            return next(new AppError('Category cannot be its own parent', 400));
        }

        // Validate parent if provided
        if (parent_id !== null && parent_id !== undefined) {
            if (!isValidUUID(parent_id)) {
                await client.query('ROLLBACK');
                return next(new AppError('Invalid parent_id format', 400));
            }

            const parent = await CategoryService.getCategoryById(parent_id, client);
            if (!parent) {
                await client.query('ROLLBACK');
                return next(new AppError('Parent category not found', 404));
            }
        }

        // Update category
        const updatedCategory = await CategoryService.updateCategory(
            category_id,
            { name, slug, parent_id, metadata, is_active, priority, image_url },
            client
        );

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Category updated', updatedCategory);
    } catch (error) {
        await client.query('ROLLBACK');
        return next(new AppError(error.message || 'Failed to update category', 500));
    } finally {
        client.release();
    }
});

module.exports.mapVendorCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        let { vendor_category_id, our_category_id } = req.body;

        // vendor_category_id can be single UUID or array of UUIDs
        if (!vendor_category_id || !our_category_id)
            return next(new AppError('vendor_category_id and our_category_id required', 400));

        // normalize to array
        if (!Array.isArray(vendor_category_id)) vendor_category_id = [vendor_category_id];

        // validate UUIDs
        if (!isValidUUID(our_category_id))
            return next(new AppError('Invalid our_category_id format', 400));

        for (const id of vendor_category_id) {
            if (!isValidUUID(id)) return next(new AppError('Invalid vendor_category_id format', 400));
        }

        await client.query('BEGIN');

        // ensure our category exists and is flagged as our_category
        const ourCat = await CategoryService.getCategoryById(our_category_id, client);
        if (!ourCat) {
            await client.query('ROLLBACK');
            return next(new AppError('Our category not found', 404));
        }
        if (!ourCat.is_our_category) {
            await client.query('ROLLBACK');
            return next(new AppError('Target category is not marked as an "our" category', 400));
        }

        const mappedResults = [];

        // iterate each vendor category
        for (const vendorId of vendor_category_id) {
            // ensure vendor category exists
            const vendorCat = await CategoryService.getCategoryById(vendorId, client);
            if (!vendorCat) {
                await client.query('ROLLBACK');
                return next(new AppError(`Vendor category not found: ${vendorId}`, 404));
            }

            // skip if vendorCat itself is our category
            if (vendorCat.is_our_category) {
                await client.query('ROLLBACK');
                return next(new AppError(`Cannot map an "our" category as vendor category: ${vendorCat.name}`, 400));
            }

            // perform mapping
            const updated = await CategoryService.mapVendorCategory({ vendor_category_id: vendorId, our_category_id }, client);
            mappedResults.push(updated);
        }

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Vendor categories mapped successfully', mappedResults);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.unmapVendorCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        let { vendor_category_id } = req.body;

        if (!vendor_category_id)
            return next(new AppError('vendor_category_id required', 400));

        // normalize to array
        if (!Array.isArray(vendor_category_id)) vendor_category_id = [vendor_category_id];

        // validate UUIDs
        for (const id of vendor_category_id) {
            if (!isValidUUID(id)) return next(new AppError('Invalid vendor_category_id format', 400));
        }

        await client.query('BEGIN');

        const unmappedResults = [];
        for (const vendorId of vendor_category_id) {
            // ensure vendor category exists
            const vendorCat = await CategoryService.getCategoryById(vendorId, client);
            if (!vendorCat) {
                await client.query('ROLLBACK');
                return next(new AppError(`Vendor category not found: ${vendorId}`, 404));
            }

            // if it's an "our" category, forbid unmapping (defensive)
            if (vendorCat.is_our_category) {
                await client.query('ROLLBACK');
                return next(new AppError(`Cannot unmap an "our" category: ${vendorCat.name}`, 400));
            }

            // call service to unmap (clears our_category)
            const updated = await CategoryService.unmapVendorCategory({ vendor_category_id: vendorId }, client);
            unmappedResults.push(updated);
        }

        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Vendor categories unmapped successfully', unmappedResults);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(err);
    } finally {
        client.release();
    }
});


module.exports.getCategoriesForMapping = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();

    try {
        const { q, vendorId } = req.query;

        if (!vendorId) {
            return sendResponse(res, 400, false, 'vendorId is required', null);
        }

        // Subquery to compute product counts per category (only direct counts)
        const countsSubquery = `
      SELECT pc.category_id, COUNT(DISTINCT pc.product_id) AS product_count
      FROM product_categories pc
      JOIN products p ON p.id = pc.product_id AND p.deleted_at IS NULL
      WHERE pc.deleted_at IS NULL
      GROUP BY pc.category_id
    `;

        let sql = `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.parent_id,
        c.lft,
        c.rgt,
        c.path,
        c.is_active,
        c.is_our_category,
        c.our_category,
        COALESCE(cnt.product_count, 0)::int AS product_count,
        oc.id AS our_id,
        oc.name AS our_name,
        oc.slug AS our_slug,
        oc.path AS our_path
      FROM categories c
      LEFT JOIN (${countsSubquery}) cnt ON cnt.category_id = c.id
      LEFT JOIN categories oc ON oc.id = c.our_category AND oc.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
        AND c.vendor_id = $1
        AND (c.is_our_category IS DISTINCT FROM true)
    `;

        const params = [vendorId];

        if (q && q.trim()) {
            params.push(`%${q.trim()}%`);
            const idx = params.length;
            sql += `
        AND (
          c.name ILIKE $${idx}
          OR c.slug ILIKE $${idx}
          OR c.path ILIKE $${idx}
        )
      `;
        }

        sql += ` ORDER BY COALESCE(c.path, c.name) ASC;`;

        const { rows } = await client.query(sql, params);

        if (rows.length === 0) {
            return sendResponse(res, 200, true, 'No categories found for this vendor', []);
        }

        // Build nodes map
        const map = new Map();
        for (const r of rows) {
            if (!map.has(r.id)) {
                map.set(r.id, {
                    id: r.id,
                    name: r.name,
                    slug: r.slug,
                    parent_id: r.parent_id,
                    lft: r.lft ?? null,
                    rgt: r.rgt ?? null,
                    path: r.path,
                    is_active: r.is_active,
                    is_our_category: !!r.is_our_category,
                    our_category: r.our_category || null,
                    our_category_meta: r.our_id
                        ? { id: r.our_id, name: r.our_name, slug: r.our_slug, path: r.our_path }
                        : null,
                    // direct product count (only products directly mapped to this vendor category)
                    product_count: Number(r.product_count || 0),
                    children: []
                });
            }
        }

        // Attach children to parents
        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                const parent = map.get(node.parent_id);
                if (!parent.children.find(c => c.id === node.id)) parent.children.push(node);
            }
        }

        // Collect top-level nodes
        const roots = [];
        for (const node of map.values()) {
            if (!node.parent_id || !map.has(node.parent_id)) {
                roots.push(node);
            }
        }

        // Sort function
        function sortNodes(nodes) {
            nodes.sort((a, b) => {
                const ka = (a.path || a.name || '').toLowerCase();
                const kb = (b.path || b.name || '').toLowerCase();
                return ka.localeCompare(kb);
            });
            for (const n of nodes) {
                if (n.children && n.children.length) sortNodes(n.children);
            }
        }
        sortNodes(roots);

        // Post-order traversal to compute aggregated counts (node.product_count becomes sum of its subtree)
        function aggregateCounts(node) {
            if (!node.children || node.children.length === 0) {
                return node.product_count || 0;
            }
            let sum = node.product_count || 0;
            for (const ch of node.children) {
                sum += aggregateCounts(ch);
            }
            node.product_count = sum;
            return sum;
        }

        for (const r of roots) {
            aggregateCounts(r);
        }

        return sendResponse(res, 200, true, 'Vendor categories for mapping fetched', roots);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

async function getCategoryWithParents(client, categoryId) {
    const query = `
        WITH RECURSIVE category_hierarchy AS (
            SELECT id, name, slug, parent_id
            FROM categories
            WHERE id = $1
            UNION ALL
            SELECT c.id, c.name, c.slug, c.parent_id
            FROM categories c
            INNER JOIN category_hierarchy ch ON ch.parent_id = c.id
        )
        SELECT * FROM category_hierarchy;
    `;
    const { rows } = await client.query(query, [categoryId]);
    if (!rows.length) return null;

    // rows are from child → parent order, we reverse to build hierarchy top-down
    const chain = rows.reverse();

    // build nested structure
    let nested = null;
    for (const c of chain) {
        nested = {
            id: c.id,
            name: c.name,
            slug: c.slug,
            ...(nested ? { parent: nested } : {})
        };
    }
    return nested;
}

module.exports.getMappedCategories = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { search, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        const params = [];

        let baseWhere = `vc.deleted_at IS NULL AND oc.deleted_at IS NULL`;

        if (search) {
            params.push(`%${search.toLowerCase()}%`);
            baseWhere += ` AND (LOWER(vc.name) LIKE $${params.length} OR LOWER(oc.name) LIKE $${params.length})`;
        }

        // 🧮 Total count
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM categories vc
            JOIN categories oc ON vc.our_category = oc.id
            WHERE ${baseWhere}
        `;
        const totalRes = await client.query(countQuery, params);
        const total = parseInt(totalRes.rows[0].total, 10);

        // 🧾 Get mapped categories
        const query = `
            SELECT 
                vc.id AS vendor_category_id,
                vc.name AS vendor_category_name,
                vc.slug AS vendor_category_slug,
                oc.id AS our_category_id,
                oc.name AS our_category_name,
                oc.slug AS our_category_slug
            FROM categories vc
            JOIN categories oc ON vc.our_category = oc.id
            WHERE ${baseWhere}
            ORDER BY vc.created_at DESC
            LIMIT ${limit} OFFSET ${offset};
        `;
        const { rows } = await client.query(query, params);

        // 🧩 Attach nested parent chain for our_category
        const result = [];
        for (const row of rows) {
            const ourCategoryNested = await getCategoryWithParents(client, row.our_category_id);
            result.push({
                vendor_category_id: row.vendor_category_id,
                vendor_category_name: row.vendor_category_name,
                vendor_category_slug: row.vendor_category_slug,
                our_category: ourCategoryNested
            });
        }

        const totalPages = Math.ceil(total / limit);

        return sendResponse(res, 200, true, "Mapped categories fetched successfully", {
            total,
            totalPages,
            currentPage: Number(page),
            data: result
        });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.getChildOfCategories = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { category_id } = req.query; // or req.body, depending on frontend (use ?category_id=xxx)

        // ✅ Fetch only our categories (is_our_category = true)
        const flat = await CategoryService.getAllChildCategories(client);
        // Build map (id -> node)
        const map = new Map();
        for (const node of flat) {
            map.set(node.id, {
                id: node.id,
                name: node.name,
                slug: node.slug,
                parent_id: node.parent_id,
                lft: node.lft ?? null,
                rgt: node.rgt ?? null,
                path: node.path,
                is_active: node.is_active,
                metadata: node.metadata,
                children: []
            });
        }

        // Assemble full tree
        const roots = [];
        for (const node of map.values()) {
            if (node.parent_id && map.has(node.parent_id)) {
                map.get(node.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        }

        // Sort function
        function sortTree(nodes) {
            nodes.sort((a, b) =>
                (a.path || a.name || '').localeCompare(b.path || b.name || '')
            );
            for (const n of nodes) {
                if (n.children?.length) sortTree(n.children);
            }
        }
        sortTree(roots);

        // ✅ If category_id is passed → find that node and return its children only
        let result = roots;
        if (category_id) {
            const targetNode = map.get(category_id);
            if (!targetNode) {
                return sendResponse(res, 404, false, 'Category not found', []);
            }
            result = targetNode.children || [];
        }

        return sendResponse(res, 200, true, 'Categories fetched', result);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.deleteOurCaegory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { category_id } = req.body;

        if (!category_id || !isValidUUID(category_id)) {
            return next(new AppError('Valid category id is required', 400));
        }

        const deleted = await CategoryService.deleteOurCategory(category_id, client);
        return sendResponse(res, 200, true, 'Category deleted successfully', deleted);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.updateImageInCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { category_id, image_url } = req.body;

        if (!category_id || !isValidUUID(category_id)) {
            return next(new AppError('Valid category id is required', 400));
        }

        if (!image_url) {
            return next(new AppError('Image url is required', 400));
        }

        const findOurCategory = await CategoryService.getCategoryById(category_id, client);
        if (!findOurCategory) {
            return next(new AppError('Category not found', 404));
        }
        if (!findOurCategory.is_our_category) {
            return next(new AppError('Category is not an "our" category', 400));
        }

        const updated = await CategoryService.updateImageInCategory(category_id, image_url, client);
        return sendResponse(res, 200, true, 'Category image updated successfully', updated);
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});




