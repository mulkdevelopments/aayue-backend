const dbPool = require("../db/dbConnection");
const { randomUUID } = require("crypto");
const CategoryService = require("./categoryService");
const {
  runAiCategoryMappingForProduct,
  pushLog,
} = require("./productAiCategoryMapService");

const jobs = new Map();
let activeJobId = null;
const AGENT_ID_AUTO_MAPPING = "auto_mapping";

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 3;

const buildUnmappedWhere = () => {
  return `
    p.deleted_at IS NULL
    AND p.is_active = TRUE
    AND p.vendor_id IS NOT NULL
    AND p.our_description IS NOT NULL
    AND TRIM(p.our_description) <> ''
    AND EXISTS (
      SELECT 1 FROM vendors v
      WHERE v.id = p.vendor_id AND v.status = 'active' AND v.deleted_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM product_our_category_map pom
      JOIN categories c ON c.id = pom.our_category_id AND c.deleted_at IS NULL
      WHERE pom.product_id = p.id
    )
  `;
};

const fetchUnmappedBatch = async (limit) => {
  const sql = `
    SELECT p.id, p.name
    FROM products p
    WHERE ${buildUnmappedWhere()}
    ORDER BY p.created_at ASC
    LIMIT $1
  `;
  const { rows } = await dbPool.query(sql, [limit]);
  return rows;
};

const countUnmapped = async () => {
  const sql = `
    SELECT COUNT(*)::int AS total
    FROM products p
    WHERE ${buildUnmappedWhere()}
  `;
  const { rows } = await dbPool.query(sql);
  return rows[0]?.total || 0;
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

    job.total = await countUnmapped();

    await dbPool.query(
      `INSERT INTO agent_jobs (id, agent_id, status, total, processed, success, failed, started_at, updated_at)
       VALUES ($1, $2, 'running', $3, 0, 0, 0, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'running', total = $3, started_at = NOW(), updated_at = NOW()`,
      [jobId, AGENT_ID_AUTO_MAPPING, job.total]
    );

    while (!job.stopRequested) {
      const batch = await fetchUnmappedBatch(job.batchSize);
      if (batch.length === 0) break;

      await runWithConcurrency(
        batch,
        job.concurrency,
        async (productRow) => {
          if (job.stopRequested) return;
          await runAiCategoryMappingForProduct(productRow, categories, job, {});
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
    pushLog(job, {
      status: "failed",
      message: err.message || "Job failed",
    });
  } finally {
    job.updatedAt = new Date().toISOString();
    activeJobId = job.status === "running" ? jobId : null;
    await dbPool
      .query(
        `UPDATE agent_jobs SET status = $2, processed = $3, success = $4, failed = $5, updated_at = NOW(), completed_at = NOW(), stop_reason = $6 WHERE id = $1`,
        [jobId, job.status, job.processed, job.success, job.failed, job.stopReason || null]
      )
      .catch((err) => console.error("agent_jobs update on finish:", err));
  }
};

const createJob = (opts = {}) => {
  const RemapCategoryJobService = require("./remapCategoryJobService");
  if (RemapCategoryJobService.getActiveJob()) {
    throw new Error("Category remap is running; stop it before starting auto-map.");
  }

  const id = randomUUID();
  const job = {
    id,
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
  if (!job || ["completed", "failed", "stopped"].includes(job.status)) return null;
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
    `SELECT id, status, total, processed, success, failed, started_at AS "startedAt", updated_at AS "updatedAt", stop_reason AS "stopReason"
     FROM agent_jobs WHERE agent_id = $1 ORDER BY started_at DESC NULLS LAST LIMIT 5`,
    [agentId || AGENT_ID_AUTO_MAPPING]
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
  }));
};

module.exports = {
  createJob,
  getJob,
  getActiveJob,
  stopJob,
  getRecentJobs,
};
