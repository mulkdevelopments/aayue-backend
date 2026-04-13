// importHelpers.js
const { randomUUID } = require("crypto");
const slugifyLib = require('slugify');
const { normalizeSize } = require("../../../utils/normalizeSize");
const { categoryHintFromPath, genderHintFromPath } = require("../../../utils/sizeConversion");

/**
 * Converts a JS value to a JSONB-compatible string or null
 */
function toJsonb(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
        try { JSON.parse(value); return value; } catch (e) { return JSON.stringify(value); }
    }
    try { return JSON.stringify(value); } catch (e) { return JSON.stringify(String(value)); }
}

/**
 * parseImageUrls: CSV has images separated by commas
 */
function parseImageUrls(s) {
    if (!s) return [];
    return String(s).split(',').map(x => x.trim()).filter(Boolean);
}

/**
 * simple helper to normalize slug
 */
function slugify(s) {
    return slugifyLib(String(s || ''), { lower: true, strict: true });
}

/**
 * transformGroupedRows
 * Accepts:
 *   - productRow: the CSV row where record_type === 'PRODUCT'
 *   - modelRows: array of CSV rows where record_type === 'MODEL' (may be empty)
 *
 * Returns:
 *   { product: {...}, variants: [...], category_path: '...' }
 *
 * Field mapping is based on the sample CSV you provided.
 */
function transformGroupedRows(productRow = {}, modelRows = []) {
    // Safe getters
    const get = (r, k) => (r && (r[k] !== undefined) ? String(r[k]).trim() : null);

    // Normalize brand name to Title Case (e.g., "GUCCI" -> "Gucci")
    const normalizeBrand = (brand) => {
        if (!brand) return null;
        const trimmed = brand.trim();
        if (!trimmed) return null;
        return trimmed.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    };

    // Category path: combine Categorie and Sottocategorie if both present
    const catMain = get(productRow, 'Categorie') || null;
    const catSub = get(productRow, 'Sottocategorie') || null;
    const categoryPath = catMain ? (catSub ? `${catMain} -> ${catSub}` : catMain) : null;

    // Images
    const images = [
        get(productRow, 'picture 1'),
        get(productRow, 'picture 2'),
        get(productRow, 'picture 3')
    ].filter(Boolean);

    // Basic product object
    const product = {
        // productid is the source product id from CSV
        productid: get(productRow, 'product_id') || null,
        // product SKU/reference code (column 'code')
        product_sku: get(productRow, 'code') || null,
        name: get(productRow, 'name') || get(productRow, 'productname') || null,
        title: get(productRow, 'productname') || get(productRow, 'name') || null,
        short_description: null,
        // plain_description column contains HTML — keep it as description (you can strip tags if needed)
        description: get(productRow, 'plain_description') || null,
        brand_name: normalizeBrand(get(productRow, 'brand') || get(productRow, 'Firme')),
        product_img: images[0] || null,
        product_img1: images[0] || null,
        product_img2: images[1] || null,
        product_img3: images[2] || null,
        product_img4: null,
        product_img5: null,
        attributes: {
            made_in: get(productRow, 'madein') || get(productRow, 'Produzione') || null,
            season: get(productRow, 'season') || null,
            color: get(productRow, 'color') || get(productRow, 'Genere') || null,
            heel: get(productRow, 'heel') || null,
            weight: parseFloat(get(productRow, 'weight')) || null
        },
        product_meta: null,
        videos: null,
        delivery_time: null,
        cod_available: true,
        supplier: normalizeBrand(get(productRow, 'brand') || get(productRow, 'Firme')),
        country_of_origin: get(productRow, 'madein') || get(productRow, 'Produzione') || null,
        gender: get(productRow, 'Genere') || null,
        is_active: true,
        // keep original rows for debugging if needed
        _raw: productRow
    };

    // Build variants from modelRows if present. If no modelRows, make 1 variant from productRow itself.
    const variants = [];

    if (Array.isArray(modelRows) && modelRows.length > 0) {
        for (const m of modelRows) {
            // The sample had barcode in scientific notation for large numbers; we'll coerce to string
            const barcodeRaw = get(m, 'picture 1 blob') || get(m, 'barcode') || get(m, 'model_id') || null;
            const barcode = barcodeRaw ? String(barcodeRaw).replace(/\s+/g, '') : null;

            const skuCandidate = get(m, 'model_id') || get(m, 'model_id') || `${product.product_sku || product.productid}-${m['model_id'] || randomUUID()}`;

            const _rawSz = get(m, 'model_size') || null;
            const _catH = categoryHintFromPath(categoryPath);
            const _genH = genderHintFromPath(categoryPath) || (get(productRow, 'Genere') || "").toLowerCase() || null;
            const _sz = normalizeSize(_rawSz, _catH, _genH);

            const v = {
                sku: skuCandidate || null,
                price: (parseFloat(get(productRow, 'sell_price')) || null),
                mrp: (parseFloat(get(productRow, 'street_price')) || null),
                sale_price: (parseFloat(get(productRow, 'sell_price')) || null),
                stock: parseInt(get(m, 'model_quantity') || get(productRow, 'product_quantity') || '0', 10) || 0,
                barcode: barcode,
                vendor_product_id: get(m, 'model_id') || null,
                attributes: {
                    size: _rawSz,
                    color: get(productRow, 'color') || null,
                },
                images: images.length ? images : null,
                is_active: true,
                variant_color: get(productRow, 'color') || null,
                variant_size: _rawSz,
                weight: parseFloat(get(productRow, 'weight')) || null,
                normalized_color: get(m, 'normalized_color') || null,
                normalized_size: get(m, 'normalized_size') || _rawSz,
                normalized_size_final: _sz.canonical || _rawSz,
                size_type: _sz.sizeType || null,
            };
            variants.push(v);
        }
    } else {
        // no model rows: create one variant from productRow
        const sku = get(productRow, 'code') || get(productRow, 'product_id') || randomUUID();
        const _rawSz2 = get(productRow, 'model_size') || null;
        const _catH2 = categoryHintFromPath(categoryPath);
        const _genH2 = genderHintFromPath(categoryPath) || (get(productRow, 'Genere') || "").toLowerCase() || null;
        const _sz2 = normalizeSize(_rawSz2, _catH2, _genH2);

        const v = {
            sku,
            price: (parseFloat(get(productRow, 'sell_price')) || null),
            mrp: (parseFloat(get(productRow, 'street_price')) || null),
            sale_price: (parseFloat(get(productRow, 'sell_price')) || null),
            stock: parseInt(get(productRow, 'product_quantity') || '0', 10) || 0,
            barcode: get(productRow, 'barcode') || null,
            vendor_product_id: get(productRow, 'model_id') || null,
            attributes: {
                color: get(productRow, 'color') || null,
                size: _rawSz2
            },
            images: images.length ? images : null,
            is_active: true,
            variant_color: get(productRow, 'color') || null,
            variant_size: _rawSz2,
            weight: parseFloat(get(productRow, 'weight')) || null,
            normalized_size_final: _sz2.canonical || _rawSz2,
            size_type: _sz2.sizeType || null,
        };
        variants.push(v);
    }

    return { product, variants, category_path: categoryPath };
}

/**
 * Backwards-compatible transformRowToProduct
 * If the incoming row looks like the old single-row-per-combination CSV, it will attempt to behave as before.
 * If the row is a PRODUCT row of the new format, it will return product object (variants empty) — the service should
 * group product + model rows and call transformGroupedRows instead for optimal results.
 */
function transformRowToProduct(row) {
    if (!row) return { product: null, variants: [] };

    const recordType = String(row['record_type'] || '').toUpperCase();

    if (recordType === 'PRODUCT') {
        // return product with one variant generated from the product row
        const grouped = transformGroupedRows(row, []);
        return grouped;
    } else if (recordType === 'MODEL') {
        // create a minimal product object that identifies the product by product_id and a variant from model row
        const productStub = {
            productid: String(row['product_id'] || '').trim() || null,
            product_sku: null,
            name: null,
            title: null,
            description: null,
            brand_name: null,
            product_img: null,
            is_active: true
        };
        const variant = {
            sku: String(row['model_id'] || randomUUID()).trim(),
            price: null,
            mrp: null,
            sale_price: null,
            stock: parseInt(row['model_quantity'] || '0', 10) || 0,
            barcode: String(row['picture 1 blob'] || row['barcode'] || '').trim() || null,
            vendor_product_id: String(row['model_id'] || '').trim() || null,
            attributes: { size: row['model_size'] || null },
            images: null,
            is_active: true,
            variant_size: row['model_size'] || null,
            normalized_color: row['normalized_color'] || null,
            normalized_size: row['normalized_size'] || null
        };
        return { product: productStub, variants: [variant], category_path: null };
    }

    // fallback: try old-style columns (keeps compatibility)
    const images = parseImageUrls(row['Product Image Urls'] || '');
    const product = {
        productid: String(row['Product ID'] || '').trim() || null,
        product_sku: String(row['Product Reference Code'] || '').trim() || null,
        name: String(row['Product Name'] || '').trim() || null,
        title: String(row['Product Name'] || '').trim() || null,
        short_description: row['Short Description'] || null,
        description: row['Description'] || null,
        brand_name: row['Manufacturer Name'] || null,
        product_img: images[0] || null,
        product_img1: images[0] || null,
        product_img2: images[1] || null,
        product_img3: images[2] || null,
        attributes: {},
        is_active: true
    };
    const variant = {
        sku: (row['Combinations Reference Code'] || row['Product Combinations ID'] || row['Product Reference Code']) || null,
        price: parseFloat(row['Final Price Without Tax']) || null,
        mrp: parseFloat(row['Street Price']) || null,
        sale_price: parseFloat(row['Final Price Without Tax']) || null,
        stock: parseInt(row['Quantity'] || '0', 10) || 0,
        barcode: row['Combinations EAN-13 Or JAN Barcode'] || row['EAN-13 Or JAN Barcode'] || null,
        attributes: {},
        images: images.length ? images : null,
        is_active: true,
        normalized_color: row['normalized_color'] || null,
        normalized_size: row['normalized_size'] || null
    };
    return { product, variants: [variant], category_path: row['Default Category Tree'] || null };
}

module.exports = {
    toJsonb,
    parseImageUrls,
    transformRowToProduct,
    transformGroupedRows,
    slugify
};
