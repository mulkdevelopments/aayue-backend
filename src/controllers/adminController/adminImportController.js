// controllers/adminImportController.js
const importService = require('../../services/importServices');
const importBdroppyHelpers = require('../importController/bdroppy/importHelper');
const importBdroppyService = require('../importController/bdroppy/importServices');
const luxuryImportService = require('../importController/luxuryDistibution/luxuryImportService');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const db = require('../../db/dbConnection');

function parsePositiveInt(v) {
    if (typeof v === 'undefined' || v === null || v === '') return undefined;
    const n = Number.parseInt(v, 10);
    if (!Number.isInteger(n) || n < 1) return undefined;
    return n;
}

async function uploadProducts(req, res) {
    try {
        if (!req.file || !req.file.buffer) {
            return res
                .status(400)
                .json({ ok: false, message: 'CSV file is required as "file" field' });
        }

        const opts = {};

        const concurrency = parseInt(req.body.concurrency);
        if (!isNaN(concurrency) && concurrency > 0) {
            opts.concurrency = concurrency;
        }

        const { currency, conversion_rate, increment_percent } = req.body;

        if (!currency || typeof currency !== "string") {
            return res
                .status(400)
                .json({ ok: false, message: "Currency is required (e.g. 'EUR')" });
        }

        if (!conversion_rate || isNaN(conversion_rate)) {
            return res
                .status(400)
                .json({ ok: false, message: "Valid conversion_rate is required" });
        }

        if (!increment_percent || isNaN(increment_percent)) {
            return res
                .status(400)
                .json({ ok: false, message: "Valid increment_percent is required" });
        }

        opts.currency = currency.toUpperCase();
        opts.conversion_rate = parseFloat(conversion_rate);
        opts.increment_percent = parseFloat(increment_percent);

        const errFileDir = path.join(__dirname, '../../../uploads/errorfiles');

        if (!fs.existsSync(errFileDir)) {
            fs.mkdirSync(errFileDir, { recursive: true });
        }

        const errorFileName = `import_errors_${Date.now()}.jsonl`;
        const fullErrorFilePath = path.join(errFileDir, errorFileName);

        opts.errFileDir = errFileDir;
        opts.errorFileName = errorFileName;
        opts.errorFullPath = fullErrorFilePath;

        fs.writeFileSync(fullErrorFilePath, '');

        const result = await importService.processCSVBuffer(
            req.file.buffer,
            opts
        );

        // 🔥 INSERT INTO DATABASE
        await db.query(
            `INSERT INTO import_error_logs 
                (vendor_id, file_name, file_path, total_errors) 
             VALUES ($1, $2, $3, $4)`,
            [
                req.body.vendor_id || 'b34fd0f6-815a-469e-b7c2-73f9e8afb3ed',
                errorFileName,
                `/uploads/errorfiles/${errorFileName}`,
                result.errorCount || 0
            ]
        );

        return res.status(200).json({
            ok: true,
            message: "CSV import completed",
            processed: result.processedCount,
            errors: result.errorCount,
            errorsPath: `/uploads/errorfiles/${errorFileName}`,
        });

    } catch (err) {
        console.error("uploadProducts error:", err);
        return res
            .status(500)
            .json({ ok: false, message: "Import failed", error: err.message });
    }
}


//before currency and increment percent added
/* async function uploadProducts(req, res) {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ ok: false, message: 'CSV file is required as "file" field' });
        }

        // build opts only when provided and valid
        const opts = {};
        const concurrency = parsePositiveInt(req.body.concurrency);
        if (typeof concurrency !== 'undefined') opts.concurrency = concurrency;

        const result = await importService.processCSVBuffer(req.file.buffer, opts);

        return res.status(200).json({
            ok: true,
            message: 'CSV import completed',
            processed: result.processedCount,
            errors: result.errorCount,
            errorsPath: result.errorsPath
        });
    } catch (err) {
        console.error('uploadProducts error:', err);
        return res.status(500).json({ ok: false, message: 'Import failed', error: err.message });
    }
} */


//before currency and increment percent added
/* async function uploadBdroppy(req, res) {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ ok: false, message: 'CSV file is required as "file" field' });
        }

        // build opts only when provided and valid
        const opts = {};
        const concurrency = parsePositiveInt(req.body.concurrency);
        if (typeof concurrency !== 'undefined') opts.concurrency = concurrency;

        const result = await importBdroppyService.processCSVBuffer(req.file.buffer, opts);

        return res.status(200).json({
            ok: true,
            message: 'CSV import completed',
            processed: result.processedCount,
            errors: result.errorCount,
            errorsPath: result.errorsPath
        });
    } catch (err) {
        console.error('uploadProducts error:', err);
        return res.status(500).json({ ok: false, message: 'Import failed', error: err.message });
    }
} */

async function uploadBdroppy(req, res) {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                ok: false,
                message: 'CSV file is required as "file" field'
            });
        }

        const opts = {};
        const concurrency = parseInt(req.body.concurrency);
        if (!isNaN(concurrency) && concurrency > 0) opts.concurrency = concurrency;

        const currency = req.body.currency;
        const conversion_rate = req.body.conversion_rate;
        const increment_percent = req.body.increment_percent;

        if (!currency || typeof currency !== 'string') {
            return res.status(400).json({ ok: false, message: 'currency is required (e.g. EUR)' });
        }
        if (!conversion_rate || isNaN(conversion_rate)) {
            return res.status(400).json({ ok: false, message: 'valid conversion_rate is required' });
        }
        if (!increment_percent || isNaN(increment_percent)) {
            return res.status(400).json({ ok: false, message: 'valid increment_percent is required' });
        }

        opts.currency = currency.toUpperCase();
        opts.conversion_rate = parseFloat(conversion_rate);
        opts.increment_percent = parseFloat(increment_percent);

        const fileBuffer = req.file.buffer;

        // Folder for saving error files
        const errFileDir = path.join(__dirname, '../../../uploads/errorfiles');

        if (!fs.existsSync(errFileDir)) {
            fs.mkdirSync(errFileDir, { recursive: true });
        }

        // Create error filename
        const errorFileName = `bdroppy_import_errors_${Date.now()}.jsonl`;
        const fullErrorFilePath = path.join(errFileDir, errorFileName);

        // Pass to background service
        opts.errFileDir = errFileDir;
        opts.errorFileName = errorFileName;
        opts.errorFullPath = fullErrorFilePath;

        fs.writeFileSync(fullErrorFilePath, '');

        // ⭐ SAVE entry to DB BEFORE background processing
        const insertResult = await db.query(
            `INSERT INTO import_error_logs (vendor_id, file_name, file_path, total_errors)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [
                req.body.vendor_id || 'a6bdd96b-0e2c-4f3e-b644-4e088b1778e0',
                errorFileName,
                `/uploads/errorfiles/${errorFileName}`,
                0 // initial 0, will update later
            ]
        );

        const logId = insertResult.rows[0].id;

        // -------------------------------
        // 🔥 Background processing
        // -------------------------------
        setImmediate(async () => {
            let finalErrorCount = 0;

            try {
                logger.info({ msg: 'BDroppy import started (background)', fileSize: fileBuffer.length });

                // Run processing
                const result = await importBdroppyService.processCSVBuffer(fileBuffer, opts);

                finalErrorCount = result.errorCount;

                logger.info({ msg: 'BDroppy import finished', result });

            } catch (e) {
                finalErrorCount += 1;

                const errLine = {
                    error: e.message || String(e),
                    time: new Date().toISOString()
                };

                try {
                    fs.appendFileSync(fullErrorFilePath, JSON.stringify(errLine) + '\n');
                } catch (_) { }

                logger.error({ err: e.message || e }, 'BDroppy background import failed');
            }

            // 🔥 Update DB with final error count
            await db.query(
                `UPDATE import_error_logs
                 SET total_errors = $1
                 WHERE id = $2`,
                [finalErrorCount, logId]
            );
        });

        // -------------------------------
        // 🔥 Immediate Response
        // -------------------------------
        return res.status(202).json({
            ok: true,
            message: 'BDroppy import started in background',
            errorsPath: `/uploads/errorfiles/${errorFileName}`,
            note: 'Check import logs after processing finishes.'
        });

    } catch (err) {
        console.error('uploadBdroppy error:', err);
        return res.status(500).json({
            ok: false,
            message: 'Import failed',
            error: err.message
        });
    }
}



// function parsePositiveInt(x) {
//     const n = Number(x);
//     return Number.isInteger(n) && n > 0 ? n : undefined;
// }

async function uploadLuxuary(req, res) {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ ok: false, message: 'CSV file is required as "file" field' });
        }

        const opts = {};
        const concurrency = parsePositiveInt(req.body.concurrency);
        if (typeof concurrency !== 'undefined') opts.concurrency = concurrency;

        const result = await luxuryImportService.processCSVBuffer(req.file.buffer, opts);

        return res.status(200).json({
            ok: true,
            message: 'Vendor LD CSV import completed',
            processed: result.processedCount,
            errors: result.errorCount,
            errorsPath: result.errorsPath,
        });
    } catch (err) {
        console.error('uploadVendorLdProducts error:', err);
        return res.status(500).json({ ok: false, message: 'Import failed', error: err.message });
    }
}

module.exports = { uploadProducts, uploadBdroppy, uploadLuxuary };
