const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const { VendorSyncJobService } = require("../../../services/vendorSyncJobService");
const brandsgatewayService = require("./BrandsgatewayApiService");

const BRANDS_GATEWAY_VENDOR_ID = "51bd4bcf-1c4d-4972-b10d-f21c2af93a9c";

module.exports.fetchAllBrandsgatewayProducts = catchAsync(async (req, res, next) => {
  const client = await dbPool.connect();

  try {
    const staleJobs = await VendorSyncJobService.markStaleJobsAsCancelled(
      client,
      BRANDS_GATEWAY_VENDOR_ID,
      30
    );
    if (staleJobs.length > 0) {
      console.log(
        `🧹 Cleaned up ${staleJobs.length} stale sync job(s): ${staleJobs
          .map((j) => j.id)
          .join(", ")}`
      );
    }

    const activeJob = await VendorSyncJobService.getActiveJobForVendor(
      client,
      BRANDS_GATEWAY_VENDOR_ID
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
      vendorId: BRANDS_GATEWAY_VENDOR_ID,
      startedBy: req.user?.id || null,
      metadata: {
        source: "admin_manual_sync",
        startedAt: new Date().toISOString(),
      },
    });

    console.log(`🚀 Created sync job: ${syncJob.id} for Brandsgateway`);

    setImmediate(async () => {
      try {
        await brandsgatewayService.syncBrandsgatewayProducts(syncJob.id);
      } catch (err) {
        console.error("❌ Brandsgateway background sync error:", err.message || err);
      }
    });

    return sendResponse(res, 202, true, "Brandsgateway products sync started", {
      jobId: syncJob.id,
      vendorId: BRANDS_GATEWAY_VENDOR_ID,
      status: syncJob.status,
      message: "Sync started in background. Use the jobId to track progress.",
    });
  } catch (err) {
    return next(new AppError(err.message || "Failed to start sync", 500));
  } finally {
    client.release();
  }
});
