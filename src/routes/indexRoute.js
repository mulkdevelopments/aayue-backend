const express = require("express");
const router = express.Router();
const userRoutes = require("./userRoutes");
const adminRoutes = require("./adminRoutes");
const currencyRoutes = require("./currencyRoutes");

router.use("/users", userRoutes);
router.use("/admin", adminRoutes);
router.use("/currency", currencyRoutes);

module.exports = router;