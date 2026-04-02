const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AppError = require("../../errorHandling/AppError");
const RemapCategoryJobService = require("../../services/remapCategoryJobService");

function toPublicRemapJob(job) {
  if (!job) return null;
  const {
    pendingRows: _pr,
    pendingIndex: _pi,
    subtreeIds: _st,
    ...rest
  } = job;
  return rest;
}

module.exports.startCategoryRemap = catchAsync(async (req, res, next) => {
  try {
    const rootOurCategoryId =
      req.body?.rootOurCategoryId || req.body?.root_our_category_id;
    if (!rootOurCategoryId) {
      return next(new AppError("rootOurCategoryId is required", 400));
    }

    const job = await RemapCategoryJobService.createJob({
      rootOurCategoryId,
      batchSize: 100,
      concurrency: 3,
    });

    return sendResponse(res, 200, true, "Category remap job started", {
      job: toPublicRemapJob(job),
    });
  } catch (err) {
    return next(
      new AppError(err.message || "Failed to start category remap", 400)
    );
  }
});

module.exports.getCategoryRemapStatus = catchAsync(async (req, res, next) => {
  const { jobId } = req.query;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = RemapCategoryJobService.getJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Category remap status", {
    job: toPublicRemapJob(job),
  });
});

module.exports.getActiveCategoryRemapJob = catchAsync(async (req, res) => {
  const active = RemapCategoryJobService.getActiveJob();
  return sendResponse(res, 200, true, "Active category remap job", {
    job: toPublicRemapJob(active),
  });
});

module.exports.stopCategoryRemap = catchAsync(async (req, res, next) => {
  const { jobId } = req.body;
  if (!jobId) {
    return next(new AppError("jobId is required", 400));
  }

  const job = RemapCategoryJobService.stopJob(jobId);
  if (!job) {
    return next(new AppError("Job not found", 404));
  }

  return sendResponse(res, 200, true, "Category remap stopping", {
    job: toPublicRemapJob(job),
  });
});
