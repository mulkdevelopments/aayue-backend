const dbPool = require("../db/dbConnection");
const AppError = require("../errorHandling/AppError");
const { randomUUID } = require("crypto");
const { get } = require("../routes/userRoutes");

const CustomerService = {
  async getAllCustomers(client, { search, page, limit = 20 }) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const offset = (pageNum - 1) * limit;

    let baseQuery = `
    SELECT 
      id, email, phone, full_name, is_active, created_at, updated_at
    FROM users
    WHERE deleted_at IS NULL
  `;

    let countQuery = `
    SELECT COUNT(*) as total
    FROM users
    WHERE deleted_at IS NULL
  `;

    const params = [];
    let paramIndex = 1;

    // SEARCH FILTER
    if (search && search.trim() !== "") {
      const searchTerm = `%${search.trim()}%`;
      const searchCondition = `(full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      baseQuery += ` AND ${searchCondition}`;
      countQuery += ` AND ${searchCondition}`;
      params.push(searchTerm);
      paramIndex++;
    }

    // PAGINATION FOR DATA
    baseQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${
      paramIndex + 1
    }`;
    params.push(limit, offset);

    try {
      // 1. Fetch paginated data
      const dataResult = await client.query(baseQuery, params);

      // 2. Fetch total count (same filters)
      const countParams = params.slice(0, params.length - 2); // Remove limit & offset
      const countResult = await client.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total, 10);

      // 3. Return clean response
      return {
        customers: dataResult.rows,
        pagination: {
          page: pageNum,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: pageNum < Math.ceil(total / limit),
          hasPrev: pageNum > 1,
        },
      };
    } catch (err) {
      throw new AppError(err.message || "Failed to fetch customers", 500);
    }
  },
  async getCustomerById(id, client) {
    try {
      const query = `
            SELECT 
                u.id,
                u.email,
                u.phone,
                u.full_name,
                u.is_active,
                u.created_at,
                u.updated_at,
                COALESCE(
                    json_agg(to_jsonb(a)) FILTER (WHERE a.id IS NOT NULL AND a.deleted_at IS NULL),
                    '[]'
                ) AS addresses
            FROM users AS u
            LEFT JOIN addresses AS a 
                ON u.id = a.user_id
            WHERE u.id = $1 AND u.deleted_at IS NULL
            GROUP BY u.id
        `;
      const { rows } = await client.query(query, [id]);
      return rows[0];
    } catch (err) {
      throw new AppError(err.message || "Failed to fetch customer", 500);
    }
  },
};

module.exports = {
  CustomerService,
};
