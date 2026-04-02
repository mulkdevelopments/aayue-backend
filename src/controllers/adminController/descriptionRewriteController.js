const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const DescriptionRewriteJobService = require("../../services/descriptionRewriteJobService");

module.exports.startDescriptionRewrite = catchAsync(async (req, res, next) => {
  try {
    const active = DescriptionRewriteJobService.getActiveJob();
    if (active) {
      return sendResponse(res, 200, true, "Description rewrite job already running", {
        job: active,
      });
    }

    const job = DescriptionRewriteJobService.createJob({
      batchSize: req.body?.batchSize || 50,
      concurrency: req.body?.concurrency || 2,
    });

    return sendResponse(res, 200, true, "Description rewrite job started", { job });
  } catch (err) {
    return next(new AppError(err.message || "Failed to start description rewrite", 500));
  }
});

module.exports.getDescriptionRewriteStatus = catchAsync(async (req, res, next) => {
  const { jobId } = req.query;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = DescriptionRewriteJobService.getJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Description rewrite status", { job });
});

module.exports.getActiveDescriptionRewriteJob = catchAsync(async (req, res, next) => {
  const active = DescriptionRewriteJobService.getActiveJob();
  return sendResponse(res, 200, true, "Active description rewrite job", {
    job: active || null,
  });
});

module.exports.stopDescriptionRewrite = catchAsync(async (req, res, next) => {
  const { jobId } = req.body;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = DescriptionRewriteJobService.stopJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Description rewrite stopping", { job });
});
