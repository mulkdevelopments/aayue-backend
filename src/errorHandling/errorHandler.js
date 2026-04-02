const AppError = require("./AppError");

module.exports = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || "error";

    // Development Mode
    if (process.env.NODE_ENV === "development") {
        return res.status(err.statusCode).json({
            success: false,
            statusCode: err.statusCode,
            message: err.message,
            stack: err.stack,
        });
    }

    if (err.name === "ValidationError") {
        err = new AppError(Object.values(err.errors).map(el => el.message).join(", "), 400);
    }

    if (err.name === "JsonWebTokenError") {
        err = new AppError("Invalid token. Please log in again.", 401);
    }

    if (err.name === "TokenExpiredError") {
        err = new AppError("Token expired. Please log in again.", 401);
    }

    return res.status(err.statusCode).json({
        success: false,
        statusCode: err.statusCode,
        message: err.message || "Something went wrong",
    });
};
