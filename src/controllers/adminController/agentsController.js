const catchAsync = require("../../errorHandling/catchAsync");
const sendResponse = require("../../utils/sendResponse");
const AutoMapJobService = require("../../services/autoMapJobService");
const RemapCategoryJobService = require("../../services/remapCategoryJobService");
const DescriptionRewriteJobService = require("../../services/descriptionRewriteJobService");
const ProductNameRewriteJobService = require("../../services/productNameRewriteJobService");

/**
 * GET /admin/agents
 * Returns list of all agents with current status and recent run info.
 */
module.exports.getAgents = catchAsync(async (req, res) => {
  const activeAutoMap = AutoMapJobService.getActiveJob();
  const recentAutoMap = await AutoMapJobService.getRecentJobs("auto_mapping");
  const activeCategoryRemap = RemapCategoryJobService.getActiveJob();
  const recentCategoryRemap = await RemapCategoryJobService.getRecentJobs(
    RemapCategoryJobService.AGENT_ID_CATEGORY_REMAP
  );
  const activeDescRewrite = DescriptionRewriteJobService.getActiveJob();
  const recentDescRewrite = await DescriptionRewriteJobService.getRecentJobs("description_rewrite");
  const activeNameRewrite = ProductNameRewriteJobService.getActiveJob();
  const recentNameRewrite = await ProductNameRewriteJobService.getRecentJobs(
    ProductNameRewriteJobService.AGENT_ID_PRODUCT_NAME_REWRITE
  );

  const agents = [
    {
      id: "auto_mapping",
      name: "Auto Mapping",
      description: "Maps unmapped products to our categories using AI suggestions. Runs in batches; supports start/stop and backs off on rate limits.",
      status: activeAutoMap ? "running" : "idle",
      activeJob: activeAutoMap
        ? {
            id: activeAutoMap.id,
            status: activeAutoMap.status,
            total: activeAutoMap.total,
            processed: activeAutoMap.processed,
            success: activeAutoMap.success,
            failed: activeAutoMap.failed,
            startedAt: activeAutoMap.startedAt,
            updatedAt: activeAutoMap.updatedAt,
          }
        : null,
      recentJobs: recentAutoMap,
      endpoints: {
        start: "POST /admin/auto-map/start",
        stop: "POST /admin/auto-map/stop",
        active: "GET /admin/auto-map/active",
        status: "GET /admin/auto-map/status?jobId=...",
      },
    },
    {
      id: "category_remap",
      name: "Category Remap",
      description:
        "Re-runs AI mapping for products currently assigned to a chosen our category and all its descendants: clears only those subtree mappings, then suggests fresh categories (e.g. after adding Formal/Casual under Shirts). Start this job from Category Mapping settings where you pick the root category.",
      startFromSettingsOnly: true,
      status: activeCategoryRemap ? "running" : "idle",
      activeJob: activeCategoryRemap
        ? {
            id: activeCategoryRemap.id,
            status: activeCategoryRemap.status,
            total: activeCategoryRemap.total,
            processed: activeCategoryRemap.processed,
            success: activeCategoryRemap.success,
            failed: activeCategoryRemap.failed,
            startedAt: activeCategoryRemap.startedAt,
            updatedAt: activeCategoryRemap.updatedAt,
            rootCategoryName: activeCategoryRemap.rootCategoryName,
            rootOurCategoryId: activeCategoryRemap.rootOurCategoryId,
          }
        : null,
      recentJobs: recentCategoryRemap,
      endpoints: {
        start: "POST /admin/category-remap/start (body: { rootOurCategoryId })",
        stop: "POST /admin/category-remap/stop",
        active: "GET /admin/category-remap/active",
        status: "GET /admin/category-remap/status?jobId=...",
      },
    },
    {
      id: "description_rewrite",
      name: "Description Rewrite",
      description: "Rewrites vendor product descriptions into our storefront format (THE DETAILS style: narrative, highlights, composition). Processes products that do not yet have an 'our description'.",
      status: activeDescRewrite ? "running" : "idle",
      activeJob: activeDescRewrite
        ? {
            id: activeDescRewrite.id,
            status: activeDescRewrite.status,
            total: activeDescRewrite.total,
            processed: activeDescRewrite.processed,
            success: activeDescRewrite.success,
            failed: activeDescRewrite.failed,
            startedAt: activeDescRewrite.startedAt,
            updatedAt: activeDescRewrite.updatedAt,
          }
        : null,
      recentJobs: recentDescRewrite,
      endpoints: {
        start: "POST /admin/description-rewrite/start",
        stop: "POST /admin/description-rewrite/stop",
        active: "GET /admin/description-rewrite/active",
        status: "GET /admin/description-rewrite/status?jobId=...",
      },
    },
    {
      id: "product_name_rewrite",
      name: "Product Name Rewrite",
      description:
        "Suggests cleaner storefront names (and titles when needed) from vendor data. Processes active products with description context that have not been processed by this agent yet (tracked in product meta).",
      status: activeNameRewrite ? "running" : "idle",
      activeJob: activeNameRewrite
        ? {
            id: activeNameRewrite.id,
            status: activeNameRewrite.status,
            total: activeNameRewrite.total,
            processed: activeNameRewrite.processed,
            success: activeNameRewrite.success,
            failed: activeNameRewrite.failed,
            startedAt: activeNameRewrite.startedAt,
            updatedAt: activeNameRewrite.updatedAt,
          }
        : null,
      recentJobs: recentNameRewrite,
      endpoints: {
        start: "POST /admin/product-name-rewrite/start",
        stop: "POST /admin/product-name-rewrite/stop",
        active: "GET /admin/product-name-rewrite/active",
        status: "GET /admin/product-name-rewrite/status?jobId=...",
      },
    },
  ];

  return sendResponse(res, 200, true, "Agents", { agents });
});
