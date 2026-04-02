const dbPool = require("../db/dbConnection");
const { randomUUID } = require("crypto");
const ProductService = require("./productService");
const { rewriteDescription } = require("./aiDescriptionRewriteService");

const jobs = new Map();
let activeJobId = null;
const AGENT_ID_DESCRIPTION_REWRITE = "description_rewrite";

const MAX_LOGS = 200;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 2;

const isRateLimitError = (err) => {
  const msg = (err?.message || err?.toString || "").toString().toLowerCase();
  const code = err?.status || err?.statusCode || err?.code;
  return code === 429 || /rate limit|too many requests|quota/i.test(msg);
};

const pushLog = (job, entry) => {
  job.logs.push({
    time: new Date().toISOString(),
    ...entry,
  });
  if (job.logs.length > MAX_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_LOGS);
  }
};

const buildWhere = () => `
  p.deleted_at IS NULL
  AND p.is_active = TRUE
  AND p.vendor_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM vendors v
    WHERE v.id = p.vendor_id AND v.status = 'active' AND v.deleted_at IS NULL
  )
  AND (p.our_description IS NULL OR TRIM(p.our_description) = '')
  AND (p.description IS NOT NULL AND TRIM(p.description) <> '' OR p.short_description IS NOT NULL AND TRIM(p.short_description) <> '')
`;

const fetchBatch = async (limit) => {
  const sql = `
    SELECT p.id, p.name
    FROM products p
    WHERE ${buildWhere()}
    ORDER BY p.updated_at ASC NULLS LAST, p.created_at ASC
    LIMIT $1
  `;
  const { rows } = await dbPool.query(sql, [limit]);
  return rows;
};

const countPending = async () => {
  const sql = `
    SELECT COUNT(*)::int AS total
    FROM products p
    WHERE ${buildWhere()}
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
    job.total = await countPending();

    await dbPool.query(
      `INSERT INTO agent_jobs (id, agent_id, status, total, processed, success, failed, started_at, updated_at)
       VALUES ($1, $2, 'running', $3, 0, 0, 0, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'running', total = $3, started_at = NOW(), updated_at = NOW()`,
      [jobId, AGENT_ID_DESCRIPTION_REWRITE, job.total]
    );

    while (!job.stopRequested) {
      const batch = await fetchBatch(job.batchSize);
      if (batch.length === 0) break;

      await runWithConcurrency(
        batch,
        job.concurrency,
        async (productRow) => {
          if (job.stopRequested) return;
          const productId = productRow.id;
          try {
            const productClient = await dbPool.connect();
            const product = await ProductService.getProductByIdAdmin(productId, productClient);
            productClient.release();

            if (!product) {
              job.failed += 1;
              job.processed += 1;
              pushLog(job, {
                status: "failed",
                product_id: productId,
                product_name: productRow.name,
                message: "Product not found",
              });
              return;
            }

            const descriptionToUse = (product.description || product.short_description || "").trim();
            if (!descriptionToUse) {
              job.failed += 1;
              job.processed += 1;
              pushLog(job, {
                status: "skipped",
                product_id: productId,
                product_name: productRow.name,
                message: "No description to rewrite",
              });
              return;
            }

            let result;
            try {
              result = await rewriteDescription(product);
            } catch (aiErr) {
              if (isRateLimitError(aiErr)) {
                const reason = `Rate limit: ${aiErr.message || "API rate limit exceeded"}`;
                job.stopRequested = true;
                job.stopReason = reason;
                job.status = "stopped";
                pushLog(job, {
                  status: "stopped",
                  product_id: productId,
                  product_name: productRow.name,
                  message: reason,
                });
                return;
              }
              throw aiErr;
            }

            // Single LLM call returns either { suspicious, reason } or the HTML description
            if (result && typeof result === "object" && result.suspicious === true) {
              const reason = result.reason || "Name and description describe different product types";
              const markClient = await dbPool.connect();
              try {
                await ProductService.markProductSuspicious(productId, reason, markClient);
              } finally {
                markClient.release();
              }
              job.failed += 1;
              job.processed += 1;
              pushLog(job, {
                status: "suspicious",
                product_id: productId,
                product_name: productRow.name,
                message: reason,
              });
              return;
            }

            const ourDesc = typeof result === "string" ? result : "";
            if (!ourDesc.trim()) {
              job.failed += 1;
              job.processed += 1;
              pushLog(job, {
                status: "failed",
                product_id: productId,
                product_name: productRow.name,
                message: "No description generated",
              });
              return;
            }

            const updateClient = await dbPool.connect();
            try {
              await ProductService.updateOurDescription(productId, ourDesc, updateClient);
            } finally {
              updateClient.release();
            }

            job.success += 1;
            job.processed += 1;
            pushLog(job, {
              status: "success",
              product_id: productId,
              product_name: productRow.name,
              message: "Description written",
            });
          } catch (err) {
            job.failed += 1;
            job.processed += 1;
            pushLog(job, {
              status: "failed",
              product_id: productId,
              product_name: productRow.name,
              message: err.message || "Rewrite failed",
            });
          } finally {
            job.updatedAt = new Date().toISOString();
          }
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
    [agentId || AGENT_ID_DESCRIPTION_REWRITE]
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
  AGENT_ID_DESCRIPTION_REWRITE,
};
