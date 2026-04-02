// controllers/newsletterController.js
const { randomUUID } = require("crypto");
const db = require("../../db/dbConnection"); // adjust path to your pg pool
const AppError = require("../../errorHandling/AppError");
const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");

/**
 * PUBLIC: Subscribe to newsletter
 * POST /api/v1/newsletter/subscribe
 * body: { email, name? }
 */
module.exports.subscribeNewsletter = catchAsync(async (req, res, next) => {
    const { email } = req.body || {};

    if (!email) {
        return next(new AppError("Email is required", 400));
    }

    const emailTrimmed = String(email).trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailTrimmed)) {
        return next(new AppError("Invalid email format", 400));
    }

    const id = randomUUID();

    const sql = `
        INSERT INTO newsletter_subscribers (
            id, email, is_active, created_at, updated_at
        )
        VALUES ($1, $2, true, NOW(), NOW())
        ON CONFLICT (email)
        DO UPDATE SET
            is_active = true,
            updated_at = NOW()
        RETURNING id, email, is_active, created_at, updated_at
    `;

    const result = await db.query(sql, [id, emailTrimmed]);

    return sendResponse(res, 200, true, "Subscribed to newsletter successfully", {
        subscriber: result.rows[0],
    });
});


/**
 * PUBLIC: Unsubscribe from newsletter
 * POST /api/v1/newsletter/unsubscribe
 * body: { email }
 */
module.exports.unsubscribeNewsletter = catchAsync(async (req, res, next) => {
    const { email } = req.body || {};

    if (!email) {
        return next(new AppError("Email is required", 400));
    }

    const emailTrimmed = String(email).trim().toLowerCase();

    const sql = `
        UPDATE newsletter_subscribers
        SET is_active = false,
            updated_at = NOW()
        WHERE email = $1
        RETURNING id, email, name, is_active, created_at, updated_at
    `;

    const result = await db.query(sql, [emailTrimmed]);

    if (result.rowCount === 0) {
        // optionally: do not treat as error, just say "already unsubscribed"
        return sendResponse(res, 200, true, "You are not subscribed or already unsubscribed", null);
    }

    return sendResponse(res, 200, true, "Unsubscribed from newsletter successfully", {
        subscriber: result.rows[0],
    });
});

/**
 * ADMIN: Get all subscribers
 * GET /api/v1/admin/newsletter-subscribers
 */
module.exports.getAllNewsletterSubscribers = catchAsync(async (req, res, next) => {
    const result = await db.query(
        `SELECT id, email, is_active, created_at, updated_at
         FROM newsletter_subscribers
         ORDER BY created_at DESC`
    );

    return sendResponse(res, 200, true, "Newsletter subscribers fetched", result.rows);
});

/**
 * ADMIN: Delete a subscriber (hard delete)
 * DELETE /api/v1/admin/newsletter-subscribers/:id
 */
module.exports.deleteNewsletterSubscriber = catchAsync(async (req, res, next) => {
    const id = req.query.id;
    if (!id) {
        return next(new AppError("Subscriber ID is required", 400));
    }

    const result = await db.query(
        `DELETE FROM newsletter_subscribers WHERE id = $1 RETURNING id`,
        [id]
    );

    if (result.rowCount === 0) {
        return next(new AppError("Subscriber not found", 404));
    }

    return sendResponse(res, 200, true, "Subscriber deleted");
});
