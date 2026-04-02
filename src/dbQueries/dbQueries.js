// src/db/queries.js
module.exports = {
  // Users
  findUserByEmail: `SELECT * FROM users WHERE email = $1 LIMIT 1`,
  findUserById: `SELECT * FROM users WHERE id = $1 LIMIT 1`,
  insertUser: `
    INSERT INTO users (full_name, email, phone, provider, google_sub, apple_sub)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
  updateUserProfile: `
    UPDATE users
    SET full_name = $1, phone = $2, dob = $3, gender = $4, updated_at = now()
    WHERE id = $5
    RETURNING *`,
  updateUserMagicToken: `
    UPDATE users
    SET magic_token = $1, magic_token_expires = $2, updated_at = now()
    WHERE id = $3
    RETURNING *`,
  findUserWithAddress: `
    SELECT u.*, a.*
    FROM users u
    LEFT JOIN addresses a ON a.user_id = u.id
    WHERE u.id = $1
  `,
  insertAddress: `
    INSERT INTO addresses (user_id, line1, line2, city, state, zip, country)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
};
