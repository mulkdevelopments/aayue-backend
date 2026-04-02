// controllers/public/newArrivalController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const NewArrivalService = require('../../services/newArrivalService');
const sendResponse = require('../../utils/sendResponse');

module.exports.getActiveNewArrivals = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '100', 10)));
        const offset = (page - 1) * limit;

        const rows = await NewArrivalService.fetchActiveNewArrivals({ limit, offset }, client);

        // simple pagination total approximation: you can add COUNT(*) query if you need exact totals
        return sendResponse(res, 200, true, 'New arrivals fetched', {
            total: rows.length,
            page,
            limit,
            items: rows.map(r => ({
                id: r.new_arrival_id,
                rank: r.rank,
                meta: r.meta,
                product: r.product
            }))
        });
    } catch (err) {
        return next(err);
    } finally {
        client.release();
    }
});
