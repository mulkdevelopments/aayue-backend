const AppError = require("../../errorHandling/AppError");
const catchAsync = require("../../errorHandling/catchAsync");
const { randomUUID } = require("crypto");
const db = require("../../db/dbConnection");
const sendResponse = require("../../utils/sendResponse");

// CREATE Contact Message
module.exports.createContactMessage = catchAsync(async (req, res, next) => {
    const { first_name, last_name, email, phone, reason_of_contact, message } = req.body;

    // Basic validation
    if (!first_name || !last_name || !email || !message) {
        return next(new AppError("first_name, last_name, email & message are required", 400));
    }

    const id = randomUUID();

    const sql = `
        INSERT INTO contact_messages 
        (id, first_name, last_name, email, phone, reason_of_contact, message, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
    `;

    await db.query(sql, [
        id,
        first_name,
        last_name,
        email,
        phone || null,
        reason_of_contact || null,
        message
    ]);

    return sendResponse(res, 200, true, "Message submitted successfully", {
        id,
        first_name,
        last_name,
        email,
        phone,
        reason_of_contact,
        message
    });
});


// ADMIN: Fetch All Messages
module.exports.getAllContactMessages = catchAsync(async (req, res, next) => {
    const result = await db.query(`SELECT * FROM contact_messages ORDER BY created_at DESC`);
    return sendResponse(res, 200, true, "Contact messages fetched", result.rows);
});


// ADMIN: Single Message
module.exports.getContactMessage = catchAsync(async (req, res, next) => {
    const { id } = req.query;

    const result = await db.query(`SELECT * FROM contact_messages WHERE id=$1`, [id]);

    if (result.rowCount === 0) {
        return next(new AppError("Message not found", 404));
    }

    return sendResponse(res, 200, true, "Contact message fetched", result.rows[0]);
});


// ADMIN: Delete Message
module.exports.deleteContactMessage = catchAsync(async (req, res, next) => {
    const id = req.query.id;
    if (!id) {
        return next(new AppError("Message ID is required", 400));
    }

    const result = await db.query(`DELETE FROM contact_messages WHERE id=$1 RETURNING id`, [id]);

    if (result.rowCount === 0) {
        return next(new AppError("Message not found", 404));
    }

    return sendResponse(res, 200, true, "Message deleted");
});