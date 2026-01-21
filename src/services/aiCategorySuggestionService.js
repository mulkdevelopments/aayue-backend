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
 * Only includes leaf categories (categories with no children) for more precise mapping
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

    // Get leaf categories only (most specific) for selection - with full paths
    const leafCategories = flattenCategoriesWithPath(categoryTree, "", [], false);

    // Build category list string - only leaf categories with full paths
    const categoryListStr = leafCategories
      .map((cat) => `ID: ${cat.id} | Full Path: ${cat.path}`)
      .join("\n");

    // Build product info string
    const productInfo = {
      name: product.name || "",
      title: product.title || "",
      description: product.description ? product.description.replace(/<[^>]*>/g, "").substring(0, 800) : "",
      brand: product.brand_name || "",
      vendorCategory: product.categories?.[0]?.name || "",
      vendorCategoryPath: product.categories?.[0]?.path || "",
    };

    // Log product info for debugging
    console.log("AI Categorization - Product Info:", {
      name: productInfo.name,
      vendorCategory: productInfo.vendorCategory,
      brand: productInfo.brand,
    });

    const prompt = `You are a fashion e-commerce category expert. Your task is to find the correct category for this product.

===== PRODUCT INFORMATION =====
Product Name: "${productInfo.name}"
Vendor Category: "${productInfo.vendorCategory}"
Brand: ${productInfo.brand}
Description: ${productInfo.description || "No description available"}

===== CRITICAL: IDENTIFY THE PRODUCT TYPE =====
LOOK AT THE PRODUCT NAME AND VENDOR CATEGORY FIRST!

The product name is: "${productInfo.name}"
The vendor category is: "${productInfo.vendorCategory}"

Based on these, what type of product is this?
- If name/category contains "Jeans" → it's JEANS (clothing)
- If name/category contains "Shirt", "T-shirt", "Tee" → it's a SHIRT (clothing)
- If name/category contains "Dress" → it's a DRESS (clothing)
- If name/category contains "Jacket", "Coat" → it's OUTERWEAR (clothing)
- If name/category contains "Sneaker", "Shoe", "Boot", "Loafer" → it's SHOES
- If name/category contains "Bag", "Tote", "Backpack" → it's a BAG
- If name/category contains "Necklace", "Bracelet", "Ring", "Earring", "Bijoux" → it's JEWELRY
- If name/category contains "Watch" → it's a WATCH
- If name/category contains "Belt" → it's a BELT

===== AVAILABLE CATEGORIES (LEAF NODES WITH FULL PATHS) =====
${categoryListStr}

===== YOUR TASK =====
1. First, identify the product type from the PRODUCT NAME and VENDOR CATEGORY above
2. Then find matching categories from the available list that match this product type
3. Return 3 suggestions - all must be for the SAME product type

EXAMPLES:
- Product "ICECREAM Jeans Black" with vendor category "Jeans" → suggest Jeans categories under Clothing
- Product "Gucci Necklace Gold" with vendor category "Jewellery" → suggest Necklace categories under Accessories
- Product "Nike Air Max" with vendor category "Sneakers" → suggest Sneaker categories under Shoes

STRICT RULES:
- ALL 3 suggestions MUST match the actual product type
- A product named "Jeans" should ONLY get Jeans/Clothing suggestions, NEVER jewelry
- A product named "Necklace" should ONLY get Jewelry suggestions, NEVER clothing
- Use the exact category IDs from the list above

Return exactly 3 suggestions as JSON array:
[
  {
    "category_id": "exact-uuid-from-list",
    "category_path": "Root > Parent > Child > Leaf (full path)",
    "confidence": 95,
    "reason": "Why this specific path matches"
  },
  {
    "category_id": "exact-uuid-from-list",
    "category_path": "Alternative full path",
    "confidence": 75,
    "reason": "Why this is a good alternative"
  },
  {
    "category_id": "exact-uuid-from-list",
    "category_path": "Another full path option",
    "confidence": 60,
    "reason": "Third option explanation"
  }
]

Return ONLY valid JSON, no other text.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a fashion product categorization expert. Your ONLY job is to match products to the correct category.

CRITICAL RULE: The product name and vendor category tell you EXACTLY what the product is.
- "Jeans" in the name = it's jeans, suggest ONLY jeans/pants categories
- "Necklace" in the name = it's jewelry, suggest ONLY necklace categories
- "Sneakers" in the name = it's shoes, suggest ONLY sneaker categories

NEVER suggest jewelry categories for clothing products.
NEVER suggest clothing categories for jewelry products.

Respond with valid JSON only.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content || "[]";

    // Parse the JSON response
    let suggestions;
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

      suggestions = JSON.parse(cleanContent);
    } catch (parseErr) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI suggestions");
    }

    // Validate and enrich suggestions with category names
    const validatedSuggestions = suggestions
      .filter((s) => s.category_id && leafCategories.some((c) => c.id === s.category_id))
      .map((s) => {
        const category = leafCategories.find((c) => c.id === s.category_id);
        return {
          category_id: s.category_id,
          category_name: category?.name || "",
          category_path: category?.path || s.category_path,
          confidence: Math.min(100, Math.max(0, parseInt(s.confidence) || 0)),
          reason: s.reason || "",
        };
      })
      .slice(0, 3);

    // If we got less than 3 valid suggestions, that's still okay
    return validatedSuggestions;
  } catch (error) {
    console.error("AI Category Suggestion Error:", error);
    throw error;
  }
};

module.exports = {
  getAICategorySuggestions,
  flattenCategoriesWithPath,
};
