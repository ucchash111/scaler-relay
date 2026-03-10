#!/usr/bin/env node
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL; // Future use
const CONFIG_PATH = path.join(__dirname, '../config/config.json');

// In-memory log store (max 50)
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
    secret: process.env.SESSION_SECRET || 'scalar-relay-secret-legacy',
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
            return null;
        }
    }
    return null;
};

const saveConfig = (config) => {
    if (!fs.existsSync(path.dirname(CONFIG_PATH))) {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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

app.get('/setup', (req, res) => {
    const config = getConfig();
    if (config) return res.redirect('/');
    res.render('setup');
});

app.post('/setup', (req, res) => {
    const { smtpHost, smtpPort, smtpUser, smtpPass, primaryEmail, dashboardPassword } = req.body;
    const masterApiKey = `sk_${uuidv4().replace(/-/g, '')}`;

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
        return res.redirect('/');
    }
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

app.post('/api/send', apiLimiter, async (req, res) => {
    const config = getConfig();
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!config) return res.status(500).json({ error: 'System not configured' });

    const validKey = config.keys.find(k => k.key === apiKey);
    if (!validKey) {
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
            id: uuidv4(),
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

        res.json({ success: true, messageId: info.messageId, gateway: !!smtpOverride });
    } catch (error) {
        console.error('Relay Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Scalar Relay Bridge live at http://localhost:${PORT}`);
});
