const catchAsync = require("../../errorHandling/catchAsync");

const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const sendResponse = require("../../utils/sendResponse");
const { isValidUUID } = require("../../utils/basicValidation");

module.exports.upsertPolicy = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const { policy_type, title, content, slug, status } = req.body;

    if (!slug || typeof slug !== "string" || slug.trim() === "") {
      return next(
        new AppError("slug is required and must be a non-empty string", 400)
      );
    }
    if (!policy_type || typeof policy_type !== "string") {
      return next(
        new AppError("policy_type is required and must be a string", 400)
      );
    }
    if (!title || typeof title !== "string") {
      return next(new AppError("title is required and must be a string", 400));
    }
    if (!content || typeof content !== "string") {
      return next(
        new AppError("content is required and must be a string", 400)
      );
    }

    const normalizedSlug = slug.trim().toLowerCase();
    const normalizedType = policy_type.trim().toLowerCase();
    const normalizedTitle = title.trim();
    const normalizedContent = content;
    const normalizedStatus = typeof status === "boolean" ? status : true;

    // Check if exists BEFORE upsert to identify action
    const existsRes = await client.query(
      "SELECT id FROM policies WHERE slug = $1 LIMIT 1",
      [normalizedSlug]
    );

    const existedBefore = existsRes.rowCount > 0;

    const upsertSQL = `
      INSERT INTO policies (policy_type, title, content, slug, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (slug)
      DO UPDATE SET
        policy_type = EXCLUDED.policy_type,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      normalizedType,
      normalizedTitle,
      normalizedContent,
      normalizedSlug,
      normalizedStatus,
    ];

    const result = await client.query(upsertSQL, values);
    const policy = result.rows[0];

    const action = existedBefore ? "updated" : "created";

    return sendResponse(res, 200, true, `Policy ${action} successfully`, {
      policy,
      action,
    });
  } catch (err) {
    console.error("upsertPolicy Error:", err);
    return next(new AppError(err.message || "Failed to upsert policy", 500));
  } finally {
    client.release();
  }
});

module.exports.getPolicy = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();

  try {
    const { policy_type } = req.query; // /api/policy?policy_type=privacy

    if (policy_type) {
      // Get specific policy by type
      const query = `SELECT * FROM policies WHERE policy_type = $1 LIMIT 1`;
      const result = await client.query(query, [policy_type]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Policy not found",
        });
      }

      // return res.json({
      //   success: true,
      //   data: result.rows[0],
      // });

      return sendResponse(res, 200, true, "Policy fetched successfully", {
        policy: result.rows[0],
      });
    }

    // Get ALL policies
    const allQuery = `SELECT * FROM policies ORDER BY created_at DESC`;
    const allResult = await client.query(allQuery);

    // return res.json({
    //   success: true,
    //   data: allResult.rows,
    // });
    return sendResponse(res, 200, true, "Policies fetched successfully", {
      policies: allResult.rows,
    });
  } catch (err) {
    console.log("Get Policy Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  } finally {
    client.release();
  }
});

// module.exports.getPolicy = catchAsync(async (req, res, next) => {
//   const client = await dbPool.connect();

//   try {
//     const { policy_type } = req.query; // /api/policy?policy_type=privacy

//     if (policy_type) {
//       // Get specific policy by type
//       const query = `SELECT * FROM policies WHERE policy_type = $1 LIMIT 1`;
//       const result = await client.query(query, [policy_type]);

//       if (result.rows.length === 0) {
//         return res.status(404).json({
//           success: false,
//           message: "Policy not found",
//         });
//       }

//       return res.json({
//         success: true,
//         data: result.rows[0],
//       });
//     }

//     // Get ALL policies
//     const allQuery = `SELECT * FROM policies ORDER BY created_at DESC`;
//     const allResult = await client.query(allQuery);

//     return res.json({
//       success: true,
//       data: allResult.rows,
//     });
//   } catch (err) {
//     console.log("Get Policy Error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//     });
//   } finally {
//     client.release();
//   }
// });
