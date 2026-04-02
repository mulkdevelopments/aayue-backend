const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const AutoMapJobService = require("../../services/autoMapJobService");

module.exports.startAutoMap = catchAsync(async (req, res, next) => {
  try {
    const active = AutoMapJobService.getActiveJob();
    if (active) {
      return sendResponse(res, 200, true, "Auto-map job already running", {
        job: active,
      });
    }

    const job = AutoMapJobService.createJob({
      batchSize: 100,
      concurrency: 3,
    });

    return sendResponse(res, 200, true, "Auto-map job started", { job });
  } catch (err) {
    return next(new AppError(err.message || "Failed to start auto-map", 500));
  }
});

module.exports.getAutoMapStatus = catchAsync(async (req, res, next) => {
  const { jobId } = req.query;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = AutoMapJobService.getJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Auto-map status", { job });
});

module.exports.getActiveAutoMapJob = catchAsync(async (req, res, next) => {
  const active = AutoMapJobService.getActiveJob();
  return sendResponse(res, 200, true, "Active auto-map job", {
    job: active || null,
  });
});

module.exports.stopAutoMap = catchAsync(async (req, res, next) => {
  const { jobId } = req.body;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = AutoMapJobService.stopJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Auto-map stopping", { job });
});
