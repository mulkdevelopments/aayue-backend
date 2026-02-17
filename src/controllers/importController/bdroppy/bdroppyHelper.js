/**
 * BDroppy API client – catalogs, categories, subcategories, brands, product export.
 * Auth: Bearer token. Base URL: prod or sandbox.
 * @see https://documenter.getpostman.com/view/18085490/UVyvuEGB
 */

const axios = require("axios");
const https = require("https");

const DEFAULT_BASE_URL = "https://prod.bdroppy.com";

function getBaseUrl() {
  return process.env.BDROPPY_BASE_URL || DEFAULT_BASE_URL;
}

function getToken() {
  const token = process.env.BDROPPY_TOKEN || "";
  if (!token) {
    throw new Error("BDROPPY_TOKEN is not set");
  }
  return token;
}

function getApiClient() {
  const baseURL = getBaseUrl();
  const token = getToken();

  return axios.create({
    baseURL,
    timeout: 60000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    httpsAgent: new https.Agent({ keepAlive: true }),
  });
}

async function requestWithRetry(requestFn, retries = 3, baseDelayMs = 500) {
  let attempt = 0;
  while (true) {
    try {
      return await requestFn();
    } catch (err) {
      const code = err.code || err?.cause?.code;
      const status = err.response?.status;
      const retryable =
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ECONNABORTED" ||
        (status >= 500 && status < 600);

      if (!retryable || attempt >= retries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

/**
 * GET /api/user_catalog – list of user catalogs (contains _id for export).
 */
async function getCatalogs() {
  const client = getApiClient();
  const response = await requestWithRetry(() =>
    client.get("/api/user_catalog")
  );
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * GET /api/category – all categories.
 */
async function getCategories() {
  const client = getApiClient();
  const response = await requestWithRetry(() => client.get("/api/category"));
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * GET /api/subcategory – all subcategories (include category ref).
 */
async function getSubcategories() {
  const client = getApiClient();
  const response = await requestWithRetry(() =>
    client.get("/api/subcategory")
  );
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * GET /api/brand – all brands.
 */
async function getBrands() {
  const client = getApiClient();
  const response = await requestWithRetry(() => client.get("/api/brand"));
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * GET /api/product/export – paginated product export.
 * @param {Object} opts
 * @param {string} opts.userCatalog - required catalog id
 * @param {number} opts.page - page number (1-based)
 * @param {number} opts.pageSize - items per page
 * @param {string} [opts.acceptedlocales] - e.g. "en_US"
 * @param {string} [opts.since] - ISO date for incremental (only updated since)
 */
async function getProductsExport({
  userCatalog,
  page = 1,
  pageSize = 100,
  acceptedlocales = "en_US",
  since = null,
}) {
  if (!userCatalog) {
    throw new Error("userCatalog is required for product export");
  }

  const client = getApiClient();
  const params = {
    user_catalog: userCatalog,
    page,
    pageSize,
    acceptedlocales,
    light_plus: false, // false so API returns real picture URLs (with light_plus=true they can be placeholders)
  };
  if (since) {
    params.since = since;
  }

  const response = await requestWithRetry(() =>
    client.get("/api/product/export", { params })
  );

  const data = response.data;
  const items = Array.isArray(data) ? data : (data && data.items) || [];
  const imgBase = data && typeof data.imgBase === "string" ? data.imgBase.trim() : null;
  const totalNumberOfElements = data && typeof data.totalNumberOfElements === "number" ? data.totalNumberOfElements : null;
  return { items, imgBase, totalNumberOfElements, page, pageSize };
}

module.exports = {
  getBaseUrl,
  getToken,
  getApiClient,
  requestWithRetry,
  getCatalogs,
  getCategories,
  getSubcategories,
  getBrands,
  getProductsExport,
};
