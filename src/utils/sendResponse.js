// src/utils/sendResponse.js

/**
 * Standardized API Response helper
 * 
 * @param {Object} res - Express response object
 * @param {Number} statusCode - HTTP Status code
 * @param {Boolean} success - true or false
 * @param {String} message - Message string
 * @param {Object|Array|null} [data=null] - Optional data
 */
const sendResponse = (res, statusCode, success, message, data = null) => {
    return res.status(statusCode).json({
        status: statusCode,
        success,
        message,
        data,
    });
};

module.exports = sendResponse;
