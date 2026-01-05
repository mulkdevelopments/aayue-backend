// app.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const hpp = require('hpp');
const globalErrorHandler = require('./src/errorHandling/errorHandler');
const cookieParser = require('cookie-parser');
const indexRoute = require('./src/routes/indexRoute');
const sendResponse = require('./src/utils/sendResponse');
const path = require('path'); 
require('./src/cron/productImageValidator'); // Start the cron job
require('./src/cron/exchangeRateUpdater'); // Update currency rates every 6 hours



const app = express();

// --- Trust Proxy (important if behind Nginx/Load Balancer) ---
// app.set('trust proxy', 1);
// --- Security Middlewares ---
app.use(helmet()); // Secure HTTP headers

// CORS Configuration - reads from environment variable
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
    : '*';

app.use(cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true, // Allow cookies and authorization headers
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());


// Prevent HTTP parameter pollution
app.use(hpp());

// Compress responses
app.use(compression());

// Logging (different for dev/prod)
if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined')); // detailed logs
} else {
    app.use(morgan('dev')); // colored, concise logs
}

// --- Rate Limiter ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.RATE_LIMIT || 200, // configurable
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        status: 429,
        error: 'Too many requests',
        message: 'Too many requests from this IP, please try again later.',
    },
});

// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// --- Example Route ---
app.get('/api/v1/health', (req, res) => {
    res.status(200).json({ message: 'E-commerce API is running and perfect!' });
});

// --- Main Routes ---
app.use('/api/v1', indexRoute); // ✅ Using indexRoute

// --- 404 Handler ---
app.all('/{*any}', (req, res) => {
    return sendResponse(res, 404, false, `Route ${req.originalUrl} not found`);
});

// --- Global Error Handler (basic) ---
app.use(globalErrorHandler);

module.exports = app;
