#!/usr/bin/env node
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

// Environment Validation
const REQUIRED_ENV = ['SESSION_SECRET'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0 && process.env.NODE_ENV === 'production') {
    logger.error('CRITICAL: Missing required environment variables: %s', missingEnv.join(', '));
    process.exit(1);
}

// In-memory log store (max 50)
let emailLogs = [];
const MAX_LOGS = 50;

// Rate Limiters
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
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
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
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
        logger.info('Configuration saved.');
    } catch (e) {
        logger.error('Failed to save config: %e', e);
    }
};

// Middleware: Setup required
const checkSetup = (req, res, next) => {
    const config = getConfig();
    if (!config && req.path !== '/setup' && !req.path.startsWith('/api') && !req.path.startsWith('/public')) {
        return res.redirect('/setup');
    }
    next();
};

// Middleware: Auth required
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

app.get('/api/info', (req, res) => {
    res.json({
        name: 'Scalar Relay',
        version: '1.2.0',
        engine: 'Node.js ' + process.version,
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.get('/setup', (req, res) => {
    const config = getConfig();
    if (config) return res.redirect('/');
    res.render('setup');
});

app.post('/setup', async (req, res) => {
    const { smtpHost, smtpPort, smtpUser, smtpPass, primaryEmail, dashboardPassword } = req.body;

    // Hash password
    const hashedPassword = await bcrypt.hash(dashboardPassword, 12);
    const masterApiKey = `sk_${crypto.randomUUID().replace(/-/g, '')}`;

    const config = {
        smtp: { host: smtpHost, port: smtpPort, user: smtpUser, pass: smtpPass },
        primaryEmail,
        dashboardPassword: hashedPassword,
        keys: [
            { id: 'master', key: masterApiKey, label: 'Master Key', created: new Date().toISOString() }
        ],
        setupAt: new Date().toISOString()
    };

    saveConfig(config);
    req.session.authenticated = true;
    logger.info('Setup completed for %s', primaryEmail);
    res.redirect('/');
});

app.get('/login', checkSetup, (req, res) => {
    if (req.session.authenticated) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', loginLimiter, checkSetup, async (req, res) => {
    const { password } = req.body;
    const config = getConfig();

    if (config && await bcrypt.compare(password, config.dashboardPassword)) {
        req.session.authenticated = true;
        logger.info('Dashboard Login Success');
        return res.redirect('/');
    }
    logger.warn('Dashboard Login Failure');
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

app.get('/api/logs', apiLimiter, (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!config) return res.status(500).json({ error: 'Not configured' });

    const isMaster = config.keys.find(k => k.id === 'master' && k.key === apiKey);
    if (!isMaster) return res.status(401).json({ error: 'Master Key Required' });

    res.json(emailLogs);
});

app.post('/api/keys', apiLimiter, (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const { label } = req.body;

    if (!config || !label) return res.status(400).json({ error: 'Config/Label missing' });

    const isMaster = config.keys.find(k => k.id === 'master' && k.key === apiKey);
    if (!isMaster) return res.status(401).json({ error: 'Master Key Required' });

    const newKey = {
        id: crypto.randomUUID(),
        key: `sk_${crypto.randomUUID().replace(/-/g, '')}`,
        label,
        created: new Date().toISOString()
    };

    config.keys.push(newKey);
    saveConfig(config);
    res.status(201).json(newKey);
});

app.post('/api/send', apiLimiter, async (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!config) return res.status(500).json({ error: 'Not configured' });

    const validKey = config.keys.find(k => k.key === apiKey);
    if (!validKey) return res.status(401).json({ error: 'Invalid API Key' });

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
            to, subject, text, html
        });

        const logEntry = {
            id: crypto.randomUUID(),
            to, subject,
            status: 'Sent',
            timestamp: new Date().toLocaleTimeString(),
            tenant: validKey.label
        };

        emailLogs.unshift(logEntry);
        if (emailLogs.length > MAX_LOGS) emailLogs.pop();

        res.json({ success: true, messageId: info.messageId });
    } catch (error) {
        logger.error('Relay Error: %e', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use((err, req, res, next) => {
    logger.error('Critical Error: %e', err);
    res.status(500).json({ error: 'Internal Error' });
});

if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Scalar Relay v1.2.0 online at ${PORT}`);
    });
}

module.exports = app;
