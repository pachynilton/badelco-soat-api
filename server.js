// server.js - Versión Producción (Sin logs de debug)
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
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
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Demasiadas solicitudes, intenta más tarde',
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

const cotizacionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Límite de cotizaciones excedido, espera un minuto'
});

app.use('/api/cotizar', cotizacionLimiter);

// CORS configuration
app.use(cors({ 
    origin: [
        'https://badelco-soat-api-production.up.railway.app',
        'http://localhost:3000',
        'http://localhost:5500',
        'http://localhost:5501'
    ], 
    credentials: true 
}));

app.use(express.json());
app.use(express.static('public'));

// API Credentials
const API_BASE_URL = 'https://dev.same.com.co/api/public/';
const API_KEY = '208d8d63a622fd73fa6e39a9681c9333';
const SECRET_KEY = '$2y$10$18UjqB3SUjix.czNvc8Bu./ddlzUtaVx0oPqFd5o5iewEf1Qubhxa';
const AUTH_TOKEN = '8618118e414837738fc652595317a8e51ff2a06bf6daaa5e93abff7eb504ae69';
const COD_PRODUCTO = 63;

// Token management
let currentToken = AUTH_TOKEN;
let tokenGeneratedAt = new Date();
let isUsingFixedToken = true;

// Generate new token function
async function generateNewToken() {
    try {
        const tokenEndpoints = ['token', 'auth/token', 'authenticate', 'login'];
        
        for (const endpoint of tokenEndpoints) {
            const tokenUrl = API_BASE_URL + endpoint;
            
            try {
                // GET method
                let response = await axios.get(tokenUrl, {
                    headers: {
                        'secretkey': SECRET_KEY,
                        'apikey': API_KEY,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000,
                    validateStatus: () => true
                });
                
                if (response.status === 200 && response.data) {
                    const token = response.data.AuthToken || response.data.authToken || response.data.token;
                    if (token) {
                        currentToken = token;
                        tokenGeneratedAt = new Date();
                        isUsingFixedToken = false;
                        return token;
                    }
                }
                
                // POST method
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
                
                if (response.status === 200 && response.data) {
                    const token = response.data.AuthToken || response.data.authToken || response.data.token;
                    if (token) {
                        currentToken = token;
                        tokenGeneratedAt = new Date();
                        isUsingFixedToken = false;
                        return token;
                    }
                }
                
            } catch (error) {
                // Silent error handling
            }
        }
        
        return AUTH_TOKEN;
        
    } catch (error) {
        return AUTH_TOKEN;
    }
}

// Get valid token
async function getValidToken() {
    if (isUsingFixedToken && (new Date() - tokenGeneratedAt) > 3600000) {
        return await generateNewToken();
    }
    return currentToken;
}

// Main SOAT quotation endpoint
app.post('/api/cotizar', async (req, res) => {
    try {
        const { placa, documentType, documentNumber, nombre, email, telefono } = req.body;

        if (!placa || !documentType || !documentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos requeridos: placa, documentType y documentNumber'
            });
        }

        const token = await getValidToken();

        const cotizacionUrl = `${API_BASE_URL}soat`;
        const params = {
            numPlaca: placa.toUpperCase(),
            codProducto: COD_PRODUCTO,
            codTipdoc: getDocumentTypeCode(documentType),
            numDocumento: documentNumber
        };

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
                cotizacionResponse = await axios.get(cotizacionUrl, {
                    headers: {
                        ...strategy.headers,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    params: params,
                    timeout: 15000
                });
                
                break;
                
            } catch (error) {
                lastError = error;
                
                if (error.response?.status === 401 && isUsingFixedToken) {
                    try {
                        const newToken = await generateNewToken();
                        strategy.headers[Object.keys(strategy.headers)[0]] = newToken;
                        
                        cotizacionResponse = await axios.get(cotizacionUrl, {
                            headers: {
                                ...strategy.headers,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            },
                            params: params,
                            timeout: 15000
                        });
                        
                        break;
                        
                    } catch (retryError) {
                        lastError = retryError;
                    }
                }
            }
        }

        if (!cotizacionResponse) {
            throw lastError;
        }

        const cotizacionData = cotizacionResponse.data;
        const precio = extractPrice(cotizacionData);
        const vehicleInfo = extractVehicleInfo(cotizacionData);
        const dates = extractDates(cotizacionData);

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
                'Horario de expedición - Lunes a Sábado: 9:00am - 6:00pm'
            ],
            metadata: {
                timestamp: new Date().toISOString(),
                numeroReferencia: `SOAT-${placa.toUpperCase()}-${Date.now()}`,
                tokenType: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                tokenAge: Math.floor((new Date() - tokenGeneratedAt) / 60000) + ' minutos'
            }
        };

        res.json(responseData);

    } catch (error) {
        res.status(error.response?.status || 500).json({
            success: false,
            message: error.response?.data?.message || error.message || 'Error al procesar la cotización',
            error: error.response?.data
        });
    }
});

// Test endpoint
app.get('/api/test', async (req, res) => {
    try {
        const token = await getValidToken();
        const testUrl = `${API_BASE_URL}soat`;
        const testParams = {
            numPlaca: 'EDR63F',
            codProducto: COD_PRODUCTO,
            codTipdoc: 1,
            numDocumento: '123456'
        };

        const response = await axios.get(testUrl, {
            headers: {
                'Auth-Token': token,
                'Content-Type': 'application/json'
            },
            params: testParams,
            timeout: 10000
        });

        res.json({
            success: true,
            message: 'Test exitoso',
            status: response.status,
            data: response.data,
            extractedPrice: extractPrice(response.data),
            tokenInfo: {
                type: isUsingFixedToken ? 'FIJO' : 'GENERADO',
                preview: token.substring(0, 30) + '...'
            }
        });

    } catch (error) {
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

// Token generation test
app.post('/api/test-generate-token', async (req, res) => {
    try {
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

// Helper functions
function extractPrice(data) {
    const priceFields = [
        'valor', 'precio', 'prima', 'precioTotal', 'total', 'costo',
        'valorTotal', 'primaNeta', 'valorPrima', 'valorSOAT',
        'costoSOAT', 'primaSOAT', 'montoTotal'
    ];
    
    for (const field of priceFields) {
        if (data[field] !== undefined && data[field] !== null) {
            const value = parseFloat(data[field]);
            if (!isNaN(value) && value > 0) {
                return value;
            }
        }
        
        if (data.data && data.data[field] !== undefined) {
            const value = parseFloat(data.data[field]);
            if (!isNaN(value) && value > 0) {
                return value;
            }
        }
    }
    
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
        server: 'Badelco SOAT API - Production',
        timestamp: new Date().toISOString(),
        endpoints: {
            test: 'GET /api/test',
            testGenerateToken: 'POST /api/test-generate-token',
            cotizar: 'POST /api/cotizar',
            info: 'GET /api/info'
        }
    });
});

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    // Silent start for production
});
