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
        this.lastCheckTime = null;
        this.clients = new Set();
        this.pollingInterval = 10 * 60 * 1000; // 10 minutos en milisegundos
    }

    async initializePool() {
        try {
            this.pool = await sql.connect(this.config);
            console.log('Conexión a base de datos establecida');
        } catch (err) {
            console.error('Error al conectar base de datos:', err);
            // Reintentar conexión
            setTimeout(() => this.initializePool(), 5000);
        }
    }

    async fetchEmergencyData() {
        if (!this.pool) {
            console.error('Conexión a base de datos no establecida');
            return [];
        }

        try {
            const query = this.lastCheckTime 
                ? `
                    SELECT TOP 100 
                        ae.id, 
                        a.placa AS ambulancia_placa, 
                        ae.semaforo_id, 
                        ae.timestamp 
                    FROM ambulance_events ae
                    INNER JOIN ambulancias a ON ae.ambulancia_id = a.id
                    WHERE ae.timestamp > @lastCheckTime
                    ORDER BY ae.timestamp DESC
                `
                : `
                    SELECT TOP 100 
                        ae.id, 
                        a.placa AS ambulancia_placa, 
                        ae.semaforo_id, 
                        ae.timestamp 
                    FROM ambulance_events ae
                    INNER JOIN ambulancias a ON ae.ambulancia_id = a.id
                    ORDER BY ae.timestamp DESC
                `;

            const request = this.pool.request();
            if (this.lastCheckTime) {
                request.input('lastCheckTime', sql.DateTime, this.lastCheckTime);
            }

            const result = await request.query(query);
            
            if (result.recordset.length > 0) {
                this.lastCheckTime = result.recordset[0].timestamp;
            }

            return result.recordset;
        } catch (error) {
            console.error('Error al obtener datos:', error);
            return [];
        }
    }

    async sendDataToClient(ws) {
        try {
            const data = await this.fetchEmergencyData();
            if (data.length > 0 && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
                console.log(`Datos enviados al cliente: ${data.length} registros`);
            }
        } catch (error) {
            console.error('Error al enviar datos al cliente:', error);
        }
    }

    async broadcastToAll() {
        try {
            const data = await this.fetchEmergencyData();
            if (data.length > 0) {
                this.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(data));
                    }
                });
                console.log(`Datos transmitidos a ${this.clients.size} clientes`);
            }
        } catch (error) {
            console.error('Error en broadcast:', error);
        }
    }

    setupWebSocketServer(server) {
        const wss = new WebSocket.Server({ server });

        wss.on('connection', (ws) => {
            console.log('Cliente WebSocket conectado');
            this.clients.add(ws);

            // Enviar datos inmediatamente al conectar
            this.sendDataToClient(ws);

            // Configurar polling individual para este cliente
            const pollInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    this.sendDataToClient(ws);
                } else {
                    clearInterval(pollInterval);
                }
            }, this.pollingInterval);

            ws.on('close', () => {
                console.log('Cliente WebSocket desconectado');
                this.clients.delete(ws);
                clearInterval(pollInterval);
            });

            ws.on('error', (error) => {
                console.error('Error en conexión WebSocket:', error);
                clearInterval(pollInterval);
                this.clients.delete(ws);
            });
        });

        return wss;
    }
}

// Inicialización del servidor
async function startServer() {
    const dataManager = new EmergencyDataManager(dbConfig);
    await dataManager.initializePool();

    // Crear servidor HTTP
    const server = http.createServer(app);

    // Configurar WebSocket
    const wss = dataManager.setupWebSocketServer(server);

    // Endpoint REST tradicional (opcional, para compatibilidad)
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

    // Iniciar servidor
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`Servidor corriendo en puerto ${PORT}`);
        console.log(`Clientes WebSocket: ${wss.clients.size}`);
    });

    // Manejo de errores de proceso
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

// Iniciar servidor
startServer().catch(console.error);