const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Build a tree structure from flat category array
 * Categories from DB have parent_id, we need to build children arrays
 */
const buildCategoryTree = (flatCategories) => {
  const categoryMap = new Map();
  const roots = [];

  // First pass: create a map of all categories
  for (const cat of flatCategories) {
    categoryMap.set(cat.id, { ...cat, children: [] });
  }

  // Second pass: build the tree by linking children to parents
  for (const cat of flatCategories) {
    const node = categoryMap.get(cat.id);
    if (cat.parent_id && categoryMap.has(cat.parent_id)) {
      categoryMap.get(cat.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by priority at each level
  const sortByPriority = (nodes) => {
    nodes.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortByPriority(node.children);
      }
    }
  };
  sortByPriority(roots);

  return roots;
};

/**
 * Flatten categories tree into a list with full paths
 * By default includes only leaf categories; set includeAll=true to include all nodes.
 */
const flattenCategoriesWithPath = (categories, parentPath = "", result = [], includeAll = false) => {
  for (const cat of categories) {
    const currentPath = parentPath ? `${parentPath} > ${cat.name}` : cat.name;
    const hasChildren = cat.children && cat.children.length > 0;

    // Only add leaf nodes (no children) OR if includeAll is true
    if (!hasChildren || includeAll) {
      result.push({
        id: cat.id,
        name: cat.name,
        path: currentPath,
        slug: cat.slug,
        depth: currentPath.split(' > ').length,
        isLeaf: !hasChildren,
      });
    }

    if (hasChildren) {
      flattenCategoriesWithPath(cat.children, currentPath, result, includeAll);
    }
  }
  return result;
};

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeGender = (value) => {
  const raw = normalizeText(value);
  if (!raw) return "";
  if (raw.includes("unisex")) return "unisex";
  if (raw.includes("female") || raw.includes("woman") || raw.includes("women") || raw.includes("womens") || raw.includes("ladies")) return "women";
  if (raw.includes("men") || raw.includes("man") || raw.includes("mens")) return "men";
  if (raw.includes("boy")) return "boys";
  if (raw.includes("girl")) return "girls";
  if (raw.includes("kid") || raw.includes("child")) return "kids";
  return raw;
};

const safeJsonParse = (value) => {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
};

const getRootFromPath = (pathValue) => {
  const raw = normalizeText(pathValue);
  if (!raw) return "";
  return raw.split(" ")[0];
};

const depthFromPath = (pathValue) => {
  if (!pathValue) return 0;
  return String(pathValue).split(">").length;
};

const isLowPriorityPath = (pathValue) => {
  const raw = normalizeText(pathValue);
  return (
    raw.includes("new in") ||
    raw.includes("what s new") ||
    raw.includes("trending") ||
    raw.includes("discover")
  );
};

const buildTokenSet = (value) => {
  const text = normalizeText(value);
  if (!text) return new Set();
  return new Set(text.split(" ").filter((t) => t.length > 2));
};

const scoreCandidate = (candidate, vendorInfo) => {
  const { vendorCategory, vendorCategoryPath } = vendorInfo;
  const candidatePath = normalizeText(candidate.path);
  const candidateName = normalizeText(candidate.name);

  let score = 0;

  if (vendorCategory && candidateName.includes(normalizeText(vendorCategory))) {
    score += 0.35;
  }

  if (vendorCategoryPath && candidatePath.includes(normalizeText(vendorCategoryPath))) {
    score += 0.35;
  }

  const vendorTokens = buildTokenSet(`${vendorCategory} ${vendorCategoryPath}`);
  if (vendorTokens.size > 0) {
    const candidateTokens = buildTokenSet(candidate.path);
    let overlap = 0;
    vendorTokens.forEach((t) => {
      if (candidateTokens.has(t)) overlap += 1;
    });
    score += Math.min(0.3, overlap / vendorTokens.size);
  }

  if (isLowPriorityPath(candidate.path)) {
    score -= 0.25;
  }

  return Math.min(1, Math.max(0, score));
};

/**
 * Get the category tree structure as a readable string for AI context
 */
const getCategoryTreeString = (categories, indent = 0) => {
  let result = "";
  for (const cat of categories) {
    result += "  ".repeat(indent) + "- " + cat.name + "\n";
    if (cat.children && cat.children.length > 0) {
      result += getCategoryTreeString(cat.children, indent + 1);
    }
  }
  return result;
};

/**
 * Get AI-powered category suggestions for a product
 */
const getAICategorySuggestions = async (product, categories) => {
  try {
    // Build tree structure from flat categories (DB returns flat array with parent_id)
    const categoryTree = buildCategoryTree(categories);

    // Get full category list (leaf + non-leaf) with paths
    const allCategories = flattenCategoriesWithPath(categoryTree, "", [], true);
    const leafCategories = allCategories.filter((c) => c.isLeaf);

    // Build category list string - full paths with IDs
    const categoryListStr = allCategories
      .map((cat) => `ID: ${cat.id} | Full Path: ${cat.path}`)
      .join("\n");

    // Build product info string
    const parsedAttributes = safeJsonParse(product.attributes) || product.attributes || {};
    const parsedMeta = safeJsonParse(product.product_meta) || product.product_meta || {};
    const metaGender =
      parsedMeta?.product_feature_map?.gender ||
      parsedMeta?.gender ||
      "";

    const descSource = product.our_description || product.description;
    const productInfo = {
      name: product.name || "",
      title: product.title || "",
      description: descSource ? descSource.replace(/<[^>]*>/g, "").substring(0, 800) : "",
      brand: product.brand_name || "",
      vendorCategory: product.vendor_category_name || product.categories?.[0]?.name || "",
      vendorCategoryPath: product.vendor_category_path || product.categories?.[0]?.path || "",
      gender:
        product.gender ||
        parsedAttributes?.gender ||
        metaGender ||
        "",
    };

    // Log product info for debugging
    console.log("AI Categorization - Product Info:", {
      name: productInfo.name,
      vendorCategory: productInfo.vendorCategory,
      brand: productInfo.brand,
    });

    const prompt = `You are a fashion e-commerce category expert. Your task is to find the correct category for this product.

===== PRODUCT INFORMATION =====
Product Title: "${productInfo.title || productInfo.name}"
Product Name: "${productInfo.name}"
Vendor Category: "${productInfo.vendorCategory}"
Vendor Category Path: "${productInfo.vendorCategoryPath || "N/A"}"
Brand: ${productInfo.brand}
Gender: ${productInfo.gender || "N/A"}
Description: ${productInfo.description || "No description available"}

===== CRITICAL: IDENTIFY THE PRODUCT TYPE =====
PRIORITY ORDER: TITLE FIRST, THEN DESCRIPTION,  THEN VENDOR CATEGORY 
Note: Vendor categories can be broad. If the name/description indicates a more specific sub‑category that exists (e.g., "T‑shirt" under Topwear, "mini dress" under Dresses), you MUST prefer that leaf.

The product name is: "${productInfo.name}"
The vendor category is: "${productInfo.vendorCategory}"

Based on these, what type of product is this?


===== AVAILABLE CATEGORIES (FULL PATHS, LEAF AND NON-LEAF) =====
${categoryListStr}
1. Identify the product type from the PRODUCT NAME, DESCRIPTION and VENDOR CATEGORY above
2. Find matching categories from the available list that match this product type
3. Return 3 suggestions - all must be for the SAME product type

RANKING (critical): Put the most specific category that truly fits the product as suggestion #1 with the HIGHEST confidence.
- Example: product clearly a "mini dress" → #1 must be the Mini Dresses leaf (if listed), NOT the generic Dresses parent.
- Use a parent (e.g. Dresses) as #1 only when no listed leaf matches the product type.
- #2 and #3 can be sibling leaves or the parent as fallback.
You MUST choose only from the category list above. Do not invent or assume categories that are not listed.

EXAMPLES:
- Product "ICECREAM Jeans Black" → suggest Jeans categories under Clothing
- Product "Gucci Necklace Gold"  → suggest Necklace categories under Accessories
- Product "Canada Goose Canada Goose T-shirts and Polos Black"  → suggest Polo Shirts categories under Tops or Topwear

STRICT RULES:
- ALL 3 suggestions MUST match the actual product type
- A product named "Jeans" should ONLY get Jeans/Clothing suggestions, NEVER jewelry
- A product named "Necklace" should ONLY get Jewelry suggestions, NEVER clothing
- Use the exact category IDs from the list above

Return exactly 3 suggestions as JSON array (highest confidence on the best-fitting leaf when one exists):
[
  {
    "category_id": "exact-uuid-from-list",
    "category_path": "Root > Parent > Child > Most specific leaf (e.g. Mini Dresses)",
    "confidence": 95,
    "reason": "Title/description clearly indicate this leaf; not the broader parent only"
  },
  {
    "category_id": "exact-uuid-from-list",
    "category_path": "Alternative leaf or sibling",
    "confidence": 75,
    "reason": "Why this is a good alternative"
  },
  {
    "category_id": "exact-uuid-from-list",
    "category_path": "Parent or other fallback only if needed",
    "confidence": 60,
    "reason": "Third option explanation"
  }
]

If NO category in the list fits this product (e.g. product type not in our taxonomy, or no suitable option for this gender), respond with this JSON object instead of an array:
{"no_match": true, "reason": "Brief, clear explanation why no category fits (e.g. product type, missing category, or mismatch)."}

Return ONLY valid JSON, no other text.`;

    const normalizedGender = normalizeGender(productInfo.gender);
    const allowedRoots = normalizedGender === "men"
      ? new Set(["menswear"])
      : normalizedGender === "women"
        ? new Set(["womenswear"])
        : normalizedGender === "unisex"
          ? new Set(["womenswear", "menswear"])
          : normalizedGender === "kids" || normalizedGender === "boys" || normalizedGender === "girls"
            ? new Set(["kidswear"])
            : new Set();

    const filteredCategories = allowedRoots.size
      ? allCategories.filter((cat) => allowedRoots.has(getRootFromPath(cat.path || cat.name)))
      : allCategories;

    const filteredLeafCategories = filteredCategories.filter((c) => c.isLeaf);

    const categoryListStrFiltered = filteredCategories
      .map((cat) => `ID: ${cat.id} | Full Path: ${cat.path}`)
      .join("\n");

    const promptWithFilteredCategories = prompt.replace(
      categoryListStr,
      categoryListStrFiltered
    );

    // Deterministic pre-match using vendor category/path (disabled for testing)
    /*
    const vendorInfo = {
      vendorCategory: productInfo.vendorCategory,
      vendorCategoryPath: productInfo.vendorCategoryPath,
    };
    const preMatched = filteredCategories
      .map((cat) => ({ ...cat, score: scoreCandidate(cat, vendorInfo) }))
      .filter((c) => c.score > 0.2)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.depth || 0) - (a.depth || 0);
      })
      .slice(0, 3)
      .map((c, idx) => ({
        category_id: c.id,
        category_name: c.name,
        category_path: c.path,
        confidence: Math.round(Math.min(95, Math.max(60, c.score * 100))),
        reason: idx === 0
          ? "Strong vendor category/path match"
          : "Relevant vendor category/path match",
      }));

    if (preMatched.length > 0) {
      return normalizedGender === "unisex"
        ? ensureUnisexBalance(preMatched, filteredCategories)
        : preMatched;
    }
    */

    console.log("AI Suggestion Input:", {
      product: {
        id: product.id,
        name: productInfo.name,
        title: productInfo.title,
        vendorCategory: productInfo.vendorCategory,
        vendorCategoryPath: productInfo.vendorCategoryPath,
        brand: productInfo.brand,
        gender: productInfo.gender,
      },
      categoryCount: filteredCategories.length,
      genderFilterApplied: !!allowedRoots.size,
      promptPreview: promptWithFilteredCategories.slice(0, 2000),
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a fashion product categorization expert. Your ONLY job is to match products to the correct category.

CRITICAL RULE: The product name, description and vendor category tell you EXACTLY what the product is.
- "Jeans" in the name = it's jeans, suggest jeans/pants categories
- "Necklace" in the name = it's jewelry, suggest necklace categories
- "Sneakers" in the name = it's shoes, suggest sneaker categories
- "Mini dress" / "maxi" / "midi" in the name or description = pick the matching leaf (Mini/Maxi/Midi Dresses), not only the parent Dresses

NEVER suggest jewelry categories for clothing products.
NEVER suggest clothing categories for jewelry products.

If no category in the provided list fits the product (e.g. product type not in taxonomy, no option for this gender), respond with {"no_match": true, "reason": "Clear explanation why no category fits"}.
Otherwise respond with the JSON array of 3 suggestions. Respond with valid JSON only.`,
        },
        {
          role: "user",
          content: promptWithFilteredCategories,
        },
      ],
      temperature: 0,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content || "[]";
    console.log("AI Suggestion Raw Response:", content);

    // Parse the JSON response
    let parsed;
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.slice(7);
      }
      if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      cleanContent = cleanContent.trim();

      parsed = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI suggestions");
    }

    // If model flagged name/description mismatch, return special object
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.suspicious === true) {
      return { suspicious: true, reason: parsed.reason || "Name and description describe different product types" };
    }

    // If model found no matching category, return reason (like description agent)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.no_match === true) {
      return { no_match: true, reason: parsed.reason || "No matching category in our taxonomy." };
    }

    const suggestions = Array.isArray(parsed) ? parsed : [];

    // Validate and enrich suggestions with category names
    const validatedSuggestions = suggestions
      .filter((s) => s.category_id && filteredCategories.some((c) => c.id === s.category_id))
      .map((s) => {
        const category = filteredCategories.find((c) => c.id === s.category_id);
        return {
          category_id: s.category_id,
          category_name: category?.name || "",
          category_path: category?.path || s.category_path,
          confidence: Math.min(100, Math.max(0, parseInt(s.confidence) || 0)),
          reason: s.reason || "",
          isLeaf: category?.isLeaf ?? false,
        };
      })
      .filter((s) => (s.category_path ? !isLowPriorityPath(s.category_path) : true))
      .sort((a, b) => {
        if (a.isLeaf !== b.isLeaf) return a.isLeaf ? -1 : 1;
        const depthDiff = depthFromPath(b.category_path) - depthFromPath(a.category_path);
        if (depthDiff !== 0) return depthDiff;
        return b.confidence - a.confidence;
      })
      .slice(0, 3);

    // If we got less than 3 valid suggestions, that's still okay
    return normalizedGender === "unisex"
      ? ensureUnisexBalance(validatedSuggestions, filteredCategories)
      : validatedSuggestions;
  } catch (error) {
    console.error("AI Category Suggestion Error:", error);
    throw error;
  }
};

const ensureUnisexBalance = (suggestions, categories) => {
  if (!Array.isArray(suggestions)) return suggestions;
  const women = suggestions.find((s) => getRootFromPath(s.category_path || "") === "womenswear");
  const men = suggestions.find((s) => getRootFromPath(s.category_path || "") === "menswear");
  if (women && men) return suggestions;

  const byRoot = (root) =>
    categories
      .filter((c) => getRootFromPath(c.path || c.name) === root)
      .filter((c) => !isLowPriorityPath(c.path))
      .map((c) => ({
        category_id: c.id,
        category_name: c.name,
        category_path: c.path,
        confidence: 60,
        reason: "Unisex product: add gender counterpart",
      }));

  const extra = [];
  if (!women) {
    const candidate = byRoot("womenswear")[0];
    if (candidate) extra.push(candidate);
  }
  if (!men) {
    const candidate = byRoot("menswear")[0];
    if (candidate) extra.push(candidate);
  }

  return [...suggestions, ...extra].slice(0, 3);
};

module.exports = {
  getAICategorySuggestions,
  flattenCategoriesWithPath,
};
