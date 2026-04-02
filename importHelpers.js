// importHelpers.js
const slugify = require('slugify');

function toJsonb(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
        try {
            JSON.parse(value);
            return value;
        } catch (e) {
            return JSON.stringify(value);
        }
    }
    try {
        return JSON.stringify(value);
    } catch (e) {
        return JSON.stringify(String(value));
    }
}

/**
 * parseCombinationString
 * Example: "KNITTED MINI DRESS : Color - White, Size - L"
 * returns { color: "White", size: "L", raw: "Color - White, Size - L" }
 */
function parseCombinationString(s) {
    if (!s) return { raw: null, attributes: {} };
    // take substring after colon if present
    let after = s.includes(':') ? s.split(':').slice(1).join(':') : s;
    after = after.trim();
    const attrs = {};
    after.split(',').map(x => x.trim()).forEach(pair => {
        const [k, ...rest] = pair.split('-').map(p => p.trim());
        if (!k) return;
        const val = rest.join('-').trim();
        const key = k.toLowerCase().replace(/\s+/g, '_'); // e.g. "Color" -> "color"
        if (val) attrs[key] = val;
    });
    return { raw: after, attributes: attrs };
}

/**
 * parseImageUrls: CSV has images separated by commas
 */
function parseImageUrls(s) {
    if (!s) return [];
    return s.split(',').map(x => x.trim()).filter(Boolean);
}

/**
 * transformRowToProduct
 * returns object: { product: {...}, variants: [...], category_path (string) }
 */
function transformRowToProduct(row) {
    // row is an object of CSV headers -> values
    const categoryPath = row['Default Category Tree'] || row['Default Category Tree ']; // tolerate trailing spaces
    const attributes = {
        composition: row['Feature Composition'] || null,
        material: row['Feature Material'] || null,
        season: row['Feature Season'] || null,
        adults_inclusive: row['Feature Adults Gender Inclusive'] || null
    };

    // parse combination to variant attributes
    const comb = parseCombinationString(row['Product Name With Combination'] || row['Product Name With Combination ']);

    const images = parseImageUrls(row['Product Image Urls'] || '');

    // product-level object
    const product = {
        productid: String(row['Product ID'] || '').trim() || null,
        name: (row['Product Name'] || '').trim(),
        title: (row['Product Name'] || '').trim(),
        short_description: (row['Short Description'] || '').trim() || null,
        description: (row['Description'] || '').trim() || null,
        brand_name: row['Manufacturer Name'] || row['Feature Manufacturer Name'] || null,
        product_sku: (row['Product Reference Code'] || '').trim() || null,
        product_img: images[0] || null,
        product_img1: images[0] || null,
        product_img2: images[1] || null,
        product_img3: images[2] || null,
        product_img4: images[3] || null,
        product_img5: images[4] || null,
        attributes: Object.assign({}, attributes),
        product_meta: null,
        videos: null,
        delivery_time: null,
        cod_available: true,
        supplier: row['Manufacturer Name'] || null,
        country_of_origin: (row['Default Category Tree'] && row['Default Category Tree'].includes('Italy')) ? 'Italy' : (row['Feature Made In'] || null),
        gender: row['Feature Gender'] || row['Feature Adults Gender Inclusive'] || null,
        is_active: true
    };

    // a single variant for this row (CSV likely has 1 line per combination)
    const variant = {
        sku: (row['Combinations Reference Code'] || row['Product Combinations ID'] || row['Product Reference Code'] || row['Product Reference Code '])?.toString().trim() || null,
        price: parseFloat(row['Final Price Without Tax']) || parseFloat(row['Street Price']) || null,
        mrp: row['Street Price'] ? parseFloat(row['Street Price']) : null,
        sale_price: row['Final Price Without Tax'] ? parseFloat(row['Final Price Without Tax']) : null,
        stock: parseInt(row['Quantity'] || '0', 10) || 0,
        barcode: row['Combinations EAN-13 Or JAN Barcode'] || row['EAN-13 Or JAN Barcode'] || null,
        vendor_product_id: row['Product Combinations ID'] || null,
        attributes: Object.assign({}, comb.attributes, {
            color: row['Feature Color'] || comb.attributes.color || null,
            size: row['Feature Size'] || comb.attributes.size || null,
            color_code: row['Feature Color Code'] || null,
            attribute_group_color: row['Attribute Group Color'] || null,
            attribute_group_size: row['Attribute Group Size'] || null
        }),
        images: images.length ? images : null,
        is_active: true,
        variant_color: row['Feature Color'] || comb.attributes.color || null,
        variant_size: row['Feature Size'] || comb.attributes.size || null,
        normalized_size: row['normalized_size'] || null,
        normalized_color: row['normalized_colors'] || null,
        size_type: row['size_type'] || null
    };

    return { product, variants: [variant], category_path: categoryPath };
}

module.exports = {
    toJsonb,
    parseCombinationString,
    parseImageUrls,
    transformRowToProduct,
    slugify: (s) => slugify(s || '', { lower: true, strict: true })
};
