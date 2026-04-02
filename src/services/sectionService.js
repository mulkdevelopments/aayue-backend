// services/sectionService.js
const { randomUUID } = require("crypto");
const SectionService = {
    async listAll(client) {
        const { rows } = await client.query(
            `SELECT id, key, label, active, meta, rank, created_by, created_at, updated_at FROM home_sections WHERE deleted_at IS NULL ORDER BY COALESCE(rank, 999), label`
        );
        return rows;
    },

    async listActive(client) {
        const { rows } = await client.query(
            `SELECT id, key, label, active, meta, rank FROM home_sections WHERE deleted_at IS NULL AND active = true ORDER BY COALESCE(rank, 999)`);
        return rows;
    },


    async getByKey(key, client) {
        const { rows } = await client.query(`SELECT * FROM home_sections WHERE key = $1 AND deleted_at IS NULL LIMIT 1`, [key]);
        return rows[0];
    },

    async upsertByKey({ key, label = null, active = null, meta = null, rank = null, created_by = null }, client) {
        // If exists, update; else insert
        const existing = await this.getByKey(key, client);
        if (existing) {
            const parts = [];
            const vals = [];
            let i = 1;
            if (label !== null) { parts.push(`label = $${i++}`); vals.push(label); }
            if (active !== null) { parts.push(`active = $${i++}`); vals.push(active); }
            if (meta !== null) { parts.push(`meta = $${i++}`); vals.push(JSON.stringify(meta)); }
            if (rank !== null) { parts.push(`rank = $${i++}`); vals.push(rank); }
            if (parts.length === 0) return existing;
            const sql = `UPDATE home_sections SET ${parts.join(', ')}, updated_at = now() WHERE key = $${i} RETURNING id, key, label, active, meta, rank, created_by, created_at, updated_at`;
            vals.push(key);
            const { rows } = await client.query(sql, vals);
            return rows[0];
        } else {
            const id = randomUUID();
            const sql = `INSERT INTO home_sections (id, key, label, active, meta, rank, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING id, key, label, active, meta, rank, created_by, created_at, updated_at`;
            const vals = [id, key, label || key, active === null ? false : active, meta ? JSON.stringify(meta) : JSON.stringify({}), rank, created_by];
            const { rows } = await client.query(sql, vals);
            return rows[0];
        }
    },

    async setActive(key, active, client) {
        const sql = `UPDATE home_sections SET active = $1, updated_at = now() WHERE key = $2 AND deleted_at IS NULL RETURNING id, key, label, active, meta, rank`;
        const { rows } = await client.query(sql, [active, key]);
        return rows[0];
    },

    async bulkSet(keys = [], active = true, client) {
        if (!Array.isArray(keys) || keys.length === 0) return [];
        // Use parameterized list
        const params = keys.map((_, i) => `$${i + 1}`).join(',');
        const sql = `UPDATE home_sections SET active = $${keys.length + 1}, updated_at = now() WHERE key IN (${params}) AND deleted_at IS NULL RETURNING id, key, label, active, meta, rank`;
        const vals = [...keys, active];
        const { rows } = await client.query(sql, vals);
        return rows;
    }
};

module.exports = SectionService;
