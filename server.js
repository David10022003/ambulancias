const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

// Asegurarse de que todas las rutas no-API devuelvan el index.html
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
        next();
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Configuración de base de datos
const dbConfig = {
    user: process.env.DB_USER || 'ambulancias',
    password: process.env.DB_PASSWORD || 'proyecto-2024',
    server: process.env.DB_SERVER || 'proyectoambulancias.database.windows.net',
    database: process.env.DB_NAME || 'ambulancias',
    options: {
        encrypt: true,
        trustServerCertificate: false,
        connectionTimeout: 30000,
        requestTimeout: 30000,
        pool: {
            max: 10,
            min: 2,
            idleTimeoutMillis: 30000
        }
    }
};

class EmergencyDataManager {
    constructor(config) {
        this.config = config;
        this.pool = null;
    }

    async initializePool() {
        try {
            this.pool = await sql.connect(this.config);
            console.log('Conexión a base de datos establecida');
        } catch (err) {
            console.error('Error al conectar base de datos:', err);
            setTimeout(() => this.initializePool(), 5000);
        }
    }

    async fetchEmergencyData() {
        if (!this.pool) {
            console.error('Conexión a base de datos no establecida');
            return [];
        }

        try {
            const query = `
                SELECT TOP 100 
                    ae.id, 
                    a.placa AS ambulancia_placa, 
                    ae.semaforo_id, 
                    ae.timestamp 
                FROM ambulance_events ae
                INNER JOIN ambulancias a ON ae.ambulancia_id = a.id
                ORDER BY ae.timestamp DESC
            `;

            const result = await this.pool.request().query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error al obtener datos:', error);
            return [];
        }
    }

    setupWebSocketServer(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', async (ws) => {
        console.log('Cliente WebSocket conectado');

        // Función para enviar datos
        const sendDataToClient = async () => {
            try {
                const data = await this.fetchEmergencyData();
                if (data.length > 0) {
                    ws.send(JSON.stringify(data));
                    console.log(`Datos enviados al cliente: ${data.length} registros`);
                }
            } catch (error) {
                console.error('Error al enviar datos:', error);
            }
        };

        // Enviar datos inmediatamente al conectar
        await sendDataToClient();

        // Configurar intervalo para enviar datos cada 5 segundos
        const intervalId = setInterval(sendDataToClient, 5000);

        // Limpiar intervalo cuando el socket se cierra
        ws.on('close', () => {
            clearInterval(intervalId);
            console.log('Cliente WebSocket desconectado');
        });

        ws.on('error', (error) => {
            clearInterval(intervalId);
            console.error('Error en conexión WebSocket:', error);
        });
    });

    return wss;
}

// Inicialización del servidor
async function startServer() {
    const dataManager = new EmergencyDataManager(dbConfig);
    await dataManager.initializePool();

    const server = http.createServer(app);
    const wss = dataManager.setupWebSocketServer(server);

    // Endpoint REST tradicional
    app.get('/api/emergency-data', async (req, res) => {
        try {
            const data = await dataManager.fetchEmergencyData();
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener datos' });
        }
    });

    // Endpoint de estado del servidor
    app.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            clients: wss.clients.size
        });
    });

    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`Servidor corriendo en puerto ${PORT}`);
        console.log(`Clientes WebSocket: ${wss.clients.size}`);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

startServer().catch(console.error);