const userAuthController = require("./userController/userAuthController");
const categoryManagementController = require("./adminController/categoryController");
const productManagementController = require("./adminController/productController");
const bestSellerController = require("./adminController/bestSellerController");
const brandSpotlightController = require("./adminController/brandSpotlightController");
const userBrandSpotlightController = require("./userController/brandSpotlightController");
const adminNewArrivalController = require("./adminController/newArrivalController");
const userNewArrivalController = require("./userController/newArrivalController");
const uploadController = require("./uploadController");
const adminSectionController = require("./adminController/sectionController");
const userSectionController = require("./userController/sectionController");
const adminSalesController = require("./adminController/saleController");
const userSalesController = require("./userController/saleController");
const cartController = require("./userController/cartController");
const paymentController = require("./userController/paymentController");
const userOrderController = require("./userController/orderController");
const orderAdminController = require("./adminController/orderAdminController");
const adminAuthController = require("./adminController/adminAuthController");
const adminImportController = require("./adminController/adminImportController");
const vendorController = require("./adminController/vendorController");
const customerController = require("./adminController/customerController");
const dashboardController = require("./adminController/dashboardController");
const couponController = require("./adminController/couponController");
const wishlistController = require("./userController/wishlistController");
const productReviewController = require("./userController/productReviewController");
const bannerController = require("./adminController/bannerManagementCtrl");
const policyController = require("./adminController/policyController");
const contactUsController = require("./contactUsController/contactUs");
const newsLetterController = require("./newsLetterController/newsletterController");
const aboutUsController = require("./adminController/aboutUsController");
const aiSuggestionController = require("./adminController/aiSuggestionController");

const indexCtrl = {
  userAuthController,
  categoryManagementController,
  productManagementController,
  bestSellerController,
  brandSpotlightController,
  userBrandSpotlightController,
  adminNewArrivalController,
  userNewArrivalController,
  uploadController,
  adminSectionController,
  userSectionController,
  adminSalesController,
  userSalesController,
  cartController,
  paymentController,
  userOrderController,
  orderAdminController,
  adminAuthController,
  adminImportController,
  vendorController,
  customerController,
  dashboardController,
  couponController,
  wishlistController,
  productReviewController,
  bannerController,
  policyController,
  contactUsController,
  newsLetterController,
  aboutUsController,
  aiSuggestionController
};

module.exports = indexCtrl;
