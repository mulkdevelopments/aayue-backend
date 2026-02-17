const dbPool = require("../db/dbConnection");
const { randomUUID } = require("crypto");
const CategoryService = require("./categoryService");
const ProductService = require("./productService");
const { getAICategorySuggestions } = require("./aiCategorySuggestionService");

const jobs = new Map();
let activeJobId = null;

const MAX_LOGS = 200;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 3;

const pushLog = (job, entry) => {
  job.logs.push({
    time: new Date().toISOString(),
    ...entry,
  });
  if (job.logs.length > MAX_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_LOGS);
  }
};

const buildUnmappedWhere = () => {
  return `
    p.deleted_at IS NULL
    AND p.vendor_id IS NOT NULL
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

const mapProductToCategory = async (productId, categoryId) => {
  const existing = await dbPool.query(
    "SELECT id FROM product_our_category_map WHERE product_id=$1 AND our_category_id=$2",
    [productId, categoryId]
  );
  if (existing.rowCount > 0) return false;

  await dbPool.query(
    `INSERT INTO product_our_category_map (id, product_id, our_category_id)
     VALUES (gen_random_uuid(), $1, $2)`,
    [productId, categoryId]
  );
  return true;
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

    while (!job.stopRequested) {
      const batch = await fetchUnmappedBatch(job.batchSize);
      if (batch.length === 0) break;

      await runWithConcurrency(
        batch,
        job.concurrency,
        async (productRow) => {
          if (job.stopRequested) return;
          const productId = productRow.id;
          try {
            const productClient = await dbPool.connect();
            const product = await ProductService.getProductByIdAdmin(
              productId,
              productClient
            );
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

            const vendorCategory =
              (product.categories || []).find((c) => c.is_our_category !== true) ||
              (product.categories || [])[0] ||
              null;
            if (vendorCategory) {
              product.vendor_category_name = vendorCategory.name || "";
              product.vendor_category_path = vendorCategory.path || "";
            }

            const suggestions = await getAICategorySuggestions(product, categories);
            const top = Array.isArray(suggestions) && suggestions.length > 0
              ? [...suggestions].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]
              : null;
            if (!top?.category_id) {
              job.failed += 1;
              job.processed += 1;
              pushLog(job, {
                status: "failed",
                product_id: productId,
                product_name: productRow.name,
                message: "No suggestions returned",
              });
              return;
            }

            const parsedAttributes =
              typeof product.attributes === "string"
                ? JSON.parse(product.attributes || "{}")
                : product.attributes || {};
            const parsedMeta =
              typeof product.product_meta === "string"
                ? JSON.parse(product.product_meta || "{}")
                : product.product_meta || {};
            const productGender = (
              product.gender ||
              parsedAttributes?.gender ||
              parsedMeta?.product_feature_map?.gender ||
              parsedMeta?.gender ||
              ""
            ).toLowerCase();
            if (productGender === "unisex") {
              const women = suggestions.find((s) => (s.category_path || "").toLowerCase().startsWith("womenswear"));
              const men = suggestions.find((s) => (s.category_path || "").toLowerCase().startsWith("menswear"));
              const toMap = [women, men, top].filter(Boolean);
              const uniqueIds = [...new Set(toMap.map((s) => s.category_id))];
              for (const cid of uniqueIds) {
                await mapProductToCategory(productId, cid);
              }
            } else {
              await mapProductToCategory(productId, top.category_id);
            }

            job.success += 1;
            job.processed += 1;
            pushLog(job, {
              status: "success",
              product_id: productId,
              product_name: productRow.name,
              category_path: top.category_path || top.category_name,
              message: "Mapped successfully",
            });
          } catch (err) {
            job.failed += 1;
            job.processed += 1;
            pushLog(job, {
              status: "failed",
              product_id: productId,
              product_name: productRow.name,
              message: err.message || "Mapping failed",
            });
          } finally {
            job.updatedAt = new Date().toISOString();
          }
        },
        () => job.stopRequested
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

module.exports = {
  createJob,
  getJob,
  getActiveJob,
  stopJob,
};
