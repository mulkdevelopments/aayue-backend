#!/usr/bin/env node
/**
 * Backfill `normalized_size_final` and `size_type` on all product_variants.
 *
 * Joins each variant with its product's mapped category path to determine
 * whether it is Clothing or Footwear, then runs normalizeSize() to produce
 * the canonical value.
 *
 * Usage:
 *   node scripts/backfillSizes.js            (dry-run by default)
 *   node scripts/backfillSizes.js --commit   (actually writes to DB)
 */

require("dotenv").config();
const { Pool } = require("pg");
const { normalizeSize } = require("../src/utils/normalizeSize");
const { categoryHintFromPath, genderHintFromPath } = require("../src/utils/sizeConversion");

const BATCH_SIZE = 5000;
const DRY_RUN = !process.argv.includes("--commit");

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
});

async function run() {
  const client = await pool.connect();
  try {
    if (DRY_RUN) {
      console.log("🔍 DRY RUN — no changes will be written.  Pass --commit to apply.\n");
    }

    // Ensure columns exist
    await client.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS normalized_size_final VARCHAR(128)`);
    await client.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS size_type VARCHAR(50)`);

    const countRes = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM product_variants
      WHERE deleted_at IS NULL
        AND COALESCE(variant_size, attributes->>'size') IS NOT NULL
    `);
    const total = countRes.rows[0].total;
    console.log(`📦 Variants to process: ${total}\n`);

    let offset = 0;
    let updated = 0;
    let skipped = 0;
    const stats = { Clothing: 0, Footwear: 0, "One Size": 0, Accessory: 0, unchanged: 0 };

    while (offset < total) {
      const batch = await client.query(`
        SELECT
          pv.id,
          COALESCE(pv.variant_size, pv.attributes->>'size') AS raw_size,
          pv.normalized_size_final AS current_nsf,
          pv.size_type AS current_st,
          c.path AS category_path,
          LOWER(TRIM(p.gender)) AS gender
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN product_our_category_map pom ON pom.product_id = p.id
        LEFT JOIN categories c ON c.id = pom.our_category_id AND c.deleted_at IS NULL
        WHERE pv.deleted_at IS NULL
          AND COALESCE(pv.variant_size, pv.attributes->>'size') IS NOT NULL
        ORDER BY pv.id
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);

      if (batch.rows.length === 0) break;

      const updates = [];

      for (const row of batch.rows) {
        const catHint = categoryHintFromPath(row.category_path);
        const genHint = genderHintFromPath(row.category_path) || row.gender || null;
        const { canonical, sizeType } = normalizeSize(row.raw_size, catHint, genHint);

        if (!canonical) {
          skipped++;
          continue;
        }

        if (row.current_nsf === canonical && row.current_st === sizeType) {
          stats.unchanged++;
          continue;
        }

        updates.push({ id: row.id, canonical, sizeType });
        stats[sizeType] = (stats[sizeType] || 0) + 1;
      }

      if (updates.length > 0 && !DRY_RUN) {
        const ids = updates.map((u) => u.id);
        const canonicals = updates.map((u) => u.canonical);
        const sizeTypes = updates.map((u) => u.sizeType);

        await client.query(`
          UPDATE product_variants AS pv
          SET
            normalized_size_final = v.canonical,
            size_type = v.size_type
          FROM (
            SELECT unnest($1::uuid[]) AS id,
                   unnest($2::text[]) AS canonical,
                   unnest($3::text[]) AS size_type
          ) AS v
          WHERE pv.id = v.id
        `, [ids, canonicals, sizeTypes]);
      }

      updated += updates.length;
      offset += batch.rows.length;

      const pct = Math.round((offset / total) * 100);
      process.stdout.write(`\r  ${pct}%  (${offset}/${total})  updated=${updated}  skipped=${skipped}`);
    }

    console.log("\n\n✅ Backfill complete.\n");
    console.log("   Stats:");
    console.log(`     Clothing:  ${stats.Clothing}`);
    console.log(`     Footwear:  ${stats.Footwear}`);
    console.log(`     One Size:  ${stats["One Size"]}`);
    console.log(`     Accessory: ${stats.Accessory}`);
    console.log(`     Unchanged: ${stats.unchanged}`);
    console.log(`     Skipped:   ${skipped}`);
    console.log(`     Total updated: ${updated}`);

    if (DRY_RUN) {
      console.log("\n⚠️  DRY RUN — nothing was written.  Re-run with --commit to apply.");
    } else {
      console.log("\n🔧 Creating composite index (if not exists)...");
      await client.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pv_size_type_canonical
          ON product_variants(size_type, normalized_size_final)
          WHERE deleted_at IS NULL AND normalized_size_final IS NOT NULL
      `);
      console.log("   Index created.");

      console.log("📊 Running ANALYZE on product_variants...");
      await client.query("ANALYZE product_variants");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("\n❌ Backfill failed:", err);
  process.exit(1);
});
