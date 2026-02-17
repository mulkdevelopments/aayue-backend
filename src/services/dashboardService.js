const {
  getDashboard,
} = require("../controllers/adminController/dashboardController");
const dbPool = require("../db/dbConnection");
const AppError = require("../errorHandling/AppError");
const { randomUUID } = require("crypto");
const DashboardService = {
  async getDashboardData(client) {
    try {
      let totalCustomers = await client.query(
        "SELECT COUNT(*) FROM users WHERE deleted_at IS NULL"
      );
      let totalOrders = await client.query(
        "SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL"
      );
      let totalRevenue = await client.query(
        "SELECT SUM(total_amount) FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid'"
      );
      let totalVendors = await client.query(
        "SELECT COUNT(*) FROM vendors WHERE  deleted_at IS NULL AND status = 'active'"
      );
      let totalUnpaidAmount = await client.query(
        "SELECT SUM(total_amount) FROM orders WHERE deleted_at IS NULL AND payment_status = 'pending'"
      );
      let recentOrders = await client.query(
        "SELECT * FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' ORDER BY created_at DESC LIMIT 10"
      );

      console.log(totalUnpaidAmount.rows, "recentOrders");

      return {
        totalCustomers: totalCustomers.rows[0].count,
        totalOrders: totalOrders.rows[0].count,
        totalRevenue: totalRevenue.rows[0].sum,
        totalVendors: totalVendors.rows[0].count,
        totalUnpaidAmount: totalUnpaidAmount.rows[0].sum,
        recentOrders: recentOrders.rows,
      };
    } catch (err) {
      throw new AppError(err.message || "Failed to fetch dashboard data", 500);
    }
  },
};

module.exports = {
  DashboardService,
};
