// controllers/public/saleController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const SaleService = require('../../services/saleService');
const sendResponse = require('../../utils/sendResponse');

module.exports.getActiveSales = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
        const offset = (page - 1) * limit;

        const rows = await SaleService.fetchActiveSales({ limit, offset }, client);

        return sendResponse(res, 200, true, 'Sales fetched', {
            total: rows.length,
            page,
            limit,
            items: rows
        });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});

module.exports.getSalesByCategory = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
        const offset = (page - 1) * limit;

        const rows = await SaleService.listSaleByCategories({ limit, offset }, client);

        return sendResponse(res, 200, true, 'Sales fetched', {
            total: rows.length,
            page,
            limit,
            items: rows
        });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});
