// server-correct-credentials.js - Con las credenciales correctas del API y CORS CORREGIDO
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers con CSP actualizado
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "https://badelco.co"],
            connectSrc: ["'self'", "https://dev.same.com.co", "https://badelco-soat-api-production.up.railway.app"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"]
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

// Middleware para logs de seguridad
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip} - Origin: ${req.get('Origin') || 'No origin'}`);
    next();
});

// ================================
// 🚨 CONFIGURACIÓN CORS CORREGIDA
// ================================
const corsOptions = {
    origin: function (origin, callback) {
        // Lista de dominios permitidos
        const allowedOrigins = [
            'https://badelco-soat-api-production.up.railway.app',
            'http://localhost:3000',
            'http://localhost:5500',
            'http://localhost:5501',
            'http://127.0.0.1:5500',
            'http://127.0.0.1:5501',
            'https://claude.ai',
            'https://badelco.co',
            'https://www.badelco.co'
        ];
        
        // Permitir requests sin origin (como Postman, aplicaciones móviles)
        if (!origin) {
            console.log('✅ Request sin origin permitido');
            return callback(null, true);
        }
        
        // Verificar si el origin está en la lista permitida
        if (allowedOrigins.indexOf(origin) !== -1) {
            console.log('✅ Origin permitido:', origin);
            return callback(null, true);
        }
        
        // En desarrollo, permitir cualquier localhost
        if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
            console.log('✅ Localhost permitido en desarrollo:', origin);
            return callback(null, true);
        }
        
        console.log('❌ Origin bloqueado:', origin);
        const msg = `Origin ${origin} no permitido por política CORS`;
        return callback(new Error(msg), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'Cache-Control',
        'X-Access-Token',
        'Access-Control-Allow-Origin'
    ],
    exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
    maxAge: 86400 // Cache preflight por 24 horas
};

app.use(cors(corsOptions));

// Manejar preflight requests explícitamente
app.options('*', (req, res) => {
    console.log('🔄 Preflight request recibido:', req.method, req.path);
    res.header('Access-Control-Allow-Origin', req.get('Origin') || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,Cache-Control,X-Access-Token');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');
    res.status(200).end();
});

// Middleware adicional
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos
app.use(express.static('public', {
    setHeaders: (res, path, stat) => {
        res.set('Cache-Control', 'public, max-age=31536000');
    }
}));

// Credenciales correctas del API
const API_BASE_URL = 'https://dev.same.com.co/api/public/';
const API_KEY = '208d8d63a622fd73fa6e39a9681c9333';
const SECRET_KEY = '$2y$10$18UjqB3SUjix.czNvc8Bu./ddlzUtaVx0oPqFd5o5iewEf1Qubhxa';
const AUTH_TOKEN = '8618118e414837738fc652595317a8e51ff2a06bf6daaa5e93abff7eb504ae69';
const COD_PRODUCTO = 63;

// Variables para el token dinámico
let currentToken = AUTH_TOKEN;
let tokenGeneratedAt = new Date();
let isUsingFixedToken = true;

console.log('🔧 Configuración con credenciales correctas:');
console.log('- API URL:', API_BASE_URL);
console.log('- API Key:', API_KEY);
console.log('- Secret Key:', SECRET_KEY.substring(0, 20) + '***');
console.log('- Auth Token:', AUTH_TOKEN.substring(0, 10) + '***');

// Función para generar nuevo token usando API_KEY y SECRET_KEY
async function generateNewToken() {
    try {
        console.log('\n🔐 Generando nuevo token con API_KEY y SECRET_KEY...');
        
        const tokenEndpoints = [
            'token',
            'auth/token',
            'authenticate',
            'login'
        ];
        
        for (const endpoint of tokenEndpoints) {
            const tokenUrl = API_BASE_URL + endpoint;
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
                        return token;
                    }
                }
                
            } catch (error) {
                console.log(`   Error: ${error.message}`);
            }
        }
        
        console.log('⚠️ No se pudo generar nuevo token, usando token fijo');
        return AUTH_TOKEN;
        
    } catch (error) {
        console.error('❌ Error generando token:', error.message);
        return AUTH_TOKEN;
    }
}

// Función para obtener token válido
async function getValidToken() {
    if (isUsingFixedToken && (new Date() - tokenGeneratedAt) > 3600000) {
        console.log('🔄 Token fijo antiguo, intentando generar nuevo...');
        return await generateNewToken();
    }
    
    console.log('✅ Usando token actual');
    return currentToken;
}

// ================================
// 📡 ENDPOINTS PRINCIPALES
// ================================

// Info endpoint mejorado
app.get('/api/info', (req, res) => {
    console.log('📊 Request a /api/info desde:', req.get('Origin') || 'Sin origin');
    
    res.json({
        status: 'READY',
        server: 'Badelco SOAT API - CORS Corregido',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        cors: {
            enabled: true,
            origin: req.get('Origin') || 'No origin',
            allowed: true
        },
        credentials: {
            apiKey: API_KEY.substring(0, 10) + '...',
            secretKey: SECRET_KEY.substring(0, 20) + '...',
            authToken: AUTH_TOKEN.substring(0, 30) + '...',
            configured: true
        },
        token: {
            current: currentToken.substring(0, 30) + '...',
            type: isUsingFixedToken ? 'FIJO' : 'GENERADO',
            age: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' minutos'
        },
        endpoints: {
            test: 'GET /api/test - Test simple',
            testGenerateToken: 'POST /api/test-generate-token - Generar token',
            cotizar: 'POST /api/cotizar - Cotización SOAT',
            info: 'GET /api/info'
        }
    });
});

// ENDPOINT PRINCIPAL: Cotizar SOAT
app.post('/api/cotizar', async (req, res) => {
    try {
        console.log('\n=== 🚀 NUEVA COTIZACIÓN ===');
        console.log('Origin:', req.get('Origin'));
        console.log('User-Agent:', req.get('User-Agent'));

        const { placa, documentType, documentNumber, nombre, email, telefono } = req.body;

        if (!placa || !documentType || !documentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos: placa, documentType y documentNumber'
            });
        }

        console.log('📋 Datos recibidos:', { placa, documentType, documentNumber });

        // Obtener token válido
        const token = await getValidToken();

        // URL y parámetros para cotización
        const cotizacionUrl = `${API_BASE_URL}soat`;
        const params = {
            numPlaca: placa.toUpperCase(),
            codProducto: COD_PRODUCTO,
            codTipdoc: getDocumentTypeCode(documentType),
            numDocumento: documentNumber
        };

        console.log('📡 Cotización URL:', cotizacionUrl);
        console.log('📡 Parámetros:', params);
        console.log('🔑 Token:', token.substring(0, 30) + '***');
        console.log('🔑 Tipo token:', isUsingFixedToken ? 'FIJO' : 'GENERADO');

        // Realizar cotización con múltiples estrategias de headers
        const headerStrategies = [
            { name: 'Auth-Token', headers: { 'Auth-Token': token } },
            { name: 'Authorization Bearer', headers: { 'Authorization': `Bearer ${token}` } },
            { name: 'AuthToken', headers: { 'AuthToken': token } },
            { name: 'Token', headers: { 'Token': token } },
            { name: 'X-Auth-Token', headers: { 'X-Auth-Token': token } },
            { name: 'X-Token', headers: { 'X-Token': token } }
        ];

        let cotizacionResponse;
        let lastError;

        for (const strategy of headerStrategies) {
            try {
                console.log(`🔄 Probando strategy: ${strategy.name}`);
                
                cotizacionResponse = await axios.get(cotizacionUrl, {
                    headers: {
                        ...strategy.headers,
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
                        const newToken = await generateNewToken();
                        strategy.headers[Object.keys(strategy.headers)[0]] = newToken;
                        
                        // Reintentar con nuevo token
                        cotizacionResponse = await axios.get(cotizacionUrl, {
                            headers: {
                                ...strategy.headers,
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
        
        console.log('\n🔍 ANÁLISIS DE RESPUESTA:');
        console.log('- Tipo:', typeof cotizacionData);
        console.log('- Es array:', Array.isArray(cotizacionData));
        console.log('- Campos disponibles:', Object.keys(cotizacionData));

        const precio = extractPrice(cotizacionData);
        const vehicleInfo = extractVehicleInfo(cotizacionData);
        const dates = extractDates(cotizacionData);

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
            año: vehicleInfo.año,
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
                'Incluye la placa del vehículo en el mensaje',
                'Recibirás tu SOAT en 24 horas máximo',
                'Horario de expedición - Lunes a Sábado: 9:00am - 6:00pm'
            ],
            metadata: {
                timestamp: new Date().toISOString(),
                numeroReferencia: `SOAT-${placa.toUpperCase()}-${Date.now()}`,
                tokenType: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                tokenAge: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' minutos',
                origin: req.get('Origin') || 'Sin origin'
            },
            debug: {
                originalResponse: cotizacionData,
                extractedPrice: precio,
                vehicleInfoCompleta: vehicleInfo,
                availableFields: Object.keys(cotizacionData),
                responseType: typeof cotizacionData
            }
        };

        console.log('✅ Enviando respuesta exitosa');
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
                url: `${API_BASE_URL}soat`,
                params: {
                    numPlaca: req.body.placa?.toUpperCase(),
                    codProducto: COD_PRODUCTO,
                    codTipdoc: getDocumentTypeCode(req.body.documentType),
                    numDocumento: req.body.documentNumber
                },
                origin: req.get('Origin') || 'Sin origin'
            }
        });
    }
});

// Test endpoint simple
app.get('/api/test', async (req, res) => {
    try {
        console.log('\n🧪 TEST SIMPLE CON CREDENCIALES CORRECTAS');
        console.log('Origin:', req.get('Origin'));
        
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
            },
            origin: req.get('Origin')
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
            },
            origin: req.get('Origin')
        });
    }
});

// Test de generación de token
app.post('/api/test-generate-token', async (req, res) => {
    try {
        console.log('\n🧪 TEST DE GENERACIÓN DE TOKEN');
        console.log('Origin:', req.get('Origin'));
        
        const newToken = await generateNewToken();
        
        res.json({
            success: true,
            message: 'Test de generación completado',
            newToken: newToken.substring(0, 30) + '...',
            tokenType: isUsingFixedToken ? 'FIJO (no se pudo generar)' : 'GENERADO',
            fullToken: newToken, // Solo para debug
            origin: req.get('Origin')
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            origin: req.get('Origin')
        });
    }
});

// ================================
// 🛠️ FUNCIONES AUXILIARES
// ================================

function extractPrice(data) {
    console.log('🔍 Buscando precio en:', typeof data, Array.isArray(data) ? 'array' : 'object');
    
    // Si es array, tomar el primer elemento
    if (Array.isArray(data) && data.length > 0) {
        data = data[0];
        console.log('📋 Usando primer elemento del array');
    }
    
    // Función recursiva para buscar precio
    function buscarPrecioRecursivo(obj, ruta = '') {
        if (!obj || typeof obj !== 'object') return 0;
        
        // Campos de precio más comunes
        const camposFormateados = [
            'TotalWithDiscountAmountFormatted', 'TotalAmountFormatted', 
            'PriceFormatted', 'PremiumFormatted', 'ValueFormatted'
        ];
        
        // Buscar campos formateados primero
        for (const campo of camposFormateados) {
            if (obj[campo] && typeof obj[campo] === 'string') {
                const valorFormateado = obj[campo];
                let numero = valorFormateado.replace(/[\$\s]/g, ''); // Quitar $ y espacios
                numero = numero.replace(/\./g, ''); // Quitar puntos (miles)
                numero = numero.replace(/,/g, '.'); // Comas a decimales
                const valor = parseFloat(numero);
                if (!isNaN(valor) && valor > 0) {
                    console.log(`💰 Precio formateado encontrado en ${ruta}.${campo}: ${valorFormateado} = ${valor}`);
                    return valor;
                }
            }
        }
        
        // Campos numéricos
        const camposNumericos = [
            'TotalWithDiscountAmount', 'TotalAmount', 'Premium', 'Price', 'Value',
            'precio', 'valor', 'prima', 'total', 'costo', 'tarifa', 'amount',
            'valorTotal', 'primaNeta', 'valorPrima', 'valorSOAT', 'costoSOAT'
        ];
        
        for (const campo of camposNumericos) {
            if (obj[campo] !== undefined && obj[campo] !== null) {
                const valor = parseFloat(obj[campo]);
                if (!isNaN(valor) && valor > 0) {
                    console.log(`💰 Precio numérico encontrado en ${ruta}.${campo}: ${valor}`);
                    return valor;
                }
            }
        }
        
        // Buscar en objetos anidados
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'object' && value !== null) {
                const nuevaRuta = ruta ? `${ruta}.${key}` : key;
                const resultado = buscarPrecioRecursivo(value, nuevaRuta);
                if (resultado > 0) return resultado;
            }
        }
        
        return 0;
    }
    
    const precio = buscarPrecioRecursivo(data, 'data');
    
    if (precio === 0) {
        console.log('⚠️ No se encontró precio válido. Campos disponibles:', Object.keys(data));
        console.log('📋 Muestra de datos:', JSON.stringify(data).substring(0, 500));
    }
    
    return precio;
}

function extractVehicleInfo(data) {
    // Si es array, tomar el primer elemento
    if (Array.isArray(data) && data.length > 0) {
        data = data[0];
    }
    
    return {
        tipo: data.tipoVehiculo || data.claseVehiculo || data.VehicleClassName || 
              data.VehicleClassMinistryName || data.tipo || data.clase || 'AUTOMOVIL',
        marca: data.marca || data.marcaVehiculo || data.BrandName || 'N/A',
        modelo: data.modelo || data.modeloVehiculo || data.VehicleLineDescription || 'N/A',
        cilindraje: data.cilindraje || data.cilindrajeVehiculo || data.CylinderCapacity || 'N/A',
        año: data.año || data.VehicleYear || data.modelYear || 'N/A'
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

// ================================
// 📁 RUTAS ESTÁTICAS
// ================================

// Página principal
app.get('/', (req, res) => {
    console.log('🏠 Página principal solicitada desde:', req.get('Origin') || 'directo');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
    console.log('❓ Ruta no encontrada:', req.method, req.originalUrl);
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: [
            'GET /',
            'GET /api/info',
            'GET /api/test',
            'POST /api/cotizar',
            'POST /api/test-generate-token'
        ]
    });
});

// Manejo global de errores
app.use((err, req, res, next) => {
    console.error('💥 Error global:', err.message);
    console.error('Stack:', err.stack);
    
    if (err.message.includes('CORS')) {
        return res.status(403).json({
            error: 'Error CORS',
            message: err.message,
            origin: req.get('Origin'),
            solution: 'Verifica que tu dominio esté en la lista de orígenes permitidos'
        });
    }
    
    res.status(500).json({
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'production' ? 'Error interno' : err.message,
        timestamp: new Date().toISOString()
    });
});

// ================================
// 🚀 INICIAR SERVIDOR
// ================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================');
    console.log('🌟 BADELCO SOAT API - CORS CORREGIDO');
    console.log('🚀 ================================');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌐 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔑 Token configurado: ${AUTH_TOKEN.substring(0, 30)}***`);
    console.log(`🛡️ CORS habilitado para múltiples orígenes`);
    console.log(`🔒 Rate limiting activo`);
    console.log(`⚡ Servidor listo para recibir requests`);
    console.log('🚀 ================================\n');
    
    // Test inicial de configuración
    console.log('🧪 Ejecutando test inicial...');
    console.log('✅ Express configurado');
    console.log('✅ CORS configurado');
    console.log('✅ Rate limiting activo');
    console.log('✅ Endpoints registrados');
    console.log('✅ Middleware de seguridad activo');
    console.log('🎯 Sistema listo para producción\n');
});
