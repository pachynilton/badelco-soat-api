// server-correct-credentials.js - Con las credenciales correctas del API
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Despues de crear la app
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://dev.same.com.co"]
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
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static('public'));


// Credenciales correctas del API
const API_BASE_URL = 'https://dev.same.com.co/api/public/';
const API_KEY = '208d8d63a622fd73fa6e39a9681c9333';
const SECRET_KEY = '$2y$10$18UjqB3SUjix.czNvc8Bu./ddlzUtaVx0oPqFd5o5iewEf1Qubhxa';
const AUTH_TOKEN = '8618118e414837738fc652595317a8e51ff2a06bf6daaa5e93abff7eb504ae69';
const COD_PRODUCTO = 63;

// Variables para el token dinámico
let currentToken = AUTH_TOKEN; // Empezar con el token fijo
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
        
        // Probar diferentes endpoints para generar token
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
        
        // Analizar estructura de respuesta
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
                tokenAge: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' minutos'
            },
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
                url: `${API_BASE_URL}soat`,
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

// Test endpoint simple
app.get('/api/test', async (req, res) => {
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
    try {
        console.log('\n🧪 TEST DE GENERACIÓN DE TOKEN\n');
        
        const newToken = await generateNewToken();
        
        res.json({
            success: true,
            message: 'Test de generación completado',
            newToken: newToken.substring(0, 30) + '...',
            tokenType: isUsingFixedToken ? 'FIJO (no se pudo generar)' : 'GENERADO',
            fullToken: newToken // Solo para debug
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

// Info endpoint
app.get('/api/info', (req, res) => {
    res.json({
        status: 'READY',
        server: 'Badelco SOAT API - Credenciales Correctas',
        timestamp: new Date().toISOString(),
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

// Página principal
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Badelco SOAT API - Credenciales Correctas</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 0; background: #f5f5f5; }
                .container { max-width: 900px; margin: 40px auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #1e3a8a; margin-bottom: 10px; }
                .status { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: 600; margin: 20px 0; }
                .success { background: #10b981; color: white; }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 30px 0; }
                .info-card { background: #f9fafb; padding: 20px; border-radius: 8px; border: 1px solid #e5e7eb; }
                .info-card h3 { margin: 0 0 10px 0; color: #374151; }
                .test-btn { display: inline-block; background: #3b82f6; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin: 5px; }
                .test-btn:hover { background: #2563eb; }
                .ready { background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
                .credential { font-family: monospace; background: #f3f4f6; padding: 5px; border-radius: 4px; margin: 2px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚗 Badelco SOAT API <span class="ready">READY</span></h1>
                <p>Sistema con las credenciales correctas del API</p>
                
                <div class="status success">
                    ✅ Credenciales Configuradas Correctamente
                </div>
                
                <div class="info-grid">
                    <div class="info-card">
                        <h3>🔐 Credenciales API</h3>
                        <div class="credential"><strong>API_KEY:</strong> ${API_KEY.substring(0, 15)}...</div>
                        <div class="credential"><strong>SECRET_KEY:</strong> ${SECRET_KEY.substring(0, 20)}...</div>
                        <div class="credential"><strong>AUTH_TOKEN:</strong> ${AUTH_TOKEN.substring(0, 20)}...</div>
                        <div class="credential"><strong>PRODUCTO:</strong> ${COD_PRODUCTO} (Previsora)</div>
                    </div>
                    
                    <div class="info-card">
                        <h3>📊 Estado Token</h3>
                        <p><strong>Actual:</strong> ${currentToken.substring(0, 20)}...</p>
                        <p><strong>Tipo:</strong> ${isUsingFixedToken ? 'FIJO' : 'GENERADO'}</p>
                        <p><strong>Edad:</strong> ${Math.floor((new Date() - tokenGeneratedAt) / 60000)} min</p>
                    </div>
                </div>
                
                <div class="info-card">
                    <h3>🧪 Pruebas Disponibles</h3>
                    <a href="/api/test" class="test-btn">Test Simple</a>
                    <a href="/api/test-generate-token" class="test-btn" onclick="testGenerateToken(event)">Generar Token</a>
                    <a href="/api/info" class="test-btn">Info Sistema</a>
                </div>
                
                <div class="info-card">
                    <h3>✅ Funcionalidades:</h3>
                    <ul style="margin: 0; padding-left: 20px;">
                        <li>✅ Token fijo configurado (AUTH_TOKEN)</li>
                        <li>✅ Generación dinámica con API_KEY + SECRET_KEY</li>
                        <li>✅ Múltiples estrategias de headers</li>
                        <li>✅ Fallback automático</li>
                        <li>✅ Extracción inteligente de datos</li>
                        <li>✅ Debug completo de respuestas</li>
                    </ul>
                </div>
            </div>
            
            <script>
                async function testGenerateToken(e) {
                    e.preventDefault();
                    try {
                        const response = await fetch('/api/test-generate-token', { method: 'POST' });
                        const data = await response.json();
                        alert(JSON.stringify(data, null, 2));
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                }
            </script>
        </body>
        </html>
    `);
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