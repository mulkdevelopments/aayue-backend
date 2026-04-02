// controllers/admin/newArrivalController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const NewArrivalService = require('../../services/newArrivalService');
const AppError = require('../../errorHandling/AppError');
const sendResponse = require('../../utils/sendResponse');

module.exports.createNewArrival = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { product_id, rank, meta, active, start_at, end_at } = req.body;
        if (!product_id) { client.release(); return next(new AppError('product_id required', 400)); }

        await client.query('BEGIN');
        // ensure unique on product: you can check exists
        const exists = await client.query('SELECT id FROM new_arrivals WHERE product_id = $1 AND deleted_at IS NULL', [product_id]);
        if (exists.rowCount > 0) { await client.query('ROLLBACK'); client.release(); return next(new AppError('New arrival for this product already exists', 400)); }

        // Optional: verify product exists
        const p = await client.query('SELECT id FROM products WHERE id = $1 AND deleted_at IS NULL', [product_id]);
        if (p.rowCount === 0) { await client.query('ROLLBACK'); client.release(); return next(new AppError('Product not found', 404)); }

        const created = await NewArrivalService.createNewArrival({
            product_id, rank, meta, active, start_at, end_at, created_by: req.user?.id || null
        }, client);

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'New arrival created', created);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to create new arrival', 500));
    } finally {
        client.release();
    }
});

module.exports.update = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req?.body?.id;
        if (!id) { client.release(); return next(new AppError('id is required', 400)); }
        const updates = req.body;
        await client.query('BEGIN');
        const updated = await NewArrivalService.updateNewArrival(id, updates, client);
        if (!updated) { await client.query('ROLLBACK'); return next(new AppError('Not found or invalid updates', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'New arrival updated', updated);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to update new arrival', 500));
    } finally {
        client.release();
    }
});

module.exports.delete = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req.query.id;
        await client.query('BEGIN');
        const removed = await NewArrivalService.deleteNewArrival(id, client);
        if (!removed) { await client.query('ROLLBACK'); return next(new AppError('Not found', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'New arrival removed', removed);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to remove new arrival', 500));
    } finally {
        client.release();
    }
});

module.exports.listAdmin = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
        const offset = (page - 1) * limit;
        const items = await NewArrivalService.listNewArrivals({ limit, offset, include_inactive: true }, client);
        return sendResponse(res, 200, true, 'New arrivals fetched', { total: items.length, items });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});
