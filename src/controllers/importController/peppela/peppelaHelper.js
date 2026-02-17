const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const PEPPELA_API_URL = process.env.PEPPELA_API_URL || "https://nokinstyle.com/api";
const PEPPELA_API_KEY = process.env.PEPPELA_API_KEY;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

function getAuthHeader() {
  if (!PEPPELA_API_KEY) {
    throw new Error("PEPPELA_API_KEY is not set");
  }
  const token = Buffer.from(`${PEPPELA_API_KEY}:`).toString("base64");
  return `Basic ${token}`;
}

function getApiClient() {
  return axios.create({
    baseURL: PEPPELA_API_URL,
    headers: {
      Authorization: getAuthHeader(),
    },
    timeout: 30000,
  });
}

function normalizeToArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "object") {
    if (Array.isArray(value.image)) return value.image;
    if (Array.isArray(value.category)) return value.category;
    if (Array.isArray(value.combination)) return value.combination;
    if (Array.isArray(value.stock_available)) return value.stock_available;
    if (Array.isArray(value.product_option_value)) return value.product_option_value;
  }

  return [value];
}

function extractCombinationOptionValueIds(xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const combination = parsed?.prestashop?.combination || parsed?.combination;
  const optionValues =
    combination?.associations?.product_option_values?.product_option_value;

  const optionValueArray = normalizeToArray(optionValues);

  return optionValueArray
    .map((entry) => entry?.id)
    .filter(Boolean)
    .map((id) => String(id));
}

async function fetchProductsPage(offset, limit) {
  const client = getApiClient();
  const response = await client.get("/products", {
    params: {
      output_format: "JSON",
      limit,
      offset,
    },
  });
  return response.data?.products || [];
}

async function fetchProductById(productId) {
  const client = getApiClient();
  const response = await client.get(`/products/${productId}`, {
    params: {
      output_format: "JSON",
      display: "full",
    },
  });
  const product =
    response.data?.product ||
    (Array.isArray(response.data?.products) ? response.data.products[0] : null);
  if (!product) {
    const apiMessage =
      response.data?.errors?.[0]?.message ||
      response.data?.errors?.message ||
      null;
    const error = new Error(
      apiMessage || `Product not found in API: ${productId}`
    );
    error.responseData = response.data;
    throw error;
  }
  return product;
}

async function fetchCombinationXml(combinationId) {
  const client = getApiClient();
  const response = await client.get(`/combinations/${combinationId}`, {
    responseType: "text",
  });
  return response.data;
}

async function fetchCombinationDetails(combinationId) {
  const xmlText = await fetchCombinationXml(combinationId);
  const parsed = xmlParser.parse(xmlText);
  const combination = parsed?.prestashop?.combination || parsed?.combination;

  if (!combination) {
    throw new Error(`Combination not found: ${combinationId}`);
  }

  const optionValueIds = extractCombinationOptionValueIds(xmlText);

  return {
    id: String(combination.id),
    productId: String(combination.id_product),
    reference: combination.reference ? String(combination.reference) : null,
    optionValueIds,
  };
}

async function fetchStockById(stockId) {
  const client = getApiClient();
  const response = await client.get(`/stock_availables/${stockId}`, {
    params: {
      output_format: "JSON",
    },
  });
  return response.data?.stock_available;
}

async function fetchOptionValueById(optionValueId) {
  const client = getApiClient();
  const response = await client.get(`/product_option_values/${optionValueId}`, {
    params: {
      output_format: "JSON",
    },
  });
  return response.data?.product_option_value;
}

async function fetchProductFeatureById(featureId) {
  const client = getApiClient();
  const response = await client.get(`/product_features/${featureId}`, {
    params: {
      output_format: "JSON",
      display: "full",
    },
  });
  return (
    response.data?.product_feature ||
    (Array.isArray(response.data?.product_features)
      ? response.data.product_features[0]
      : null)
  );
}

async function fetchProductFeatureValueById(featureValueId) {
  const client = getApiClient();
  const response = await client.get(`/product_feature_values/${featureValueId}`, {
    params: {
      output_format: "JSON",
      display: "full",
    },
  });
  return (
    response.data?.product_feature_value ||
    (Array.isArray(response.data?.product_feature_values)
      ? response.data.product_feature_values[0]
      : null)
  );
}

async function fetchCategoryById(categoryId) {
  const client = getApiClient();
  const response = await client.get(`/categories/${categoryId}`, {
    params: {
      output_format: "JSON",
      display: "full",
    },
  });
  return (
    response.data?.category ||
    (Array.isArray(response.data?.categories)
      ? response.data.categories[0]
      : null)
  );
}

function buildImageUrl(productId, imageId) {
  return `${PEPPELA_API_URL}/images/products/${productId}/${imageId}`;
}

module.exports = {
  fetchProductsPage,
  fetchProductById,
  fetchCombinationDetails,
  fetchStockById,
  fetchOptionValueById,
  fetchProductFeatureById,
  fetchProductFeatureValueById,
  fetchCategoryById,
  buildImageUrl,
  normalizeToArray,
};
