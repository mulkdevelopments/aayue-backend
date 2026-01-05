const express = require('express');
const { getExchangeRates } = require('../controllers/currencyController/currencyController');
const router = express.Router();


/**
 * @route   GET /api/v1/currency/rates
 * @desc    Get all exchange rates
 * @access  Public
 * @example GET /api/v1/currency/rates
 */ 
router.get('/rates', getExchangeRates);
 
module.exports = router;
