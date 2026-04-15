const userAuthController = require("./userController/userAuthController");
const categoryManagementController = require("./adminController/categoryController");
const productManagementController = require("./adminController/productController");
const bestSellerController = require("./adminController/bestSellerController");
const brandSpotlightController = require("./adminController/brandSpotlightController");
const userBrandSpotlightController = require("./userController/brandSpotlightController");
const brandGroupController = require("./adminController/brandGroupController");
const userBrandGroupController = require("./userController/brandGroupController");
const brandHighlightController = require("./adminController/brandHighlightController");
const userBrandHighlightController = require("./userController/brandHighlightController");
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
const stockNotifyController = require("./stockNotifyController/stockNotifyController");
const aboutUsController = require("./adminController/aboutUsController");
const pageContentController = require("./adminController/pageContentController");
const aiSuggestionController = require("./adminController/aiSuggestionController");
const autoMapController = require("./adminController/autoMapController");
const remapCategoryController = require("./adminController/remapCategoryController");
const descriptionRewriteController = require("./adminController/descriptionRewriteController");
const productNameRewriteController = require("./adminController/productNameRewriteController");
const agentsController = require("./adminController/agentsController");
const accessRequestController = require("./accessRequestController");
const heroSlideController = require("./adminController/heroSlideController");
const userHeroSlideController = require("./userController/heroSlideController");
const adminManagementController = require("./adminController/adminManagementController");
const sizeNormalizationController = require("./adminController/sizeNormalizationController");

const indexCtrl = {
  userAuthController,
  categoryManagementController,
  productManagementController,
  bestSellerController,
  brandSpotlightController,
  userBrandSpotlightController,
  brandGroupController,
  userBrandGroupController,
  brandHighlightController,
  userBrandHighlightController,
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
  stockNotifyController,
  aboutUsController,
  pageContentController,
  aiSuggestionController,
  autoMapController,
  remapCategoryController,
  descriptionRewriteController,
  productNameRewriteController,
  agentsController,
  accessRequestController,
  heroSlideController,
  userHeroSlideController,
  adminManagementController,
  sizeNormalizationController,
};

module.exports = indexCtrl;
