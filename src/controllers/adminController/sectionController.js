// controllers/admin/sectionController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const SectionService = require('../../services/sectionService');
const AppError = require('../../errorHandling/AppError');
const sendResponse = require('../../utils/sendResponse');

module.exports.list = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const rows = await SectionService.listAll(client);
        return sendResponse(res, 200, true, 'Sections fetched', rows);
    } finally {
        client.release();
    }
});

module.exports.getSectionByKey = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const key = req.query.key;
        if (!key) return next(new AppError('Section key required', 400));
        if (!['brand_spotlight', 'new_arrivals', 'best_seller', 'sale'].includes(key)) return next(new AppError('Invalid section key', 400));
        const row = await SectionService.getByKey(key, client);
        if (!row) return next(new AppError('Section not found', 404));
        return sendResponse(res, 200, true, 'Section fetched', row);
    } finally {
        client.release();
    }
});

/**
 * Toggle or update a section (admin)
 * body: { active: true|false, label?: string, meta?: {...}, rank?: number }
 */
module.exports.updateHomeSection = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const key = req.body.key;
        const { active = null, label = null, meta = null, rank = null } = req.body;
        // optionally validate allowed keys
        const allowedKeys = new Set(['brand_spotlight', 'new_arrivals', 'best_seller', 'sale']);
        if (!allowedKeys.has(key)) return next(new AppError('Invalid section key', 400));

        await client.query('BEGIN');
        const updated = await SectionService.upsertByKey({ key, active, label, meta, rank, created_by: req.user?.id || null }, client);
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Section updated', updated);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(err);
    } finally {
        client.release();
    }
});

/**
 * Bulk toggle (admin)
 * body: { keys: ['brand_spotlight','sale'], active: true }
 */
module.exports.bulkUpdate = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const { keys, active } = req.body;
        if (!Array.isArray(keys) || keys.length === 0) return next(new AppError('keys array required', 400));
        await client.query('BEGIN');
        const rows = await SectionService.bulkSet(keys, !!active, client);
        await client.query('COMMIT');
        return sendResponse(res, 200, true, 'Sections updated', rows);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(err);
    } finally {
        client.release();
    }
});
