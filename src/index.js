#!/usr/bin/env node
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

// Environment Validation
const REQUIRED_ENV = ['SESSION_SECRET'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0 && process.env.NODE_ENV === 'production') {
    logger.error('CRITICAL: Missing required environment variables: %s', missingEnv.join(', '));
    process.exit(1);
}

// In-memory log store (max 50) for dashboard
let emailLogs = [];
const MAX_LOGS = 50;

// Rate Limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(compression());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'scalar-relay-secret-dev',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const getConfig = () => {
    if (fs.existsSync(CONFIG_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
            logger.error('Failed to parse config.json: %e', e);
            return null;
        }
    }
    return null;
};

const saveConfig = (config) => {
    try {
        if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
            fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        }
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        logger.info('Configuration saved successfully.');
    } catch (e) {
        logger.error('Failed to save configuration: %e', e);
    }
};

// Middleware: Check if setup is complete
const checkSetup = (req, res, next) => {
    const config = getConfig();
    if (!config && req.path !== '/setup' && !req.path.startsWith('/api')) {
        return res.redirect('/setup');
    }
    next();
};

// Middleware: Authenticate UI access
const requireAuth = (req, res, next) => {
    const config = getConfig();
    if (config && !req.session.authenticated) {
        return res.redirect('/login');
    }
    next();
};

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

/**
 * @api {get} /api/info Fetch system information
 */
app.get('/api/info', (req, res) => {
    res.json({
        name: 'Scalar Relay',
        version: '1.1.0',
        engine: 'Node.js ' + process.version,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

/**
 * @api {get} /api/config Fetch public configuration
 * @header {String} x-api-key Master API Key
 */
app.get('/api/config', apiLimiter, (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!config) return res.status(500).json({ error: 'System not configured' });

    const isMaster = config.keys.find(k => k.id === 'master' && k.key === apiKey);
    if (!isMaster) return res.status(401).json({ error: 'Unauthorized: Master Key required' });

    // Exclude password and SMTP credentials for security
    const { dashboardPassword, smtp, ...safeConfig } = config;
    res.json({
        ...safeConfig,
        smtpHost: smtp.host,
        smtpPort: smtp.port
    });
});

app.get('/setup', (req, res) => {
    const config = getConfig();
    if (config) return res.redirect('/');
    res.render('setup');
});

app.post('/setup', (req, res) => {
    const { smtpHost, smtpPort, smtpUser, smtpPass, primaryEmail, dashboardPassword } = req.body;
    const masterApiKey = `sk_${crypto.randomUUID().replace(/-/g, '')}`;

    const config = {
        smtp: { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass },
        primaryEmail,
        dashboardPassword,
        keys: [
            { id: 'master', key: masterApiKey, label: 'Master Key', created: new Date().toISOString() }
        ],
        setupAt: new Date().toISOString()
    };

    saveConfig(config);
    req.session.authenticated = true;
    logger.info('System setup completed by %s', primaryEmail);
    res.redirect('/');
});

app.get('/login', checkSetup, (req, res) => {
    if (req.session.authenticated) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', checkSetup, (req, res) => {
    const { password } = req.body;
    const config = getConfig();

    if (config && password === config.dashboardPassword) {
        req.session.authenticated = true;
        logger.info('Successful dashboard login.');
        return res.redirect('/');
    }
    logger.warn('Failed dashboard login attempt.');
    res.render('login', { error: 'Invalid dashboard password' });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/', checkSetup, requireAuth, (req, res) => {
    const config = getConfig();
    res.render('dashboard', {
        logs: emailLogs,
        apiKey: config.keys[0].key,
        primaryEmail: config.primaryEmail
    });
});

/**
 * @api {get} /api/logs Fetch recent relay logs
 * @header {String} x-api-key Master API Key
 */
app.get('/api/logs', apiLimiter, (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!config) return res.status(500).json({ error: 'System not configured' });

    // Only master key can access logs
    const isMaster = config.keys.find(k => k.id === 'master' && k.key === apiKey);
    if (!isMaster) return res.status(401).json({ error: 'Unauthorized: Master Key required' });

    res.json(emailLogs);
});

/**
 * @api {post} /api/keys Generate a new tenant API key
 * @header {String} x-api-key Master API Key
 * @body {String} label Label for the new key
 */
app.post('/api/keys', apiLimiter, (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const { label } = req.body;

    if (!config) return res.status(500).json({ error: 'System not configured' });
    if (!label) return res.status(400).json({ error: 'Label is required' });

    const isMaster = config.keys.find(k => k.id === 'master' && k.key === apiKey);
    if (!isMaster) return res.status(401).json({ error: 'Unauthorized: Master Key required' });

    const newKey = {
        id: crypto.randomUUID(),
        key: `sk_${crypto.randomUUID().replace(/-/g, '')}`,
        label,
        created: new Date().toISOString()
    };

    config.keys.push(newKey);
    saveConfig(config);

    logger.info('New API Key generated: %s', label);
    res.status(201).json(newKey);
});

app.post('/api/send', apiLimiter, async (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!config) return res.status(500).json({ error: 'System not configured' });

    const validKey = config.keys.find(k => k.key === apiKey);
    if (!validKey) {
        logger.warn('Unauthorized API access attempt with key: %s', apiKey);
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }

    const { to, subject, text, html, fromOverride, smtpOverride } = req.body;

    const smtpConfig = (smtpOverride && smtpOverride.host) ? {
        host: smtpOverride.host,
        port: smtpOverride.port || 465,
        auth: { user: smtpOverride.user, pass: smtpOverride.pass }
    } : {
        host: config.smtp.host,
        port: config.smtp.port,
        auth: { user: config.smtp.user, pass: config.smtp.pass }
    };

    const transporter = nodemailer.createTransport({
        ...smtpConfig,
        secure: smtpConfig.port == 465
    });

    try {
        const info = await transporter.sendMail({
            from: fromOverride || smtpConfig.auth.user,
            to,
            subject,
            text,
            html
        });

        const logEntry = {
            id: crypto.randomUUID(),
            to,
            subject,
            status: 'Sent',
            timestamp: new Date().toLocaleTimeString(),
            messageId: info.messageId,
            gateway: !!smtpOverride,
            tenant: validKey.label
        };

        emailLogs.unshift(logEntry);
        if (emailLogs.length > MAX_LOGS) emailLogs.pop();

        logger.info('Email sent successfully to %s via %s', to, validKey.label);
        res.json({ success: true, messageId: info.messageId, gateway: !!smtpOverride });
    } catch (error) {
        logger.error('Relay Error sending to %s: %e', to, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Robust Error Handling Middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled Exception: %e', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Scalar Relay Bridge live at http://localhost:${PORT}`);
    });
}

module.exports = app; // For testing
