const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

// Ensure all non-API routes return index.html
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
        next();
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Database Configuration
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
        this.lastFetchTimestamp = null;
    }

    async initializePool() {
        try {
            this.pool = await sql.connect(this.config);
            console.log('Database connection established');
        } catch (err) {
            console.error('Database connection error:', err);
            setTimeout(() => this.initializePool(), 5000);
        }
    }

    async fetchEmergencyData() {
        if (!this.pool) {
            console.error('Database connection not established');
            return [];
        }

        try {
            // Fetch events from the last 30 minutes, or all events if this is the first fetch
            const query = this.lastFetchTimestamp ? `
                SELECT 
                    ae.id, 
                    a.placa AS ambulancia_placa, 
                    ae.semaforo_id, 
                    ae.timestamp 
                FROM ambulance_events ae
                INNER JOIN ambulancias a ON ae.ambulancia_id = a.id
                WHERE ae.timestamp > @lastFetchTimestamp
                ORDER BY ae.timestamp DESC
            ` : `
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
            if (this.lastFetchTimestamp) {
                request.input('lastFetchTimestamp', sql.DateTime, this.lastFetchTimestamp);
            }

            const result = await request.query(query);
            
            // Update last fetch timestamp to the most recent event's timestamp
            if (result.recordset.length > 0) {
                this.lastFetchTimestamp = result.recordset[0].timestamp;
            }

            console.log(`Fetched ${result.recordset.length} new records`);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching data:', error);
            return [];
        }
    }

    setupWebSocketServer(server) {
        const wss = new WebSocket.Server({ server });

        wss.on('connection', async (ws) => {
            console.log('WebSocket client connected');

            const sendDataToClient = async () => {
                try {
                    const data = await this.fetchEmergencyData();
                    if (data.length > 0) {
                        ws.send(JSON.stringify(data));
                        console.log(`Sent ${data.length} records to client`);
                    }
                } catch (error) {
                    console.error('Error sending data:', error);
                }
            };

            // Send data immediately on connection
            await sendDataToClient();

            // Send data every 5 seconds
            const intervalId = setInterval(sendDataToClient, 5000);

            ws.on('close', () => {
                clearInterval(intervalId);
                console.log('WebSocket client disconnected');
            });

            ws.on('error', (error) => {
                clearInterval(intervalId);
                console.error('WebSocket connection error:', error);
            });
        });

        return wss;
    }
}

async function startServer() {
    const dataManager = new EmergencyDataManager(dbConfig);
    await dataManager.initializePool();

    const server = http.createServer(app);
    const wss = dataManager.setupWebSocketServer(server);

    // Traditional REST endpoint
    app.get('/api/emergency-data', async (req, res) => {
        try {
            const data = await dataManager.fetchEmergencyData();
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Error fetching data' });
        }
    });

    // Server health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            clients: wss.clients.size
        });
    });

    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`WebSocket clients: ${wss.clients.size}`);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

startServer().catch(console.error);