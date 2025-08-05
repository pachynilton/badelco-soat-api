// server.js - Versión simplificada y funcional
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================
// 🚨 CONFIGURACIÓN CORS SIMPLE
// ================================
app.use(cors({
    origin: '*', // Permitir todos los orígenes temporalmente
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));

// Middleware básico
app.use(express.json());
app.use(express.static('public'));

// Logs simples
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ================================
// 📡 CREDENCIALES API
// ================================
const API_BASE_URL = 'https://dev.same.com.co/api/public/';
const API_KEY = '208d8d63a622fd73fa6e39a9681c9333';
const SECRET_KEY = '$2y$10$18UjqB3SUjix.czNvc8Bu./ddlzUtaVx0oPqFd5o5iewEf1Qubhxa';
const AUTH_TOKEN = '8618118e414837738fc652595317a8e51ff2a06bf6daaa5e93abff7eb504ae69';
const COD_PRODUCTO = 63;

console.log('🔧 API configurada:', API_BASE_URL);

// ================================
// 📡 ENDPOINTS
// ================================

// Info endpoint
app.get('/api/info', (req, res) => {
    console.log('📊 Request a /api/info');
    
    try {
        res.json({
            status: 'READY',
            server: 'Badelco SOAT API - Simplificado',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            cors: {
                enabled: true,
                allowAll: true
            },
            endpoints: {
                info: 'GET /api/info',
                cotizar: 'POST /api/cotizar',
                test: 'GET /api/test'
            }
        });
    } catch (error) {
        console.error('Error en /api/info:', error);
        res.status(500).json({ error: 'Error interno', message: error.message });
    }
});

// Test endpoint
app.get('/api/test', async (req, res) => {
    console.log('🧪 Test endpoint');
    
    try {
        const testUrl = `${API_BASE_URL}soat`;
        const testParams = {
            numPlaca: 'EDR63F',
            codProducto: COD_PRODUCTO,
            codTipdoc: 1,
            numDocumento: '123456'
        };

        console.log('📡 Testing:', testUrl);
        console.log('📋 Params:', testParams);

        const response = await axios.get(testUrl, {
            headers: {
                'Auth-Token': AUTH_TOKEN,
                'Content-Type': 'application/json'
            },
            params: testParams,
            timeout: 10000
        });
        
        console.log('✅ Test exitoso:', response.status);

        res.json({
            success: true,
            message: 'Test exitoso',
            status: response.status,
            data: response.data
        });

    } catch (error) {
        console.error('❌ Error en test:', error.message);
        
        res.json({
            success: false,
            error: error.message,
            status: error.response?.status || 'sin status',
            details: error.response?.data || 'sin detalles'
        });
    }
});

// Cotizar endpoint
app.post('/api/cotizar', async (req, res) => {
    console.log('\n=== 🚀 NUEVA COTIZACIÓN ===');
    
    try {
        const { placa, documentType, documentNumber } = req.body;

        // Validación básica
        if (!placa || !documentType || !documentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Faltan datos: placa, documentType, documentNumber'
            });
        }

        console.log('📋 Datos:', { placa, documentType, documentNumber });

        // Preparar parámetros
        const cotizacionUrl = `${API_BASE_URL}soat`;
        const params = {
            numPlaca: placa.toUpperCase(),
            codProducto: COD_PRODUCTO,
            codTipdoc: getDocumentTypeCode(documentType),
            numDocumento: documentNumber
        };

        console.log('📡 URL:', cotizacionUrl);
        console.log('📋 Params:', params);

        // Hacer request al API
        const response = await axios.get(cotizacionUrl, {
            headers: {
                'Auth-Token': AUTH_TOKEN,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            params: params,
            timeout: 15000
        });
        
        console.log('✅ Respuesta exitosa:', response.status);
        console.log('📊 Data:', JSON.stringify(response.data, null, 2));

        // Procesar respuesta
        const cotizacionData = response.data;
        const precio = extractPrice(cotizacionData);
        const vehicleInfo = extractVehicleInfo(cotizacionData);

        console.log('💰 Precio extraído:', precio);

        // Respuesta final
        const responseData = {
            success: true,
            placa: placa.toUpperCase(),
            precio: precio,
            tipoVehiculo: vehicleInfo.tipo,
            marca: vehicleInfo.marca,
            modelo: vehicleInfo.modelo,
            cilindraje: vehicleInfo.cilindraje,
            año: vehicleInfo.año,
            inicioVigencia: new Date().toISOString(),
            finVigencia: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
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
                'Envía el comprobante por WhatsApp: 3128433999',
                'Incluye la placa del vehículo',
                'Recibirás tu SOAT en 24 horas',
                'Horario: Lunes a Sábado 9:00am - 6:00pm'
            ],
            debug: {
                originalResponse: cotizacionData,
                extractedPrice: precio,
                vehicleInfoCompleta: vehicleInfo
            }
        };

        console.log('✅ Enviando respuesta exitosa');
        res.json(responseData);

    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        console.error('Status:', error.response?.status);
        console.error('Data:', error.response?.data);
        
        res.status(error.response?.status || 500).json({
            success: false,
            message: error.message || 'Error al procesar cotización',
            error: error.response?.data || error.message,
            debug: {
                url: `${API_BASE_URL}soat`,
                hasToken: !!AUTH_TOKEN,
                timestamp: new Date().toISOString()
            }
        });
    }
});

// ================================
// 🛠️ FUNCIONES AUXILIARES
// ================================

function extractPrice(data) {
    console.log('🔍 Extrayendo precio de:', typeof data);
    
    // Si es array, usar primer elemento
    if (Array.isArray(data) && data.length > 0) {
        data = data[0];
    }
    
    // Buscar campos de precio
    const priceFields = [
        'TotalWithDiscountAmountFormatted', 'TotalAmountFormatted',
        'TotalWithDiscountAmount', 'TotalAmount', 'Premium', 'Price',
        'valor', 'precio', 'prima', 'total', 'costo'
    ];
    
    for (const field of priceFields) {
        if (data[field] !== undefined && data[field] !== null) {
            let value = data[field];
            
            // Si es string, limpiar formato
            if (typeof value === 'string') {
                value = value.replace(/[\$\s\.]/g, '').replace(',', '.');
            }
            
            const numValue = parseFloat(value);
            if (!isNaN(numValue) && numValue > 0) {
                console.log(`💰 Precio encontrado en '${field}':`, numValue);
                return numValue;
            }
        }
    }
    
    console.log('⚠️ No se encontró precio, usando 0');
    return 0;
}

function extractVehicleInfo(data) {
    // Si es array, usar primer elemento
    if (Array.isArray(data) && data.length > 0) {
        data = data[0];
    }
    
    return {
        tipo: data.VehicleClassName || data.tipoVehiculo || 'AUTOMOVIL',
        marca: data.BrandName || data.marca || 'N/A',
        modelo: data.VehicleLineDescription || data.modelo || 'N/A',
        cilindraje: data.CylinderCapacity || data.cilindraje || 'N/A',
        año: data.VehicleYear || data.año || new Date().getFullYear()
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
    console.log('🏠 Página principal');
    try {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } catch (error) {
        res.send(`
            <h1>Badelco SOAT API</h1>
            <p>Servidor funcionando correctamente</p>
            <p>Endpoints disponibles:</p>
            <ul>
                <li>GET /api/info</li>
                <li>GET /api/test</li>
                <li>POST /api/cotizar</li>
            </ul>
        `);
    }
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('💥 Error global:', err.message);
    res.status(500).json({
        error: 'Error interno del servidor',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// ================================
// 🚀 INICIAR SERVIDOR
// ================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================');
    console.log('🌟 BADELCO SOAT API - SIMPLIFICADO');
    console.log('🚀 ================================');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🔑 Token: ${AUTH_TOKEN.substring(0, 20)}...`);
    console.log(`🛡️ CORS: Habilitado para todos`);
    console.log('✅ Servidor listo');
    console.log('🚀 ================================\n');
});
