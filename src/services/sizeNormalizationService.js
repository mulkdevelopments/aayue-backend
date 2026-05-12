const pool = require("../db/dbConnection");
const { randomUUID } = require("crypto");

const ALPHA_LIST = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL","6XL"];

const CAT_TREE_CTE = `
  WITH RECURSIVE cat_tree AS (
    SELECT id FROM categories WHERE id = $1
      AND deleted_at IS NULL AND is_our_category = true
    UNION ALL
    SELECT c.id FROM categories c JOIN cat_tree t ON c.parent_id = t.id
    WHERE c.deleted_at IS NULL AND c.is_our_category = true
  )
`;

const COUNTRY_TO_SYSTEM = {
  italy: "IT", italia: "IT",
  france: "FR",
  germany: "DE", deutschland: "DE",
  spain: "EU", portugal: "EU", romania: "EU", hungary: "EU",
  bulgaria: "EU", slovenia: "EU", albania: "EU", turkey: "EU",
  mongolia: "EU", tr: "EU",
  tunisia: "FR", madagascar: "FR", morocco: "FR", egypt: "FR",
  "united kingdom": "UK",
  "united states": "US",
};

async function getCategoryTree() {
  const sql = `
    WITH RECURSIVE roots AS (
      SELECT id, name, parent_id, 0 AS depth
      FROM categories
      WHERE parent_id IS NULL AND is_our_category = true AND deleted_at IS NULL
        AND name IN ('Womenswear', 'Menswear')
    ),
    tree AS (
      SELECT id, name, parent_id, depth FROM roots
      UNION ALL
      SELECT c.id, c.name, c.parent_id, t.depth + 1
      FROM categories c JOIN tree t ON c.parent_id = t.id
      WHERE c.is_our_category = true AND c.deleted_at IS NULL
    )
    SELECT t.id, t.name, t.parent_id, t.depth,
      csm.table_id, csm.filter_type,
      sct.name AS table_name
    FROM tree t
    LEFT JOIN category_size_table_map csm ON csm.category_id = t.id
    LEFT JOIN size_conversion_tables sct ON sct.id = csm.table_id
    ORDER BY t.depth, t.name
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

async function getCategoryStatus(categoryId) {
  const sql = `
    ${CAT_TREE_CTE}
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN pv.normalized_size_final IS NOT NULL THEN 1 END) AS mapped,
      COUNT(CASE WHEN pv.normalized_size_final IS NULL THEN 1 END) AS unmapped
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    JOIN product_our_category_map pom ON pom.product_id = p.id
    JOIN cat_tree ct ON ct.id = pom.our_category_id
    WHERE pv.deleted_at IS NULL
  `;
  const { rows } = await pool.query(sql, [categoryId]);
  const r = rows[0];
  const total = parseInt(r.total);
  const mapped = parseInt(r.mapped);
  return {
    total,
    mapped,
    unmapped: parseInt(r.unmapped),
    coverage: total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0,
  };
}

async function getFullStatus() {
  const tree = await getCategoryTree();
  const catIds = tree.filter((n) => n.depth >= 2).map((n) => n.id);

  if (catIds.length === 0) return { tree, stats: {} };

  const sql = `
    WITH RECURSIVE cat_trees AS (
      SELECT id, id AS root_id FROM categories
      WHERE id = ANY($1) AND is_our_category = true AND deleted_at IS NULL
      UNION ALL
      SELECT c.id, t.root_id FROM categories c JOIN cat_trees t ON c.parent_id = t.id
      WHERE c.is_our_category = true AND c.deleted_at IS NULL
    )
    SELECT ct.root_id,
      COUNT(pv.id) AS total,
      COUNT(CASE WHEN pv.normalized_size_final IS NOT NULL THEN 1 END) AS mapped,
      COUNT(CASE WHEN pv.normalized_size_final IS NULL THEN 1 END) AS unmapped
    FROM cat_trees ct
    JOIN product_our_category_map pom ON pom.our_category_id = ct.id
    JOIN product_variants pv ON pv.product_id = pom.product_id AND pv.deleted_at IS NULL
    GROUP BY ct.root_id
  `;
  const { rows } = await pool.query(sql, [catIds]);
  const stats = {};
  for (const r of rows) {
    const total = parseInt(r.total);
    const mapped = parseInt(r.mapped);
    stats[r.root_id] = {
      total,
      mapped,
      unmapped: parseInt(r.unmapped),
      coverage: total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0,
    };
  }
  return { tree, stats };
}

async function getConversionRows(tableId) {
  const { rows } = await pool.query(
    "SELECT id, system, source_value, target_value FROM size_conversion_rows WHERE table_id = $1 ORDER BY system, source_value::numeric",
    [tableId]
  );
  return rows;
}

async function dryRunNormalization(categoryId, tableId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '60s'");

    const convRows = await getConversionRows(tableId);
    const status = await getCategoryStatus(categoryId);

    const byPattern = await countByPatternMatch(client, categoryId, convRows);
    const byCountry = await countByCountryMatch(client, categoryId, convRows);

    await client.query("ROLLBACK");

    return {
      current: status,
      preview: {
        byPatternMatch: byPattern,
        byCountryMatch: byCountry,
        estimatedNewMapped: byPattern.total + byCountry.total,
      },
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function countByPatternMatch(client, categoryId, convRows) {
  const convValues = buildConvValues(convRows);
  const sql = `
    ${CAT_TREE_CTE},
    conv(sys, num, target) AS (VALUES ${convValues})
    SELECT COUNT(*) AS cnt
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    JOIN product_our_category_map pom ON pom.product_id = p.id
    JOIN cat_tree ct ON ct.id = pom.our_category_id
    WHERE pv.deleted_at IS NULL AND pv.normalized_size_final IS NULL
    AND EXISTS (
      SELECT 1 FROM conv c
      WHERE (
        UPPER(TRIM(pv.variant_size)) ~ ('^' || c.num || '\\s*' || c.sys || '$')
        OR (pv.size_type ILIKE '%' || c.sys || '%' AND TRIM(regexp_replace(pv.variant_size, '[^0-9.]', '', 'g')) = c.num)
      )
    )
  `;
  const { rows } = await client.query(sql, [categoryId]);
  return { total: parseInt(rows[0].cnt) };
}

async function countByCountryMatch(client, categoryId, convRows) {
  const systems = [...new Set(convRows.map((r) => r.system))];
  const countrySystems = Object.entries(COUNTRY_TO_SYSTEM)
    .filter(([, sys]) => systems.includes(sys));

  if (countrySystems.length === 0) return { total: 0 };

  const conditions = countrySystems.map(
    ([country, sys]) => `(LOWER(pv.country_of_origin) = '${country.replace(/'/g, "''")}' AND '${sys}')`
  );

  const sql = `
    ${CAT_TREE_CTE}
    SELECT COUNT(*) AS cnt
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    JOIN product_our_category_map pom ON pom.product_id = p.id
    JOIN cat_tree ct ON ct.id = pom.our_category_id
    WHERE pv.deleted_at IS NULL AND pv.normalized_size_final IS NULL
    AND pv.country_of_origin IS NOT NULL
    AND TRIM(regexp_replace(pv.variant_size, '[^0-9.]', '', 'g')) != ''
  `;
  const { rows } = await client.query(sql, [categoryId]);
  return { total: parseInt(rows[0].cnt) };
}

function buildConvValues(convRows) {
  return convRows
    .map((r) => `('${r.system}','${r.source_value}','${r.target_value}')`)
    .join(",");
}

async function executeNormalization(categoryId, tableId, adminId) {
  const client = await pool.connect();
  const runId = randomUUID();
  const backupName = `_backup_norm_${Date.now()}`;

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '300s'");

    await client.query(
      `INSERT INTO size_normalization_runs (id, category_id, table_id, admin_id, status, backup_table_name)
       VALUES ($1, $2, $3, $4, 'running', $5)`,
      [runId, categoryId, tableId, adminId, backupName]
    );

    const backupSql = `
      CREATE TABLE ${backupName} AS
      ${CAT_TREE_CTE}
      SELECT pv.id, pv.variant_size, pv.normalized_size_final, pv.size_type
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      JOIN product_our_category_map pom ON pom.product_id = p.id
      JOIN cat_tree ct ON ct.id = pom.our_category_id
      WHERE pv.deleted_at IS NULL
    `;
    await client.query(backupSql, [categoryId]);

    const { rows: tableInfo } = await client.query(
      "SELECT target_type FROM size_conversion_tables WHERE id = $1", [tableId]
    );
    const targetType = tableInfo[0]?.target_type || "alpha";

    const convRows = await getConversionRows(tableId);
    const convValues = buildConvValues(convRows);

    const preStatus = await getCategoryStatus(categoryId);

    let r1Count = 0;
    let r2Count = 0;

    if (targetType === "alpha") {
      const unmapSql = `
        ${CAT_TREE_CTE}
        UPDATE product_variants pv SET normalized_size_final = NULL
        FROM products p
        JOIN product_our_category_map pom ON pom.product_id = p.id
        JOIN cat_tree ct ON ct.id = pom.our_category_id
        WHERE pv.product_id = p.id AND pv.deleted_at IS NULL
        AND pv.normalized_size_final IS NOT NULL
        AND UPPER(TRIM(pv.variant_size)) NOT IN (${ALPHA_LIST.map((a) => `'${a}'`).join(",")})
      `;
      await client.query(unmapSql, [categoryId]);
    }

    // Round 1: Map by size_type pattern
    const r1Sql = `
      ${CAT_TREE_CTE},
      conv(sys, num, target) AS (VALUES ${convValues})
      UPDATE product_variants pv SET normalized_size_final = sub.target
      FROM (
        SELECT DISTINCT ON (pv2.id) pv2.id, c.target
        FROM product_variants pv2
        JOIN products p ON p.id = pv2.product_id
        JOIN product_our_category_map pom ON pom.product_id = p.id
        JOIN cat_tree ct ON ct.id = pom.our_category_id
        CROSS JOIN conv c
        WHERE pv2.deleted_at IS NULL AND pv2.normalized_size_final IS NULL
        AND (
          UPPER(TRIM(pv2.variant_size)) ~ ('^' || c.num || '\\s*' || c.sys || '$')
          OR UPPER(TRIM(pv2.variant_size)) ~ ('^' || c.sys || '\\s*' || c.num || '$')
          OR (pv2.size_type IS NOT NULL AND UPPER(pv2.size_type) LIKE '%' || c.sys || '%'
              AND TRIM(regexp_replace(pv2.variant_size, '[^0-9.]', '', 'g')) = c.num)
          OR (TRIM(regexp_replace(UPPER(pv2.variant_size), '[^0-9.]', '', 'g')) = c.num
              AND UPPER(pv2.variant_size) LIKE '%' || c.sys || '%')
        )
      ) sub
      WHERE pv.id = sub.id
    `;
    const r1Res = await client.query(r1Sql, [categoryId]);
    r1Count = r1Res.rowCount;

    // Round 1b: Map embedded alpha formats (pipe, slash)
    const r1bSql = `
      ${CAT_TREE_CTE},
      conv(sys, num, target) AS (VALUES ${convValues})
      UPDATE product_variants pv SET normalized_size_final = sub.target
      FROM (
        SELECT DISTINCT ON (pv2.id) pv2.id, c.target
        FROM product_variants pv2
        JOIN products p ON p.id = pv2.product_id
        JOIN product_our_category_map pom ON pom.product_id = p.id
        JOIN cat_tree ct ON ct.id = pom.our_category_id
        CROSS JOIN conv c
        WHERE pv2.deleted_at IS NULL AND pv2.normalized_size_final IS NULL
        AND TRIM(regexp_replace(pv2.variant_size, '[^0-9.]', '', 'g')) = c.num
        AND c.sys IN ('EU','IT')
      ) sub
      WHERE pv.id = sub.id
    `;
    const r1bRes = await client.query(r1bSql, [categoryId]);
    r1Count += r1bRes.rowCount;

    // Round 2: Map by country of origin
    for (const [country, sys] of Object.entries(COUNTRY_TO_SYSTEM)) {
      const r2Sql = `
        ${CAT_TREE_CTE},
        conv(sys, num, target) AS (VALUES ${convValues})
        UPDATE product_variants pv SET normalized_size_final = sub.target
        FROM (
          SELECT DISTINCT ON (pv2.id) pv2.id, c.target
          FROM product_variants pv2
          JOIN products p ON p.id = pv2.product_id
          JOIN product_our_category_map pom ON pom.product_id = p.id
          JOIN cat_tree ct ON ct.id = pom.our_category_id
          CROSS JOIN conv c
          WHERE pv2.deleted_at IS NULL AND pv2.normalized_size_final IS NULL
          AND LOWER(TRIM(pv2.country_of_origin)) = $2
          AND c.sys = '${sys}'
          AND TRIM(regexp_replace(pv2.variant_size, '[^0-9.]', '', 'g')) = c.num
        ) sub
        WHERE pv.id = sub.id
      `;
      const r2Res = await client.query(r2Sql, [categoryId, country]);
      r2Count += r2Res.rowCount;
    }

    const postStatus = await getCategoryStatus(categoryId);

    const stats = {
      pre: preStatus,
      post: postStatus,
      round1: r1Count,
      round2: r2Count,
      totalNewlyMapped: r1Count + r2Count,
    };

    await client.query(
      `UPDATE size_normalization_runs SET status = 'completed', stats = $1, completed_at = now() WHERE id = $2`,
      [JSON.stringify(stats), runId]
    );

    await client.query("COMMIT");
    return { runId, backupName, stats };
  } catch (err) {
    await client.query("ROLLBACK");
    await pool.query(
      `UPDATE size_normalization_runs SET status = 'failed', stats = $1, completed_at = now() WHERE id = $2`,
      [JSON.stringify({ error: err.message }), runId]
    ).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rollbackRun(runId) {
  const { rows } = await pool.query(
    "SELECT * FROM size_normalization_runs WHERE id = $1", [runId]
  );
  if (!rows.length) throw new Error("Run not found");
  const run = rows[0];
  if (run.status !== "completed") throw new Error("Can only rollback completed runs");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const checkTable = await client.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
      [run.backup_table_name]
    );
    if (!checkTable.rows[0].exists) throw new Error("Backup table not found");

    await client.query(`
      UPDATE product_variants pv
      SET normalized_size_final = b.normalized_size_final,
          size_type = b.size_type
      FROM ${run.backup_table_name} b
      WHERE pv.id = b.id
    `);

    await client.query(
      `UPDATE size_normalization_runs SET status = 'rolled_back', completed_at = now() WHERE id = $1`,
      [runId]
    );

    await client.query("COMMIT");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getHistory(limit = 50) {
  const { rows } = await pool.query(`
    SELECT snr.*, c.name AS category_name
    FROM size_normalization_runs snr
    LEFT JOIN categories c ON c.id = snr.category_id
    ORDER BY snr.created_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

// --- Conversion table CRUD ---

async function listTables() {
  const { rows } = await pool.query(`
    SELECT t.*, COUNT(r.id)::int AS row_count,
      (SELECT COUNT(*)::int FROM category_size_table_map csm WHERE csm.table_id = t.id) AS assigned_count
    FROM size_conversion_tables t
    LEFT JOIN size_conversion_rows r ON r.table_id = t.id
    GROUP BY t.id ORDER BY t.name
  `);
  return rows;
}

async function getTable(id) {
  const { rows: tableRows } = await pool.query("SELECT * FROM size_conversion_tables WHERE id = $1", [id]);
  if (!tableRows.length) return null;
  const convRows = await getConversionRows(id);
  return { ...tableRows[0], rows: convRows };
}

async function createTable(name, description, targetType, rows) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tableId = randomUUID();
    await client.query(
      "INSERT INTO size_conversion_tables (id, name, description, target_type) VALUES ($1, $2, $3, $4)",
      [tableId, name, description, targetType]
    );
    for (const r of rows) {
      await client.query(
        "INSERT INTO size_conversion_rows (table_id, system, source_value, target_value) VALUES ($1, $2, $3, $4)",
        [tableId, r.system, r.source_value, r.target_value]
      );
    }
    await client.query("COMMIT");
    return tableId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateTable(id, name, description, targetType, rows) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE size_conversion_tables SET name = $1, description = $2, target_type = $3, updated_at = now() WHERE id = $4",
      [name, description, targetType, id]
    );
    await client.query("DELETE FROM size_conversion_rows WHERE table_id = $1", [id]);
    for (const r of rows) {
      await client.query(
        "INSERT INTO size_conversion_rows (table_id, system, source_value, target_value) VALUES ($1, $2, $3, $4)",
        [id, r.system, r.source_value, r.target_value]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function deleteTable(id) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM category_size_table_map WHERE table_id = $1", [id]
  );
  if (rows[0].cnt > 0) throw new Error("Cannot delete: table is assigned to categories");
  await pool.query("DELETE FROM size_conversion_tables WHERE id = $1", [id]);
}

// --- Category assignments ---

async function getAssignments() {
  const { rows } = await pool.query(`
    SELECT csm.*, c.name AS category_name, sct.name AS table_name
    FROM category_size_table_map csm
    JOIN categories c ON c.id = csm.category_id
    LEFT JOIN size_conversion_tables sct ON sct.id = csm.table_id
    ORDER BY c.name
  `);
  return rows;
}

async function upsertAssignment(categoryId, tableId, filterType) {
  await pool.query(`
    INSERT INTO category_size_table_map (category_id, table_id, filter_type)
    VALUES ($1, $2, $3)
    ON CONFLICT (category_id) DO UPDATE SET table_id = $2, filter_type = $3, updated_at = now()
  `, [categoryId, tableId, filterType]);
}

/**
 * Normalize variants for a single product after it's mapped to a category.
 * Looks up the conversion table assigned to that category, then applies
 * pattern + country matching on the product's variants.
 */
async function normalizeProductAfterCategoryMap(productId, categoryId, client) {
  const db = client || pool;

  const { rows: assignment } = await db.query(
    `WITH RECURSIVE cat_chain AS (
       SELECT id, parent_id FROM categories WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id FROM categories c JOIN cat_chain cc ON cc.id = c.parent_id
     )
     SELECT csm.table_id, csm.filter_type
     FROM category_size_table_map csm
     JOIN cat_chain cc ON cc.id = csm.category_id
     WHERE csm.table_id IS NOT NULL
     LIMIT 1`,
    [categoryId]
  );

  if (!assignment.length) return { mapped: 0 };

  const tableId = assignment[0].table_id;
  const convRows = await getConversionRows(tableId);
  if (!convRows.length) return { mapped: 0 };

  const convValues = buildConvValues(convRows);

  // Round 1: pattern match (system prefix/suffix in variant_size)
  const r1Sql = `
    WITH conv(sys, num, target) AS (VALUES ${convValues})
    UPDATE product_variants pv SET normalized_size_final = sub.target
    FROM (
      SELECT DISTINCT ON (pv2.id) pv2.id, c.target
      FROM product_variants pv2
      CROSS JOIN conv c
      WHERE pv2.product_id = $1 AND pv2.deleted_at IS NULL
      AND pv2.normalized_size_final IS NULL
      AND (
        UPPER(TRIM(pv2.variant_size)) ~ ('^' || c.num || '\\s*' || c.sys || '$')
        OR UPPER(TRIM(pv2.variant_size)) ~ ('^' || c.sys || '\\s*' || c.num || '$')
        OR (pv2.size_type IS NOT NULL AND UPPER(pv2.size_type) LIKE '%' || c.sys || '%'
            AND TRIM(regexp_replace(pv2.variant_size, '[^0-9.]', '', 'g')) = c.num)
        OR (TRIM(regexp_replace(UPPER(pv2.variant_size), '[^0-9.]', '', 'g')) = c.num
            AND UPPER(pv2.variant_size) LIKE '%' || c.sys || '%')
      )
    ) sub
    WHERE pv.id = sub.id
  `;
  const r1 = await db.query(r1Sql, [productId]);

  // Round 1b: plain numeric match for EU/IT systems
  const r1bSql = `
    WITH conv(sys, num, target) AS (VALUES ${convValues})
    UPDATE product_variants pv SET normalized_size_final = sub.target
    FROM (
      SELECT DISTINCT ON (pv2.id) pv2.id, c.target
      FROM product_variants pv2
      CROSS JOIN conv c
      WHERE pv2.product_id = $1 AND pv2.deleted_at IS NULL
      AND pv2.normalized_size_final IS NULL
      AND TRIM(regexp_replace(pv2.variant_size, '[^0-9.]', '', 'g')) = c.num
      AND c.sys IN ('EU','IT')
    ) sub
    WHERE pv.id = sub.id
  `;
  const r1b = await db.query(r1bSql, [productId]);

  // Round 2: country of origin
  let r2Total = 0;
  for (const [country, sys] of Object.entries(COUNTRY_TO_SYSTEM)) {
    const r2Sql = `
      WITH conv(sys, num, target) AS (VALUES ${convValues})
      UPDATE product_variants pv SET normalized_size_final = sub.target
      FROM (
        SELECT DISTINCT ON (pv2.id) pv2.id, c.target
        FROM product_variants pv2
        CROSS JOIN conv c
        WHERE pv2.product_id = $1 AND pv2.deleted_at IS NULL
        AND pv2.normalized_size_final IS NULL
        AND LOWER(TRIM(pv2.country_of_origin)) = $2
        AND c.sys = '${sys}'
        AND TRIM(regexp_replace(pv2.variant_size, '[^0-9.]', '', 'g')) = c.num
      ) sub
      WHERE pv.id = sub.id
    `;
    const r2 = await db.query(r2Sql, [productId, country]);
    r2Total += r2.rowCount;
  }

  // Set UNI for empty/nosize variants that are still null
  const uniSql = `
    UPDATE product_variants SET normalized_size_final = 'UNI'
    WHERE product_id = $1 AND deleted_at IS NULL
    AND normalized_size_final IS NULL
    AND (variant_size IS NULL OR UPPER(TRIM(variant_size)) IN ('', 'UNI', 'NOSIZE', 'ONE SIZE'))
  `;
  await db.query(uniSql, [productId]);

  return { mapped: r1.rowCount + r1b.rowCount + r2Total };
}

module.exports = {
  getCategoryTree,
  getCategoryStatus,
  getFullStatus,
  dryRunNormalization,
  executeNormalization,
  rollbackRun,
  getHistory,
  listTables,
  getTable,
  createTable,
  updateTable,
  deleteTable,
  getAssignments,
  upsertAssignment,
  normalizeProductAfterCategoryMap,
};
