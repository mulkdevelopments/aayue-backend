const catchAsync = require("../errorHandling/catchAsync");
const sendResponse = require("../utils/sendResponse");
const AppError = require("../errorHandling/AppError");
const dbPool = require("../db/dbConnection");
const { VendorSyncJobService } = require("../services/vendorSyncJobService");

/**
 * Get sync job status by ID
 * GET /admin/vendor-sync-status/:jobId
 */
module.exports.getSyncJobStatus = catchAsync(async (req, res, next) => {
  const { jobId } = req.params;
  const client = await dbPool.connect();

  try {
    const job = await VendorSyncJobService.getJobById(client, jobId);
    const formattedJob = VendorSyncJobService.formatJobResponse(job);

    return sendResponse(res, 200, true, "Sync job status retrieved", formattedJob);
  } catch (err) {
    return next(new AppError(err.message || "Failed to get sync job status", 500));
  } finally {
    client.release();
  }
});

/**
 * Get active sync job for a vendor
 * GET /admin/vendor-sync-active/:vendorId
 */
module.exports.getActiveSyncJob = catchAsync(async (req, res, next) => {
  const { vendorId } = req.params;
  const client = await dbPool.connect();

  try {
    // Clean up stale/orphaned jobs before checking for active jobs
    const staleJobs = await VendorSyncJobService.markStaleJobsAsCancelled(client, vendorId, 30);
    if (staleJobs.length > 0) {
      console.log(`🧹 Cleaned up ${staleJobs.length} stale sync job(s): ${staleJobs.map(j => j.id).join(', ')}`);
    }

    const job = await VendorSyncJobService.getActiveJobForVendor(client, vendorId);

    if (!job) {
      // No active job, check for latest completed job
      const latestJob = await VendorSyncJobService.getLatestJobForVendor(client, vendorId);
      const formattedJob = latestJob ? VendorSyncJobService.formatJobResponse(latestJob) : null;

      return sendResponse(res, 200, true, "No active sync job", {
        activeJob: null,
        latestJob: formattedJob,
      });
    }

    const formattedJob = VendorSyncJobService.formatJobResponse(job);
    return sendResponse(res, 200, true, "Active sync job found", {
      activeJob: formattedJob,
      latestJob: formattedJob,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to get active sync job", 500));
  } finally {
    client.release();
  }
});

/**
 * Cancel a running sync job
 * POST /admin/vendor-sync-cancel/:jobId
 */
module.exports.cancelSyncJob = catchAsync(async (req, res, next) => {
  const { jobId } = req.params;
  const client = await dbPool.connect();

  try {
    // Request cancellation
    const job = await VendorSyncJobService.requestCancellation(client, jobId);

    console.log(`🛑 Cancellation requested for sync job ${jobId}`);

    return sendResponse(res, 200, true, "Sync cancellation requested", {
      id: job.id,
      status: job.status,
      message: "Sync will stop after processing the current product",
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to cancel sync job", 500));
  } finally {
    client.release();
  }
});

/**
 * Get sync job history for a vendor
 * GET /admin/vendor-sync-history/:vendorId?limit=10
 */
module.exports.getSyncJobHistory = catchAsync(async (req, res, next) => {
  const { vendorId } = req.params;
  const limit = parseInt(req.query.limit) || 10;
  const client = await dbPool.connect();

  try {
    const jobs = await VendorSyncJobService.getJobHistory(client, vendorId, limit);
    const formattedJobs = jobs.map(job => VendorSyncJobService.formatJobResponse(job));

    return sendResponse(res, 200, true, "Sync job history retrieved", {
      jobs: formattedJobs,
      total: jobs.length,
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to get sync job history", 500));
  } finally {
    client.release();
  }
});
