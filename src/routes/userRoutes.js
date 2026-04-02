const express = require("express");
const indexCtrl = require("../controllers/indexController");
const { protectUser } = require("../middlewares/authMiddleware");
const router = express.Router();

router.get("/ok", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "user router ok",
  });
});

router.post("/request-access", indexCtrl.accessRequestController.createAccessRequest);
router.post("/register-user", indexCtrl.userAuthController.registerUser);
router.post(
  "/register-guest-user",
  indexCtrl.userAuthController.registerGuestUser
);
router.post("/send-magic-link", indexCtrl.userAuthController.sendMagicLink);
router.post(
  "/login-with-magic-link",
  indexCtrl.userAuthController.loginWithMagicLink
);
router.get(
  "/get-user-profile",
  protectUser,
  indexCtrl.userAuthController.viewProfile
);
router.put(
  "/update-user-profile",
  protectUser,
  indexCtrl.userAuthController.updateProfile
);

/**================== Address Routes ================== */
router.post(
  "/add-address",
  protectUser,
  indexCtrl.userAuthController.addAddress
);
router.get(
  "/get-addresses",
  protectUser,
  indexCtrl.userAuthController.getAddresses
);
router.get(
  "/get-address-by-id",
  protectUser,
  indexCtrl.userAuthController.getAddressById
);
router.put(
  "/update-address",
  protectUser,
  indexCtrl.userAuthController.updateAddress
);
router.put(
  "/delete-address",
  protectUser,
  indexCtrl.userAuthController.deleteAddress
);

/**================== Menu Routes ================== */

router.get(
  "/get-menubar",
  indexCtrl.categoryManagementController.getAllCategories
);
router.get(
  "/get-our-menubar",
  indexCtrl.categoryManagementController.getOurCategories
);
router.get(
  "/get-child-categories",
  indexCtrl.categoryManagementController.getChildOfCategories
);

/**================== Product Routes ================== */

router.get("/get-products", indexCtrl.productManagementController.getProducts);
router.get(
  "/get-products-from-our-categories",
  indexCtrl.productManagementController.getProductsFromOurCategories
);
router.get(
  "/search-auto-suggest",
  indexCtrl.productManagementController.getSearchAutocomplete
);
router.get(
  "/get-product-by-id",
  indexCtrl.productManagementController.getProductById
);

const { checkLiveStock } = require("../controllers/importController/vendorSyncService");
router.get("/check-live-stock", checkLiveStock);
router.get(
  "/get-filters-for-products",
  indexCtrl.productManagementController.getDynamicFilters
);
router.get(
  "/get-all-brands",
  indexCtrl.productManagementController.getAllBrands
);

/**================== Best Seller Routes ================== */

router.get(
  "/get-active-best-sellers",
  indexCtrl.bestSellerController.getBestSellers
);

/**================== Brand Spotlight Routes ================== */
router.get(
  "/get-active-brand-spotlights",
  indexCtrl.userBrandSpotlightController.getSpotlights
);
router.get(
  "/get-products-by-brand",
  indexCtrl.userBrandSpotlightController.getProductsByBrand
);
router.get(
  "/get-brand-groups",
  indexCtrl.userBrandGroupController.getActiveBrandGroups
);
router.get(
  "/get-brand-highlights",
  indexCtrl.userBrandHighlightController.getActiveBrandHighlights
);

/**================== New Arrival Routes ================== */

router.get(
  "/get-active-new-arrivals",
  indexCtrl.userNewArrivalController.getActiveNewArrivals
);

/**================== Home Section Routes ================== */

router.get(
  "/get-home-sections",
  indexCtrl.userSectionController.getActiveSections
);
router.get(
  "/get-hero-slides",
  indexCtrl.userHeroSlideController.getActiveHeroSlides
);

/**================== Sales Routes ================== */

router.get("/get-sales", indexCtrl.userSalesController.getActiveSales);
router.get('/get-sales-by-category', indexCtrl.userSalesController.getSalesByCategory);

/**================== Cart Routes ================== */
router.get("/get-cart", protectUser, indexCtrl.cartController.getCart);
router.post("/add-to-cart", protectUser, indexCtrl.cartController.addToCart);
router.put(
  "/update-cart-item",
  protectUser,
  indexCtrl.cartController.updateCartItem
);
router.put(
  "/remove-cart-item",
  protectUser,
  indexCtrl.cartController.removeCartItem
);
router.post("/sync-cart", protectUser, indexCtrl.cartController.syncGuestCart);
// router.delete('/clear-cart', protectUser, indexCtrl.cartController.clearCart);

/**================== Payment Routes ================== */
router.post(
  "/create-checkout-session",
  protectUser,
  indexCtrl.paymentController.createCheckoutSession
);
router.post("/webhook", indexCtrl.paymentController.stripeWebhookHandler);
router.post(
  "/verify-payment",
  protectUser,
  indexCtrl.paymentController.verifyPayment
);

/**================== Order Routes ================== */

router.get(
  "/get-paid-orders",
  protectUser,
  indexCtrl.userOrderController.getUserPaidOrders
);
router.get(
  "/get-order-by-id",
  protectUser,
  indexCtrl.userOrderController.getUserOrderById
);
router.post(
  "/cancel-order",
  protectUser,
  indexCtrl.userOrderController.cancelOrderByCustomer
);
router.get(
  "/shipment-tracking-timeline",
  protectUser,
  indexCtrl.userOrderController.getShipmentTrackingTimeline
);

router.post("/apply-coupon", indexCtrl.couponController.applyCoupon);
router.get(
  "/download-invoice",
  protectUser,
  indexCtrl.userOrderController.downloadInvoiceHtml
);

/**================== Wishlist Routes ================== */

// router.get(
//   "/get-wishlist",
//   protectUser,
//   indexCtrl.wishlistController.getWishlist
// );
router.post(
  "/add-to-wishlist",
  protectUser,
  indexCtrl.wishlistController.addToWishlist
);

router.get(
  "/get-wishlist",
  protectUser,
  indexCtrl.wishlistController.getWishlist
);

router.delete(
  "/remove-from-wishlist",
  protectUser,
  indexCtrl.wishlistController.removeFromWishlist
);

/**================== Review Routes ================== */

router.post(
  "/add-review",
  protectUser,
  indexCtrl.productReviewController.addReview
);

router.get("/get-reviews", indexCtrl.productReviewController.getReviews);

router.get(
  "/get-similar-product",
  indexCtrl.productManagementController.getSimilarProducts
);

/**================== Google Auth Routes ================== */

// Redirect user to Google consent screen
router.get("/google", indexCtrl.userAuthController.googleAuthRedirect);

// Google callback - Google redirects here with ?code
router.get("/google/callback", indexCtrl.userAuthController.googleAuthCallback);

/**================== Apple Auth Routes ================== */

// Redirect user to Apple consent screen
router.get("/apple", indexCtrl.userAuthController.appleAuthRedirect);

// Apple callback (form_post or query)
router.post("/apple/callback", indexCtrl.userAuthController.appleAuthCallback);
router.get("/apple/callback", indexCtrl.userAuthController.appleAuthCallback);

router.get("/get-home-banners", indexCtrl.bannerController.getHomeBanners);

router.post('/contact-us', indexCtrl.contactUsController.createContactMessage);

/**================= Newsletter Routes ================= */

router.post('/subscribe-newsletter', indexCtrl.newsLetterController.subscribeNewsletter);

/**================= Stock Notify Routes ================= */
router.post("/notify-stock", indexCtrl.stockNotifyController.createStockNotifyRequest);

/**================= Access Request Routes ================= */
router.post("/request-access", indexCtrl.accessRequestController.createAccessRequest);

router.get("/get-overlay-grid", indexCtrl.bannerController.getOverlayGrid);

/**================= Policy Routes ================= */

router.get("/get-policies", indexCtrl.policyController.getPolicy);

/**=================== About Us Routes ================== */

router.get('/get-about-us', indexCtrl.aboutUsController.getAboutUs);

/**=================== Page Content (FAQ, How to Shop) ================== */
router.get('/get-page-content', indexCtrl.pageContentController.getPageContentPublic);

module.exports = router;
