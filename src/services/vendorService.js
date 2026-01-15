const dbPool = require("../db/dbConnection");
const AppError = require("../errorHandling/AppError");
const { v4: uuidv4 } = require("uuid");

const VendorService = {
  async getAllVendors(client, { status, page, search }) {
    let sql = "SELECT * FROM vendors WHERE 1=1"; // Base query
    const values = [];
    let paramIndex = 1;

    // 1. STATUS FILTER
    if (status && status !== "all") {
      sql += ` AND status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    // 2. SEARCH FILTER
    if (search) {
      sql += ` AND name ILIKE $${paramIndex}`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count before pagination
    const countSql = sql.replace("SELECT *", "SELECT COUNT(*)");
    const countResult = await client.query(countSql, values.slice(0, paramIndex - 1));
    const totalCount = parseInt(countResult.rows[0].count);

    // 3. PAGINATION
    const limit = 20;
    const pageNum = page ? Math.max(1, parseInt(page)) : 1;
    const offset = (pageNum - 1) * limit;

    sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);

    try {
      const result = await client.query(sql, values);
      return {
        vendors: result.rows,
        pagination: {
          page: pageNum,
          limit,
          total: totalCount,
        },
      };
    } catch (err) {
      throw new AppError(err.message || "Failed to get vendors", 500);
    }
  },
  async getVendorById(id, client) {
    try {
      const vendor = await client.query("SELECT * FROM vendors WHERE id = $1", [
        id,
      ]);
      return vendor.rows[0];
    } catch (err) {
      throw new AppError(err.message || "Failed to get vendor", 500);
    }
  },
};

module.exports = { VendorService };
