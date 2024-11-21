// Configuración
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

// Estado global
let lastUpdateTime = null;
let currentData = [];
let ambulancesMap = {};
let trafficLightsMap = {};

// Elementos DOM
const ambulanciasActivas = document.getElementById('ambulancias-activas');
const semaforosActivos = document.getElementById('semaforos-activos');
const statusUpdates = document.getElementById('status-updates');
const eventsBody = document.getElementById('events-body');
const semaforosGrid = document.getElementById('semaforos-grid');

// Funciones auxiliares
function formatDate(dateString) {
    return new Date(dateString).toLocaleString('es-ES');
}

function createStatusItem(data) {
    const div = document.createElement('div');
    div.className = 'status-item';
    div.innerHTML = `
        <strong>Ambulancia ${data.ambulancia_placa}</strong> 
        pasó por Semáforo ${data.semaforo_id}
        <br>
        <small>${formatDate(data.timestamp)}</small>
    `;
    return div;
}

function createTrafficLight(id, status) {
    return `
    <div style="text-align: center; font-size:20px;">
        <div class="traffic-light" id="semaforo-${id}">
            <div class="light red ${status === 'red' ? 'active' : ''}"></div>
            <div class="light yellow ${status === 'yellow' ? 'active' : ''}"></div>
            <div class="light green ${status === 'green' ? 'active' : ''}"></div>
        </div>
        <div class="light-id">S${id}</div>
    </div>
    `;
}

function updateTrafficLights(data) {
    const uniqueSemaforos = [...new Set(data.map(item => item.semaforo_id))];
    semaforosGrid.innerHTML = '';
    
    uniqueSemaforos.forEach(id => {
        const status = 'red'; // Por defecto rojo, ajustar según lógica necesaria
        semaforosGrid.innerHTML += createTrafficLight(id, status);
    });
}

function createAmbulanceStatus(placa, status = 'active') {
    return `
    <div style="text-align: center; font-size:20px;">
        <div class="ambulance-status" id="ambulancia-${placa}">
            <div class="ambulance-icon ${status}">
                🚑
            </div>
            <div class="ambulance-id">${placa}</div>
        </div>
    </div>
    `;
}

function updateAmbulances(data) {
    const uniqueAmbulancias = [...new Set(data.map(item => item.ambulancia_placa))];
    const ambulanciasGrid = document.getElementById('ambulancias-grid');
    ambulanciasGrid.innerHTML = '';
    
    uniqueAmbulancias.forEach(placa => {
        ambulanciasGrid.innerHTML += createAmbulanceStatus(placa);
    });
}

function updateTable(data) {
    eventsBody.innerHTML = '';
    
    data.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.id}</td>
            <td>🚑 ${row.ambulancia_placa}</td>
            <td>🚦 ${row.semaforo_id}</td>
            <td>${formatDate(row.timestamp)}</td>
            <td><span class="status-badge status-active">Activo</span></td>
        `;
        eventsBody.appendChild(tr);
    });
}

function updateStats(data) {
    const ambulanciasUnicas = new Set(data.map(d => d.ambulancia_placa));
    const semaforosUnicos = new Set(data.map(d => d.semaforo_id));
    
    ambulanciasActivas.textContent = ambulanciasUnicas.size;
    semaforosActivos.textContent = semaforosUnicos.size;
}

function updateStatusFeed(newData) {
    // Filtrar solo nuevos eventos
    const lastUpdate = lastUpdateTime ? new Date(lastUpdateTime) : new Date(0);
    const newEvents = newData.filter(item => new Date(item.timestamp) > lastUpdate);
    
    newEvents.forEach(event => {
        statusUpdates.insertBefore(createStatusItem(event), statusUpdates.firstChild);
    });
    
    // Mantener solo los últimos 50 eventos
    while (statusUpdates.children.length > 50) {
        statusUpdates.removeChild(statusUpdates.lastChild);
    }
    
    if (newEvents.length > 0) {
        lastUpdateTime = newEvents[0].timestamp;
    }
}

// Función para conexión WebSocket
function conectarWebSocket() {
    const socket = new WebSocket(WS_URL);

    socket.onopen = function(e) {
        console.log('Conexión WebSocket establecida');
        // Opcional: añadir indicador visual de conexión
        document.getElementById('connection-status').textContent = 'Conectado ✅';
    };

    socket.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
 		 console.log('Datos recibidos:', data);
            
            currentData = data;

            data.forEach(item => {
                ambulancesMap[item.ambulancia_placa] = `Ambulancia ${item.ambulancia_placa}`;
                trafficLightsMap[item.semaforo_id] = `Semáforo ${item.semaforo_id}`;
            });
            
            updateStats(data);
            updateTable(data);
            updateStatusFeed(data);
            updateTrafficLights(data);
            updateAmbulances(data);
        } catch (error) {
            console.error('Error procesando datos:', error);
        }
    };

    socket.onclose = function(event) {
        if (event.wasClean) {
            console.log(`Conexión cerrada limpiamente, código=${event.code} razón=${event.reason}`);
        } else {
            console.log('Conexión WebSocket interrumpida');
            // Intentar reconectar después de un tiempo
            document.getElementById('connection-status').textContent = 'Desconectado ❌';
            setTimeout(conectarWebSocket, 5000);
        }
    };

    socket.onerror = function(error) {
        console.error(`Error WebSocket: ${error.message}`);
        document.getElementById('connection-status').textContent = 'Error de conexión ❌';
    };
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    conectarWebSocket();
});

// Manejo de errores global
window.addEventListener('error', function(event) {
    console.error('Error capturado:', event.error);
});