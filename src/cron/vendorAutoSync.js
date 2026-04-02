const cron = require("node-cron");
const dbPool = require("../db/dbConnection");
const { VendorSyncJobService } = require("../services/vendorSyncJobService");
const DescriptionRewriteJobService = require("../services/descriptionRewriteJobService");
const AutoMapJobService = require("../services/autoMapJobService");
const luxuryImportService = require("../controllers/importController/luxuryDistibution/LuxuryApiService");
const peppelaImportService = require("../controllers/importController/peppela/PeppelaApiService");
const brandsgatewayImportService = require("../controllers/importController/brandsgateway/BrandsgatewayApiService");
const bdroppyImportService = require("../controllers/importController/bdroppy/BdroppyApiService");

const VENDORS = [
  {
    id: "65053474-4e40-44ee-941c-ef5253ea9fc9",
    name: "Luxury-Distribution",
    sync: (jobId) => luxuryImportService.syncLuxuryProducts(jobId),
  },
  {
    id: "b34fd0f6-815a-469e-b7c2-73f9e8afb3ed",
    name: "Peppela",
    sync: (jobId) => peppelaImportService.syncPeppelaProducts(jobId),
  },
  {
    id: "51bd4bcf-1c4d-4972-b10d-f21c2af93a9c",
    name: "Brandsgateway",
    sync: (jobId) => brandsgatewayImportService.syncBrandsgatewayProducts(jobId),
  },
  {
    id: "a6bdd96b-0e2c-4f3e-b644-4e088b1778e0",
    name: "Bdroppy",
    sync: (jobId) => bdroppyImportService.syncBdroppyProducts(jobId),
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const AGENT_POLL_INTERVAL_MS = 15 * 1000;
const AGENT_MAX_WAIT_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Start one vendor sync and return a Promise that resolves when that sync completes (or resolves immediately if skipped). */
async function runVendorSyncAndWait(vendor) {
  const client = await dbPool.connect();
  try {
    const vendorStatus = await client.query(
      `SELECT status FROM vendors WHERE id = $1 LIMIT 1`,
      [vendor.id]
    );
    const isActive = vendorStatus.rowCount
      ? String(vendorStatus.rows[0].status || "").toLowerCase() === "active"
      : false;

    if (!isActive) {
      console.log(`⏭️  Auto sync skipped for ${vendor.name}: vendor inactive`);
      return;
    }

    const staleJobs = await VendorSyncJobService.markStaleJobsAsCancelled(
      client,
      vendor.id,
      30
    );
    if (staleJobs.length > 0) {
      console.log(
        `🧹 Cleaned up ${staleJobs.length} stale sync job(s) for ${vendor.name}: ${staleJobs
          .map((j) => j.id)
          .join(", ")}`
      );
    }

    const activeJob = await VendorSyncJobService.getActiveJobForVendor(
      client,
      vendor.id
    );
    if (activeJob) {
      console.log(
        `⏭️  Auto sync skipped for ${vendor.name}: already running (${activeJob.id})`
      );
      return;
    }

    const syncJob = await VendorSyncJobService.createSyncJob(client, {
      vendorId: vendor.id,
      startedBy: null,
      metadata: {
        source: "auto_midnight",
        startedAt: new Date().toISOString(),
      },
    });

    console.log(`🌙 Auto sync started for ${vendor.name}: ${syncJob.id}`);
    try {
      await vendor.sync(syncJob.id);
    } catch (err) {
      console.error(
        `❌ Auto sync error for ${vendor.name}:`,
        err.message || err
      );
    }
  } catch (err) {
    console.error(
      `❌ Auto sync setup failed for ${vendor.name}:`,
      err.message || err
    );
  } finally {
    client.release();
  }
}

/** Poll until the description rewrite job is no longer running (completed/failed/stopped). */
async function waitForDescriptionJobToFinish(jobId) {
  const start = Date.now();
  while (Date.now() - start < AGENT_MAX_WAIT_MS) {
    const job = DescriptionRewriteJobService.getJob(jobId);
    if (!job || ["completed", "failed", "stopped"].includes(job.status)) {
      return job;
    }
    await sleep(AGENT_POLL_INTERVAL_MS);
  }
  return null;
}

/** Poll until the mapping job is no longer running. */
async function waitForMappingJobToFinish(jobId) {
  const start = Date.now();
  while (Date.now() - start < AGENT_MAX_WAIT_MS) {
    const job = AutoMapJobService.getJob(jobId);
    if (!job || ["completed", "failed", "stopped"].includes(job.status)) {
      return job;
    }
    await sleep(AGENT_POLL_INTERVAL_MS);
  }
  return null;
}

async function runAutoSync() {
  console.log("🕒 Cron: starting vendor sync + description + mapping pipeline");

  // 1) Run all vendor syncs and wait for completion
  await Promise.all(VENDORS.map((v) => runVendorSyncAndWait(v)));
  console.log("✅ Cron: all vendor syncs finished");

  // 2) Run description agent and wait for completion
  const activeDesc = DescriptionRewriteJobService.getActiveJob();
  if (activeDesc) {
    console.log(
      `⏭️  Cron: description agent already running (${activeDesc.id}), waiting for it...`
    );
    await waitForDescriptionJobToFinish(activeDesc.id);
  } else {
    const descJob = DescriptionRewriteJobService.createJob({});
    console.log(`📝 Cron: description agent started (${descJob.id}), waiting for completion...`);
    await waitForDescriptionJobToFinish(descJob.id);
    console.log("✅ Cron: description agent finished");
  }

  // 3) Run mapping agent (and wait for completion)
  const activeMap = AutoMapJobService.getActiveJob();
  if (activeMap) {
    console.log(
      `⏭️  Cron: mapping agent already running (${activeMap.id}), waiting for it...`
    );
    await waitForMappingJobToFinish(activeMap.id);
  } else {
    const mapJob = AutoMapJobService.createJob({});
    console.log(`🗺️  Cron: mapping agent started (${mapJob.id}), waiting for completion...`);
    await waitForMappingJobToFinish(mapJob.id);
    console.log("✅ Cron: mapping agent finished");
  }

  console.log("🕒 Cron: pipeline complete (vendor sync → description → mapping)");
}

const cronExpression = process.env.AUTO_SYNC_CRON || "0 0 * * *";
const cronOptions = {};
if (process.env.AUTO_SYNC_TZ) {
  cronOptions.timezone = process.env.AUTO_SYNC_TZ;
}

cron.schedule(cronExpression, () => {
  runAutoSync();
}, cronOptions);

console.log(
  `🕒 Vendor auto sync scheduled (${cronExpression}${
    process.env.AUTO_SYNC_TZ ? ` ${process.env.AUTO_SYNC_TZ}` : ""
  })`
);

module.exports = { runAutoSync };
