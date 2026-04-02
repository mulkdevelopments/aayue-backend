const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const { DashboardService } = require("../../services/dashboardService");
const { isValidUUID } = require("../../utils/basicValidation");
const dbPool = require("../../db/dbConnection");



module.exports.getDashboard = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const dashboard = await DashboardService.getDashboardData(client);
        return sendResponse(res, 200, true, 'Dashboard fetched', dashboard);
    } catch (err) {
        return next(new AppError(err.message || 'Failed to fetch dashboard', 500));
    } finally {
        client.release();
    }
});