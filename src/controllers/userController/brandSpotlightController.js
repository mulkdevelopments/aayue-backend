// controllers/public/brandSpotlightController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const sendResponse = require('../../utils/sendResponse');
const BrandSpotlightService = require('../../services/brandSpotlightService');
const AppError = require('../../errorHandling/AppError');
const { isValidUUID } = require('../../utils/basicValidation');
const ProductService = require('../../services/productService');

module.exports.getSpotlights = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
        const offset = (page - 1) * limit;

        const spotlights = await BrandSpotlightService.listSpotlights({ limit, offset, include_inactive: false }, client);

        // fetch sample products for the brands returned
        const brandNames = spotlights.map(s => s.brand_name);
        const samples = await BrandSpotlightService.fetchSampleProductsForBrands(brandNames, { limitPerBrand: 4 }, client);

        // attach product samples to spotlight row
        const items = spotlights.map(s => ({
            id: s.id,
            brand_name: s.brand_name,
            meta: s.meta,
            rank: s.rank,
            active: s.active,
            start_at: s.start_at,
            end_at: s.end_at,
            created_at: s.created_at,
            products: samples[s.brand_name] || []
        }));

        return sendResponse(res, 200, true, 'Brand spotlights fetched', { total: items.length, page, limit, items });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.getProductsByBrand = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        // brand can be passed as route param (brand name or brand id) or query param
        // Prefer route param: /brands/:brand/products
        const brandParam = req.params.brand || req.query.brand;
        if (!brandParam) return next(new AppError('brand parameter required (brand name or id)', 400));

        // Filters & pagination from query
        const {
            q,
            category_id,
            min_price,
            max_price,
            color,
            size,
            gender,
            country,
            sku,
            dynamic_filter, // can be repeated or comma-separated type:name
            sort_by = 'created_at',
            sort_order = 'desc',
            page: pageQ,
            limit: limitQ,
            include = 'variants,categories,filters,media',
        } = req.query;

        // parse dynamic filters into expected array of {filter_type, filter_name}
        let dynamic_filters = [];
        if (dynamic_filter) {
            let arr = Array.isArray(dynamic_filter) ? dynamic_filter : String(dynamic_filter).split(',');
            dynamic_filters = arr.map(df => {
                const [filter_type, ...rest] = df.split(':');
                const filter_name = rest.join(':');
                if (!filter_type || !filter_name) return null;
                return { filter_type: filter_type.trim(), filter_name: filter_name.trim() };
            }).filter(Boolean);
        }

        // pagination
        const page = Math.max(1, parseInt(pageQ, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitQ, 10) || 20));
        const offset = (page - 1) * limit;

        // include flags
        const includeParts = new Set(String(include || 'variants,categories,filters,media').split(',').map(s => s.trim()).filter(Boolean));

        // decide whether brandParam is UUID (brand table id) or name
        // If it's a UUID we may want to look up brand_name in brand_spotlights or brands table.
        let brandName = null;
        if (isValidUUID(brandParam)) {
            // try to resolve to brand name from brand_spotlights (if exists) else treat as unknown
            const { rows } = await client.query('SELECT brand_name FROM brand_spotlights WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [brandParam]);
            if (rows.length > 0) {
                brandName = rows[0].brand_name;
            } else {
                // also try brands table if you have one (uncomment if exists)
                // const b = await client.query('SELECT name FROM brands WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [brandParam]);
                // if (b.rows.length > 0) brandName = b.rows[0].name;
                // If not found, return empty
                if (!brandName) {
                    client.release();
                    return sendResponse(res, 200, true, 'Products fetched', { total: 0, page, limit, total_pages: 0, products: [] });
                }
            }
        } else {
            // treat as brand name (string)
            brandName = String(brandParam).trim();
        }

        // Build options and call ProductService.getProducts
        const options = {
            q: q || null,
            category_id: category_id || null,
            brand: brandName || null,
            vendor_id: null,
            min_price: isNaN(Number(min_price)) ? null : Number(min_price),
            max_price: isNaN(Number(max_price)) ? null : Number(max_price),
            color: color || null,
            size: size || null,
            gender: gender || null,
            country: country || null,
            sku: sku || null,
            dynamic_filters,
            sort_by,
            sort_order: sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc',
            limit,
            offset,
            include: {
                variants: includeParts.has('variants'),
                categories: includeParts.has('categories'),
                filters: includeParts.has('filters'),
                media: includeParts.has('media')
            }
        };

        const { total, products } = await ProductService.getProducts(options, client);

        const totalPages = Math.max(1, Math.ceil(total / limit));

        return sendResponse(res, 200, true, 'Products fetched', {
            total,
            page,
            limit,
            total_pages: totalPages,
            products
        });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});
