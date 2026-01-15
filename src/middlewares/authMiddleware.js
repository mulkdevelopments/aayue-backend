const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const dbPool = require("../db/dbConnection");
const AppError = require("../errorHandling/AppError");
const { UserServices } = require("../services/userServices");
const { isValidEmail } = require("../utils/basicValidation");
const { AdminServices } = require("../services/adminService");

const protectUser = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
        return next(new AppError("Not authorized to access this route", 401));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded.userId) {
            throw new Error("Invalid token");
        }

        req.user = await UserServices.findUserById(decoded.userId);
        next();
    } catch (err) {
        return next(new AppError(err.message, 401));
    }
};

const protectAdmin = async (req, res, next) => {
    let token;
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith("Bearer")
    ) {
        token = req.headers.authorization.split(" ")[1];
    }
    if (!token) {
        console.log("No token found");
        return next(new AppError("Not authorized to access this route", 401));
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded.userId) {
            throw new Error("Invalid token");
        }

        req.admin = await AdminServices.findAdminById(decoded.userId);
        next();
    } catch (err) {
        return next(new AppError(err.message, 401));
    }
}

module.exports = { protectUser, protectAdmin };