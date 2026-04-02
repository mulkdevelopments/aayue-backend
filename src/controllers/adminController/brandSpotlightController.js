// controllers/admin/brandSpotlightController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const AppError = require('../../errorHandling/AppError');
const sendResponse = require('../../utils/sendResponse');
const BrandSpotlightService = require('../../services/brandSpotlightService');

module.exports.createSpotlight = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { brand_name, vendor_id, meta, rank, active, start_at, end_at } = req.body;
        if (!brand_name) {
            client.release();
            return next(new AppError('brand_name is required', 400));
        }
        await client.query('BEGIN');

        // Optionally: ensure brand exists in products table (not mandatory)
        // const check = await client.query('SELECT 1 FROM products WHERE brand_name = $1 LIMIT 1', [brand_name]);
        // if (check.rowCount === 0) { ... } 

        const created = await BrandSpotlightService.createSpotlight({
            brand_name, vendor_id, meta, rank, active, start_at, end_at, created_by: req.user?.id || null
        }, client);

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'Brand spotlight created', created);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to create brand spotlight', 500));
    } finally {
        client.release();
    }
});

module.exports.updateSpotlight = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { id } = req.params;
        const updates = req.body;
        await client.query('BEGIN');
        const updated = await BrandSpotlightService.updateSpotlight(id, updates, client);
        if (!updated) { await client.query('ROLLBACK'); return next(new AppError('Spotlight not found or invalid payload', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Brand spotlight updated', updated);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to update brand spotlight', 500));
    } finally {
        client.release();
    }
});

module.exports.deleteSpotlight = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');
        const removed = await BrandSpotlightService.deleteSpotlight(id, client);
        if (!removed) { await client.query('ROLLBACK'); return next(new AppError('Spotlight not found', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Brand spotlight removed', removed);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to remove brand spotlight', 500));
    } finally {
        client.release();
    }
});

module.exports.listSpotlightsAdmin = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { page = 1, limit = 50, include_inactive = 'false' } = req.query;
        const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));
        const rows = await BrandSpotlightService.listSpotlights({ limit: parseInt(limit, 10), offset, include_inactive: include_inactive === 'true' }, client);
        return sendResponse(res, 200, true, 'Brand spotlights fetched', { total: rows.length, items: rows });
    } catch (err) {
        return next(new AppError(err.message || 'Failed to list brand spotlights', 500));
    } finally {
        client.release();
    }
});
