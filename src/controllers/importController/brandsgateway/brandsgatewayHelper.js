const axios = require("axios");
const https = require("https");

const DEFAULT_BASE_URL = "https://nova.shopwoo.com/api/v1";

function getApiClient() {
  const baseURL = process.env.BRANDSGATEWAY_API_URL || DEFAULT_BASE_URL;
  const username = process.env.BRANDSGATEWAY_USERNAME || "";
  const password = process.env.BRANDSGATEWAY_PASSWORD || "";

  return axios.create({
    baseURL,
    auth: { username, password },
    timeout: 30000,
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
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

async function fetchProductsPage({
  storeId,
  page = 1,
  perPage = 50,
  stockStatus = "instock",
  conditionId = null,
}) {
  const client = getApiClient();
  const response = await requestWithRetry(() =>
    client.get("/products", {
      params: {
        store_id: storeId,
        page,
        per_page: perPage,
        stock_status: stockStatus,
        ...(conditionId ? { condition: conditionId } : {}),
      },
    })
  );

  const total = Number(response.headers["x-sw-total"] || 0) || 0;
  const totalPages = Number(response.headers["x-sw-totalpages"] || 0) || 0;
  const items = Array.isArray(response.data) ? response.data : [];

  return { items, total, totalPages };
}

async function fetchProductById(productId, storeId) {
  const client = getApiClient();
  const response = await requestWithRetry(() =>
    client.get(`/products/${productId}`, {
      params: {
        store_id: storeId,
      },
    })
  );
  return response.data || null;
}

async function checkProductsStatus(productIds, storeId) {
  const client = getApiClient();
  const body = new URLSearchParams();
  for (const id of productIds || []) {
    if (id === null || id === undefined) continue;
    body.append("product_ids[]", String(id));
  }
  const response = await requestWithRetry(() =>
    client.post("/products/check-status", body, {
      params: { store_id: storeId },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    })
  );
  return response.data || null;
}

async function fetchCategoryById(categoryId, storeId) {
  const client = getApiClient();
  const response = await requestWithRetry(() =>
    client.get(`/categories/${categoryId}`, {
      params: {
        store_id: storeId,
      },
    })
  );
  return response.data || null;
}

module.exports = {
  getApiClient,
  requestWithRetry,
  fetchProductsPage,
  fetchProductById,
  checkProductsStatus,
  fetchCategoryById,
};
