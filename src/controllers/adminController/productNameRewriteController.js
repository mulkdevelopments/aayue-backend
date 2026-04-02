const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const ProductNameRewriteJobService = require("../../services/productNameRewriteJobService");

module.exports.startProductNameRewrite = catchAsync(async (req, res, next) => {
  try {
    const active = ProductNameRewriteJobService.getActiveJob();
    if (active) {
      return sendResponse(res, 200, true, "Product name rewrite job already running", {
        job: active,
      });
    }

    const job = ProductNameRewriteJobService.createJob({
      batchSize: req.body?.batchSize || 50,
      concurrency: req.body?.concurrency || 2,
    });

    return sendResponse(res, 200, true, "Product name rewrite job started", { job });
  } catch (err) {
    return next(new AppError(err.message || "Failed to start product name rewrite", 500));
  }
});

module.exports.getProductNameRewriteStatus = catchAsync(async (req, res, next) => {
  const { jobId } = req.query;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = ProductNameRewriteJobService.getJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Product name rewrite status", { job });
});

module.exports.getActiveProductNameRewriteJob = catchAsync(async (req, res, next) => {
  const active = ProductNameRewriteJobService.getActiveJob();
  return sendResponse(res, 200, true, "Active product name rewrite job", {
    job: active || null,
  });
});

module.exports.stopProductNameRewrite = catchAsync(async (req, res, next) => {
  const { jobId } = req.body;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = ProductNameRewriteJobService.stopJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Product name rewrite stopping", { job });
});
