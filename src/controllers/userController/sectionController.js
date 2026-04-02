// controllers/public/sectionController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const SectionService = require('../../services/sectionService');
const sendResponse = require('../../utils/sendResponse');

module.exports.getActiveSections = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const rows = await SectionService.listActive(client);
        // map to simple object for consumer, optionally include meta to instruct front-end which API to call
        const items = rows.map(r => ({
            key: r.key,
            label: r.label,
            meta: r.meta || {},
            rank: r.rank
        }));
        return sendResponse(res, 200, true, 'Active sections fetched', items);
    } finally {
        client.release();
    }
});
