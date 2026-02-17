// controllers/homeBannerController.js
const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const catchAsync = require("../../errorHandling/catchAsync");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
require("dotenv").config({ path: "../../../.env" });
const dbPool = require("../../db/dbConnection");
const cloudinary = require("../../config/cloudinary");
// const dbPool = new Pool({
//   connectionString: process.env.DATABASE_URL,
//   max: parseInt(process.env.PG_MAX_CLIENTS || "20", 10),
// });

// allowed slots for safety
const VALID_SLOTS = [
  "top-banner",
  "below-top-banner",
  "middle-banner",
  "bottom-top-banner",
  "bottom-left-banner",
];

/**
 * Normalize a banner payload and validate slot.
 */
function normalizeBannerPayload(raw) {
  if (!raw || typeof raw !== "object") return null;

  const slot = String(raw.slot || "").trim();
  if (!VALID_SLOTS.includes(slot)) {
    throw new AppError(`Invalid slot: ${slot}`, 400);
  }

  return {
    slot,
    media_type: raw.media_type || null, // 'image' | 'video'
    media_url: raw.media_url || null,
    title: raw.title || null,
    subtitle: raw.subtitle || null,
    button_text: raw.button_text || null,
    link_url: raw.link_url || null,
    is_active: typeof raw.is_active === "boolean" ? raw.is_active : true,
    sort_order: Number.isFinite(raw.sort_order) ? raw.sort_order : 0,
    metadata: raw.metadata || null,
  };
}

const deleteCloudinaryAsset = async (assetUrl) => {
  if (!assetUrl) return;
  let parsedUrl;
  try {
    parsedUrl = new URL(assetUrl);
  } catch (err) {
    return;
  }

  const parts = parsedUrl.pathname.split("/").filter(Boolean);
  const uploadIndex = parts.findIndex((part) => part === "upload");
  if (uploadIndex === -1 || uploadIndex + 1 >= parts.length) return;

  const resourceType = parts[uploadIndex - 1] || "image";
  let publicParts = parts.slice(uploadIndex + 1);
  if (publicParts[0] && /^v\d+$/.test(publicParts[0])) {
    publicParts = publicParts.slice(1);
  }
  const filename = publicParts.join("/");
  const publicId = filename.replace(/\.[^/.]+$/, "");
  if (!publicId) return;

  await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
};

/**
 * GET /home-banners
 * Public/frontend endpoint - returns all banner slots.
 */
exports.getHomeBanners = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `
      SELECT
        slot,
        media_type,
        media_url,
        title,
        subtitle,
        button_text,
        link_url,
        is_active,
        sort_order,
        metadata
      FROM home_banners
      ORDER BY sort_order ASC, slot ASC
      `
    );

    // Group as object by slot for easier frontend use
    const data = {};
    for (const row of rows) {
      data[row.slot] = {
        media_type: row.media_type,
        media_url: row.media_url,
        title: row.title,
        subtitle: row.subtitle,
        button_text: row.button_text,
        link_url: row.link_url,
        is_active: row.is_active,
        sort_order: row.sort_order,
        metadata: row.metadata,
      };
    }

    return sendResponse(
      res,
      200,
      true,
      "Home banners fetched successfully",
      data
    );
  } catch (err) {
    return next(
      new AppError(err.message || "Failed to fetch home banners", 500)
    );
  } finally {
    client.release();
  }
});

/**
 * PUT /admin/home-banners
 * Admin API – upsert multiple slots in a single call.
 *
 * Body example:
 * {
 *   "banners": [
 *     { "slot": "top-banner", "media_type": "image", "media_url": "...", "link_url": null },
 *     { "slot": "below-top-banner", "media_type": "image", "media_url": "...", "title": "Shop now", "link_url": "/shop" },
 *     ...
 *   ]
 * }
 */
exports.upsertHomeBanners = catchAsync(async (req, res, next) => {
  const { banners } = req.body;

  if (!Array.isArray(banners) || banners.length === 0) {
    return next(new AppError("banners array is required", 400));
  }

  // normalize all first so we fail fast on validation
  let normalized = [];
  try {
    normalized = banners.map(normalizeBannerPayload);
  } catch (err) {
    return next(err); // err is AppError from normalizeBannerPayload
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const insertText = `
      INSERT INTO home_banners (
        id, slot, media_type, media_url, title, subtitle,
        button_text, link_url, is_active, sort_order, metadata, created_at, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11::jsonb, now(), now()
      )
      ON CONFLICT (slot)
      DO UPDATE SET
        media_type   = EXCLUDED.media_type,
        media_url    = EXCLUDED.media_url,
        title        = EXCLUDED.title,
        subtitle     = EXCLUDED.subtitle,
        button_text  = EXCLUDED.button_text,
        link_url     = EXCLUDED.link_url,
        is_active    = EXCLUDED.is_active,
        sort_order   = EXCLUDED.sort_order,
        metadata     = EXCLUDED.metadata,
        updated_at   = now()
      RETURNING slot
    `;

    const updatedSlots = [];

    for (const b of normalized) {
      const id = randomUUID();
      const values = [
        id, // $1 id
        b.slot, // $2 slot
        b.media_type, // $3 media_type
        b.media_url, // $4 media_url
        b.title, // $5 title
        b.subtitle, // $6 subtitle
        b.button_text, // $7 button_text
        b.link_url, // $8 link_url
        b.is_active, // $9 is_active
        b.sort_order, // $10 sort_order
        b.metadata ? JSON.stringify(b.metadata) : null, // $11 metadata
      ];

      const result = await client.query(insertText, values);
      updatedSlots.push(result.rows[0].slot);
    }

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Home banners updated successfully", {
      updatedSlots,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return next(
      new AppError(err.message || "Failed to update home banners", 500)
    );
  } finally {
    client.release();
  }
});

module.exports.upsertOverlayGrid = catchAsync(async (req, res, next) => {
  let client;

  try {
    const { id, title, mrp, sale_price, product_image, product_redirect_url } =
      req.body;

    client = await dbPool.connect();

    let result;

    if (id) {
      // 1️⃣ Update using ID
      const existing = await client.query(
        "SELECT id, product_image FROM overlaygrid WHERE id = $1",
        [id]
      );

      if (existing.rows.length > 0) {
        const previousImage = existing.rows[0]?.product_image || null;
        result = await client.query(
          `UPDATE overlaygrid 
           SET title=$1, mrp=$2, sale_price=$3, product_image=$4, product_redirect_url=$5, updated_at=NOW()
           WHERE id=$6
           RETURNING *`,
          [title, mrp, sale_price, product_image, product_redirect_url, id]
        );

        if (previousImage && product_image && previousImage !== product_image) {
          try {
            await deleteCloudinaryAsset(previousImage);
          } catch (err) {
            console.warn(
              "Failed to delete previous overlay image:",
              err.message || err
            );
          }
        }

        return sendResponse(
          res,
          200,
          true,
          "Overlay grid item updated successfully",
          result.rows[0]
        );
      }
    }

    // 2️⃣ Create new item only if < 3
    const count = await client.query("SELECT COUNT(*) FROM overlaygrid");
    const total = Number(count.rows[0].count);

    if (total >= 3) {
      return sendResponse(
        res,
        400,
        false,
        "Only 3 items allowed in overlay grid. Update existing items only.",
        null
      );
    }

    // 3️⃣ CREATE NEW ITEM
    result = await client.query(
      `INSERT INTO overlaygrid 
        (title, mrp, sale_price, product_image, product_redirect_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, mrp, sale_price, product_image, product_redirect_url]
    );

    return sendResponse(
      res,
      201,
      true,
      "Overlay grid item created successfully",
      result.rows[0]
    );
  } catch (err) {
    console.error(err);

    if (client) client.release();
    return next(new AppError("Failed to upsert overlay grid item", 500));
  } finally {
    if (client) client.release();
  }
});

module.exports.getOverlayGrid = catchAsync(async (req, res, next) => {
  let client;
  try {
    client = await dbPool.connect();
    const result = await client.query(
      "SELECT * FROM overlaygrid ORDER BY created_at ASC"
    );

    return sendResponse(
      res,
      200,
      true,
      "Overlay grid items fetched successfully",
      result.rows
    );
  } catch (err) {
    console.error(err);
    return next(new AppError("Failed to fetch overlay grid items", 500));
  } finally {
    client.release();
  }
});

module.exports.deleteOverlayGrid = catchAsync(async (req, res, next) => {
  let client;
  try {
    const { id } = req.query;
    if (!id) {
      return next(new AppError("Overlay id required", 400));
    }

    client = await dbPool.connect();
    const existing = await client.query(
      "SELECT id, product_image FROM overlaygrid WHERE id = $1",
      [id]
    );
    if (!existing.rows.length) {
      return next(new AppError("Overlay not found", 404));
    }

    const result = await client.query(
      `DELETE FROM overlaygrid
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      return next(new AppError("Overlay not found", 404));
    }

    const previousImage = existing.rows[0]?.product_image || null;
    if (previousImage) {
      try {
        await deleteCloudinaryAsset(previousImage);
      } catch (err) {
        console.warn(
          "Failed to delete overlay image from Cloudinary:",
          err.message || err
        );
      }
    }

    return sendResponse(
      res,
      200,
      true,
      "Overlay grid item deleted successfully",
      result.rows[0]
    );
  } catch (err) {
    console.error(err);
    return next(new AppError("Failed to delete overlay grid item", 500));
  } finally {
    if (client) client.release();
  }
});
