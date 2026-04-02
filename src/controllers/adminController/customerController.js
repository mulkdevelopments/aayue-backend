const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const { CustomerService } = require("../../services/customerService");
const { isValidUUID } = require("../../utils/basicValidation");
const dbPool = require("../../db/dbConnection");

module.exports.getCustomers = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  let { search, page, limit } = req.query;
  try {
    console.log("Fetching all customers...");
    const customers = await CustomerService.getAllCustomers(client, {
      search,
      page,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return sendResponse(res, 200, true, "Customers fetched", customers);
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch customers", 500));
  } finally {
    client.release();
  }
});

module.exports.getCustomerById = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();
  try {
    const id = req.query.customerId;
    if (!isValidUUID(id)) return next(new AppError("Invalid customer ID", 400));
    const customer = await CustomerService.getCustomerById(id, client);
    if (!customer) return next(new AppError("Customer not found", 404));
    return sendResponse(res, 200, true, "Customer fetched", customer);
  } catch (err) {
    return next(new AppError(err.message || "Failed to fetch customer", 500));
  } finally {
    client.release();
  }
});
