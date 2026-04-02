// src/controllers/cartController.js
const catchAsync = require('../../errorHandling/catchAsync');
const dbPool = require('../../db/dbConnection');
const AppError = require('../../errorHandling/AppError');
const sendResponse = require('../../utils/sendResponse');
const { isValidUUID } = require('../../utils/basicValidation');
const CartService = require('../../services/cartService');

module.exports.getCart = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const user_id = req.user?.id;
        if (!user_id) return next(new AppError('Unauthorized', 401));
        const cart = await CartService.getCart({ user_id }, client);
        return sendResponse(res, 200, true, 'Cart fetched', cart);
    } catch (err) {
        return next(new AppError(err.message || 'Failed to fetch cart', 500));
    } finally {
        client.release();
    }
});

module.exports.addToCart = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const user_id = req.user?.id;
        if (!user_id) return next(new AppError('Unauthorized', 401));

        const { variant_id, qty = 1 } = req.body;
        if (!variant_id || !isValidUUID(variant_id)) return next(new AppError('Invalid variant_id', 400));
        if (isNaN(Number(qty)) || Number(qty) <= 0) return next(new AppError('qty must be > 0', 400));

        await client.query('BEGIN');
        const cart = await CartService.addItem({ user_id, variant_id, qty }, client);
        await client.query('COMMIT');

        return sendResponse(res, 200, true, 'Added to cart', cart);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to add to cart', 500));
    } finally {
        client.release();
    }
});

module.exports.updateCartItem = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const user_id = req.user?.id;
        if (!user_id) return next(new AppError('Unauthorized', 401));
        const { item_id } = req.body;
        const { qty } = req.body;
        if (!item_id || !isValidUUID(item_id)) return next(new AppError('Invalid item_id', 400));
        if (isNaN(Number(qty)) || Number(qty) < 0) return next(new AppError('qty must be integer >= 0', 400));

        await client.query('BEGIN');
        const cart = await CartService.updateItem({ user_id, item_id, qty }, client);
        await client.query('COMMIT');

        return sendResponse(res, 200, true, 'Cart updated', cart);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to update cart item', 500));
    } finally {
        client.release();
    }
});

module.exports.removeCartItem = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const user_id = req.user?.id;
        if (!user_id) return next(new AppError('Unauthorized', 401));
        const { item_id } = req.body;
        if (!item_id || !isValidUUID(item_id)) return next(new AppError('Invalid item_id', 400));

        await client.query('BEGIN');
        const cart = await CartService.removeItem({ user_id, item_id }, client);
        await client.query('COMMIT');

        return sendResponse(res, 200, true, 'Item removed', cart);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to remove cart item', 500));
    } finally {
        client.release();
    }
});

module.exports.clearCart = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const user_id = req.user?.id;
        if (!user_id) return next(new AppError('Unauthorized', 401));

        await client.query('BEGIN');
        await CartService.clearCart({ user_id }, client);
        await client.query('COMMIT');

        return sendResponse(res, 200, true, 'Cart cleared', {});
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        return next(new AppError(err.message || 'Failed to clear cart', 500));
    } finally {
        client.release();
    }
});

module.exports.syncGuestCart = catchAsync(async (req, res, next) => {
    const client = await dbPool.connect();
    try {
        const user_id = req.user?.id;
        if (!user_id) return next(new AppError("Unauthorized", 401));

        const { items } = req.body; // guest cart items array
        if (!Array.isArray(items) || items.length === 0)
            return sendResponse(res, 200, true, "No guest items to sync", await CartService.getCart({ user_id }, client));

        await client.query("BEGIN");

        const syncedCart = await CartService.syncGuestCart({ user_id, items }, client);

        await client.query("COMMIT");
        return sendResponse(res, 200, true, "Cart synced successfully", syncedCart);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        return next(new AppError(err.message || "Failed to sync guest cart", 500));
    } finally {
        client.release();
    }
});

