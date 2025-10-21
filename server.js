const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// --- Configuration ---
const PORT = 7654;
const LOG_DIR = './logs';

// --- Initialization ---
// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

// --- Middleware ---
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- Helper Functions ---
function sanitizeResourceName(resourceName) {
    if (!resourceName || typeof resourceName !== 'string') {
        return 'unknown_resource';
    }
    return resourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function writeLog(resource, data) {
    const safeResource = sanitizeResourceName(resource);
    const logFilePath = path.join(LOG_DIR, `${safeResource}.jsonl`);
    const logEntry = { timestamp: new Date().toISOString(), ...data };
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(logFilePath, logLine);

    const icons = { 'lua_to_nui': '📨', 'nui_to_lua': '📤', 'fetch_call': '🌐', 'console': '🖥️' };
    const icon = icons[data.type] || '📝';
    const logData = data.data || data.event || data.callback || data.url;
    console.log(`${icon} [${safeResource} - ${data.type}]`, JSON.stringify(logData, null, 2));
}

// --- API Endpoints ---

// Main logging endpoint
app.post('/log', (req, res) => {
    try {
        const { resource, ...logData } = req.body;
        if (!resource) {
            return res.status(400).json({ error: 'Resource name is required.' });
        }
        writeLog(resource, logData);
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error logging data:', error);
        res.status(500).json({ error: error.message });
    }
});

// API for log data
app.get('/logs', (req, res) => {
    try {
        const { resource } = req.query;
        if (!resource) {
            const files = fs.readdirSync(LOG_DIR)
                .filter(file => file.endsWith('.jsonl'))
                .map(file => file.replace('.jsonl', ''));
            return res.json(files);
        }
        const safeResource = sanitizeResourceName(resource);
        const logFilePath = path.join(LOG_DIR, `${safeResource}.jsonl`);
        if (!fs.existsSync(logFilePath)) return res.json([]);

        const logs = fs.readFileSync(logFilePath, 'utf8')
            .split('\n').filter(line => line.trim())
            .map(line => JSON.parse(line)).slice(-200);
        res.json(logs);
    } catch (error) {
        console.error(`❌ Error reading logs for "${req.query.resource}":`, error);
        res.status(500).json({ error: error.message });
    }
});

// Clear logs for a specific resource
app.post('/clear', (req, res) => {
    try {
        const { resource } = req.body;
        if (!resource) return res.status(400).json({ error: 'Resource name is required.' });

        const safeResource = sanitizeResourceName(resource);
        const logFilePath = path.join(LOG_DIR, `${safeResource}.jsonl`);
        if (fs.existsSync(logFilePath)) {
            fs.writeFileSync(logFilePath, '');
            console.log(`🗑️ Logs cleared for resource: ${safeResource}`);
            return res.json({ message: `Logs cleared for ${safeResource}` });
        }
        return res.status(404).json({ message: `No logs found for ${safeResource}` });
    } catch (error) {
        console.error(`❌ Error clearing logs for "${req.body.resource}":`, error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'running', logDirectory: LOG_DIR, timestamp: new Date().toISOString() });
});

// --- NEW: Interactive Log Viewer ---
app.get('/', (req, res) => res.redirect('/view'));

app.get('/view', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FiveM NUI Log Viewer</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { scrollbar-width: thin; scrollbar-color: #4b5563 #1f2937; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1f2937; }
        ::-webkit-scrollbar-thumb { background-color: #4b5563; border-radius: 4px; }
        .log-type-lua_to_nui  { border-left-color: #3b82f6; }
        .log-type-nui_to_lua  { border-left-color: #22c55e; }
        .log-type-fetch_call  { border-left-color: #eab308; }
        .log-type-console     { border-left-color: #a855f7; }
    </style>
</head>
<body class="bg-gray-900 text-gray-300 font-mono">
<div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-1/4 h-screen bg-gray-800 p-4 overflow-y-auto">
        <h1 class="text-xl font-bold text-white mb-4">Resources</h1>
        <div id="resource-list" class="flex flex-col space-y-2">
            <!-- Resources will be populated here -->
        </div>
    </div>

    <!-- Main Content -->
    <div class="w-3/4 h-screen flex flex-col">
        <div id="log-header" class="p-4 bg-gray-800 border-b border-gray-700 flex items-center justify-between hidden">
            <h2 class="text-lg font-bold text-white">Logs for <span id="current-resource" class="text-cyan-400"></span></h2>
            <div>
                <label class="mr-4">
                    <input type="checkbox" id="auto-refresh" class="align-middle"> Auto-refresh
                </label>
                <button id="clear-logs-btn" class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
                    Clear Logs
                </button>
            </div>
        </div>
        <div id="log-container" class="flex-grow p-4 overflow-y-auto">
            <div id="placeholder" class="text-gray-500">Select a resource to view logs.</div>
        </div>
    </div>
</div>

<script>
    const resourceList = document.getElementById('resource-list');
    const logContainer = document.getElementById('log-container');
    const logHeader = document.getElementById('log-header');
    const currentResourceSpan = document.getElementById('current-resource');
    const placeholder = document.getElementById('placeholder');
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    const autoRefreshCheckbox = document.getElementById('auto-refresh');

    let activeResource = null;
    let refreshInterval = null;

    const typeColors = {
        'lua_to_nui': 'text-blue-400',
        'nui_to_lua': 'text-green-400',
        'fetch_call': 'text-yellow-400',
        'console':    'text-purple-400',
    };

    async function fetchResources() {
        try {
            const response = await fetch('/logs');
            const resources = await response.json();
            resourceList.innerHTML = '';
            resources.sort().forEach(resource => {
                const button = document.createElement('button');
                button.textContent = resource;
                button.dataset.resource = resource;
                button.className = 'text-left p-2 rounded hover:bg-gray-700 focus:outline-none focus:bg-cyan-500 focus:text-white';
                button.onclick = () => selectResource(resource);
                resourceList.appendChild(button);
            });
        } catch (error) {
            console.error('Failed to fetch resources:', error);
            resourceList.innerHTML = '<div class="text-red-400">Error loading resources.</div>';
        }
    }

    async function fetchLogs(resource) {
        if (!resource) return;
        try {
            const response = await fetch(\`/logs?resource=\${resource}\`);
            const logs = await response.json();
            logContainer.innerHTML = '';

            if (logs.length === 0) {
                logContainer.innerHTML = '<div class="text-gray-500">No logs for this resource.</div>';
                return;
            }
            
            logs.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry bg-gray-800 p-3 rounded mb-2 border-l-4 ' + ('log-type-' + log.type);
                
                const data = log.data || log.event || log.callback || { url: log.url, options: log.options };
                const formattedData = JSON.stringify(data, null, 2);
                
                logEntry.innerHTML = \`
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold \${typeColors[log.type] || ''}">\${log.type}</span>
                        <span class="text-xs text-gray-500">\${new Date(log.timestamp).toLocaleString()}</span>
                    </div>
                    <pre class="text-sm whitespace-pre-wrap"><code>\${formattedData}</code></pre>
                \`;
                logContainer.appendChild(logEntry);
            });
        } catch (error) {
            console.error('Failed to fetch logs:', error);
            logContainer.innerHTML = '<div class="text-red-400">Error loading logs.</div>';
        }
    }

    function selectResource(resource) {
        activeResource = resource;
        currentResourceSpan.textContent = resource;
        logHeader.classList.remove('hidden');
        placeholder.classList.add('hidden');
        
        document.querySelectorAll('#resource-list button').forEach(btn => {
            if (btn.dataset.resource === resource) {
                btn.classList.add('bg-cyan-500', 'text-white');
            } else {
                btn.classList.remove('bg-cyan-500', 'text-white');
            }
        });

        fetchLogs(resource);
        if (autoRefreshCheckbox.checked) {
            startAutoRefresh();
        }
    }
    
    async function clearLogs() {
        if (!activeResource || !confirm(\`Are you sure you want to clear all logs for \${activeResource}?\`)) return;
        try {
            await fetch('/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource: activeResource })
            });
            fetchLogs(activeResource); // Refresh logs
        } catch(error) {
            console.error("Failed to clear logs:", error);
        }
    }

    function startAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (activeResource) {
            refreshInterval = setInterval(() => fetchLogs(activeResource), 2000);
        }
    }

    function stopAutoRefresh() {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    clearLogsBtn.addEventListener('click', clearLogs);
    autoRefreshCheckbox.addEventListener('change', () => {
        if (autoRefreshCheckbox.checked) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });

    // Initial load
    fetchResources();
    setInterval(fetchResources, 5000); // Refresh resource list every 5 seconds
</script>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});


// --- Server Start ---
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   🎮 FiveM NUI Interceptor Logger Server   ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    console.log(`✅ Server running, access the viewer at: http://localhost:${PORT}/view`);
    console.log(`📁 Logging to directory: ${LOG_DIR}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /log         - Receive NUI intercepts`);
    console.log(`  GET  /logs        - API: List all resources with logs`);
    console.log(`  GET  /logs?resource=<name> - API: View last 200 logs for a resource`);
    console.log(`  POST /clear       - API: Clear logs for a resource`);
    console.log(`  GET  /health      - Health check\n`);
    console.log('📡 Waiting for NUI data...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
});

