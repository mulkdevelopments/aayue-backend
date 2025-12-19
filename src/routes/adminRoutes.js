const express = require("express");
const router = express.Router();
const indexCtrl = require("../controllers/indexController");
const multer = require("multer");
const { validateProductImages } = require("../cron/productImageValidator");
const {
  fetchAllLuxuryProducts,
} = require("../controllers/importController/luxuryDistibution/luxuryDistributionService");
const { AdminServices } = require("../services/adminService");
const { protectAdmin } = require("../middlewares/authMiddleware");

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get("/ok", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "admin router ok",
  });
});

router.post(
  "/send-admin-magic-link",
  indexCtrl.adminAuthController.sendAdminMagicLink
);
router.post(
  "/admin-login-with-magic-link",
  indexCtrl.adminAuthController.adminLoginWithMagicLink
);
router.use(protectAdmin);

/** ================== Import Products via CSV ================== */
router.post(
  "/import-products",
  upload.single("file"),
  indexCtrl.adminImportController.uploadProducts
);
router.post(
  "/import-bdroppy",
  upload.single("file"),
  indexCtrl.adminImportController.uploadBdroppy
);
router.post(
  "/import-luxury",
  upload.single("file"),
  indexCtrl.adminImportController.uploadLuxuary
);

router.post(
  "/create-category",
  indexCtrl.categoryManagementController.createCategory
);
router.get(
  "/get-categories",
  indexCtrl.categoryManagementController.getAllCategories
);
router.get(
  "/get-our-categories",
  indexCtrl.categoryManagementController.getOurCategories
);
router.put(
  "/update-category",
  indexCtrl.categoryManagementController.editCategory
);
router.put(
  "/delete-category",
  indexCtrl.categoryManagementController.deleteOurCaegory
);

router.post('/update-categroy-image', indexCtrl.categoryManagementController.updateImageInCategory)

/** ================== Product Routes ================== */

router.post(
  "/create-product",
  indexCtrl.productManagementController.createProduct
);
router.get("/get-products", indexCtrl.productManagementController.getProducts);
router.get(
  "/get-product-by-id",
  indexCtrl.productManagementController.getProductByIdAdmin
);
router.post(
  "/manage-op-newest-products",
  indexCtrl.productManagementController.toggleProductFlag
);

router.patch(
  "/update-product-price",
  indexCtrl.productManagementController.updateProductPrice
);
router.put(
  "/disable-product",
  indexCtrl.productManagementController.toggleProductStatus
);

router.patch(
  "/update-product-price-by-vendor-id",
  indexCtrl.productManagementController.updateProductPriceByVendorId
);
/**================= Best Seller Routes ================ */

router.post(
  "/add-best-seller",
  indexCtrl.bestSellerController.createBestSeller
);
router.get(
  "/list-best-sellers",
  indexCtrl.bestSellerController.listBestSellersAdmin
);
router.put(
  "/update-best-seller",
  indexCtrl.bestSellerController.updateBestSeller
);
router.put(
  "/remove-best-seller",
  indexCtrl.bestSellerController.deleteBestSeller
);

/**================= Brand Spotlight Routes ================ */

router.post(
  "/add-brand-spotlight",
  indexCtrl.brandSpotlightController.createSpotlight
);
router.get(
  "/list-brand-spotlights",
  indexCtrl.brandSpotlightController.listSpotlightsAdmin
);
// router.put('/update-brand-spotlight/:id', indexCtrl.brandSpotlightController.updateSpotlight);
// router.delete('/remove-brand-spotlight/:id', indexCtrl.brandSpotlightController.deleteSpotlight);

/**================= New Arrival Routes ================ */
router.post(
  "/add-new-arrival",
  indexCtrl.adminNewArrivalController.createNewArrival
);
router.get("/list-new-arrivals", indexCtrl.adminNewArrivalController.listAdmin);
router.put("/update-new-arrival", indexCtrl.adminNewArrivalController.update);
router.put("/remove-new-arrival", indexCtrl.adminNewArrivalController.delete);

/**================= Uploads ROutes================== */

router.post(
  "/upload-images",
  upload.array("images"),
  indexCtrl.uploadController.uploadProductImages
);
router.post(
  "/upload-hero-images",
  upload.array("images"),
  indexCtrl.uploadController.uploadHeroImages
);
router.post(
  "/upload-banners",
  upload.array("banners"),
  indexCtrl.uploadController.uploadBanners
);

/**================= Home Section Routes================== */

router.get("/sections-list", indexCtrl.adminSectionController.list);
router.get("/section-by-key", indexCtrl.adminSectionController.getSectionByKey);
router.put(
  "/update-section",
  indexCtrl.adminSectionController.updateHomeSection
);

/**================= Sales Routes================== */

router.post("/create-sale", indexCtrl.adminSalesController.createSale);
router.get("/list-sales", indexCtrl.adminSalesController.salesListAdmin);
router.put("/update-sale", indexCtrl.adminSalesController.updateSale);
router.put("/remove-sale", indexCtrl.adminSalesController.deleteSale);

/**================= List Orders================== */

router.get("/orders", indexCtrl.orderAdminController.listOrders);
router.get(
  "/orders-dashboard",
  indexCtrl.orderAdminController.listOrdersDashboard
);
router.get(
  "/order-details-by-id",
  indexCtrl.orderAdminController.getOrderDetails
);
router.put(
  "/update-order-status",
  indexCtrl.orderAdminController.updateOrderStatus
);

/**================= Mapping category Apis================== */

router.post(
  "/map-vendor-category",
  indexCtrl.categoryManagementController.mapVendorCategory
);
router.post(
  "/unmap-vendor-category",
  indexCtrl.categoryManagementController.unmapVendorCategory
);
router.get(
  "/get-category-for-mappings",
  indexCtrl.categoryManagementController.getCategoriesForMapping
);
router.get(
  "/get-mapped-categories",
  indexCtrl.categoryManagementController.getMappedCategories
);

/**=================Validate Image===================== */

router.post("/validate-product-images", validateProductImages);

/** ==================vendor Routes ================== */

router.get("/get-vendor-list", indexCtrl.vendorController.getVendors);
router.patch(
  "/update-vendor-status",
  indexCtrl.vendorController.updateVendorStatus
);

router.get("/get-vendor-by-id", indexCtrl.vendorController.getVendorById);

/**================= customer routers================ */

router.get("/get-all-customers", indexCtrl.customerController.getCustomers);
router.get("/get-customer-by-id", indexCtrl.customerController.getCustomerById);

/**==================Dashboard routes================ */

router.get("/get-dashboard-data", indexCtrl.dashboardController.getDashboard);

/** =================Luxury Product Routes==================== */
router.post("/get-products-from-luxury", fetchAllLuxuryProducts);

/** ============================coupon routes======================== */

router.post("/create-coupon", indexCtrl.couponController.createCoupon);
router.get("/get-all-coupons", indexCtrl.couponController.getAllCoupons);
router.patch(
  "/update-coupon-status",
  indexCtrl.couponController.activeDeactiveCoupon
);

router.delete("/delete-coupon", indexCtrl.couponController.deleteCoupon);

router.put(
  "/cancel-order-by-admin",
  indexCtrl.orderAdminController.cancelOrder
);
router.put(
  "/process-refund",
  indexCtrl.orderAdminController.updatePaymentStatusAfterCancel
);

/**================= Map Product Routes================ */

router.post(
  "/map-product-directly-to-category",
  indexCtrl.productManagementController.mapProductToOurCategory
);

router.get(
  "/get-mapped-products",
  indexCtrl.productManagementController.getMappedProducts
);

router.delete(
  "/unmap-product-from-category",
  indexCtrl.productManagementController.unmapProduct
);

router.get(
  "/get-all-brands",
  indexCtrl.productManagementController.getAllBrands
);

/** Banner Management Controllers */
router.post(
  "/create-home-banner",
  indexCtrl.bannerController.upsertHomeBanners
);

router.post("/create-policies", indexCtrl.policyController.upsertPolicy);

router.get("/get-home-banners", indexCtrl.bannerController.getHomeBanners);

router.get("/get-policies", indexCtrl.policyController.getPolicy);


/**=================Contact us================= */
router.get("/get-contact-messages", indexCtrl.contactUsController.getAllContactMessages);
router.get("/get-contact-message", indexCtrl.contactUsController.getContactMessage);
router.delete("/delete-contact-message", indexCtrl.contactUsController.deleteContactMessage);

/**================= Newsletter Routes ================= */
router.get("/get-newsletter-subscribers", indexCtrl.newsLetterController.getAllNewsletterSubscribers);
router.delete("/delete-newsletter-subscriber", indexCtrl.newsLetterController.deleteNewsletterSubscriber);

router.post(
  "/create-overlay-grid",
  indexCtrl.bannerController.upsertOverlayGrid
);

router.get("/get-overlay-grid", indexCtrl.bannerController.getOverlayGrid);

/**================== Sale By Caategory Routes================ */

router.post('/create-sale-by-category', indexCtrl.adminSalesController.createSaleByCategory);
router.put('/update-sale-by-category', indexCtrl.adminSalesController.updateSaleByCategory);
router.delete('/delete-sale-by-category', indexCtrl.adminSalesController.deleteSaleByCategory);
router.get('/list-sale-by-categories', indexCtrl.adminSalesController.listSaleByCategoriesAdmin);

/**=================== About Us Routes ================  */

router.post('/save-about-us', indexCtrl.aboutUsController.saveAboutUs);
router.get('/get-about-us', indexCtrl.aboutUsController.getAboutUs);



module.exports = router;
