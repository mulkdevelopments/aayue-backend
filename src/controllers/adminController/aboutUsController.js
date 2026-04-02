// controllers/AboutUsController.js
const dbPool = require("../../db/dbConnection");
const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");

const AboutUsService = require("../../services/aboutUsService");

function mapBody(body) {
    return {
        summary_heading: body.summary_heading || null,
        summary_subheading: body.summary_subheading || null,
        summary_text: body.summary_text || null,
        summary_banner: body.summary_banner || null,

        top_title: body.top_title || null,
        top_subtitle: body.top_subtitle || null,
        top_text: body.top_text || null,
        top_image_url: body.top_image_url || null,

        middle_title: body.middle_title || null,
        middle_subtitle: body.middle_subtitle || null,
        middle_text: body.middle_text || null,
        middle_image_url: body.middle_image_url || null,

        bottom_title: body.bottom_title || null,
        bottom_subtitle: body.bottom_subtitle || null,
        bottom_text: body.bottom_text || null,
        bottom_image_url: body.bottom_image_url || null,
    };
}

// ---------------------- GET ----------------------
module.exports.getAboutUs = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const aboutUs = await AboutUsService.getAboutUs(client);

        if (!aboutUs) return sendResponse(res, 200, true, "About Us data not found", null);

        const formatted = {
            id: aboutUs.id,
            summary: {
                heading: aboutUs.summary_heading,
                subheading: aboutUs.summary_subheading,
                text: aboutUs.summary_text,
                summary_banner: aboutUs.summary_banner
            },
            top: {
                title: aboutUs.top_title,
                subtitle: aboutUs.top_subtitle,
                text: aboutUs.top_text,
                image_url: aboutUs.top_image_url
            },
            middle: {
                title: aboutUs.middle_title,
                subtitle: aboutUs.middle_subtitle,
                text: aboutUs.middle_text,
                image_url: aboutUs.middle_image_url
            },
            bottom: {
                title: aboutUs.bottom_title,
                subtitle: aboutUs.bottom_subtitle,
                text: aboutUs.bottom_text,
                image_url: aboutUs.bottom_image_url
            },
            created_at: aboutUs.created_at,
            updated_at: aboutUs.updated_at,
            deleted_at: aboutUs.deleted_at,
        };

        return sendResponse(res, 200, true, "About Us data fetched", formatted);
    } catch (err) {
        return next(new AppError(err.message, 500));
    } finally {
        client.release();
    }
});

// ---------------------- CREATE / UPDATE ----------------------
module.exports.saveAboutUs = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        if (!req.body) {
            return next(new AppError("Request body is missing", 400));
        }
        const body = mapBody(req.body);

        // check existing
        const existing = await AboutUsService.getAboutUs(client);

        let data;
        if (!existing) {
            data = await AboutUsService.createAboutUs(body, client);
        } else {
            data = await AboutUsService.updateAboutUs(existing.id, body, client);
        }

        return sendResponse(res, 200, true, "About Us saved successfully", data);
    } catch (err) {
        return next(new AppError(err.message, 500));
    } finally {
        client.release();
    }
});
