const {
  getLuxuryToken,
  getLuxuryProduct,
  insertProducts,
} = require("./luxuryHelper");
const dbPool = require("../../../db/dbConnection");
const catchAsync = require("../../../errorHandling/catchAsync");
const sendResponse = require("../../../utils/sendResponse");
const AppError = require("../../../errorHandling/AppError");
const luxuryImportService = require("./LuxuryApiService");

/* module.exports.fetchAllLuxuryProducts = catchAsync(async (req, res, next) => {
const limit = 100; // ek call me 100 products
  let offset = 1;
  let totalFetched = 0;
  let totalProducts = 0;

  const token = await getLuxuryToken();
  const client = await dbPool.connect();

  try {
    console.log("🚀 Starting product sync from Luxury Distribution...");

    while (true) {
      const result = await getLuxuryProduct(offset, limit, token);
      console.log(result, "result");
      const { data, total } = result;

      if (!data || data.length === 0) break;

      totalProducts = total;
      console.log(`📦 Fetched: ${offset} - ${offset + limit - 1} / ${total}`);

      // await insertProducts(data, client);

      totalFetched += data.length;
      offset += limit;

      if (totalFetched >= total) break;
    }

    console.log("✅ All products fetched and inserted successfully!");
    return sendResponse(res, 200, true, "Luxury products synced successfully", {
      totalFetched,
      totalProducts,
    });
  } catch (err) {
    console.error("❌ Error syncing products:", err.message);
    return next(new AppError(err.message || "Failed to fetch luxury products", 500));
  } finally {
    client.release();
  }
}); */

module.exports.fetchAllLuxuryProducts = catchAsync(async (req, res, next) => {
  const dbPool = require("../../../db/dbConnection");
  const { VendorSyncJobService } = require("../../../services/vendorSyncJobService");

  const LUXURY_VENDOR_ID = "65053474-4e40-44ee-941c-ef5253ea9fc9";
  const client = await dbPool.connect();

  try {
    // Clean up stale/orphaned jobs (from server crashes/restarts)
    const staleJobs = await VendorSyncJobService.markStaleJobsAsCancelled(client, LUXURY_VENDOR_ID, 30);
    if (staleJobs.length > 0) {
      console.log(`🧹 Cleaned up ${staleJobs.length} stale sync job(s): ${staleJobs.map(j => j.id).join(', ')}`);
    }

    // Check if there's already an active sync job for this vendor
    const activeJob = await VendorSyncJobService.getActiveJobForVendor(client, LUXURY_VENDOR_ID);

    if (activeJob) {
      const formattedJob = VendorSyncJobService.formatJobResponse(activeJob);
      return sendResponse(
        res,
        200,
        true,
        "Sync already in progress",
        {
          jobId: activeJob.id,
          status: activeJob.status,
          progress: formattedJob.progress,
          message: "A sync job is already running. Please wait for it to complete or cancel it first.",
        }
      );
    }

    // Create new sync job
    const syncJob = await VendorSyncJobService.createSyncJob(client, {
      vendorId: LUXURY_VENDOR_ID,
      startedBy: req.user?.id || null,
      metadata: {
        source: "admin_manual_sync",
        startedAt: new Date().toISOString(),
      },
    });

    console.log(`🚀 Created sync job: ${syncJob.id} for Luxury-Distribution`);

    // Start background sync with jobId
    setImmediate(async () => {
      try {
        await luxuryImportService.syncLuxuryProducts(syncJob.id);
      } catch (err) {
        console.error("❌ Luxury background sync error:", err.message || err);
      }
    });

    return sendResponse(
      res,
      202,
      true,
      "Luxury products sync started",
      {
        jobId: syncJob.id,
        vendorId: LUXURY_VENDOR_ID,
        status: syncJob.status,
        message: "Sync started in background. Use the jobId to track progress.",
      }
    );
  } catch (err) {
    return next(new AppError(err.message || "Failed to start sync", 500));
  } finally {
    client.release();
  }
});
