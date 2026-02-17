// importHelpers/vendorLdHelpers.js

// Utilities
function safeJsonParse(str, fallback = null) {
    if (str == null) return fallback;
    try {
        if (typeof str === 'object') return str;
        return JSON.parse(String(str));
    } catch {
        return fallback;
    }
}

function toJsonb(obj) {
    // In callers we pass through as plain value; pg driver will handle string -> jsonb by ::jsonb
    return obj == null ? null : JSON.stringify(obj);
}

function slugify(input) {
    if (!input) return '';
    return String(input)
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

function stripStars(val) {
    if (!val) return val;
    return String(val).replace(/\*/g, '').trim();
}

function normalizeGenderValue(value) {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['man', 'men', 'mens'].includes(normalized)) return 'men';
    if (['woman', 'women', 'womens', 'ladies'].includes(normalized)) return 'women';
    if (['boy', 'boys'].includes(normalized)) return 'boys';
    if (['girl', 'girls'].includes(normalized)) return 'girls';
    if (['kids', 'children', 'child'].includes(normalized)) return 'kids';
    if (normalized.includes('unisex')) return 'unisex';
    return normalized;
}
// Map one CSV row into our internal product/variants shape
// Source headers include (examples):
// supplier_product_id, brand, year, variant, color_detail, color_supplier, made_in, material,
// name, description, size_info, ... ean, qty, supplier, original_price, product_category_id,
// brand_model_number, hs_code, sku, category_string, selling_price, cost, images, size_quantity,
// products_tags, gender, season_one, season_two, created_at, updated_at, id
function transformRowToProduct(row) {
    // Normalize incoming strings
    const imagesArr = safeJsonParse(row.images, []);
    const sizeQuantities = safeJsonParse(row.size_quantity, []);
    const tags = safeJsonParse(row.products_tags, []);
    const genderObj = safeJsonParse(row.gender, null);
    const seasonOne = (safeJsonParse(row.season_one, null) || {}).name || row.season_one || null;
    const seasonTwo = (safeJsonParse(row.season_two, null) || {}).name || row.season_two || null;
    const genderNameRaw = (genderObj && genderObj.name) ? genderObj.name : row.gender?.name || row.gender || null;
    const genderName = normalizeGenderValue(genderNameRaw);

    const productSku = row.sku ? String(row.sku).trim() : null;
    const supplierProductId = row.supplier_product_id ? String(row.supplier_product_id).trim() : null;

    const product = {
        // product keys
        productid: supplierProductId,
        product_sku: productSku, // "first row wins" keyed on this
        name: row.name || null,
        title: row.name || null,
        short_description: null,
        description: row.description || null,
        brand_name: row.brand || null,
        gender: genderName || null,
        attributes: {
            brand_model_number: row.brand_model_number || null,
            hs_code: row.hs_code || null,
            year: row.year || null,
            color_detail: row.color_detail || null,
            color_supplier: row.color_supplier || null,
            material: row.material || null,
            products_tags: tags || [],
            season_one: seasonOne || null,
            season_two: seasonTwo || null,
            size_info: row.size_info || null,
            category_id_source: row.product_category_id || null,
            supplier: row.supplier || null,
            vendor_source_id: row.id || null,
        },
        product_meta: null,
        sizechart_text: null,
        sizechart_image: null,
        shipping_returns_payments: null,
        environmental_impact: null,

        // We’ll let MEDIA table store images; but still keep an array here to push into media later
        product_img: imagesArr && imagesArr.length ? imagesArr[0] : null,
        videos: null,
        delivery_time: null,
        cod_available: true,
        supplier: row.supplier || null,
        country_of_origin: row.made_in || null,
        is_active: true,

        // custom for media pipeline
        images: imagesArr || [],
    };

    // Build variants from size_quantity; if absent, create a single "UNI" variant using qty
    // size_quantity sample: [{"UNI": "2"}]
    const normalizedColor = row.normalized_color || null;
    const normalizedSize = row.normalized_size || null;
    const variants = [];

    const color = (row.color_detail || row.color_supplier || null) || null;
    const eanRaw = stripStars(row.ean);

    // Vendor prices (in EUR)
    const vendorMrp = row.original_price ? Number(row.original_price) : null;
    const vendorSalePrice = row.selling_price ? Number(row.selling_price) : null;

    // Calculate our prices with tiered markup: >1000 → 28%, 501–1000 → 37%, else 45%
    let ourPrice = null;
    let ourMrp = null;

    if (vendorSalePrice !== null && vendorSalePrice < 6) {
        return null;
    }
    if (vendorSalePrice && vendorSalePrice > 0) {
        let markupPercentage;

        if (vendorSalePrice > 1000) {
            markupPercentage = 0.28;
        } else if (vendorSalePrice >= 501) {
            markupPercentage = 0.37;
        } else {
            markupPercentage = 0.45;
        }

        ourPrice = Math.round(vendorSalePrice * (1 + markupPercentage));

        if (vendorMrp && vendorMrp > vendorSalePrice) {
            const vendorDiscount = (vendorMrp - vendorSalePrice) / vendorMrp;
            ourMrp = Math.round(ourPrice / (1 - vendorDiscount));
        } else {
            ourMrp = ourPrice;
        }
    }

    const basePrices = {
        vendormrp: vendorMrp,
        vendorsaleprice: vendorSalePrice,
        price: ourPrice,
        mrp: ourMrp,
        cost: row.cost ? Number(row.cost) : null,
    };
    if (Array.isArray(sizeQuantities) && sizeQuantities.length) {
        // each entry is like {"UNI": "2"} or {"40":"1"}
        sizeQuantities.forEach(entry => {
            const sizeKey = Object.keys(entry || {})[0];
            if (!sizeKey) return;
            const qtyVal = Number(entry[sizeKey] ?? 0) || 0;

            const vSku = productSku ? `${productSku}-${sizeKey}` : null;

            variants.push({
                sku: vSku,
                vendor_product_id: supplierProductId || null,
                stock: qtyVal,
                vendormrp: basePrices.vendormrp,
                vendorsaleprice: basePrices.vendorsaleprice,
                price: basePrices.price,
                mrp: basePrices.mrp,
                attributes: {
                    ean: eanRaw || null,
                    brand_model_number: row.brand_model_number || null,
                    hs_code: row.hs_code || null,
                    material: row.material || null,
                    year: row.year || null,
                    tags: tags || [],
                    season_one: seasonOne || null,
                    season_two: seasonTwo || null,
                },
                images: imagesArr || [],
                variant_color: color,
                variant_size: sizeKey,
                normalized_color: normalizedColor,
                normalized_size: normalizedSize,
                country_of_origin: row.made_in || null,
                is_active: true,
                // normalized_color: 
            });
        });
    } else {
        // Single variant path
        const qty = Number(row.qty ?? 0) || 0;
        variants.push({
            sku: productSku || null,
            vendor_product_id: supplierProductId || null,
            stock: qty,
            vendormrp: basePrices.vendormrp,
            vendorsaleprice: basePrices.vendorsaleprice,
            price: basePrices.price,
            mrp: basePrices.mrp,
            attributes: {
                ean: eanRaw || null,
                brand_model_number: row.brand_model_number || null,
                hs_code: row.hs_code || null,
                material: row.material || null,
                year: row.year || null,
                tags: tags || [],
                season_one: seasonOne || null,
                season_two: seasonTwo || null,
            },
            images: imagesArr || [],
            variant_color: color,
            variant_size: (row.size_info && String(row.size_info).trim()) || 'UNI',
            country_of_origin: row.made_in || null,
            is_active: true,
        });
    }

    const totalStock = variants.reduce(
        (sum, variant) => sum + (Number(variant.stock) || 0),
        0
    );
    product.is_active = totalStock > 0;

    // Category from "Women > Accessories > Lifestyle"
    const category_path = (row.category_string || '').trim() || null;

    return { product, variants, category_path };
}

module.exports = {
    transformRowToProduct,
    slugify,
    toJsonb,
    safeJsonParse,
    stripStars,
};
