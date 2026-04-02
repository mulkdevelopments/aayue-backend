// const fs = require("fs");
// const path = require("path");
// const csv = require("csv-parser");
// const { Pool } = require("pg");

// // ✅ Configure PostgreSQL
// const pool = new Pool({
//     user: "postgres",
//     host: "45.64.107.216",
//     database: "ecommerce",
//     password: "Developer123#",
//     port: 5432,
// });

// // ✅ CSV file path
// const csvFilePath = path.join(__dirname, "variants_export_final_normalized_final - variants_export_final_normalized_final.csv.csv");

// async function updateNormalizedSize() {
//     const client = await pool.connect();

//     try {
//         console.log("⏳ Reading CSV file...");

//         const rows = [];

//         await new Promise((resolve, reject) => {
//             fs.createReadStream(csvFilePath)
//                 .pipe(csv())
//                 .on("data", (row) => {
//                     rows.push(row);
//                 })
//                 .on("end", resolve)
//                 .on("error", reject);
//         });

//         console.log(`✅ CSV loaded. Total rows found: ${rows.length}`);

//         await client.query("BEGIN");

//         for (let row of rows) {
//             const { id, normalized_size } = row;

//             if (!id || !normalized_size) continue;

//             const updateQuery = `
//         UPDATE product_variants
//         SET normalized_size_final = $1
//         WHERE id = $2
//       `;

//             await client.query(updateQuery, [normalized_size, id]);
//         }

//         await client.query("COMMIT");

//         console.log(`✅ Successfully updated normalized_size_final for ${rows.length} rows.`);
//     } catch (error) {
//         await client.query("ROLLBACK");
//         console.error("❌ Error:", error);
//     } finally {
//         client.release();
//         pool.end();
//         console.log("🔌 Database connection closed.");
//     }
// }

// updateNormalizedSize();


const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { Pool } = require("pg");

const pool = new Pool({
    user: "postgres",
    host: "45.64.107.216",
    database: "ecommerce",
    password: "Developer123#",
    port: 5432,
});

const BATCH_SIZE = 5000; // ✅ process 5k rows per update
const csvFilePath = path.join(__dirname, "variants_export_final_normalized_final.csv.csv");

async function updateNormalizedSize() {
    const client = await pool.connect();

    try {
        console.log("⏳ Reading CSV file...");
        const rows = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(csvFilePath)
                .pipe(csv())
                .on("data", (row) => rows.push(row))
                .on("end", resolve)
                .on("error", reject);
        });

        console.log(`✅ CSV Loaded. Total rows: ${rows.length}`);
        console.log("🚀 Updating in batches...");

        await client.query("BEGIN");

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const chunk = rows.slice(i, i + BATCH_SIZE);

            const values = chunk
                .map(
                    (row) =>
                        `('${row.id}', '${row.normalized_size?.replace(/'/g, "''") || ""}')`
                )
                .join(",");

            const updateQuery = `
        UPDATE product_variants AS pv
        SET normalized_size_final = v.normalized_size
        FROM (VALUES ${values}) AS v(id, normalized_size)
        WHERE pv.id = v.id::uuid
      `;

            await client.query(updateQuery);

            console.log(`✅ Updated: ${i + chunk.length} / ${rows.length}`);
        }

        await client.query("COMMIT");

        console.log("🎉 Done! All rows updated successfully.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error:", error.message);
    } finally {
        client.release();
        pool.end();
    }
}

updateNormalizedSize();

