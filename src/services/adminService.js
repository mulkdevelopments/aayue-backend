
const dbPool = require("../db/dbConnection");
const queries = require("../dbQueries/dbQueries");

module.exports.AdminServices = {
    findUserByEmail: async (email, client = dbPool) => {
        const { rows } = await client.query(queries.findUserByEmail, [email]);
        return rows[0];
    },

    findAdminById: async (id, client = dbPool) => {
        const { rows } = await client.query(
            `SELECT * FROM admins WHERE id = $1 AND deleted_at IS NULL`,
            [id]
        );
        return rows[0];
    },
};
