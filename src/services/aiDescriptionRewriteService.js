const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Strip HTML tags for plain-text input to the model.
 */
function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Safely parse JSON (attributes, product_meta).
 */
function safeJson(obj) {
  if (obj == null) return {};
  if (typeof obj === "object") return obj;
  if (typeof obj !== "string") return {};
  try {
    return JSON.parse(obj || "{}");
  } catch {
    return {};
  }
}

/**
 * Build full product context for the model: all fields we have so the model does not need to invent anything.
 */
function buildProductContext(product) {
  const name = product.name || "";
  const title = product.title || product.name || "";
  const brand = product.brand_name || "";
  const shortDesc = stripHtml(product.short_description || "").slice(0, 1000);
  const vendorDesc = stripHtml(product.description || "").slice(0, 4000);
  const attrs = safeJson(product.attributes);
  const meta = safeJson(product.product_meta);
  const gender = product.gender || attrs.gender || meta.gender || "";
  const countryOfOrigin = product.country_of_origin || attrs.country_of_origin || meta.country_of_origin || "";
  return {
    name,
    title,
    brand,
    shortDesc,
    vendorDesc,
    attrs,
    meta,
    gender,
    countryOfOrigin,
  };
}

/**
 * Format product data as a single structured text block for the prompt (all we know about the product).
 */
function formatProductDataForPrompt(ctx) {
  const lines = [];
  lines.push("=== PRODUCT INFORMATION (use only this; do not add anything not listed here) ===");
  lines.push(`Name: ${ctx.name}`);
  if (ctx.title && ctx.title !== ctx.name) lines.push(`Title: ${ctx.title}`);
  if (ctx.brand) lines.push(`Brand: ${ctx.brand}`);
  if (ctx.gender) lines.push(`Gender: ${ctx.gender}`);
  if (ctx.countryOfOrigin) lines.push(`Country of origin: ${ctx.countryOfOrigin}`);
  if (ctx.shortDesc) lines.push(`Short description: ${ctx.shortDesc}`);
  if (ctx.vendorDesc) lines.push(`Vendor description:\n${ctx.vendorDesc}`);
  if (Object.keys(ctx.attrs).length > 0) {
    lines.push("Attributes: " + JSON.stringify(ctx.attrs));
  }
  if (Object.keys(ctx.meta).length > 0) {
    const metaFiltered = { ...ctx.meta };
    delete metaFiltered.default_category_resolved;
    if (Object.keys(metaFiltered).length > 0) {
      lines.push("Product meta: " + JSON.stringify(metaFiltered));
    }
  }
  lines.push("=== END PRODUCT INFORMATION ===");
  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are a fashion e-commerce copywriter. Your task is to rewrite the vendor's product description into a clean "our" storefront description.

STEP 1 — CHECK FOR NAME vs DESCRIPTION MISMATCH (do this first):
- If the product NAME or TITLE clearly describes a different thing than the DESCRIPTION (e.g. name says "sneaker" but description talks about "t-shirt";), then the product is suspicious ,but name says "boots" but description talks about "rain boots", then it is ok it is not suspicious.
- In that case, respond with ONLY this JSON, nothing else: {"suspicious": true, "reason": "Name indicates [X] but description describes [Y]"}
- If name and description refer is ok, proceed to STEP 2.

STEP 2 — WRITE THE DESCRIPTION:
- Use ONLY the product information provided. Do not invent any details.
- Output format (use HTML tags for structure):
  1) Optional section header: "THE DETAILS".
  2) Brand name in bold, then product name.
  3) One concise narrative paragraph (2–4 sentences) based only on the provided name, description, and attributes. Do NOT include external partner names (e.g. Good On You, FARFETCH), ratings, or links. Put model fit in a separate "Wearing" line if it appears in the source.
  4) A "Highlights" section with a bullet list of key attributes that are actually present. Use <ul><li>...</li></ul>.
  5) Composition / Washing / Wearing only if explicitly provided.
- Output ONLY the description HTML. No preamble, no JSON wrapper.

Rules:
- If suspicious (name/description mismatch), output only the JSON object. Otherwise output only the HTML.
- Use simple HTML: <p>, <strong>, <ul>, <li>, <br/>. No div or class.`;

/**
 * Call OpenAI to rewrite vendor description into our storefront format.
 * Returns either { suspicious: true, reason } or the HTML description string.
 * @param {object} product - Full product from getProductByIdAdmin
 * @returns {Promise<{ suspicious: true, reason: string } | string>}
 */
async function rewriteDescription(product) {
  const ctx = buildProductContext(product);
  const userContent = formatProductDataForPrompt(ctx);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  const content = response.choices[0]?.message?.content?.trim() || "";
  if (!content) throw new Error("Empty rewrite from AI");

  // If model returned suspicious JSON, parse and return it
  let parsed;
  try {
    const cleaned = content.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && parsed.suspicious === true) {
    return { suspicious: true, reason: parsed.reason || "Name and description describe different product types" };
  }

  return content;
}

const QUARANTINE_SUGGEST_SYSTEM = `You help fix e-commerce products in "quarantine" due to data quality flags.
You receive the quarantine reason and current name, title, short description, and description (plain text excerpt).

Return ONLY a single JSON object (no markdown) with this exact shape:
{
  "fixable": boolean,
  "explanation": "1-3 sentences for the merchant",
  "suggested_name": string | null,
  "suggested_title": string | null,
  "suggested_short_description": string | null,
  "suggested_description": string | null
}

Rules:
- Use null for any field that should stay unchanged (when in doubt, null).
- If the issue is name vs description mismatch, align description and short_description to match the product name/brand; you may adjust title if needed. Do not invent a different product type.
- If the reason mentions competitor names or blacklisted terms in content, rewrite description/short_description to remove those references while keeping factual product details.
- If the issue is only "no matching category" or mapping-only text with no text conflict, set fixable to false and explain that category assignment is needed outside this tool.
- suggested_description may include simple HTML (<p>, <strong>, <ul>, <li>, <br/>) like a normal product description, or plain text.
- Do not add competitor names, other retailers, or URLs.`;

/**
 * Propose editable fixes for a quarantined product (name / title / descriptions).
 * @param {object} product - from getProductByIdAdmin
 * @param {string} suspiciousReason
 * @returns {Promise<{ fixable: boolean, explanation: string, suggested_name: string|null, suggested_title: string|null, suggested_short_description: string|null, suggested_description: string|null }>}
 */
async function suggestQuarantineFix(product, suspiciousReason) {
  const name = product.name || "";
  const title = product.title || "";
  const shortDesc = stripHtml(product.short_description || "").slice(0, 2000);
  const longDesc = stripHtml(product.description || "").slice(0, 12000);

  const userPayload = {
    suspicious_reason: suspiciousReason || "Unknown",
    name,
    title,
    short_description: shortDesc,
    description_excerpt: longDesc,
    brand_name: product.brand_name || "",
  };

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: QUARANTINE_SUGGEST_SYSTEM },
      {
        role: "user",
        content: JSON.stringify(userPayload),
      },
    ],
    temperature: 0.25,
    max_tokens: 2500,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim() || "";
  if (!content) throw new Error("Empty suggestion from AI");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON from AI suggestion");
  }

  return {
    fixable: parsed.fixable === true,
    explanation: String(parsed.explanation || "").trim() || "No explanation provided.",
    suggested_name:
      parsed.suggested_name != null && String(parsed.suggested_name).trim()
        ? String(parsed.suggested_name).trim()
        : null,
    suggested_title:
      parsed.suggested_title != null && String(parsed.suggested_title).trim()
        ? String(parsed.suggested_title).trim()
        : null,
    suggested_short_description:
      parsed.suggested_short_description != null &&
      String(parsed.suggested_short_description).trim()
        ? String(parsed.suggested_short_description).trim()
        : null,
    suggested_description:
      parsed.suggested_description != null && String(parsed.suggested_description).trim()
        ? String(parsed.suggested_description).trim()
        : null,
  };
}

const NAME_REWRITE_SYSTEM = `You improve e-commerce product display names for a fashion storefront.

You receive structured product information (name, title, brand, descriptions). Use ONLY that information. Do not invent materials, categories, or product types that are not clearly supported by the text.

Return ONLY a single JSON object (no markdown) with this exact shape:
{
  "skip": boolean,
  "skip_reason": string | null,
  "name": string,
  "title": string | null
}

Rules:
- If the current name is already clear, professional, and well-formatted for shoppers, set skip to true, skip_reason to a short explanation, name to the current name, title to null.
- Otherwise set skip to false. "name" is the main storefront product name: concise (aim under 100 characters), Title Case or natural casing (not ALL CAPS), include brand once at the start when a brand is provided, no internal SKU codes or pipe-separated vendor junk unless they are clearly part of the official style name.
- "title" is optional SEO/display line: shorter variant or null to mean "same as name" / leave strategy to the app (you may set null and the app will align title when appropriate).
- Do not add competitor names, other retailers, or URLs.
- name must be non-empty when skip is false.`;

/**
 * Suggest a cleaner storefront name (and optional title) from product context.
 * @param {object} product - from getProductByIdAdmin
 * @returns {Promise<{ skip: true, skip_reason: string } | { skip: false, name: string, title: string | null }>}
 */
async function rewriteProductName(product) {
  const ctx = buildProductContext(product);
  const userContent = formatProductDataForPrompt(ctx);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: NAME_REWRITE_SYSTEM },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 400,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim() || "";
  if (!content) throw new Error("Empty name rewrite from AI");

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Invalid JSON from name rewrite");
  }

  if (parsed.skip === true) {
    return {
      skip: true,
      skip_reason: String(parsed.skip_reason || "Model skipped").trim() || "Skipped",
    };
  }

  const name = String(parsed.name || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Name rewrite returned empty name");

  const maxLen = 255;
  const clipped = name.length > maxLen ? name.slice(0, maxLen).trim() : name;

  let title = null;
  if (parsed.title != null && String(parsed.title).trim()) {
    const t = String(parsed.title).trim().replace(/\s+/g, " ");
    title = t.length > maxLen ? t.slice(0, maxLen).trim() : t;
  }

  return { skip: false, name: clipped, title };
}

module.exports = {
  rewriteDescription,
  rewriteProductName,
  buildProductContext,
  suggestQuarantineFix,
};
