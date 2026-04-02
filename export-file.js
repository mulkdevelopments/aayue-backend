const fs = require("fs");
const { Pool } = require("pg");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

// ✅ Configure PostgreSQL Connection
const pool = new Pool({
    user: "postgres",
    host: "45.64.107.216",
    database: "ecommerce",
    password: "Developer123#",
    port: 5432,
});
 
async function exportVariants() {
    try {
        const client = await pool.connect();

        const query = `
            SELECT
                pv.id ,
                pv.variant_color,
                pv.variant_size,
                pv.normalized_size,
                pv.normalized_color,
                pv.size_type,
                p.name AS product_name,
                c.name AS category_name,
                c.path AS category_path
            FROM product_variants pv
            LEFT JOIN products p ON pv.product_id = p.id
            LEFT JOIN categories c ON p.default_category_id = c.id
        `;

        console.log("⏳ Running query...");
        const res = await client.query(query);
        client.release();
        console.log(`✅ Query completed. Rows fetched: ${res.rows.length}`);

        const csvWriter = createCsvWriter({
            path: "./variants_export_final.csv",
            header: [
                { id: "id", title: "id" },
                { id: "variant_color", title: "variant_color" },
                { id: "variant_size", title: "variant_size" },
                { id: "normalized_size", title: "normalized_size" },
                { id: "normalized_color", title: "normalized_color" },
                { id: "size_type", title: "size_type" },
                { id: "product_name", title: "product_name" },
                { id: "category_name", title: "category_name" },
                { id: "category_path", title: "category_path" },
            ]
        });

        console.log("⏳ Writing to CSV...");
        await csvWriter.writeRecords(res.rows);

        console.log("\n✅ CSV Export Completed!");
        console.log(`📄 File saved as: variants_export.csv\n`);

    } catch (err) {
        console.error("❌ Error while exporting:", err);
    }
}

exportVariants();
