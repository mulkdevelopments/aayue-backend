// rebuild_categories_from_csv.js
// Usage: node rebuild_categories_from_csv.js ./products.csv

const fs = require("fs");
const csv = require("fast-csv");
const { Pool } = require("pg");
const slugify = require("slugify");
const { v4: uuidv4 } = require("uuid");

const CSV_FILE = process.argv[2] || "./products.csv";
const DB_URL = process.env.DATABASE_URL || "postgres://postgres:password@localhost:5432/Ecommerce";
const pool = new Pool({ connectionString: DB_URL, max: 5 });

function normalizePath(pathStr) {
    if (!pathStr) return null;
    const parts = pathStr.split(/->|\/|>/).map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    return parts.map((seg) => ({
        slug: slugify(seg, { lower: true, strict: true }),
        name: seg.trim(),
    }));
}

(async function main() {
    console.log("Reading CSV for category paths...");
    const paths = new Set();

    await new Promise((resolve, reject) => {
        fs.createReadStream(CSV_FILE)
            .pipe(csv.parse({ headers: true, trim: true }))
            .on("data", (row) => {
                const raw = row["Default Category Tree"];
                const norm = normalizePath(raw);
                if (norm) paths.add(JSON.stringify(norm));
            })
            .on("end", resolve)
            .on("error", reject);
    });

    const parsedPaths = Array.from(paths).map((p) => JSON.parse(p));

    // Build tree
    const rootMap = new Map();
    for (const parts of parsedPaths) {
        let parent = null;
        for (const part of parts) {
            const container = parent ? parent.children : rootMap;
            if (!container) continue;
            if (!container.has(part.slug)) {
                container.set(part.slug, {
                    id: uuidv4(),
                    slug: part.slug,
                    name: part.name,
                    parent,
                    children: new Map(),
                });
            }
            parent = container.get(part.slug);
        }
    }

    // DFS assign lft/rgt
    let counter = 1;
    const nodes = [];
    function dfs(node, parentPath) {
        const lft = counter++;
        const path = parentPath ? `${parentPath}/${node.slug}` : node.slug;
        for (const ch of Array.from(node.children.values())) dfs(ch, path);
        const rgt = counter++;
        nodes.push({
            id: node.id,
            name: node.name,
            slug: node.slug,
            parent_id: node.parent ? node.parent.id : null,
            lft,
            rgt,
            path,
        });
    }
    for (const node of rootMap.values()) dfs(node, null);

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("TRUNCATE TABLE categories RESTART IDENTITY CASCADE");

        const sql = `INSERT INTO categories (id,name,slug,parent_id,lft,rgt,path,is_active,metadata,created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,now())`;
        for (const n of nodes.sort((a, b) => a.lft - b.lft)) {
            await client.query(sql, [
                n.id,
                n.name,
                n.slug,
                n.parent_id,
                n.lft,
                n.rgt,
                n.path,
                JSON.stringify({ created_via_import: true }),
            ]);
        }
        await client.query("COMMIT");
        console.log("Categories rebuilt successfully!");
    } catch (e) {
        await client.query("ROLLBACK");
        console.error("Error rebuilding categories:", e);
    } finally {
        client.release();
        await pool.end();
    }
})();
