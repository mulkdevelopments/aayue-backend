/**
 * BDroppy full product sync – admin route handler.
 * Creates a vendor sync job and runs sync in background.
 */

const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const { VendorSyncJobService } = require("../../../services/vendorSyncJobService");
const bdroppyApiService = require("./BdroppyApiService");

const BDROPPY_VENDOR_ID = "a6bdd96b-0e2c-4f3e-b644-4e088b1778e0";

module.exports.fetchAllBdroppyProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();

  try {
    const staleJobs = await VendorSyncJobService.markStaleJobsAsCancelled(
      client,
      BDROPPY_VENDOR_ID,
      30
    );
    if (staleJobs.length > 0) {
      console.log(
        `🧹 Cleaned up ${staleJobs.length} stale sync job(s) for BDroppy: ${staleJobs.map((j) => j.id).join(", ")}`
      );
    }

    const activeJob = await VendorSyncJobService.getActiveJobForVendor(
      client,
      BDROPPY_VENDOR_ID
    );

    if (activeJob) {
      const formattedJob = VendorSyncJobService.formatJobResponse(activeJob);
      return sendResponse(res, 200, true, "Sync already in progress", {
        jobId: activeJob.id,
        status: activeJob.status,
        progress: formattedJob.progress,
        message:
          "A sync job is already running. Please wait for it to complete or cancel it first.",
      });
    }

    const syncJob = await VendorSyncJobService.createSyncJob(client, {
      vendorId: BDROPPY_VENDOR_ID,
      startedBy: req.user?.id || null,
      metadata: {
        source: "admin_manual_sync",
        startedAt: new Date().toISOString(),
      },
    });

    console.log(`🚀 Created sync job: ${syncJob.id} for BDroppy`);

    setImmediate(async () => {
      try {
        await bdroppyApiService.syncBdroppyProducts(syncJob.id);
      } catch (err) {
        console.error("❌ BDroppy background sync error:", err.message || err);
      }
    });

    return sendResponse(res, 202, true, "BDroppy products sync started", {
      jobId: syncJob.id,
      vendorId: BDROPPY_VENDOR_ID,
      status: syncJob.status,
      message: "Sync started in background. Use the jobId to track progress.",
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to start sync", 500));
  } finally {
    client.release();
  }
});
