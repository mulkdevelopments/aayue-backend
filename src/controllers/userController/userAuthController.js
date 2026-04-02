const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const dbPool = require("../../db/dbConnection");
const AppError = require("../../errorHandling/AppError");
const { UserServices } = require("../../services/userServices");
const { isValidEmail, isValidUUID } = require("../../utils/basicValidation");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");

const { generateAuthUrl: generateGoogleAuthUrl } = require("../../utils/googleAuth");
const appleAuth = require("../../utils/appleAuth");
const { createToken } = require("../../utils/helper");
const {
  OTP_EXPIRY_MS,
  hashUserLoginOtp,
  generateSixDigitOtp,
  buildUserLoginOtpEmailHtml,
} = require("../../utils/userLoginOtp");

// module.exports.registerUser = catchAsync(async (req, res, next) => {
//     let { full_name, email, phone } = req.body;

//     if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
//     email = email.toLowerCase();
//     const client = await dbPool.connect(); // get transaction client
//     try {
//         await client.query("BEGIN"); // start transaction

//         const existingUser = await UserServices.findUserByEmail(email, client);
//         if (existingUser) {
//             throw new AppError("User already exists", 400);
//         }

//         const user = await UserServices.createUser({ full_name, email, phone }, client);

//         const token = generateMagicToken(user.id);
//         const magicLink = `${process.env.CLIENT_URL}/auth?type=magic-login&token=${token}`;

//         await UserServices.updateUserMagicToken({
//             userId: user.id,
//             token,
//             expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min expiry
//         }, client);

//         await client.query("COMMIT"); // commit transaction

//         return sendResponse(res, 200, true, "Magic link sent to your email", { ...user, magicLink });
//     } catch (err) {
//         await client.query("ROLLBACK"); // rollback on error
//         return next(err);
//     } finally {
//         client.release(); // release client
//     }
// });

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "email-smtp.eu-north-1.amazonaws.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOtpEmailToUser(client, user, email, { subject, greetingName, headline, extraParagraph }) {
  const otp = generateSixDigitOtp();
  const otpHash = hashUserLoginOtp(user.id, otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  await UserServices.updateUserMagicToken(
    { userId: user.id, token: otpHash, expiresAt },
    client
  );
  const mailOptions = {
    from: `"${process.env.EMAIL_SENDER_NAME || "AAYEU Support"}" <no-reply@aayeu.com>`,
    to: email,
    subject,
    html: buildUserLoginOtpEmailHtml({
      otp,
      greetingName,
      headline,
      extraParagraph,
    }),
  };
  await transporter.sendMail(mailOptions);
}

module.exports.registerGuestUser = catchAsync(async (req, res, next) => {
  let { full_name, email, phone } = req.body;

  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  email = email.toLowerCase();

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    // ✅ Check if user already exists
    let user = await UserServices.findUserByEmail(email, client);

    if (user) {
      // ✅ If user exists → no updates, only generate access token
      const accessToken = jwt.sign(
        { userId: user.id },
        process.env.JWT_SECRET,
        { expiresIn: "365d" }
      );

      await client.query("COMMIT");

      return sendResponse(res, 200, true, "Login successful", {
        ...user,
        accessToken,
      });
    }

    // ✅ If new user → create entry
    user = await UserServices.createUser(
      {
        full_name,
        email,
        phone,
        provider: "local",
        google_sub: null,
        apple_sub: null,
      },
      client
    );

    // ✅ Generate magic token (15 min)
    const magic_token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });
    const magic_token_expires = new Date(Date.now() + 15 * 60 * 1000);

    // ✅ Save magic token info in DB
    await UserServices.updateUserMagicToken(
      {
        userId: user.id,
        token: magic_token,
        expiresAt: magic_token_expires,
      },
      client
    );

    // ✅ Generate access token (365 days)
    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "365d",
    });

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Login successful", {
      ...user,
      magic_token,
      magic_token_expires,
      accessToken,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.registerUser = catchAsync(async (req, res, next) => {
  let { full_name, email, phone } = req.body;

  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  email = email.toLowerCase();

  const client = await dbPool.connect(); // get transaction client
  try {
    await client.query("BEGIN"); // start transaction

    // ✅ Check if user already exists
    const existingUser = await UserServices.findUserByEmail(email, client);
    if (existingUser) throw new AppError("User already exists", 400);

    // ✅ Create new user
    const user = await UserServices.createUser(
      {
        full_name,
        email,
        phone,
        provider: "local",
        google_sub: null,
        apple_sub: null,
      },
      client
    );

    await sendOtpEmailToUser(client, user, email, {
      subject: "Welcome to AAYEU — Your verification code",
      greetingName: full_name || "there",
      headline: "Thanks for registering with <b>AAYEU</b>. Use this code to verify your email and sign in:",
      extraParagraph:
        '<p style="color:#555;">Enter the code on the sign-in page when prompted.</p>',
    });

    await client.query("COMMIT"); // commit transaction

    return sendResponse(res, 200, true, "We sent a verification code to your email", {
      ...user,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.sendLoginOtp = catchAsync(async (req, res, next) => {
  let { email } = req.body;
  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  email = email.toLowerCase();

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const user = await UserServices.findUserByEmail(email, client);
    if (!user) throw new AppError("User not found", 404);

    const greetingName = user.full_name || user.name || "there";
    await sendOtpEmailToUser(client, user, email, {
      subject: "Your AAYEU sign-in code",
      greetingName,
      headline: "Use this code to sign in to your account:",
    });

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "We sent a login code to your email", null);
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});

/** @deprecated Use sendLoginOtp — kept for older clients; sends OTP email, not a link. */
module.exports.sendMagicLink = module.exports.sendLoginOtp;

module.exports.verifyLoginOtp = catchAsync(async (req, res, next) => {
  let email = req.body?.email;
  const normalizedOtp = String(req.body?.otp ?? "").replace(/\s/g, "");
  if (!isValidEmail(email)) return next(new AppError("Invalid email", 400));
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return next(new AppError("Enter the 6-digit code from your email", 400));
  }
  email = email.toLowerCase();

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const user = await UserServices.findUserByEmail(email, client);
    if (!user) throw new AppError("User not found", 404);

    const storedToken = user.magic_token || user.magicToken || null;
    const expiresAt =
      user.magic_token_expires_at ||
      user.magic_token_expires ||
      user.magicTokenExpires ||
      null;

    if (!storedToken || !expiresAt || new Date(expiresAt) < new Date()) {
      throw new AppError("Code expired or invalid. Request a new code.", 400);
    }

    if (String(storedToken).includes(".")) {
      throw new AppError(
        "Open the link in your email to sign in, or request a new login code.",
        400
      );
    }

    const submittedHash = hashUserLoginOtp(user.id, normalizedOtp);
    const storedBuf = Buffer.from(String(storedToken), "utf8");
    const submittedBuf = Buffer.from(submittedHash, "utf8");
    if (
      storedBuf.length !== submittedBuf.length ||
      !crypto.timingSafeEqual(storedBuf, submittedBuf)
    ) {
      throw new AppError("Invalid code", 400);
    }

    await UserServices.updateUserMagicToken(
      { userId: user.id, token: null, expiresAt: null },
      client
    );

    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    await client.query("COMMIT");

    return sendResponse(res, 200, true, "Login successful", {
      ...user,
      accessToken,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    return next(err);
  } finally {
    client.release();
  }
});

module.exports.loginWithMagicLink = catchAsync(async (req, res, next) => {
  const { token } = req.body;
  if (!token) return next(new AppError("Token is required", 400));

  //first check in db whether magic_token is not null

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(new AppError("Invalid or expired token", 400));
  }
  const { userId } = decoded;
  const client = await dbPool.connect(); // get transaction client
  try {
    await client.query("BEGIN"); // start transaction

    const user = await UserServices.findUserById(userId, client);
    if (!user) {
      throw new AppError("User not found", 404);
    }

    // Check stored magic token exists and matches the provided token
    // Support common column names: magic_token & magic_token_expires_at or magic_token_expires
    const storedToken = user.magic_token || user.magicToken || null;
    const expiresAt =
      user.magic_token_expires_at ||
      user.magic_token_expires ||
      user.magicTokenExpires ||
      null;

    if (!storedToken) {
      await client.query("ROLLBACK");
      return next(new AppError("Token Expired or Already Used", 400));
    }

    if (storedToken !== token) {
      await client.query("ROLLBACK");
      return next(new AppError("Magic token mismatch", 400));
    }

    if (expiresAt) {
      const expiry = new Date(expiresAt);
      if (isNaN(expiry.getTime()) || expiry < new Date()) {
        await client.query("ROLLBACK");
        return next(new AppError("Magic link has expired", 400));
      }
    }

    await UserServices.updateUserMagicToken(
      {
        userId: user.id,
        token: null,
        expiresAt: null,
      },
      client
    );

    const accessToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1d", // token valid for 1 day
    });

    await client.query("COMMIT"); // commit transaction

    return sendResponse(res, 200, true, "Login successful", {
      ...user,
      accessToken,
    });
  } catch (err) {
    await client.query("ROLLBACK"); // rollback on error
    return next(err);
  } finally {
    client.release(); // release client
  }
});

module.exports.viewProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  if (!userId) return next(new AppError("User ID is required", 400));
  const client = await dbPool.connect(); // get transaction client
  try {
    const user = await UserServices.findUserById(userId, client);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    return sendResponse(res, 200, true, "User fetched", user);
  } catch (err) {
    return next(err);
  } finally {
    client.release(); // release client
  }
});

module.exports.updateProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  if (!userId) return next(new AppError("User ID is required", 400));
  const client = await dbPool.connect(); // get transaction client
  try {
    const user = await UserServices.findUserById(userId, client);
    if (!user) {
      throw new AppError("User not found", 404);
    }
    const updatedUser = await UserServices.updateUser(
      {
        id: userId,
        full_name: req.body.full_name,
        phone: req.body.phone,
        dob: req.body.dob,
        gender: req.body.gender,
      },
      client
    );
    return sendResponse(res, 200, true, "User updated", updatedUser);
  } catch (err) {
    return next(err);
  } finally {
    client.release(); // release client
  }
});

/** Address Management */

module.exports.addAddress = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const {
      label,
      street,
      city,
      state,
      postal_code,
      country,
      lat,
      lon,
      is_default = false,
      mobile,
    } = req.body;

    const user_id = req.user?.id; // Assuming user is authenticated and middleware sets req.user
    if (!user_id)
      return next(new AppError("Unauthorized: user not found in request", 401));

    // Basic validation
    if (!street || !city || !state || !country || !postal_code) {
      return next(
        new AppError(
          "Please provide street, city, state, country, and postal_code",
          400
        )
      );
    }

    // Start transaction
    await client.query("BEGIN");

    // If is_default = true, unset previous default address for this user
    if (is_default) {
      await client.query(
        `UPDATE addresses SET is_default = false WHERE user_id = $1 AND deleted_at IS NULL`,
        [user_id]
      );
    }

    const id = randomUUID();
    const insertSQL = `
      INSERT INTO addresses (
        id, user_id, label, street, city, state, postal_code, country,
        lat, lon, is_default, created_at, mobile
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12)
      RETURNING *
    `;

    const params = [
      id,
      user_id,
      label || null,
      street,
      city,
      state,
      postal_code,
      country,
      lat || null,
      lon || null,
      is_default || false,
      mobile || null,
    ];

    const { rows } = await client.query(insertSQL, params);

    await client.query("COMMIT");
    return sendResponse(res, 200, true, "Address added successfully", rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("addAddress error:", err);
    return next(new AppError(err.message || "Failed to add address", 500));
  } finally {
    client.release();
  }
});

module.exports.getAddresses = catchAsync(async (req, res, next) => {
  const user_id = req.user?.id; // Assuming user is authenticated and middleware sets req.user
  if (!user_id)
    return next(new AppError("Unauthorized: user not found in request", 401));
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM addresses WHERE user_id = $1 AND deleted_at IS NULL`,
      [user_id]
    );
    return sendResponse(res, 200, true, "Addresses fetched successfully", rows);
  } catch (err) {
    console.error("getAddresses error:", err);
    return next(new AppError(err.message || "Failed to fetch addresses", 500));
  } finally {
    client.release();
  }
});

module.exports.getAddressById = catchAsync(async (req, res, next) => {
  const address_id = req.query.address_id;
  if (!address_id)
    return next(new AppError("address_id query param is required", 400));
  const user_id = req.user?.id; // Assuming user is authenticated and middleware sets req.user
  if (!user_id)
    return next(new AppError("Unauthorized: user not found in request", 401));
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT * FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [address_id, user_id]
    );
    return sendResponse(
      res,
      200,
      true,
      "Address fetched successfully",
      rows[0]
    );
  } catch (err) {
    console.error("getAddressById error:", err);
    return next(new AppError(err.message || "Failed to fetch address", 500));
  } finally {
    client.release();
  }
});

module.exports.updateAddress = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.body.address_id;
    const {
      label,
      street,
      city,
      state,
      postal_code,
      country,
      lat,
      lon,
      is_default, // keep undefined vs false distinction
      mobile,
    } = req.body;

    const user_id = req.user?.id; // make sure your auth middleware sets this
    if (!user_id) {
      client.release();
      return next(new AppError("Unauthorized: user not found in request", 401));
    }

    // Validate id format (requires your isValidUUID util)
    if (!isValidUUID(id)) {
      client.release();
      return next(new AppError("Invalid address id", 400));
    }

    await client.query("BEGIN");

    // Lock the address row to ensure safe concurrent updates
    const { rows: addrRows } = await client.query(
      `SELECT * FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [id, user_id]
    );

    if (addrRows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return next(new AppError("Address not found", 404));
    }

    const existing = addrRows[0];

    // Merge incoming fields with existing values (partial update)
    const newLabel = typeof label !== "undefined" ? label : existing.label;
    const newStreet = typeof street !== "undefined" ? street : existing.street;
    const newCity = typeof city !== "undefined" ? city : existing.city;
    const newState = typeof state !== "undefined" ? state : existing.state;
    const newPostal =
      typeof postal_code !== "undefined" ? postal_code : existing.postal_code;
    const newCountry =
      typeof country !== "undefined" ? country : existing.country;
    const newLat = typeof lat !== "undefined" ? lat : existing.lat;
    const newLon = typeof lon !== "undefined" ? lon : existing.lon;
    const newMobile = typeof mobile !== "undefined" ? mobile : existing.mobile;
    const newIsDefault =
      typeof is_default !== "undefined"
        ? Boolean(is_default)
        : existing.is_default;

    // If newIsDefault true -> unset other defaults for this user (except current address)
    if (newIsDefault) {
      await client.query(
        `UPDATE addresses SET is_default = false WHERE user_id = $1 AND id <> $2 AND deleted_at IS NULL`,
        [user_id, id]
      );
    }

    // Now update the address row
    const updateSQL = `
      UPDATE addresses
      SET label = $1,
          street = $2,
          city = $3,
          state = $4,
          postal_code = $5,
          country = $6,
          lat = $7,
          lon = $8,
          is_default = $9,
          mobile = $10
      WHERE id = $11 AND user_id = $12 AND deleted_at IS NULL
      RETURNING *
    `;

    const params = [
      newLabel,
      newStreet,
      newCity,
      newState,
      newPostal,
      newCountry,
      newLat,
      newLon,
      newIsDefault,
      newMobile,
      id,
      user_id,
    ];

    const { rows: updatedRows } = await client.query(updateSQL, params);
    await client.query("COMMIT");

    if (!updatedRows || updatedRows.length === 0) {
      // Shouldn't happen because we locked and checked earlier, but be safe
      return next(new AppError("Failed to update address", 500));
    }

    return sendResponse(
      res,
      200,
      true,
      "Address updated successfully",
      updatedRows[0]
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    console.error("updateAddress error:", err);
    return next(new AppError(err.message || "Failed to update address", 500));
  } finally {
    client.release();
  }
});

module.exports.deleteAddress = catchAsync(async (req, res, next) => {
  const address_id = req.body.address_id;
  if (!address_id)
    return next(new AppError("address_id is required in body", 400));
  const user_id = req.user?.id; // Assuming user is authenticated and middleware sets req.user
  if (!user_id)
    return next(new AppError("Unauthorized: user not found in request", 401));
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const findAddress = await client.query(
      `SELECT * FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [address_id, user_id]
    );
    if (findAddress.rows.length === 0) {
      await client.query("ROLLBACK");
      return next(new AppError("Address not found", 404));
    }
    if (findAddress.rows[0].is_default) {
      await client.query("ROLLBACK");
      return next(
        new AppError(
          "Cannot delete default address. Please set another address as default first.",
          400
        )
      );
    }
    const deleted = await client.query(
      `UPDATE addresses SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`,
      [address_id, user_id]
    );
    await client.query("COMMIT");
    return sendResponse(
      res,
      200,
      true,
      "Address deleted successfully",
      deleted?.rows[0]
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { });
    console.error("deleteAddress error:", err);
    return next(new AppError(err.message || "Failed to delete address", 500));
  } finally {
    client.release();
  }
});

module.exports.googleAuthRedirect = (req, res) => {
  // build google auth url and redirect (client side can also open this URL)
  try {
    const url = generateGoogleAuthUrl();
    return res.redirect(url);
  } catch (err) {
    return res.status(500).send("Failed to build Google auth URL");
  }
};

module.exports.googleAuthCallback = catchAsync(async (req, res, next) => {
  const code = req.query.code;
  if (!code) return next(new AppError("Authorization code not provided", 400));

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    // Service will exchange code, fetch userinfo, create/find user and return user object
    const user = await UserServices.loginWithGoogle({ code }, client);

    // Create JWT or session cookie

    const accessToken = createToken({ userId: user.id, email: user.email });

    await client.query("COMMIT");

    // Redirect back to frontend app (with token in cookie)
    const redirectTo = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(
      redirectTo + `/auth?type=google&accessToken=${accessToken}`
    ); // frontend route to handle post-login state
  } catch (error) {
    await client.query("ROLLBACK").catch(() => { });
    return next(new AppError(error.message || "Google auth failed", 500));
  } finally {
    client.release();
  }
});

module.exports.appleAuthRedirect = (req, res) => {
  try {
    const url = appleAuth.generateAuthUrl();
    return res.redirect(url);
  } catch (err) {
    return res.status(500).send("Failed to build Apple auth URL");
  }
};

module.exports.appleAuthCallback = catchAsync(async (req, res, next) => {
  const code = req.body.code || req.query.code;
  if (!code) return next(new AppError("Authorization code not provided", 400));

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const tokenRes = await appleAuth.exchangeCodeForTokens(code);
    const idToken = tokenRes?.id_token;
    if (!idToken) {
      throw new AppError("Apple id_token missing", 400);
    }

    const applePayload = await appleAuth.verifyIdToken(idToken);
    const appleSub = applePayload?.sub;
    const email = applePayload?.email || null;

    let fullName = null;
    if (req.body?.user) {
      try {
        const userData =
          typeof req.body.user === "string"
            ? JSON.parse(req.body.user)
            : req.body.user;
        const firstName = userData?.name?.firstName || "";
        const lastName = userData?.name?.lastName || "";
        const combined = `${firstName} ${lastName}`.trim();
        if (combined) fullName = combined;
      } catch (err) {
        // ignore parse errors for optional name payload
      }
    }

    const user = await UserServices.loginWithApple(
      { appleSub, email, fullName },
      client
    );

    const accessToken = createToken({ userId: user.id, email: user.email });

    await client.query("COMMIT");

    const redirectTo = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(
      redirectTo + `/auth?type=apple&accessToken=${accessToken}`
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return next(new AppError(error.message || "Apple auth failed", 500));
  } finally {
    client.release();
  }
});
