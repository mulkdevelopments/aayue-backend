// controllers/cloudinaryUploads.js
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");
const sendResponse = require("../utils/sendResponse");
const catchAsync = require("../errorHandling/catchAsync");
const util = require("util");

let pLimit = null;
const getPLimit = async () => {
    if (!pLimit) {
        const mod = await import("p-limit");
        pLimit = mod.default || mod;
    }
    return pLimit;
};

// optional: try to require sharp for resizing (not required)
let sharp = null;
try {
    sharp = require("sharp");
} catch (e) {
    // sharp is optional; if absent we'll upload full-size images
}

/**
 * Config (tune via env vars)
 * CLOUDINARY_CONCURRENCY: number of parallel uploads (default 6)
 * CLOUDINARY_UPLOAD_RETRIES: retry attempts (default 3)
 * CLOUDINARY_ENABLE_RESIZE: "true"/"false" to enable resizing
 * CLOUDINARY_RESIZE_WIDTH: width in px to resize (default 1600)
 */
const CONCURRENCY = parseInt(process.env.CLOUDINARY_CONCURRENCY, 10) || 6;
const MAX_RETRIES = parseInt(process.env.CLOUDINARY_UPLOAD_RETRIES, 10) || 3;
const ENABLE_RESIZE = (process.env.CLOUDINARY_ENABLE_RESIZE === "true") && !!sharp;
const RESIZE_WIDTH = parseInt(process.env.CLOUDINARY_RESIZE_WIDTH, 10) || 1600;

/**
 * uploadStream: wraps cloudinary.uploader.upload_stream into a Promise
 */
const uploadStream = (buffer, folder = "products") =>
    new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        streamifier.createReadStream(buffer).pipe(stream);
    });

/**
 * optionally resize buffer using sharp (if enabled)
 */
const maybeResizeBuffer = async (buffer) => {
    if (!ENABLE_RESIZE) return buffer;
    try {
        const resized = await sharp(buffer)
            .rotate() // auto-orient
            .resize({ width: RESIZE_WIDTH, withoutEnlargement: true })
            .toBuffer();
        return resized;
    } catch (err) {
        // if resize fails, fallback to original buffer
        console.warn("sharp resize failed, uploading original buffer:", err.message || err);
        return buffer;
    }
};

/**
 * retry wrapper with exponential backoff + jitter
 */
async function retryUpload(buffer, folder = "products", maxAttempts = MAX_RETRIES) {
    let attempt = 0;
    const baseDelay = 200; // ms
    while (true) {
        attempt += 1;
        try {
            const result = await uploadStream(buffer, folder);
            return result;
        } catch (err) {
            if (attempt >= maxAttempts) {
                // bubble final error
                throw err;
            }
            // exponential backoff with jitter
            const backoff = baseDelay * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * 100);
            const waitMs = backoff + jitter;
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
}

/**
 * Public: uploadProductImages (no disk)
 */
module.exports.uploadProductImages = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return sendResponse(res, 400, false, "No images uploaded");
        }

        const limit = (await getPLimit())(CONCURRENCY);

        // map each file to a limited task that optionally resizes then retries upload
        const tasks = req.files.map((file) =>
            limit(async () => {
                try {
                    const bufferToUpload = await maybeResizeBuffer(file.buffer);
                    const result = await retryUpload(bufferToUpload, "products");
                    return { success: true, result };
                } catch (err) {
                    return { success: false, error: err.message || err.toString() };
                }
            })
        );

        const settled = await Promise.all(tasks); // concurrency enforced by p-limit

        const uploaded = settled
            .filter((s) => s.success)
            .map((s) => ({ url: s.result.secure_url, public_id: s.result.public_id }));

        const failed = settled
            .filter((s) => !s.success)
            .map((s) => ({ error: s.error }));

        // 207-like response: partial success possible
        const statusCode = uploaded.length > 0 ? 200 : 500;
        const message =
            failed.length === 0
                ? "Images uploaded successfully"
                : uploaded.length > 0
                    ? "Partial success: some images failed to upload"
                    : "All uploads failed";

        return sendResponse(res, statusCode, failed.length === 0, message, {
            uploaded,
            failed,
        });
    } catch (error) {
        console.error("Cloudinary upload error:", error);
        return sendResponse(res, 500, false, "Image upload failed", error.message || error);
    }
};

/**
 * Public: uploadHeroImages (uses 'hero' folder)
 */
module.exports.uploadHeroImages = catchAsync(async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) {
            return sendResponse(res, 400, false, "No images uploaded");
        }

        const limit = (await getPLimit())(CONCURRENCY);

        const tasks = req.files.map((file) =>
            limit(async () => {
                try {
                    const bufferToUpload = await maybeResizeBuffer(file.buffer);
                    const result = await retryUpload(bufferToUpload, "hero");
                    return { success: true, result };
                } catch (err) {
                    return { success: false, error: err.message || err.toString() };
                }
            })
        );

        const settled = await Promise.all(tasks);

        const uploaded = settled
            .filter((s) => s.success)
            .map((s) => ({ url: s.result.secure_url, public_id: s.result.public_id }));

        const failed = settled
            .filter((s) => !s.success)
            .map((s) => ({ error: s.error }));

        const statusCode = uploaded.length > 0 ? 200 : 500;
        const message =
            failed.length === 0
                ? "Hero images uploaded successfully"
                : uploaded.length > 0
                    ? "Partial success: some hero images failed to upload"
                    : "All hero uploads failed";

        return sendResponse(res, statusCode, failed.length === 0, message, {
            uploaded,
            failed,
        });
    } catch (error) {
        console.error("Cloudinary upload error:", error);
        return sendResponse(res, 500, false, "Hero image upload failed", error.message || error);
    }
});

async function retryUploadVideo(buffer, folder = 'hero', maxRetries = 3) {
    let attempt = 0;
    let lastError;

    while (attempt < maxRetries) {
        try {
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    {
                        folder,
                        resource_type: 'video', // 👈 IMPORTANT for videos
                    },
                    (err, res) => {
                        if (err) return reject(err);
                        resolve(res);
                    }
                );

                uploadStream.end(buffer);
            });

            return result;
        } catch (err) {
            lastError = err;
            attempt += 1;
            if (attempt >= maxRetries) break;

            // small delay between retries
            await new Promise((r) => setTimeout(r, 500 * attempt));
        }
    }

    throw lastError || new Error('Video upload failed after retries');
}

module.exports.uploadBanners = catchAsync(async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) {
            return sendResponse(res, 400, false, 'No files uploaded');
        }

        const limit = (await getPLimit())(CONCURRENCY);

        const tasks = req.files.map((file) =>
            limit(async () => {
                const mime = file.mimetype || '';
                const isImage = mime.startsWith('image/');
                const isVideo = mime.startsWith('video/');

                const type = isVideo ? 'video' : 'image';

                try {
                    let bufferToUpload = file.buffer;
                    let result;

                    if (isImage) {
                        // ✅ Images → optional resize + existing retryUpload helper
                        bufferToUpload = await maybeResizeBuffer(file.buffer);
                        result = await retryUpload(bufferToUpload, 'hero'); // your existing helper
                    } else if (isVideo) {
                        // ✅ Videos → no resize, use video-specific upload
                        result = await retryUploadVideo(bufferToUpload, 'hero');
                    } else {
                        throw new Error(`Unsupported file type: ${mime}`);
                    }

                    return {
                        success: true,
                        type,
                        original_name: file.originalname,
                        mimetype: mime,
                        result,
                    };
                } catch (err) {
                    return {
                        success: false,
                        type,
                        original_name: file.originalname,
                        mimetype: mime,
                        error: err.message || err.toString(),
                    };
                }
            })
        );

        const settled = await Promise.all(tasks);

        const uploaded = settled
            .filter((s) => s.success)
            .map((s) => ({
                url: s.result.secure_url,
                public_id: s.result.public_id,
                type: s.type, // 'image' | 'video'
                original_name: s.original_name,
                mimetype: s.mimetype,
            }));

        const failed = settled
            .filter((s) => !s.success)
            .map((s) => ({
                type: s.type,
                original_name: s.original_name,
                mimetype: s.mimetype,
                error: s.error,
            }));

        const statusCode = uploaded.length > 0 ? 200 : 500;
        const message =
            failed.length === 0
                ? 'Banners uploaded successfully'
                : uploaded.length > 0
                    ? 'Partial success: some banners failed to upload'
                    : 'All banner uploads failed';

        return sendResponse(res, statusCode, failed.length === 0, message, {
            uploaded,
            failed,
        });
    } catch (error) {
        console.error('Banner upload error:', error);
        return sendResponse(
            res,
            500,
            false,
            'Banner upload failed',
            error.message || error
        );
    }
});

