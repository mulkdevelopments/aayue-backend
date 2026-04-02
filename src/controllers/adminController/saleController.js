// controllers/admin/saleController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const SaleService = require('../../services/saleService');
const AppError = require('../../errorHandling/AppError');
const sendResponse = require('../../utils/sendResponse');

// controllers/admin/saleController.js

module.exports.createSale = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { product_id, rank, meta, active, start_at, end_at, discount_percent } = req.body;
        if (!product_id) return next(new AppError('product_id required', 400));
        if (discount_percent === undefined) return next(new AppError('discount_percent required', 400));

        await client.query('BEGIN');

        const check = await client.query('SELECT id FROM products WHERE id=$1 AND deleted_at IS NULL', [product_id]);
        if (check.rowCount === 0) {
            await client.query('ROLLBACK');
            return next(new AppError('Product not found', 404));
        }

        const created = await SaleService.createSale({
            product_id,
            rank,
            meta,
            active,
            start_at,
            end_at,
            discount_percent,
            created_by: req.user?.id || null
        }, client);

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'Sale created', created);
    } catch (err) {
        await client.query('ROLLBACK');
        return next(new AppError(err.message || 'Failed to create sale', 500));
    } finally {
        client.release();
    }
});

module.exports.updateSale = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req.body.saleId
        const updates = req.body;
        await client.query('BEGIN');
        const updated = await SaleService.updateSale(id, updates, client);
        if (!updated) { await client.query('ROLLBACK'); return next(new AppError('Not found or invalid updates', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Sale updated', updated);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to update sale', 500));
    } finally {
        client.release();
    }
});

module.exports.deleteSale = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req.body.saleId;
        if (!id) return next(new AppError('saleId required', 400));
        await client.query('BEGIN');
        const removed = await SaleService.deleteSale(id, client);
        if (!removed) { await client.query('ROLLBACK'); return next(new AppError('Not found', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Sale removed', removed);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to remove sale', 500));
    } finally {
        client.release();
    }
});

module.exports.salesListAdmin = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
        const offset = (page - 1) * limit;
        const items = await SaleService.listSales({ limit, offset, include_inactive: true }, client);
        return sendResponse(res, 200, true, 'Sales fetched', { total: items.length, items });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.createSaleByCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { image_url, redirect_url, title, button_text } = req.body;
        if (!title) return next(new AppError('title required', 400));

        await client.query('BEGIN');

        const created = await SaleService.createSaleByCategory({
            image_url,
            redirect_url,
            title,
            button_text,
            created_by: req.user?.id || null
        }, client);

        await client.query('COMMIT');
        return sendResponse(res, 201, true, 'Sale created', created);
    } catch (err) {
        await client.query('ROLLBACK');
        return next(new AppError(err.message || 'Failed to create sale', 500));
    } finally {
        client.release();
    }
});

module.exports.updateSaleByCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req.body.saleId
        const updates = req.body;
        await client.query('BEGIN');
        const updated = await SaleService.updateSaleByCategory(id, updates, client);
        if (!updated) { await client.query('ROLLBACK'); return next(new AppError('Not found or invalid updates', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Sale updated', updated);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to update sale', 500));
    } finally {
        client.release();
    }
});

module.exports.deleteSaleByCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const id = req.query?.saleId;
        if (!id) return next(new AppError('saleId required', 400));
        await client.query('BEGIN');
        const removed = await SaleService.deleteSaleByCategory(id, client);
        if (!removed) { await client.query('ROLLBACK'); return next(new AppError('Not found', 404)); }
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Sale removed', removed);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to remove sale', 500));
    } finally {
        client.release();
    }
});

module.exports.listSaleByCategoriesAdmin = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '5', 10)));
        const offset = (page - 1) * limit;
        const items = await SaleService.listSaleByCategories({ limit, offset }, client);
        return sendResponse(res, 200, true, 'Sales fetched', { total: items.length, items });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});
