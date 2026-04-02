const dbPool = require("../db/dbConnection");
const { randomUUID } = require("crypto");
const CategoryService = require("./categoryService");
const { runAiCategoryMappingForProduct } = require("./productAiCategoryMapService");

const jobs = new Map();
let activeJobId = null;
const AGENT_ID_CATEGORY_REMAP = "category_remap";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 3;

const buildRemapProductWhere = () => `
  p.deleted_at IS NULL
  AND p.is_active = TRUE
  AND p.vendor_id IS NOT NULL
  AND p.our_description IS NOT NULL
  AND TRIM(p.our_description) <> ''
  AND EXISTS (
    SELECT 1 FROM vendors v
    WHERE v.id = p.vendor_id AND v.status = 'active' AND v.deleted_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM product_our_category_map pom
    WHERE pom.product_id = p.id AND pom.our_category_id = ANY($1::uuid[])
  )
`;

/** Distinct products that have at least one our-category map in the subtree (snapshot at job start). */
const fetchAllRemapProductRows = async (subtreeIds) => {
  const sql = `
    SELECT DISTINCT ON (p.id) p.id, p.name
    FROM products p
    WHERE ${buildRemapProductWhere()}
    ORDER BY p.id, p.created_at ASC
  `;
  const { rows } = await dbPool.query(sql, [subtreeIds]);
  return rows;
};

const runWithConcurrency = async (items, limit, handler, shouldStop) => {
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length && !shouldStop()) {
      const current = items[index];
      index += 1;
      await handler(current);
    }
  });
  await Promise.all(workers);
};

const runJob = async (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.updatedAt = job.startedAt;

  try {
    const client = await dbPool.connect();
    const categories = await CategoryService.getAllOurCategories(client, true);
    client.release();

    const subtreeIds = job.subtreeIds;
    const pendingRows = await fetchAllRemapProductRows(subtreeIds);
    job.pendingRows = pendingRows;
    job.pendingIndex = 0;
    job.total = pendingRows.length;

    const metadata = {
      rootOurCategoryId: job.rootOurCategoryId,
      rootCategoryName: job.rootCategoryName,
    };

    await dbPool.query(
      `INSERT INTO agent_jobs (id, agent_id, status, total, processed, success, failed, started_at, updated_at, metadata)
       VALUES ($1, $2, 'running', $3, 0, 0, 0, NOW(), NOW(), $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         status = 'running',
         total = $3,
         metadata = $4::jsonb,
         started_at = NOW(),
         updated_at = NOW()`,
      [jobId, AGENT_ID_CATEGORY_REMAP, job.total, JSON.stringify(metadata)]
    );

    while (!job.stopRequested) {
      const batch = job.pendingRows.slice(
        job.pendingIndex,
        job.pendingIndex + job.batchSize
      );
      job.pendingIndex += batch.length;
      if (batch.length === 0) break;

      await runWithConcurrency(
        batch,
        job.concurrency,
        async (productRow) => {
          if (job.stopRequested) return;
          await runAiCategoryMappingForProduct(productRow, categories, job, {
            subtreeIdsToClear: subtreeIds,
            mappingContext: "remap",
          });
        },
        () => job.stopRequested
      );

      await dbPool.query(
        `UPDATE agent_jobs SET processed = $2, success = $3, failed = $4, updated_at = NOW() WHERE id = $1`,
        [jobId, job.processed, job.success, job.failed]
      );
    }

    job.status = job.stopRequested ? "stopped" : "completed";
  } catch (err) {
    job.status = "failed";
    job.logs = job.logs || [];
    job.logs.push({
      time: new Date().toISOString(),
      status: "failed",
      message: err.message || "Job failed",
    });
    if (job.logs.length > 200) {
      job.logs.splice(0, job.logs.length - 200);
    }
  } finally {
    job.updatedAt = new Date().toISOString();
    activeJobId = job.status === "running" ? jobId : null;
    await dbPool
      .query(
        `UPDATE agent_jobs SET status = $2, processed = $3, success = $4, failed = $5, updated_at = NOW(), completed_at = NOW(), stop_reason = $6 WHERE id = $1`,
        [
          jobId,
          job.status,
          job.processed,
          job.success,
          job.failed,
          job.stopReason || null,
        ]
      )
      .catch((e) => console.error("agent_jobs update on finish (remap):", e));
  }
};

const createJob = async (opts = {}) => {
  const AutoMapJobService = require("./autoMapJobService");
  if (AutoMapJobService.getActiveJob()) {
    throw new Error("Auto-map is running; stop it before starting category remap.");
  }
  if (getActiveJob()) {
    throw new Error("A category remap job is already running.");
  }

  const rootOurCategoryId = opts.rootOurCategoryId;
  if (!rootOurCategoryId) {
    throw new Error("rootOurCategoryId is required");
  }

  const resolved = await CategoryService.getOurCategorySubtreeRootAndIds(
    rootOurCategoryId
  );
  if (!resolved?.ids?.length) {
    throw new Error("Invalid our category or empty subtree.");
  }

  const id = randomUUID();
  const job = {
    id,
    agentId: AGENT_ID_CATEGORY_REMAP,
    status: "queued",
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    batchSize: opts.batchSize || DEFAULT_BATCH_SIZE,
    concurrency: opts.concurrency || DEFAULT_CONCURRENCY,
    logs: [],
    stopRequested: false,
    stopReason: null,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    rootOurCategoryId: resolved.root.id,
    rootCategoryName: resolved.root.name,
    subtreeIds: resolved.ids,
  };
  jobs.set(id, job);
  activeJobId = id;
  setImmediate(() => runJob(id));
  return job;
};

const getJob = (jobId) => jobs.get(jobId);

const getActiveJob = () => {
  if (!activeJobId) return null;
  const job = jobs.get(activeJobId);
  if (!job || ["completed", "failed", "stopped"].includes(job.status)) {
    return null;
  }
  return job;
};

const stopJob = (jobId) => {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.stopRequested = true;
  job.status = "stopping";
  job.updatedAt = new Date().toISOString();
  return job;
};

const getRecentJobs = async (agentId) => {
  const { rows } = await dbPool.query(
    `SELECT id, status, total, processed, success, failed,
            started_at AS "startedAt", updated_at AS "updatedAt",
            stop_reason AS "stopReason", metadata
     FROM agent_jobs
     WHERE agent_id = $1
     ORDER BY started_at DESC NULLS LAST
     LIMIT 5`,
    [agentId || AGENT_ID_CATEGORY_REMAP]
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    total: r.total,
    processed: r.processed,
    success: r.success,
    failed: r.failed,
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    stopReason: r.stopReason || null,
    metadata: r.metadata || null,
  }));
};

module.exports = {
  createJob,
  getJob,
  getActiveJob,
  stopJob,
  getRecentJobs,
  AGENT_ID_CATEGORY_REMAP,
};
