const dbPool = require("../db/dbConnection");
const ProductService = require("./productService");
const { getAICategorySuggestions } = require("./aiCategorySuggestionService");
const { normalizeProductAfterCategoryMap } = require("./sizeNormalizationService");

const MAX_LOGS = 200;

const isRateLimitError = (err) => {
  const msg = (err?.message || err?.toString || "").toString().toLowerCase();
  const code = err?.status || err?.statusCode || err?.code;
  return code === 429 || /rate limit|too many requests|quota/i.test(msg);
};

const pushLog = (job, entry) => {
  if (!job?.logs) return;
  job.logs.push({
    time: new Date().toISOString(),
    ...entry,
  });
  if (job.logs.length > MAX_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_LOGS);
  }
};

/** Normalize text for matching leaf category words to title/description. */
function normalizeForLexicalMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pathDepth(categoryPath) {
  if (!categoryPath) return 0;
  return String(categoryPath)
    .split(/[>›»]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function pathLeafWords(categoryPath) {
  const parts = String(categoryPath || "")
    .split(/[>›»]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return [];
  return parts[parts.length - 1].split(/\s+/).filter((w) => w.length >= 3);
}

/** True if a significant word from the path's leaf appears in product text (incl. light plural stem). */
function pathLeafMatchesProduct(categoryPath, productNorm) {
  const words = pathLeafWords(categoryPath);
  if (!words.length || !productNorm) return false;
  for (const w of words) {
    if (productNorm.includes(w)) return true;
    if (w.length > 4 && w.endsWith("es") && productNorm.includes(w.slice(0, -2)))
      return true;
    if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") && productNorm.includes(w.slice(0, -1)))
      return true;
  }
  return false;
}

/**
 * Choose primary mapping from AI suggestions. Avoids picking a broad parent when a deeper
 * leaf fits the product text or is within a confidence band of the top score.
 */
function pickPrimaryCategorySuggestion(suggestions, product) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  const maxConf = Math.max(...suggestions.map((s) => Number(s.confidence) || 0));
  const CONF_BAND = 28;
  const MIN_LEXICAL_CONF = 52;

  const descSource = product.our_description || product.description || "";
  const productNorm = normalizeForLexicalMatch(
    [
      product.name,
      product.title,
      descSource,
      product.vendor_category_name,
      product.vendor_category_path,
    ].join(" ")
  );

  const enriched = suggestions.map((s) => {
    const conf = Number(s.confidence) || 0;
    const depth = pathDepth(s.category_path);
    const lexical = pathLeafMatchesProduct(s.category_path, productNorm);
    const isLeaf = s.isLeaf === true;
    return { ...s, _conf: conf, _depth: depth, _lexical: lexical, _isLeaf: isLeaf };
  });

  const candidates = enriched.filter(
    (s) =>
      s._conf >= maxConf - CONF_BAND ||
      (s._lexical && s._conf >= MIN_LEXICAL_CONF)
  );
  const pool = candidates.length ? candidates : enriched;

  pool.sort((a, b) => {
    if (b._isLeaf !== a._isLeaf) return (b._isLeaf ? 1 : 0) - (a._isLeaf ? 1 : 0);
    if (b._depth !== a._depth) return b._depth - a._depth;
    if (b._lexical !== a._lexical) return (b._lexical ? 1 : 0) - (a._lexical ? 1 : 0);
    return b._conf - a._conf;
  });

  const chosen = pool[0];
  return {
    category_id: chosen.category_id,
    category_name: chosen.category_name,
    category_path: chosen.category_path,
    confidence: chosen.confidence,
    reason: chosen.reason,
    isLeaf: chosen.isLeaf,
  };
}

async function mapProductToCategory(productId, categoryId) {
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
}

/**
 * Clear our-category mappings for a product that fall inside a subtree (before re-AI map).
 */
async function clearProductMapsInSubtree(productId, subtreeIds) {
  if (!subtreeIds?.length) return;
  await dbPool.query(
    `DELETE FROM product_our_category_map
     WHERE product_id = $1 AND our_category_id = ANY($2::uuid[])`,
    [productId, subtreeIds]
  );
}

/**
 * Same AI mapping pipeline as auto-map: load product, optional subtree clear, AI suggest, insert maps.
 * Mutates job.success / job.failed / job.processed and job.stopRequested on rate limit.
 *
 * @returns {Promise<'success'|'failed'|'suspicious'|'stopped'>}
 */
async function runAiCategoryMappingForProduct(
  productRow,
  categories,
  job,
  { subtreeIdsToClear = null, mappingContext = "auto" } = {}
) {
  const productId = productRow.id;

  try {
    if (subtreeIdsToClear?.length) {
      await clearProductMapsInSubtree(productId, subtreeIdsToClear);
    }

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
      return "failed";
    }

    const vendorCategory =
      (product.categories || []).find((c) => c.is_our_category !== true) ||
      (product.categories || [])[0] ||
      null;
    if (vendorCategory) {
      product.vendor_category_name = vendorCategory.name || "";
      product.vendor_category_path = vendorCategory.path || "";
    }

    let suggestions;
    try {
      suggestions = await getAICategorySuggestions(product, categories);
    } catch (aiErr) {
      if (isRateLimitError(aiErr)) {
        const reason = `Rate limit reached: ${aiErr.message || "API rate limit exceeded"}`;
        job.stopRequested = true;
        job.stopReason = reason;
        job.status = "stopped";
        pushLog(job, {
          status: "stopped",
          product_id: productId,
          product_name: productRow.name,
          message: reason,
        });
        return "stopped";
      }
      throw aiErr;
    }

    if (
      suggestions &&
      typeof suggestions === "object" &&
      !Array.isArray(suggestions) &&
      suggestions.suspicious === true
    ) {
      const reason =
        suggestions.reason ||
        "Name and description describe different product types";
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
      return "suspicious";
    }

    if (
      suggestions &&
      typeof suggestions === "object" &&
      !Array.isArray(suggestions) &&
      suggestions.no_match === true
    ) {
      const reason = suggestions.reason || "No matching category in our taxonomy.";
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
      return "suspicious";
    }

    const top = pickPrimaryCategorySuggestion(suggestions, product);

    if (!top?.category_id) {
      const productLabel = productRow.name || product?.title || "Unknown";
      const vendorCat =
        product?.vendor_category_path || product?.vendor_category_name || "none";
      const reason =
        mappingContext === "remap"
          ? `Re-map could not find a matching category. Product: "${productLabel}". Vendor category: ${vendorCat}.`
          : `Auto-mapping could not find a matching category. Product: "${productLabel}". Vendor category: ${vendorCat}. Please assign a category manually.`;
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
      return "suspicious";
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
      const women = suggestions.find((s) =>
        (s.category_path || "").toLowerCase().startsWith("womenswear")
      );
      const men = suggestions.find((s) =>
        (s.category_path || "").toLowerCase().startsWith("menswear")
      );
      const toMap = [women, men, top].filter(Boolean);
      const uniqueIds = [...new Set(toMap.map((s) => s.category_id))];
      for (const cid of uniqueIds) {
        await mapProductToCategory(productId, cid);
      }
      for (const cid of uniqueIds) {
        try { await normalizeProductAfterCategoryMap(productId, cid); } catch (_) {}
      }
    } else {
      await mapProductToCategory(productId, top.category_id);
      try { await normalizeProductAfterCategoryMap(productId, top.category_id); } catch (_) {}
    }

    job.success += 1;
    job.processed += 1;
    pushLog(job, {
      status: "success",
      product_id: productId,
      product_name: productRow.name,
      category_path: top.category_path || top.category_name,
      message: subtreeIdsToClear?.length
        ? "Re-mapped successfully"
        : "Mapped successfully",
    });
    return "success";
  } catch (err) {
    job.failed += 1;
    job.processed += 1;
    pushLog(job, {
      status: "failed",
      product_id: productId,
      product_name: productRow.name,
      message: err.message || "Mapping failed",
    });
    return "failed";
  } finally {
    job.updatedAt = new Date().toISOString();
  }
}

module.exports = {
  runAiCategoryMappingForProduct,
  mapProductToCategory,
  pushLog,
  isRateLimitError,
};
