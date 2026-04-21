// server-correct-credentials.js - Con las credenciales correctas del API
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Railway corre detrás de proxy; esto evita errores de express-rate-limit con X-Forwarded-For.
app.set('trust proxy', 1);

// Despues de crear la app
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://dev.same.com.co", "https://badelco-soat-api-production.up.railway.app"]
        }
    }
}));
// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP
    message: 'Demasiadas solicitudes, intenta más tarde',
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

// Rate limiting específico para cotización
const cotizacionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10, // máximo 10 cotizaciones por minuto
    message: 'Límite de cotizaciones excedido, espera un minuto'
});

app.use('/api/cotizar', cotizacionLimiter);

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: 'Demasiados intentos de inicio de sesión, intenta más tarde',
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/auth/login', authLimiter);

// Middleware para logs de seguridad
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

const defaultAllowedOrigins = [
    'https://badelco-soat-api-production.up.railway.app',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://localhost:5501'
];
const envAllowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...envAllowedOrigins])];

app.use(cors({
    origin: (origin, callback) => {
        // Permite herramientas locales y llamadas server-to-server sin cabecera Origin.
        if (!origin) {
            return callback(null, true);
        }

        const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
        if (isLocalhostOrigin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Origen no permitido por CORS'));
    },
    credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));


const WORKBOOK_PATH = path.join(__dirname, 'Listado-Placas.xlsx');
const LOCAL_NOTIFICATIONS_DIR = path.join(__dirname, 'local-notifications');
const RUNTIME_ADMIN_CONFIG_PATH = path.join(__dirname, 'runtime-admin-config.json');
const NOTIFICATION_EMAIL = normalizeEnvString(process.env.NOTIFICATION_EMAIL, 'info@badelco.co');
const SAME_API_BASE_URL = ensureTrailingSlash(process.env.SAME_API_BASE_URL || process.env.API_BASE_URL || 'https://pagoalafija.co/api/public/');
const SAME_API_KEY = process.env.SAME_API_KEY || process.env.API_KEY || '';
const SAME_SECRET_KEY = process.env.SAME_SECRET_KEY || process.env.SECRET_KEY || '';
const SAME_COD_PRODUCTO = Number(process.env.SAME_COD_PRODUCTO || 63);
const SAME_IND_PRUEBA = String(process.env.SAME_IND_PRUEBA || '1');
const REQUIRE_LISTED_PLATES = String(process.env.REQUIRE_LISTED_PLATES || (SAME_IND_PRUEBA === '1' ? 'true' : 'false')) === 'true';
const SMTP_HOST = normalizeEnvString(process.env.SMTP_HOST);
const SMTP_PORT = normalizeEnvNumber(process.env.SMTP_PORT, 587);
const SMTP_SECURE = normalizeEnvBoolean(process.env.SMTP_SECURE, SMTP_PORT === 465);
const SMTP_USER = normalizeEnvString(process.env.SMTP_USER);
const SMTP_PASS = normalizeEnvString(process.env.SMTP_PASS);
const SAME_REQUEST_TIMEOUT_MS = Number(process.env.SAME_REQUEST_TIMEOUT_MS || 12000);
const SMTP_SEND_TIMEOUT_MS = normalizeEnvNumber(process.env.SMTP_SEND_TIMEOUT_MS || process.env.STPM_SEND_TIMEOUT_MS, 20000);
const SMTP_SEND_ATTEMPTS = Math.max(1, normalizeEnvNumber(process.env.SMTP_SEND_ATTEMPTS || process.env.STMP_SEND_ATTEMPS, 2));
const SMTP_RETRY_DELAY_MS = Math.max(0, normalizeEnvNumber(process.env.SMTP_RETRY_DELAY_MS, 1500));
const SMTP_FALLBACK_TO_587 = normalizeEnvBoolean(process.env.SMTP_FALLBACK_TO_587, true);
const RESEND_API_KEY = normalizeEnvString(process.env.RESEND_API_KEY);
const RESEND_FROM = normalizeEnvString(process.env.RESEND_FROM, normalizeEnvString(process.env.SMTP_FROM, SMTP_USER));
const RESEND_AUDIENCE = normalizeEnvString(process.env.RESEND_AUDIENCE, NOTIFICATION_EMAIL);

const DEFAULT_ALLY_OPTIONS = ['SUMOTO', 'Aliado 02', 'Aliado 03', 'Aliado 04', 'Aliado 05'];
const DEFAULT_ADVISOR_OPTIONS = ['01.SUMOTO JOHANA', '02.SUMOTO CAROLINA', 'Asesor 03', 'Asesor 04', 'Asesor 05'];
const ALLY_LOGIN_USER = String(process.env.ALLY_LOGIN_USER || '').trim();
const ALLY_LOGIN_PASSWORD_HASH = String(process.env.ALLY_LOGIN_PASSWORD_HASH || '').trim();
const ADMIN_LOGIN_USER = normalizeEnvString(process.env.ADMIN_LOGIN_USER, '0TtO.B4d3lc0/');
const ADMIN_LOGIN_PASSWORD = String(process.env.ADMIN_LOGIN_PASSWORD || 'B4d3lc0.2Oz6/*');
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 30);
const ENABLE_DEBUG_ENDPOINTS = String(process.env.ENABLE_DEBUG_ENDPOINTS || 'false') === 'true';
const allySessions = new Map();
const adminSessions = new Map();
const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
let runtimeAdminConfig = null;

const plateCatalog = loadPlateCatalog();
let sameAuthToken = '';
let sameTokenGeneratedAt = 0;


// Credenciales correctas del API
const API_BASE_URL = ensureTrailingSlash(process.env.API_BASE_URL || 'https://pagoalafija.co/api/public/');
const API_KEY = String(process.env.API_KEY || '').trim();
const SECRET_KEY = String(process.env.SECRET_KEY || '').trim();
const AUTH_TOKEN = String(process.env.AUTHTOKEN || process.env.AUTH_TOKEN || '').trim();
const COD_PRODUCTO = 63;
const LEGACY_API_BASE_CANDIDATES = Array.from(new Set([
    API_BASE_URL,
    'https://pagoalafija.co/api/public/',
    'https://dev.same.com.co/api/public/'
].map(ensureTrailingSlash)));

// Variables para el token dinámico
let currentToken = AUTH_TOKEN; // Empezar con el token fijo
let tokenGeneratedAt = new Date();
let isUsingFixedToken = true;
let activeLegacyApiBaseUrl = LEGACY_API_BASE_CANDIDATES[0];

function isResendConfigured() {
    return Boolean(resendClient && RESEND_FROM && RESEND_AUDIENCE);
}

function maskSecret(value, keepStart = 4, keepEnd = 2) {
    const secret = String(value || '');
    if (!secret) {
        return '(vacío)';
    }

    if (secret.length <= keepStart + keepEnd) {
        return `${secret[0]}***`;
    }

    return `${secret.slice(0, keepStart)}***${secret.slice(-keepEnd)}`;
}

function hashPasswordScrypt(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordHashScrypt(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${hashPasswordScrypt(password, salt)}`;
}

function verifyPasswordScrypt(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) {
        return false;
    }

    const [salt, expectedHash] = storedHash.split(':');
    if (!salt || !expectedHash) {
        return false;
    }

    const actualHash = hashPasswordScrypt(password, salt);
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const actualBuffer = Buffer.from(actualHash, 'hex');

    if (expectedBuffer.length !== actualBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function createAllySession(user) {
    const token = crypto.randomBytes(48).toString('hex');
    const now = Date.now();
    const expiresAt = now + (SESSION_TTL_MINUTES * 60 * 1000);

    allySessions.set(token, {
        user,
        createdAt: now,
        expiresAt
    });

    return { token, expiresAt };
}

function createAdminSession(user) {
    const token = crypto.randomBytes(48).toString('hex');
    const now = Date.now();
    const expiresAt = now + (SESSION_TTL_MINUTES * 60 * 1000);

    adminSessions.set(token, {
        user,
        createdAt: now,
        expiresAt
    });

    return { token, expiresAt };
}

function getBearerToken(req) {
    const authorizationHeader = String(req.headers.authorization || '').trim();
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function cleanExpiredAllySessions() {
    const now = Date.now();
    for (const [token, session] of allySessions.entries()) {
        if (session.expiresAt <= now) {
            allySessions.delete(token);
        }
    }
}

function cleanExpiredAdminSessions() {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (session.expiresAt <= now) {
            adminSessions.delete(token);
        }
    }
}

function requireAlliesSession(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Sesión inválida o expirada. Debes iniciar sesión nuevamente.'
        });
    }

    const session = allySessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        allySessions.delete(token);
        return res.status(401).json({
            success: false,
            message: 'Sesión inválida o expirada. Debes iniciar sesión nuevamente.'
        });
    }

    req.allyToken = token;
    req.allySession = session;
    return next();
}

function requireAdminSession(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Sesión admin inválida o expirada. Debes iniciar sesión nuevamente.'
        });
    }

    const session = adminSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        adminSessions.delete(token);
        return res.status(401).json({
            success: false,
            message: 'Sesión admin inválida o expirada. Debes iniciar sesión nuevamente.'
        });
    }

    req.adminToken = token;
    req.adminSession = session;
    return next();
}

function normalizeOptionsList(values, fallback = []) {
    const source = Array.isArray(values) ? values : fallback;
    const unique = [];
    const seen = new Set();

    for (const item of source) {
        const normalized = String(item || '').trim();
        if (!normalized) {
            continue;
        }

        const lower = normalized.toLowerCase();
        if (seen.has(lower)) {
            continue;
        }

        seen.add(lower);
        unique.push(normalized);
    }

    return unique;
}

function buildDefaultRuntimeAdminConfig() {
    const allyPasswordHash = ALLY_LOGIN_PASSWORD_HASH || '';

    return {
        allyOptions: normalizeOptionsList(DEFAULT_ALLY_OPTIONS),
        advisorOptions: normalizeOptionsList(DEFAULT_ADVISOR_OPTIONS),
        allyCredentials: {
            user: ALLY_LOGIN_USER,
            passwordHash: allyPasswordHash
        },
        adminCredentials: {
            user: ADMIN_LOGIN_USER,
            passwordHash: createPasswordHashScrypt(ADMIN_LOGIN_PASSWORD)
        },
        updatedAt: new Date().toISOString()
    };
}

function saveRuntimeAdminConfig() {
    if (!runtimeAdminConfig) {
        return;
    }

    const payload = {
        ...runtimeAdminConfig,
        updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(RUNTIME_ADMIN_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
    runtimeAdminConfig = payload;
}

function loadRuntimeAdminConfig() {
    const fallback = buildDefaultRuntimeAdminConfig();

    try {
        if (!fs.existsSync(RUNTIME_ADMIN_CONFIG_PATH)) {
            runtimeAdminConfig = fallback;
            saveRuntimeAdminConfig();
            return runtimeAdminConfig;
        }

        const raw = fs.readFileSync(RUNTIME_ADMIN_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);

        runtimeAdminConfig = {
            allyOptions: normalizeOptionsList(parsed.allyOptions, fallback.allyOptions),
            advisorOptions: normalizeOptionsList(parsed.advisorOptions, fallback.advisorOptions),
            allyCredentials: {
                user: normalizeEnvString(parsed?.allyCredentials?.user, fallback.allyCredentials.user),
                passwordHash: normalizeEnvString(parsed?.allyCredentials?.passwordHash, fallback.allyCredentials.passwordHash)
            },
            adminCredentials: {
                user: normalizeEnvString(parsed?.adminCredentials?.user, fallback.adminCredentials.user),
                passwordHash: normalizeEnvString(parsed?.adminCredentials?.passwordHash, fallback.adminCredentials.passwordHash)
            },
            updatedAt: parsed?.updatedAt || fallback.updatedAt
        };

        if (!runtimeAdminConfig.adminCredentials.passwordHash) {
            runtimeAdminConfig.adminCredentials.passwordHash = fallback.adminCredentials.passwordHash;
            saveRuntimeAdminConfig();
        }

        return runtimeAdminConfig;
    } catch (error) {
        console.error('❌ No se pudo leer runtime-admin-config.json. Se usarán valores por defecto:', error.message);
        runtimeAdminConfig = fallback;
        saveRuntimeAdminConfig();
        return runtimeAdminConfig;
    }
}

function getAllyOptions() {
    return runtimeAdminConfig?.allyOptions || [];
}

function getAdvisorOptions() {
    return runtimeAdminConfig?.advisorOptions || [];
}

function isAllyLoginConfigured() {
    const user = normalizeEnvString(runtimeAdminConfig?.allyCredentials?.user);
    const passwordHash = normalizeEnvString(runtimeAdminConfig?.allyCredentials?.passwordHash);
    return Boolean(user && passwordHash);
}

function verifyAllyCredentials(user, password) {
    if (!isAllyLoginConfigured()) {
        return false;
    }

    const expectedUser = normalizeEnvString(runtimeAdminConfig.allyCredentials.user);
    const storedHash = normalizeEnvString(runtimeAdminConfig.allyCredentials.passwordHash);
    return user === expectedUser && verifyPasswordScrypt(password, storedHash);
}

runtimeAdminConfig = loadRuntimeAdminConfig();

setInterval(cleanExpiredAllySessions, 10 * 60 * 1000).unref();
setInterval(cleanExpiredAdminSessions, 10 * 60 * 1000).unref();

if (!API_KEY || !SECRET_KEY) {
    console.error('❌ ERROR: Debes configurar API_KEY y SECRET_KEY en variables de entorno');
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

if (!isAllyLoginConfigured()) {
    console.warn('⚠️ Login de aliados no configurado. Define ALLY_LOGIN_USER y ALLY_LOGIN_PASSWORD_HASH');
}

console.log('🔧 Configuración con credenciales correctas:');
console.log('- API URL:', API_BASE_URL);
console.log('- API URL candidates:', LEGACY_API_BASE_CANDIDATES.join(' | '));
console.log('- API Key:', maskSecret(API_KEY));
console.log('- Secret Key:', maskSecret(SECRET_KEY));
console.log('- Auth Token:', maskSecret(AUTH_TOKEN));
console.log('- SAME API URL:', SAME_API_BASE_URL);
console.log('- SAME API configurada:', Boolean(SAME_API_KEY && SAME_SECRET_KEY));
console.log('- Resend configurado:', isResendConfigured());
console.log('- SMTP configurado:', Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS));
console.log('- SMTP host/port/secure:', `${SMTP_HOST}:${SMTP_PORT} secure=${SMTP_SECURE}`);
console.log('- SMTP intentos/timeout:', `${SMTP_SEND_ATTEMPTS} intentos, ${SMTP_SEND_TIMEOUT_MS}ms timeout`);
console.log('- Login aliados configurado:', isAllyLoginConfigured());
console.log('- Panel admin configurado:', Boolean(runtimeAdminConfig?.adminCredentials?.user));

function ensureTrailingSlash(url) {
    return url.endsWith('/') ? url : `${url}/`;
}

function normalizeEnvString(value, fallback = '') {
    const normalized = String(value ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    return normalized || fallback;
}

function normalizeEnvNumber(value, fallback) {
    const normalized = normalizeEnvString(value);
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEnvBoolean(value, fallback = false) {
    const normalized = normalizeEnvString(value).toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePlate(value = '') {
    return String(value).trim().toUpperCase();
}

function loadPlateCatalog() {
    try {
        const workbook = xlsx.readFile(WORKBOOK_PATH);
        const firstSheetName = workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
            defval: '',
            raw: false
        });

        const map = new Map();
        for (const row of rows) {
            const placa = normalizePlate(row.Placa || row.placa);
            if (!placa) {
                continue;
            }

            map.set(placa, {
                placa,
                tarifa: String(row.Tarifa || row.tarifa || '').trim(),
                portafolio: String(row.Portafolio || row.portafolio || '').trim()
            });
        }

        console.log(`📘 Listado de placas cargado: ${map.size} registros`);
        return map;
    } catch (error) {
        console.error('❌ No se pudo cargar Listado-Placas.xlsx:', error.message);
        return new Map();
    }
}

function getPlateMetadata(placa) {
    return plateCatalog.get(normalizePlate(placa)) || null;
}

function isSameConfigured() {
    return Boolean(SAME_API_KEY && SAME_SECRET_KEY);
}

function isSmtpConfigured() {
    return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function createTransporter({ host = SMTP_HOST, port = SMTP_PORT, secure = SMTP_SECURE } = {}) {
    if (!isSmtpConfigured()) {
        return null;
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !secure && port === 587,
        connectionTimeout: 15000,
        greetingTimeout: 12000,
        socketTimeout: 20000,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });
}

function saveLocalNotification(payload) {
    try {
        fs.mkdirSync(LOCAL_NOTIFICATIONS_DIR, { recursive: true });
        const fileName = `notification-${Date.now()}.json`;
        const filePath = path.join(LOCAL_NOTIFICATIONS_DIR, fileName);
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
        return filePath;
    } catch (error) {
        console.error('❌ No se pudo guardar la notificación local:', error.message);
        return null;
    }
}

function appendNotificationStat(entry) {
    try {
        fs.mkdirSync(LOCAL_NOTIFICATIONS_DIR, { recursive: true });
        const statsPath = path.join(LOCAL_NOTIFICATIONS_DIR, 'notification-stats.ndjson');
        fs.appendFileSync(statsPath, `${JSON.stringify(entry)}\n`, 'utf8');
        return statsPath;
    } catch (error) {
        console.error('❌ No se pudo registrar estadística de notificación:', error.message);
        return null;
    }
}

async function sendAliadoNotification({
    aliado,
    asesor,
    placa,
    documentType,
    documentNumber,
    issued,
    policyNumber,
    detail,
    plateMetadata,
    contact,
    refVenta
}) {
    const timestamp = new Date();
    const payload = {
        fecha: timestamp.toLocaleString('es-CO'),
        aliado,
        asesor,
        placa: normalizePlate(placa),
        tipoDocumento: documentType || 'N/A',
        documento: documentNumber,
        emitido: issued ? 'Si' : 'No',
        poliza: policyNumber || 'N/A',
        detalle: detail || (issued ? 'Expedicion exitosa' : 'Expedicion fallida'),
        referenciaVenta: refVenta || 'N/A',
        tarifaPrueba: plateMetadata?.tarifa || 'N/A',
        portafolio: plateMetadata?.portafolio || 'N/A',
        contacto: {
            email: contact?.Email || 'N/A',
            celular: contact?.Cellular || 'N/A',
            ciudad: contact?.CityId || 'N/A',
            direccion: contact?.Address || 'N/A'
        }
    };

    const baseStat = {
        timestamp: new Date().toISOString(),
        aliado: payload.aliado,
        asesor: payload.asesor,
        placa: payload.placa,
        emitido: payload.emitido,
        detalle: payload.detalle,
        referenciaVenta: payload.referenciaVenta
    };

    const mailOptions = {
        from: normalizeEnvString(process.env.SMTP_FROM, SMTP_USER),
        to: NOTIFICATION_EMAIL,
        subject: `Badelco SOAT - ${issued ? 'EXPEDIDO' : 'FALLIDO'} - ${aliado} / ${asesor}`,
        text: [
            `Fecha: ${payload.fecha}`,
            `Aliado: ${payload.aliado}`,
            `Asesor: ${payload.asesor}`,
            `Placa: ${payload.placa}`,
            `Tipo documento: ${payload.tipoDocumento}`,
            `Documento: ${payload.documento}`,
            `Emitido: ${payload.emitido}`,
            `Poliza: ${payload.poliza}`,
            `Detalle: ${payload.detalle}`,
            `Referencia venta: ${payload.referenciaVenta}`,
            `Tarifa (Excel): ${payload.tarifaPrueba}`,
            `Portafolio: ${payload.portafolio}`,
            `Email contacto: ${payload.contacto.email}`,
            `Celular contacto: ${payload.contacto.celular}`,
            `Ciudad contacto: ${payload.contacto.ciudad}`,
            `Direccion contacto: ${payload.contacto.direccion}`
        ].join('\n'),
        html: `
            <h2>Badelco SOAT - Control de Expedicion</h2>
            <p><strong>Fecha:</strong> ${payload.fecha}</p>
            <p><strong>Aliado / Asesor:</strong> ${payload.aliado} / ${payload.asesor}</p>
            <p><strong>Placa:</strong> ${payload.placa}</p>
            <p><strong>Tipo/Documento:</strong> ${payload.tipoDocumento} ${payload.documento}</p>
            <p><strong>Emitido:</strong> ${payload.emitido}</p>
            <p><strong>Poliza:</strong> ${payload.poliza}</p>
            <p><strong>Detalle:</strong> ${payload.detalle}</p>
            <p><strong>Referencia:</strong> ${payload.referenciaVenta}</p>
            <p><strong>Tarifa (Excel):</strong> ${payload.tarifaPrueba}</p>
            <p><strong>Portafolio:</strong> ${payload.portafolio}</p>
            <p><strong>Email contacto:</strong> ${payload.contacto.email}</p>
            <p><strong>Celular contacto:</strong> ${payload.contacto.celular}</p>
            <p><strong>Ciudad contacto:</strong> ${payload.contacto.ciudad}</p>
            <p><strong>Direccion contacto:</strong> ${payload.contacto.direccion}</p>
        `
    };

    if (isResendConfigured()) {
        try {
            const resendResult = await resendClient.emails.send({
                from: RESEND_FROM,
                to: [RESEND_AUDIENCE],
                subject: mailOptions.subject,
                text: mailOptions.text,
                html: mailOptions.html
            });

            appendNotificationStat({
                ...baseStat,
                sent: true,
                channel: 'resend',
                messageId: resendResult?.data?.id || resendResult?.id || null,
                accepted: [RESEND_AUDIENCE],
                rejected: []
            });

            console.log('✅ Notificación enviada con Resend:', {
                messageId: resendResult?.data?.id || resendResult?.id || null,
                audience: RESEND_AUDIENCE
            });

            return {
                sent: true,
                channel: 'resend',
                messageId: resendResult?.data?.id || resendResult?.id || null,
                payload
            };
        } catch (error) {
            console.warn('⚠️ Resend falló, se intentará SMTP:', error.message);
        }
    }

    if (!isSmtpConfigured()) {
        const localFile = saveLocalNotification(payload);
        appendNotificationStat({
            ...baseStat,
            sent: false,
            channel: localFile ? 'local-file' : 'none',
            reason: 'SMTP no configurado',
            localFile
        });
        console.warn('⚠️ SMTP no configurado. Notificación pendiente:', payload);
        return {
            sent: false,
            reason: 'SMTP no configurado',
            channel: localFile ? 'local-file' : 'none',
            localFile,
            payload
        };
    }

    const transportCandidates = [
        { host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, label: 'primary' }
    ];

    if (SMTP_FALLBACK_TO_587 && SMTP_PORT === 465) {
        transportCandidates.push({ host: SMTP_HOST, port: 587, secure: false, label: 'fallback-587' });
    }

    try {
        let result = null;
        let lastError = null;

        for (const candidate of transportCandidates) {
            const transporter = createTransporter(candidate);

            for (let attempt = 1; attempt <= SMTP_SEND_ATTEMPTS; attempt += 1) {
                try {
                    result = await Promise.race([
                        transporter.sendMail(mailOptions),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera SMTP agotado')), SMTP_SEND_TIMEOUT_MS))
                    ]);
                    break;
                } catch (error) {
                    lastError = error;
                    console.warn(`⚠️ Intento SMTP ${attempt}/${SMTP_SEND_ATTEMPTS} fallido (${candidate.label} ${candidate.host}:${candidate.port} secure=${candidate.secure}):`, error.message);
                    if (attempt < SMTP_SEND_ATTEMPTS) {
                        await wait(SMTP_RETRY_DELAY_MS);
                    }
                }
            }

            if (result) {
                break;
            }
        }

        if (!result) {
            throw lastError || new Error('No se pudo enviar notificación SMTP');
        }

        appendNotificationStat({
            ...baseStat,
            sent: true,
            channel: 'smtp',
            messageId: result?.messageId || null,
            accepted: result?.accepted || [],
            rejected: result?.rejected || []
        });

        console.log('✅ Notificación SMTP enviada:', {
            messageId: result?.messageId || null,
            accepted: result?.accepted || [],
            rejected: result?.rejected || []
        });
    } catch (error) {
        const localFile = saveLocalNotification(payload);
        appendNotificationStat({
            ...baseStat,
            sent: false,
            channel: localFile ? 'local-file' : 'none',
            reason: error.message,
            localFile
        });
        console.warn('⚠️ No se pudo enviar notificación por SMTP:', {
            reason: error.message,
            smtpHost: SMTP_HOST,
            smtpPort: SMTP_PORT,
            notificationEmail: NOTIFICATION_EMAIL,
            localFile
        });
        return {
            sent: false,
            reason: error.message,
            channel: localFile ? 'local-file' : 'none',
            localFile,
            payload
        };
    }

    return {
        sent: true,
        channel: 'smtp',
        payload
    };
}

function queueAliadoNotification(notificationInput) {
    Promise.resolve()
        .then(() => sendAliadoNotification(notificationInput))
        .then((result) => {
            console.log('📨 Notificación procesada en segundo plano:', {
                sent: result?.sent,
                channel: result?.channel || 'unknown',
                reason: result?.reason || null
            });
        })
        .catch((error) => {
            console.error('❌ Error procesando notificación en segundo plano:', error.message);
        });

    return {
        sent: false,
        queued: true,
        channel: 'background',
        reason: 'Notificación en proceso'
    };
}

async function getSameToken() {
    if (!isSameConfigured()) {
        throw new Error('Las variables SAME_API_KEY y SAME_SECRET_KEY no están configuradas');
    }

    const isTokenFresh = sameAuthToken && (Date.now() - sameTokenGeneratedAt) < 50 * 60 * 1000;
    if (isTokenFresh) {
        return sameAuthToken;
    }

    const response = await axios.get(`${SAME_API_BASE_URL}token`, {
        headers: {
            secretkey: SAME_SECRET_KEY,
            apikey: SAME_API_KEY,
            'Content-Type': 'application/json'
        },
        timeout: 15000
    });

    const token = response.data?.AuthToken;
    if (!token) {
        throw new Error('SAME no devolvió un AuthToken válido');
    }

    sameAuthToken = token;
    sameTokenGeneratedAt = Date.now();
    return sameAuthToken;
}

async function sameRequest(method, endpoint, { params, data } = {}) {
    const token = await getSameToken();
    try {
        return await axios({
            method,
            url: `${SAME_API_BASE_URL}${endpoint}`,
            params,
            data,
            timeout: SAME_REQUEST_TIMEOUT_MS,
            headers: {
                AuthToken: token,
                indPrueba: SAME_IND_PRUEBA,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            }
        });
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            error.statusCode = 504;
            error.publicMessage = `SAME tardó más de ${Math.floor(SAME_REQUEST_TIMEOUT_MS / 1000)} segundos en responder`;
        }
        throw error;
    }
}

function parseFormattedMoney(value) {
    if (typeof value !== 'string') {
        return Number(value) || 0;
    }

    const numericValue = value.replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '.');
    return Number.parseFloat(numericValue) || 0;
}

function getTomorrowDate() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
}

function normalizeSameFromValidateDate(value) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxAllowed = new Date(today);
    maxAllowed.setDate(maxAllowed.getDate() + 30);

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return getTomorrowDate();
    }

    parsed.setHours(0, 0, 0, 0);

    if (parsed > maxAllowed) {
        console.warn('⚠️ SAME devolvió FromValidateDate fuera de rango (>30 días). Se ajusta al máximo permitido.');
        return maxAllowed.toISOString();
    }

    if (parsed < today) {
        return getTomorrowDate();
    }

    return parsed.toISOString();
}

function getNationalOperationCardId(plateMetadata) {
    const tariff = String(plateMetadata?.tarifa || '').trim();
    if (tariff.startsWith('920')) {
        return 2;
    }

    if (tariff.startsWith('910')) {
        return 1;
    }

    return null;
}

function buildContactFromTomador(tomador = {}, documentType, documentNumber, fallbackContact = {}) {
    const address = tomador.Address || tomador.address || tomador.Direccion || tomador.direccion || tomador?.Address?.Description || tomador?.Address?.Address || '';
    const cityId = tomador.CityId || tomador.cityId || tomador?.Address?.CityId || tomador?.Address?.cityId || '';
    const stateId = tomador.StateId || tomador.stateId || tomador?.Address?.StateId || tomador?.Address?.stateId || '';
    const email = tomador.Email || tomador.email || fallbackContact.Email || '';
    const cellular = tomador.Cellular || tomador.cellular || tomador.Phone || tomador.phone || fallbackContact.Cellular || '';
    const firstName = tomador.FirstName || tomador.firstName || tomador.Name || '';
    const lastName = tomador.LastName || tomador.lastName || tomador.LastNames || '';

    const contact = {
        Address: String(address).trim(),
        CityId: String(cityId).trim(),
        StateId: String(stateId).trim(),
        Cellular: String(cellular).trim(),
        DocumentNumber: String(documentNumber).trim(),
        DocumentTypeId: getSameDocumentTypeCode(documentType),
        Email: String(email).trim(),
        FirstName: String(firstName).trim(),
        FirstName1: String(tomador.FirstName1 || tomador.firstName1 || '').trim(),
        LastName: String(lastName).trim(),
        LastName1: String(tomador.LastName1 || tomador.lastName1 || '').trim(),
        Phone: String(tomador.Phone || tomador.phone || '').trim()
    };

    const missingFields = Object.entries(contact)
        .filter(([key, value]) => ['Address', 'CityId', 'StateId', 'Cellular', 'Email', 'FirstName', 'LastName'].includes(key) && !value)
        .map(([key]) => key);

    return { contact, missingFields };
}

function extractSameVehicle(cotizacionData = {}) {
    const data = cotizacionData.data || cotizacionData.vehiculo || cotizacionData.Vehicle || {};
    return {
        NumberPlate: data.NumberPlate || cotizacionData.NumberPlate,
        VehicleYear: Number(data.VehicleYear || cotizacionData.VehicleYear || 0),
        MotorNumber: String(data.MotorNumber || cotizacionData.MotorNumber || ''),
        ChasisNumber: String(data.ChasisNumber || cotizacionData.ChasisNumber || ''),
        Vin: String(data.Vin || cotizacionData.Vin || ''),
        CylinderCapacity: Number(data.CylinderCapacity || cotizacionData.CylinderCapacity || 0),
        LoadCapacity: Number(data.LoadCapacity || cotizacionData.LoadCapacity || 0),
        PassengerCapacity: Number(data.PassengerCapacity || cotizacionData.PassengerCapacity || 0),
        BrandId: Number(data.BrandId || cotizacionData.BrandId || 0),
        VehicleLineId: Number(data.VehicleLineId || cotizacionData.VehicleLineId || 0),
        VehicleDescription: String(data.VehicleDescription || cotizacionData.VehicleDescription || data.VehicleLineDescription || ''),
        VehicleClassId: Number(data.VehicleClassId || cotizacionData.VehicleClassId || 0),
        VehicleClassMinistryId: Number(data.VehicleClassMinistryId || cotizacionData.VehicleClassMinistryId || 0),
        ServiceTypeId: Number(data.ServiceTypeId || cotizacionData.ServiceTypeId || 0),
        VehicleBodyTypeId: Number(data.VehicleBodyTypeId || cotizacionData.VehicleBodyTypeId || 0)
    };
}

function extractSameTariff(cotizacionData = {}, publicTariffData = null) {
    const tarifa = publicTariffData?.tarifa || cotizacionData.data?.NewTariff || cotizacionData.tarifa || cotizacionData.Tarifa || cotizacionData.NewTariff || {};
    return {
        TariffCode: String(tarifa.TariffCode || tarifa.codTarifa || ''),
        InsurancePremium: Number(tarifa.InsurancePremium || tarifa.valPrima || 0),
        InsuranceTax: Number(tarifa.InsuranceTax || tarifa.valIva || 0),
        InsuranceFine: Number(tarifa.InsuranceFine || tarifa.valRunt || 0),
        Total: Number(tarifa.Total || tarifa.valTotal || parseFormattedMoney(tarifa.TotalFormatted) || 0),
        TotalWithDiscountAmount: Number(tarifa.TotalWithDiscountAmount || tarifa.Total || tarifa.valTotal || parseFormattedMoney(tarifa.TotalWithDiscountAmountFormatted) || 0),
        DiscountAmount: Number(tarifa.DiscountAmount || 0),
        ElectricDiscount: Number(tarifa.ElectricDiscount || 0),
        PercentageElectricDiscount: Number(tarifa.PercentageElectricDiscount || 0),
        InsurancePremiumFormatted: tarifa.InsurancePremiumFormatted || '',
        InsuranceTaxFormatted: tarifa.InsuranceTaxFormatted || '',
        InsuranceFineFormatted: tarifa.InsuranceFineFormatted || '',
        TotalFormatted: tarifa.TotalFormatted || '',
        DiscountAmountFormatted: tarifa.DiscountAmountFormatted || '$0',
        TotalWithDiscountAmountFormatted: tarifa.TotalWithDiscountAmountFormatted || tarifa.TotalFormatted || ''
    };
}

function extractSameFromValidateDate(cotizacionData = {}) {
    const fromValidateDate = (
        cotizacionData.data?.Expiration?.FromValidateDate ||
        cotizacionData.Expiration?.FromValidateDate ||
        cotizacionData.FromValidateDate ||
        getTomorrowDate()
    );

    return normalizeSameFromValidateDate(fromValidateDate);
}

// Función para generar nuevo token usando API_KEY y SECRET_KEY
async function generateNewToken() {
    try {
        console.log('\n🔐 Generando nuevo token con API_KEY y SECRET_KEY...');
        
        // Probar diferentes endpoints para generar token
        const tokenEndpoints = [
            'token',
            'auth/token',
            'authenticate',
            'login'
        ];
        
        for (const baseUrl of LEGACY_API_BASE_CANDIDATES) {
            for (const endpoint of tokenEndpoints) {
                const tokenUrl = baseUrl + endpoint;
                console.log(`🔄 Probando endpoint: ${tokenUrl}`);
                
                try {
                    // Método GET con headers
                    console.log('   Método: GET con headers');
                    let response = await axios.get(tokenUrl, {
                        headers: {
                            'secretkey': SECRET_KEY,
                            'apikey': API_KEY,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000,
                        validateStatus: () => true
                    });
                    
                    console.log(`   Status: ${response.status}`);
                    
                    if (response.status === 200 && response.data) {
                        console.log('   Respuesta:', JSON.stringify(response.data, null, 2));
                        
                        const token = response.data.AuthToken || response.data.authToken || response.data.token;
                        if (token) {
                            console.log('✅ Token generado exitosamente con GET');
                            currentToken = token;
                            tokenGeneratedAt = new Date();
                            isUsingFixedToken = false;
                            activeLegacyApiBaseUrl = baseUrl;
                            return token;
                        }
                    }
                    
                    // Método POST con body
                    console.log('   Método: POST con body');
                    response = await axios.post(tokenUrl, {
                        secretkey: SECRET_KEY,
                        apikey: API_KEY
                    }, {
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000,
                        validateStatus: () => true
                    });
                    
                    console.log(`   Status: ${response.status}`);
                    
                    if (response.status === 200 && response.data) {
                        console.log('   Respuesta:', JSON.stringify(response.data, null, 2));
                        
                        const token = response.data.AuthToken || response.data.authToken || response.data.token;
                        if (token) {
                            console.log('✅ Token generado exitosamente con POST');
                            currentToken = token;
                            tokenGeneratedAt = new Date();
                            isUsingFixedToken = false;
                            activeLegacyApiBaseUrl = baseUrl;
                            return token;
                        }
                    }
                    
                } catch (error) {
                    console.log(`   Error: ${error.message}`);
                }
            }
        }
        
        // Si no se pudo generar, seguir usando el token fijo
        console.log('⚠️ No se pudo generar nuevo token, usando token fijo');
        return AUTH_TOKEN;
        
    } catch (error) {
        console.error('❌ Error generando token:', error.message);
        // Fallback al token fijo
        return AUTH_TOKEN;
    }
}

// Función para obtener token válido
async function getValidToken() {
    // Si estamos usando token fijo y ha pasado más de 1 hora, intentar generar nuevo
    if (isUsingFixedToken && (new Date() - tokenGeneratedAt) > 3600000) {
        console.log('🔄 Token fijo antiguo, intentando generar nuevo...');
        return await generateNewToken();
    }
    
    console.log('✅ Usando token actual');
    return currentToken;
}

// ENDPOINT PRINCIPAL: Cotizar SOAT
app.post('/api/cotizar', async (req, res) => {
    try {
        console.log('\n=== 🚀 NUEVA COTIZACIÓN ===');

        const { placa, documentType, documentNumber, nombre, email, telefono } = req.body;

        if (!placa || !documentType || !documentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos: placa, documentType y documentNumber'
            });
        }

        console.log('📋 Datos recibidos:', { placa, documentType, documentNumber });

        // Obtener token válido
        await getValidToken();

        // URL y parámetros para cotización
        let cotizacionUrl = `${activeLegacyApiBaseUrl}soat`;
        const params = {
            numPlaca: placa.toUpperCase(),
            codProducto: COD_PRODUCTO,
            codTipdoc: getDocumentTypeCode(documentType),
            numDocumento: documentNumber
        };

        console.log('📡 Cotización URL:', cotizacionUrl);
        console.log('📡 Parámetros:', params);
        console.log('🔑 Token:', currentToken.substring(0, 30) + '***');
        console.log('🔑 Tipo token:', isUsingFixedToken ? 'FIJO' : 'GENERADO');

        // Realizar cotización con múltiples estrategias de headers
        const headerStrategies = [
            { name: 'AuthToken', headerName: 'AuthToken', formatter: t => t },
            { name: 'Auth-Token', headerName: 'Auth-Token', formatter: t => t },
            { name: 'Authorization Bearer', headerName: 'Authorization', formatter: t => `Bearer ${t}` },
            { name: 'Token', headerName: 'Token', formatter: t => t },
            { name: 'X-Auth-Token', headerName: 'X-Auth-Token', formatter: t => t },
            { name: 'X-Token', headerName: 'X-Token', formatter: t => t }
        ];

        let cotizacionResponse;
        let lastError;

        for (const strategy of headerStrategies) {
            try {
                console.log(`🔄 Probando strategy: ${strategy.name}`);
                cotizacionUrl = `${activeLegacyApiBaseUrl}soat`;
                const tokenToUse = currentToken;
                const authHeaders = {
                    [strategy.headerName]: strategy.formatter(tokenToUse)
                };
                
                cotizacionResponse = await axios.get(cotizacionUrl, {
                    headers: {
                        ...authHeaders,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    params: params,
                    timeout: 15000
                });
                
                console.log(`✅ Éxito con strategy: ${strategy.name}`);
                console.log('📊 Status:', cotizacionResponse.status);
                console.log('📊 Respuesta completa:', JSON.stringify(cotizacionResponse.data, null, 2));
                break;
                
            } catch (error) {
                console.log(`❌ Falló strategy: ${strategy.name} - Status: ${error.response?.status}`);
                
                if (error.response?.data) {
                    console.log('   Error data:', JSON.stringify(error.response.data, null, 2));
                }
                
                lastError = error;
                
                // Si es 401 y estamos usando token fijo, intentar generar nuevo
                if (error.response?.status === 401 && isUsingFixedToken) {
                    console.log('🔄 Error 401 con token fijo, generando nuevo token...');
                    try {
                        await generateNewToken();
                        cotizacionUrl = `${activeLegacyApiBaseUrl}soat`;
                        const authHeadersWithNewToken = {
                            [strategy.headerName]: strategy.formatter(currentToken)
                        };
                        
                        // Reintentar con nuevo token
                        cotizacionResponse = await axios.get(cotizacionUrl, {
                            headers: {
                                ...authHeadersWithNewToken,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            },
                            params: params,
                            timeout: 15000
                        });
                        
                        console.log(`✅ Éxito con nuevo token y strategy: ${strategy.name}`);
                        break;
                        
                    } catch (retryError) {
                        console.log('❌ Falló incluso con nuevo token');
                        lastError = retryError;
                    }
                }
            }
        }

        if (!cotizacionResponse) {
            throw lastError;
        }

        console.log('✅ ¡COTIZACIÓN EXITOSA!');

        // Procesar respuesta
        const cotizacionData = cotizacionResponse.data;
        
        // Analizar estructura de respuesta
        console.log('\n🔍 ANÁLISIS DE RESPUESTA:');
        console.log('- Tipo:', typeof cotizacionData);
        console.log('- Es array:', Array.isArray(cotizacionData));
        console.log('- Campos disponibles:', Object.keys(cotizacionData));

        const precio = extractPrice(cotizacionData);
        const vehicleInfo = extractVehicleInfo(cotizacionData);
        const dates = extractDates(cotizacionData);
        const plateMetadata = getPlateMetadata(placa);

        console.log('💰 Precio extraído:', precio);
        console.log('🚗 Info vehículo:', vehicleInfo);

        const responseData = {
            success: true,
            placa: placa.toUpperCase(),
            precio: precio,
            tipoVehiculo: vehicleInfo.tipo,
            marca: vehicleInfo.marca,
            modelo: vehicleInfo.modelo,
            cilindraje: vehicleInfo.cilindraje,
            inicioVigencia: dates.inicio,
            finVigencia: dates.fin,
            tomador: {
                nombre: nombre || cotizacionData.nombreTomador || cotizacionData.nombre || 'N/A',
                documento: documentNumber,
                tipoDocumento: documentType,
                email: email || cotizacionData.email || 'N/A',
                telefono: telefono || cotizacionData.telefono || 'N/A'
            },
            cuentasBancarias: [
                {
                    banco: 'Bancolombia',
                    numero: '30685175725',
                    tipo: 'Cuenta de Ahorros',
                    titular: 'Otto Rafael Badel'
                },
                {
                    banco: 'Nequi',
                    numero: '3128433999',
                    tipo: 'Cuenta Nequi'
                }
            ],
            instruccionesPago: [
                'Realiza la transferencia por el valor exacto',
                'Envía el comprobante dando clic al botón de WhatsApp: 3128433999',
                'Incluye la placa del vehículo',
                'Recibirás tu SOAT en 24 horas',
                'Horario de expedición - Lunes a Sábado: 9:00am - 6:00pm'
                
                
            ],
            metadata: {
                timestamp: new Date().toISOString(),
                numeroReferencia: `SOAT-${placa.toUpperCase()}-${Date.now()}`,
                tokenType: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                tokenAge: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' minutos',
                plateListed: Boolean(plateMetadata)
            },
            plateMetadata,
            // Debug completo
            debug: {
                originalResponse: cotizacionData,
                extractedPrice: precio,
                vehicleInfo: vehicleInfo,
                availableFields: Object.keys(cotizacionData),
                responseType: typeof cotizacionData
            }
        };

        res.json(responseData);

    } catch (error) {
        console.error('❌ ERROR FINAL en cotización:');
        console.error('- Status:', error.response?.status);
        console.error('- Message:', error.message);
        console.error('- Data:', JSON.stringify(error.response?.data, null, 2));
        
        res.status(error.response?.status || 500).json({
            success: false,
            message: error.response?.data?.message || error.message || 'Error al procesar la cotización',
            error: error.response?.data,
            debug: {
                tokenInfo: {
                    hasToken: !!currentToken,
                    tokenType: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                    tokenAge: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' min'
                },
                url: `${activeLegacyApiBaseUrl}soat`,
                params: {
                    numPlaca: req.body.placa?.toUpperCase(),
                    codProducto: COD_PRODUCTO,
                    codTipdoc: getDocumentTypeCode(req.body.documentType),
                    numDocumento: req.body.documentNumber
                }
            }
        });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        sameConfigured: isSameConfigured(),
        requireListedPlates: REQUIRE_LISTED_PLATES,
        smtpConfigured: isSmtpConfigured(),
        allyAuthConfigured: isAllyLoginConfigured(),
        sessionTtlMinutes: SESSION_TTL_MINUTES,
        notificationEmail: NOTIFICATION_EMAIL,
        allyOptions: getAllyOptions(),
        advisorOptions: getAdvisorOptions(),
        listedPlates: plateCatalog.size
    });
});

app.post('/api/auth/login', (req, res) => {
    const user = String(req.body?.user || '').trim();
    const password = String(req.body?.password || '');

    if (!user || !password) {
        return res.status(400).json({
            success: false,
            message: 'Usuario y contraseña son obligatorios'
        });
    }

    if (!isAllyLoginConfigured()) {
        return res.status(503).json({
            success: false,
            message: 'El inicio de sesión no está configurado en el servidor'
        });
    }

    const userValid = user === runtimeAdminConfig.allyCredentials.user;
    const passwordValid = verifyPasswordScrypt(password, runtimeAdminConfig.allyCredentials.passwordHash);

    if (!userValid || !passwordValid) {
        return res.status(401).json({
            success: false,
            message: 'Credenciales inválidas'
        });
    }

    const { token, expiresAt } = createAllySession(user);

    return res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        expiresAt,
        user
    });
});

app.post('/api/auth/logout', requireAlliesSession, (req, res) => {
    allySessions.delete(req.allyToken);
    return res.json({ success: true });
});

app.post('/api/admin/auth/login', authLimiter, (req, res) => {
    const user = String(req.body?.user || '').trim();
    const password = String(req.body?.password || '');

    if (!user || !password) {
        return res.status(400).json({
            success: false,
            message: 'Usuario y contraseña admin son obligatorios'
        });
    }

    const expectedUser = normalizeEnvString(runtimeAdminConfig?.adminCredentials?.user);
    const expectedPasswordHash = normalizeEnvString(runtimeAdminConfig?.adminCredentials?.passwordHash);

    if (!expectedUser || !expectedPasswordHash) {
        return res.status(503).json({
            success: false,
            message: 'El panel admin no está configurado en el servidor'
        });
    }

    const userValid = user === expectedUser;
    const passwordValid = verifyPasswordScrypt(password, expectedPasswordHash);

    if (!userValid || !passwordValid) {
        return res.status(401).json({
            success: false,
            message: 'Credenciales admin inválidas'
        });
    }

    const { token, expiresAt } = createAdminSession(user);

    return res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        expiresAt,
        user
    });
});

app.post('/api/admin/auth/logout', requireAdminSession, (req, res) => {
    adminSessions.delete(req.adminToken);
    return res.json({ success: true });
});

app.get('/api/admin/config', requireAdminSession, (req, res) => {
    return res.json({
        success: true,
        allyOptions: getAllyOptions(),
        advisorOptions: getAdvisorOptions(),
        allyUser: runtimeAdminConfig?.allyCredentials?.user || '',
        adminUser: runtimeAdminConfig?.adminCredentials?.user || '',
        updatedAt: runtimeAdminConfig?.updatedAt || null
    });
});

app.post('/api/admin/ally-options', requireAdminSession, (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre del aliado es obligatorio' });
    }

    const exists = getAllyOptions().some(item => item.toLowerCase() === name.toLowerCase());
    if (exists) {
        return res.status(409).json({ success: false, message: 'El aliado ya existe' });
    }

    runtimeAdminConfig.allyOptions = normalizeOptionsList([...getAllyOptions(), name]);
    saveRuntimeAdminConfig();
    return res.json({ success: true, allyOptions: getAllyOptions() });
});

app.delete('/api/admin/ally-options/:name', requireAdminSession, (req, res) => {
    const target = String(req.params?.name || '').trim().toLowerCase();
    if (!target) {
        return res.status(400).json({ success: false, message: 'Aliado inválido' });
    }

    const updated = getAllyOptions().filter(item => item.toLowerCase() !== target);
    if (updated.length === getAllyOptions().length) {
        return res.status(404).json({ success: false, message: 'Aliado no encontrado' });
    }

    runtimeAdminConfig.allyOptions = updated;
    saveRuntimeAdminConfig();
    return res.json({ success: true, allyOptions: getAllyOptions() });
});

app.post('/api/admin/advisor-options', requireAdminSession, (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
        return res.status(400).json({ success: false, message: 'El nombre del asesor es obligatorio' });
    }

    const exists = getAdvisorOptions().some(item => item.toLowerCase() === name.toLowerCase());
    if (exists) {
        return res.status(409).json({ success: false, message: 'El asesor ya existe' });
    }

    runtimeAdminConfig.advisorOptions = normalizeOptionsList([...getAdvisorOptions(), name]);
    saveRuntimeAdminConfig();
    return res.json({ success: true, advisorOptions: getAdvisorOptions() });
});

app.delete('/api/admin/advisor-options/:name', requireAdminSession, (req, res) => {
    const target = String(req.params?.name || '').trim().toLowerCase();
    if (!target) {
        return res.status(400).json({ success: false, message: 'Asesor inválido' });
    }

    const updated = getAdvisorOptions().filter(item => item.toLowerCase() !== target);
    if (updated.length === getAdvisorOptions().length) {
        return res.status(404).json({ success: false, message: 'Asesor no encontrado' });
    }

    runtimeAdminConfig.advisorOptions = updated;
    saveRuntimeAdminConfig();
    return res.json({ success: true, advisorOptions: getAdvisorOptions() });
});

app.put('/api/admin/credentials/ally', requireAdminSession, (req, res) => {
    const oldUser = String(req.body?.oldUser || '').trim();
    const oldPassword = String(req.body?.oldPassword || '');
    const newUser = String(req.body?.newUser || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!newUser || !newPassword) {
        return res.status(400).json({ success: false, message: 'Nuevo usuario y contraseña de aliados son obligatorios' });
    }

    const allyConfigured = isAllyLoginConfigured();
    if (allyConfigured && !verifyAllyCredentials(oldUser, oldPassword)) {
        return res.status(401).json({
            success: false,
            message: 'Las credenciales antiguas de aliados no son válidas'
        });
    }

    runtimeAdminConfig.allyCredentials = {
        user: newUser,
        passwordHash: createPasswordHashScrypt(newPassword)
    };
    saveRuntimeAdminConfig();
    allySessions.clear();

    return res.json({
        success: true,
        message: allyConfigured
            ? 'Credenciales de aliados actualizadas correctamente'
            : 'Credenciales de aliados configuradas correctamente',
        allyUser: newUser
    });
});

app.put('/api/admin/credentials/admin', requireAdminSession, (req, res) => {
    const oldUser = String(req.body?.oldUser || '').trim();
    const oldPassword = String(req.body?.oldPassword || '');
    const newUser = String(req.body?.newUser || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!oldUser || !oldPassword || !newUser || !newPassword) {
        return res.status(400).json({
            success: false,
            message: 'Debes enviar credenciales antiguas y nuevas del administrador'
        });
    }

    const expectedUser = normalizeEnvString(runtimeAdminConfig?.adminCredentials?.user);
    const expectedPasswordHash = normalizeEnvString(runtimeAdminConfig?.adminCredentials?.passwordHash);
    const oldValid = oldUser === expectedUser && verifyPasswordScrypt(oldPassword, expectedPasswordHash);

    if (!oldValid) {
        return res.status(401).json({
            success: false,
            message: 'Las credenciales antiguas del administrador no son válidas'
        });
    }

    runtimeAdminConfig.adminCredentials = {
        user: newUser,
        passwordHash: createPasswordHashScrypt(newPassword)
    };
    saveRuntimeAdminConfig();
    adminSessions.clear();

    return res.json({
        success: true,
        message: 'Credenciales del administrador actualizadas. Inicia sesión nuevamente.',
        adminUser: newUser
    });
});

app.get('/api/plates/:placa', (req, res) => {
    const placa = normalizePlate(req.params.placa);
    const plateMetadata = getPlateMetadata(placa);

    res.json({
        success: true,
        placa,
        listed: Boolean(plateMetadata),
        plateMetadata
    });
});

app.post('/api/expedir', requireAlliesSession, async (req, res) => {
    try {
        const { placa, documentType, documentNumber, aliado, asesor, email, telefono, celular } = req.body;
        const normalizedPlate = normalizePlate(placa);
        const fallbackContact = {
            Email: String(email || '').trim(),
            Cellular: String(telefono || celular || '').trim()
        };
        const sendFailedNotification = (detail, contact = null, plateMetadata = null, refVenta = '') => queueAliadoNotification({
            aliado,
            asesor,
            placa: normalizedPlate,
            documentType,
            documentNumber,
            issued: false,
            policyNumber: '',
            detail,
            contact,
            plateMetadata,
            refVenta
        });

        if (!normalizedPlate || !documentType || !documentNumber || !aliado || !asesor) {
            const notification = sendFailedNotification('Faltan datos requeridos para la expedición');
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos para la expedición',
                notification
            });
        }

        if (!getAllyOptions().includes(aliado) || !getAdvisorOptions().includes(asesor)) {
            const notification = sendFailedNotification('Aliado o asesor inválido');
            return res.status(400).json({
                success: false,
                message: 'Aliado o asesor inválido',
                notification
            });
        }

        const plateMetadata = getPlateMetadata(normalizedPlate);
        if (REQUIRE_LISTED_PLATES && !plateMetadata) {
            const notification = sendFailedNotification('La placa no se encuentra en el listado de pruebas');
            return res.status(404).json({
                success: false,
                message: 'La placa no se encuentra en el listado de pruebas',
                placa: normalizedPlate,
                notification
            });
        }

        if (!isSameConfigured()) {
            const notification = queueAliadoNotification({
                aliado,
                asesor,
                placa: normalizedPlate,
                documentType,
                documentNumber,
                issued: false,
                policyNumber: '',
                detail: 'La expedición SAME no está configurada',
                plateMetadata
            });

            return res.status(503).json({
                success: false,
                message: 'La expedición SAME está lista en código, pero faltan SAME_API_KEY y SAME_SECRET_KEY en Railway',
                sameConfigured: false,
                notification,
                plateMetadata
            });
        }

        const quoteResponse = await sameRequest('get', 'soat', {
            params: {
                numPlaca: normalizedPlate,
                codProducto: SAME_COD_PRODUCTO,
                codTipdoc: getSameDocumentTypeCode(documentType),
                numDocumento: documentNumber
            }
        });

        const quoteData = quoteResponse.data;
        const vehicle = extractSameVehicle(quoteData);
        let publicTariffData = null;

        if (vehicle.ServiceTypeId === 2) {
            const nationalOperationCardId = getNationalOperationCardId(plateMetadata);
            if (!nationalOperationCardId) {
                const notification = sendFailedNotification('No fue posible inferir el tipo de operación del vehículo público');
                return res.status(422).json({
                    success: false,
                    message: 'La placa es de servicio público y no fue posible inferir el tipo de operación desde el archivo de placas',
                    plateMetadata,
                    notification
                });
            }

            const publicoResponse = await sameRequest('get', 'publico', {
                params: {
                    NumberPlate: vehicle.NumberPlate || normalizedPlate,
                    NationalOperationCardId: nationalOperationCardId,
                    VehicleClassMinistryId: vehicle.VehicleClassMinistryId,
                    VehicleYear: vehicle.VehicleYear,
                    CylinderCapacity: vehicle.CylinderCapacity,
                    PassengerCapacity: vehicle.PassengerCapacity,
                    LoadCapacity: vehicle.LoadCapacity,
                    VehicleClassId: vehicle.VehicleClassId
                }
            });

            publicTariffData = publicoResponse.data;
        }

        const tomadorResponse = await sameRequest('get', 'tomador', {
            params: {
                numDocumento: documentNumber,
                codTipdoc: getSameDocumentTypeCode(documentType)
            }
        });

        const { contact, missingFields } = buildContactFromTomador(
            tomadorResponse.data?.tomador || {},
            documentType,
            documentNumber,
            fallbackContact
        );
        if (missingFields.length > 0) {
            const notification = sendFailedNotification(`Faltan datos del tomador en SAME: ${missingFields.join(', ')}`, contact, plateMetadata);
            return res.status(422).json({
                success: false,
                message: `No es posible emitir porque faltan datos del tomador en SAME: ${missingFields.join(', ')}`,
                missingFields,
                plateMetadata,
                notification
            });
        }

        const payload = {
            codProducto: SAME_COD_PRODUCTO,
            refVenta: `BADELCO-${normalizedPlate}-${Date.now()}`,
            numPlaca: normalizedPlate,
            Contact: contact,
            Tarifa: extractSameTariff(quoteData, publicTariffData),
            Vehicle: vehicle,
            FromValidateDate: extractSameFromValidateDate(quoteData),
            RegimenTypeId: 2,
            Rutid: documentType === 'NIT' ? 3 : 5,
            numCelular: contact.Cellular,
            desCorreo: contact.Email
        };

        const validationResponse = await sameRequest('post', 'valida', { data: payload });
        if (!validationResponse.data?.status) {
            const notification = sendFailedNotification(
                validationResponse.data?.message || 'SAME rechazó la validación de emisión',
                contact,
                plateMetadata,
                payload.refVenta
            );
            return res.status(422).json({
                success: false,
                message: validationResponse.data?.message || 'SAME rechazó la validación de emisión',
                validation: validationResponse.data,
                notification
            });
        }

        const issueResponse = await sameRequest('post', 'soat', { data: payload });
        const policyNumber = issueResponse.data?.soat?.numPoliza || issueResponse.data?.soat?.InsurancePolicyNumber || '';
        const notification = queueAliadoNotification({
            aliado,
            asesor,
            placa: normalizedPlate,
            documentType,
            documentNumber,
            issued: Boolean(issueResponse.data?.status),
            policyNumber,
            detail: issueResponse.data?.message || 'Expedición exitosa',
            plateMetadata,
            contact,
            refVenta: payload.refVenta
        });

        res.json({
            success: true,
            message: issueResponse.data?.message || 'SOAT emitido correctamente',
            requestedBy: req.allySession.user,
            plateMetadata,
            notification,
            emission: issueResponse.data
        });
    } catch (error) {
        console.error('❌ Error en expedición SAME:', error.response?.data || error.message);
        const notification = (req.body?.aliado && req.body?.asesor && req.body?.placa && req.body?.documentNumber)
            ? queueAliadoNotification({
                aliado: req.body.aliado,
                asesor: req.body.asesor,
                placa: req.body.placa,
                documentType: req.body.documentType,
                documentNumber: req.body.documentNumber,
                issued: false,
                policyNumber: '',
                detail: error.response?.data?.message || error.message || 'No fue posible expedir el SOAT'
            })
            : null;
        const statusCode = error.response?.status || error.statusCode || 500;
        res.status(statusCode).json({
            success: false,
            message: error.response?.data?.message || error.publicMessage || error.message || 'No fue posible expedir el SOAT',
            error: error.response?.data || null,
            notification
        });
    }
});

// Test endpoint simple
app.get('/api/test', async (req, res) => {
    if (!ENABLE_DEBUG_ENDPOINTS) {
        return res.status(404).json({ success: false, message: 'Not found' });
    }

    try {
        console.log('\n🧪 TEST SIMPLE CON CREDENCIALES CORRECTAS\n');
        
        const token = await getValidToken();
        
        console.log('🔑 Token a usar:', token.substring(0, 30) + '***');
        console.log('🔑 Tipo:', isUsingFixedToken ? 'FIJO' : 'GENERADO');

        const testUrl = `${API_BASE_URL}soat`;
        const testParams = {
            numPlaca: 'EDR63F',
            codProducto: COD_PRODUCTO,
            codTipdoc: 1,
            numDocumento: '123456'
        };

        console.log('📡 URL de prueba:', testUrl);
        console.log('📡 Parámetros:', testParams);

        // Probar solo con Auth-Token primero (más común)
        const response = await axios.get(testUrl, {
            headers: {
                'Auth-Token': token,
                'Content-Type': 'application/json'
            },
            params: testParams,
            timeout: 10000
        });
        
        console.log('✅ Test exitoso!');
        console.log('📊 Status:', response.status);
        console.log('📊 Data:', JSON.stringify(response.data, null, 2));

        res.json({
            success: true,
            message: 'Test exitoso con credenciales correctas',
            status: response.status,
            data: response.data,
            extractedPrice: extractPrice(response.data),
            tokenInfo: {
                type: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                preview: token.substring(0, 30) + '...'
            }
        });

    } catch (error) {
        console.error('❌ Error en test:');
        console.error('- Status:', error.response?.status);
        console.error('- Message:', error.message);
        console.error('- Data:', JSON.stringify(error.response?.data, null, 2));
        
        res.status(error.response?.status || 500).json({
            success: false,
            error: error.message,
            details: error.response?.data,
            tokenInfo: {
                type: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                preview: currentToken.substring(0, 30) + '...'
            }
        });
    }
});

// Test de generación de token
app.post('/api/test-generate-token', async (req, res) => {
    if (!ENABLE_DEBUG_ENDPOINTS) {
        return res.status(404).json({ success: false, message: 'Not found' });
    }

    try {
        console.log('\n🧪 TEST DE GENERACIÓN DE TOKEN\n');
        
        const newToken = await generateNewToken();
        
        res.json({
            success: true,
            message: 'Test de generación completado',
            newToken: newToken.substring(0, 30) + '...',
            tokenType: isUsingFixedToken ? 'FIJO (no se pudo generar)' : 'GENERADO'
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Funciones auxiliares
function extractPrice(data) {
    // Buscar precio en múltiples campos posibles
    const priceFields = [
        'valor', 'precio', 'prima', 'precioTotal', 'total', 'costo',
        'valorTotal', 'primaNeta', 'valorPrima', 'valorSOAT',
        'costoSOAT', 'primaSOAT', 'montoTotal'
    ];
    
    for (const field of priceFields) {
        if (data[field] !== undefined && data[field] !== null) {
            const value = parseFloat(data[field]);
            if (!isNaN(value) && value > 0) {
                console.log(`💰 Precio encontrado en campo '${field}':`, value);
                return value;
            }
        }
        
        // Buscar en objetos anidados
        if (data.data && data.data[field] !== undefined) {
            const value = parseFloat(data.data[field]);
            if (!isNaN(value) && value > 0) {
                console.log(`💰 Precio encontrado en 'data.${field}':`, value);
                return value;
            }
        }
    }
    
    console.log('⚠️ No se encontró precio válido');
    return 0;
}

function extractVehicleInfo(data) {
    return {
        tipo: data.tipoVehiculo || data.claseVehiculo || data.tipo || data.clase || 'AUTOMOVIL',
        marca: data.marca || data.marcaVehiculo || 'N/A',
        modelo: data.modelo || data.modeloVehiculo || 'N/A',
        cilindraje: data.cilindraje || data.cilindrajeVehiculo || 'N/A'
    };
}

function extractDates(data) {
    const now = new Date();
    const nextYear = new Date(now);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    
    return {
        inicio: data.inicioVigencia || data.fechaInicio || data.vigenciaDesde || now.toISOString(),
        fin: data.finVigencia || data.fechaFin || data.vigenciaHasta || nextYear.toISOString()
    };
}

function getDocumentTypeCode(documentType) {
    const codes = { 'CC': 1, 'CE': 2, 'NIT': 3, 'PA': 4 };
    return codes[documentType] || 1;
}

function getSameDocumentTypeCode(documentType) {
    const codes = { 'CC': 1, 'CE': 2, 'NIT': 3, 'TI': 4, 'PA': 5 };
    return codes[documentType] || 1;
}

// Info endpoint
app.get('/api/info', (req, res) => {
    res.json({
        status: 'READY',
        server: 'Badelco SOAT API - Credenciales Correctas',
        timestamp: new Date().toISOString(),
        credentialsConfigured: Boolean(API_KEY && SECRET_KEY),
        allyAuthConfigured: isAllyLoginConfigured(),
        token: {
            hasCurrentToken: Boolean(currentToken),
            type: isUsingFixedToken ? 'FIJO' : 'GENERADO',
            age: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' minutos'
        },
        endpoints: {
            test: 'GET /api/test - Test simple',
            testGenerateToken: 'POST /api/test-generate-token - Generar token',
            cotizar: 'POST /api/cotizar - Cotización SOAT',
            authAdminLogin: 'POST /api/admin/auth/login - Login administrador',
            info: 'GET /api/info'
        }
    });
});

// Ruta GET para compatibilidad con frontend
app.get('/api/soat', async (req, res) => {
    try {
        const token = await getValidToken();
        
        const response = await axios.get(`${activeLegacyApiBaseUrl}soat`, {
            headers: {
                'AuthToken': token,
                'Content-Type': 'application/json'
            },
            params: req.query,
            timeout: 15000
        });
        
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: error.message,
            details: error.response?.data
        });
    }
});

// Página principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// Al final del archivo server.js, cambiar esta línea:
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================');
    console.log('🌟 BADELCO SOAT API - READY ON RAILWAY');
    console.log('🚀 ================================');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌐 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Token configurado: ${AUTH_TOKEN.substring(0, 30)}***`);
    console.log('🚀 ================================\n');
});









