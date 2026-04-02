const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const {VendorService}  = require("../../services/vendorService");
const { isValidUUID } = require("../../utils/basicValidation");
const dbPool = require("../../db/dbConnection");


module.exports.getVendors = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    let {status,page,search} = req.query;
    try {
        const vendors = await VendorService.getAllVendors( client, {status,page,search});
        return sendResponse(res, 200, true, 'Vendors fetched', vendors);
    } catch (err) {
        return next(new AppError(err.message || 'Failed to fetch vendors', 500));
    } finally {
        client.release();
    }
});


module.exports.getVendorById = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req.query.vendorId;
        if (!isValidUUID(id)) return next(new AppError('Invalid vendor ID', 400));
        const vendor = await VendorService.getVendorById(id, client);
        if (!vendor) return next(new AppError('Vendor not found', 404));
        return sendResponse(res, 200, true, 'Vendor fetched', vendor);
    } catch (err) {
        return next(new AppError(err.message || 'Failed to fetch vendor', 500));
    } finally {
        client.release();
    }
});

module.exports.updateVendorStatus = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const {id, status} = req.body;
        if (!isValidUUID(id)) return next(new AppError('Invalid vendor ID', 400));
        if (typeof status !== 'string' || !['active', 'inactive'].includes(status)) {
            return next(new AppError('Invalid status value', 400));
        }

        const vendor = await VendorService.getVendorById(id, client);
        if (!vendor) return next(new AppError('Vendor not found', 404));

        const updateQuery = 'UPDATE vendors SET status = $1 WHERE id = $2 RETURNING *';
        const result = await client.query(updateQuery, [status, id]);
        const updatedVendor = result.rows[0];

        return sendResponse(res, 200, true, 'Vendor status updated', updatedVendor);
    } catch (err) {
        return next(new AppError(err.message || 'Failed to update vendor status', 500));
    } finally {
        client.release();
    }
});

/** PATCH /admin/update-vendor - update vendor fields (e.g. merchant_dashboard_url, metadata.shipping) */
module.exports.updateVendor = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { id, merchant_dashboard_url, status, shipping_country_costs, shipping_per_item, shipping_default_rate, shipping_country_rates, shipping_item_tiers, shipping_low_value_threshold, shipping_low_value_supplement } = req.body;
        if (!isValidUUID(id)) return next(new AppError('Invalid vendor ID', 400));

        const vendor = await VendorService.getVendorById(id, client);
        if (!vendor) return next(new AppError('Vendor not found', 404));

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (merchant_dashboard_url !== undefined) {
            const url = merchant_dashboard_url === null || merchant_dashboard_url === '' ? null : String(merchant_dashboard_url).trim();
            if (url !== null && url.length > 500) return next(new AppError('merchant_dashboard_url must be 500 characters or less', 400));
            updates.push(`merchant_dashboard_url = $${paramIndex}`);
            values.push(url);
            paramIndex++;
        }
        if (status !== undefined) {
            if (typeof status !== 'string' || !['active', 'inactive'].includes(status)) return next(new AppError('Invalid status value', 400));
            updates.push(`status = $${paramIndex}`);
            values.push(status);
            paramIndex++;
        }

        const hasShippingMeta = shipping_country_costs !== undefined || shipping_per_item !== undefined ||
            shipping_default_rate !== undefined || shipping_country_rates !== undefined || shipping_item_tiers !== undefined ||
            shipping_low_value_threshold !== undefined || shipping_low_value_supplement !== undefined;
        if (hasShippingMeta) {
            const meta = { ...(vendor.metadata || {}) };
            if (shipping_country_costs !== undefined) {
                const sanitized = {};
                if (shipping_country_costs && typeof shipping_country_costs === 'object') {
                    for (const [k, v] of Object.entries(shipping_country_costs)) {
                        const code = String(k).toUpperCase().trim();
                        if (code.length === 2 || code.length === 3) {
                            const num = Number(v);
                            sanitized[code] = Number.isFinite(num) ? num : 0;
                        }
                    }
                }
                meta.shipping_country_costs = sanitized;
            }
            if (shipping_per_item !== undefined) {
                const sanitized = {};
                if (shipping_per_item && typeof shipping_per_item === 'object') {
                    for (const [k, v] of Object.entries(shipping_per_item)) {
                        const key = String(k).trim();
                        if (key) {
                            const num = Number(v);
                            sanitized[key] = Number.isFinite(num) ? num : 0;
                        }
                    }
                }
                meta.shipping_per_item = sanitized;
            }
            if (shipping_default_rate !== undefined) {
                const num = Number(shipping_default_rate);
                meta.shipping_default_rate = Number.isFinite(num) && num >= 0 ? num : 100;
            }
            if (shipping_country_rates !== undefined) {
                const sanitized = {};
                if (shipping_country_rates && typeof shipping_country_rates === 'object') {
                    for (const [k, v] of Object.entries(shipping_country_rates)) {
                        const code = String(k).trim().toUpperCase();
                        if (code.length >= 1 && code.length <= 3) {
                            const num = Number(v);
                            sanitized[code] = Number.isFinite(num) && num >= 0 ? num : 0;
                        }
                    }
                }
                meta.shipping_country_rates = sanitized;
            }
            if (shipping_item_tiers !== undefined && Array.isArray(shipping_item_tiers)) {
                meta.shipping_item_tiers = shipping_item_tiers
                    .filter(t => t && Number(t.min) >= 0 && Number(t.max) >= Number(t.min) && Number(t.multiplier) >= 1)
                    .map(t => ({ min: Number(t.min), max: Number(t.max), multiplier: Number(t.multiplier) }));
            }
            if (shipping_low_value_threshold !== undefined) {
                const num = Number(shipping_low_value_threshold);
                meta.shipping_low_value_threshold = Number.isFinite(num) && num >= 0 ? num : 200;
            }
            if (shipping_low_value_supplement !== undefined) {
                const num = Number(shipping_low_value_supplement);
                meta.shipping_low_value_supplement = Number.isFinite(num) && num >= 0 ? num : 20;
            }
            updates.push(`metadata = $${paramIndex}::jsonb`);
            values.push(JSON.stringify(meta));
            paramIndex++;
        }

        if (updates.length === 0) return next(new AppError('No valid fields to update', 400));

        values.push(id);
        const updateQuery = `UPDATE vendors SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await client.query(updateQuery, values);
        const updatedVendor = result.rows[0];

        return sendResponse(res, 200, true, 'Vendor updated', updatedVendor);
    } catch (err) {
        return next(new AppError(err.message || 'Failed to update vendor', 500));
    } finally {
        client.release();
    }
});

module.exports.getVendorProductStats = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { vendorId } = req.params;
        if (!isValidUUID(vendorId)) return next(new AppError('Invalid vendor ID', 400));

        const vendor = await VendorService.getVendorById(vendorId, client);
        if (!vendor) return next(new AppError('Vendor not found', 404));

        // Get product counts
        const statsQuery = `
            SELECT
                COUNT(*) FILTER (WHERE deleted_at IS NULL) as total_products,
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = true) as active_products,
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_active = false) as inactive_products
            FROM products
            WHERE vendor_id = $1
        `;
        const statsResult = await client.query(statsQuery, [vendorId]);
        const stats = statsResult.rows[0];

        // Get variant counts
        const variantQuery = `
            SELECT COUNT(*) as total_variants
            FROM product_variants pv
            INNER JOIN products p ON pv.product_id = p.id
            WHERE p.vendor_id = $1
            AND pv.deleted_at IS NULL
            AND p.deleted_at IS NULL
        `;
        const variantResult = await client.query(variantQuery, [vendorId]);
        const variantStats = variantResult.rows[0];

        // Get last sync info
        const lastSyncQuery = `
            SELECT id, status, started_at, completed_at,
                   total_products as total_synced,
                   successful_products as successful,
                   failed_products as failed
            FROM vendor_sync_jobs
            WHERE vendor_id = $1
            AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
        `;
        const lastSyncResult = await client.query(lastSyncQuery, [vendorId]);
        const lastSync = lastSyncResult.rows[0] || null;

        return sendResponse(res, 200, true, 'Vendor product stats fetched', {
            totalProducts: parseInt(stats.total_products) || 0,
            activeProducts: parseInt(stats.active_products) || 0,
            inactiveProducts: parseInt(stats.inactive_products) || 0,
            totalVariants: parseInt(variantStats.total_variants) || 0,
            lastSync: lastSync ? {
                completedAt: lastSync.completed_at,
                totalSynced: parseInt(lastSync.total_synced) || 0,
                successful: parseInt(lastSync.successful) || 0,
                failed: parseInt(lastSync.failed) || 0,
            } : null,
        });
    } catch (err) {
        return next(new AppError(err.message || 'Failed to fetch vendor product stats', 500));
    } finally {
        client.release();
    }
});
