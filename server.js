const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const app = express();

// --- Configuration ---
const PORT = 7654;
const LOG_DIR = './logs';
const VIEWER_PIN = '280824'; // Your PIN
const AUTH_COOKIE_NAME = 'nui-logger-auth';

// --- Initialization ---
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

// --- Middleware ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Authentication Middleware ---
const checkAuth = (req, res, next) => {
    if (req.cookies[AUTH_COOKIE_NAME] === VIEWER_PIN) {
        return next();
    }
    res.redirect('/login');
};

// --- Helper Functions ---
function sanitizeName(name) { // Renamed from sanitizeResourceName
    if (!name || typeof name !== 'string') return 'unknown';
    return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function writeLog(server, resource, data) {
    const safeServer = sanitizeName(server || 'default_server');
    const safeResource = sanitizeName(resource);
    
    // Create server directory if it doesn't exist
    const serverDir = path.join(LOG_DIR, safeServer);
    if (!fs.existsSync(serverDir)) {
        fs.mkdirSync(serverDir, { recursive: true });
    }

    const logFilePath = path.join(serverDir, `${safeResource}.jsonl`);
    const logEntry = { timestamp: new Date().toISOString(), ...data };
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(logFilePath, logLine);

    const icons = { 'lua_to_nui': '📨', 'nui_to_lua': '📤', 'fetch_call': '🌐', 'console': '🖥️' };
    const icon = icons[data.type] || '📝';
    const logData = data.data || data.event || data.callback || data.url;
    console.log(`${icon} [${safeServer} / ${safeResource} - ${data.type}]`, JSON.stringify(logData, null, 2));
}

// --- API Endpoints ---

// Main logging endpoint
app.post('/log', (req, res) => {
    try {
        const server = req.body.server;
        let actualResource = req.body.resource;
        const logData = { ...req.body };
        delete logData.resource;
        delete logData.server;

        try {
            let urlToParse = null;
            if (logData.type === 'nui_to_lua' && logData.callback) {
                urlToParse = logData.callback;
            } else if (logData.type === 'fetch_call' && typeof logData.url === 'string') {
                urlToParse = logData.url;
            }

            if (urlToParse) {
                const match = urlToParse.match(/^https?:\/\/([a-zA-Z0-9_-]+)\//);
                if (match && match[1]) {
                    actualResource = match[1];
                }
            }
        } catch (e) {
            console.warn('Error parsing resource from log data:', e);
        }

        if (!actualResource) {
            return res.status(400).json({ error: 'Resource name is required.' });
        }
        
        writeLog(server, actualResource, logData); // Use server and resource
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error logging data:', error);
        res.status(500).json({ error: error.message });
    }
});

// API for log data
app.get('/logs', checkAuth, (req, res) => {
    try {
        const { server, resource } = req.query;

        if (server && resource) {
            // Case 1: Get logs for a specific resource on a specific server
            const safeServer = sanitizeName(server);
            const safeResource = sanitizeName(resource);
            const logFilePath = path.join(LOG_DIR, safeServer, `${safeResource}.jsonl`);
            
            if (!fs.existsSync(logFilePath)) return res.json([]);

            const logs = fs.readFileSync(logFilePath, 'utf8')
                .split('\n').filter(line => line.trim())
                .map(line => JSON.parse(line)).slice(-200);
            return res.json(logs);

        } else if (server) {
            // Case 2: Get all resources for a specific server
            const safeServer = sanitizeName(server);
            const serverDir = path.join(LOG_DIR, safeServer);
            
            if (!fs.existsSync(serverDir) || !fs.statSync(serverDir).isDirectory()) {
                return res.json([]);
            }

            const files = fs.readdirSync(serverDir)
                .filter(file => file.endsWith('.jsonl'))
                .map(file => file.replace('.jsonl', ''));
            return res.json(files);

        } else {
            // Case 3: Get all servers (directories)
            const dirs = fs.readdirSync(LOG_DIR, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);
            return res.json(dirs);
        }
    } catch (error) {
        console.error(`❌ Error reading logs for "${req.query.server} / ${req.query.resource}":`, error);
        res.status(500).json({ error: error.message });
    }
});

// Clear logs for a specific resource
app.post('/clear', checkAuth, (req, res) => {
    try {
        const { server, resource } = req.body;
        if (!server) return res.status(400).json({ error: 'Server name is required.' });
        if (!resource) return res.status(400).json({ error: 'Resource name is required.' });

        const safeServer = sanitizeName(server);
        const safeResource = sanitizeName(resource);
        const logFilePath = path.join(LOG_DIR, safeServer, `${safeResource}.jsonl`);

        if (fs.existsSync(logFilePath)) {
            fs.writeFileSync(logFilePath, '');
            console.log(`🗑️ Logs cleared for: ${safeServer} / ${safeResource}`);
            return res.json({ message: `Logs cleared for ${safeServer} / ${safeResource}` });
        }
        return res.status(404).json({ message: `No logs found for ${safeServer} / ${safeResource}` });
    } catch (error) {
        console.error(`❌ Error clearing logs for "${req.body.server} / ${req.body.resource}":`, error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'running', logDirectory: LOG_DIR, timestamp: new Date().toISOString() });
});

// --- Login Page Endpoints ---
app.get('/login', (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NUI Logger - Login</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-900 text-gray-300 font-mono h-screen flex items-center justify-center">
    <form class="bg-gray-800 p-8 rounded-lg shadow-lg" method="POST" action="/login">
        <h1 class="text-white text-2xl font-bold mb-6 text-center">NUI Log Viewer</h1>
        <label for="pin" class="block text-sm font-medium mb-2">Enter PIN</label>
        <input type="password" id="pin" name="pin" class="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500" autofocus>
        <button type="submit" class="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded mt-6">Login</button>
    </form>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

app.post('/login', (req, res) => {
    const { pin } = req.body;
    if (pin === VIEWER_PIN) {
        res.cookie(AUTH_COOKIE_NAME, VIEWER_PIN, {
            httpOnly: true,
            secure: req.protocol === 'https',
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
        res.redirect('/view');
    } else {
        res.redirect('/login');
    }
});

// --- Interactive Log Viewer ---
app.get('/', (req, res) => res.redirect('/view'));

// Main viewer page
app.get('/view', checkAuth, (req, res) => {
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
        #toast-notification { transition: opacity 0.3s ease-in-out; }
    </style>
</head>
<body class="bg-gray-900 text-gray-300 font-mono">
<div class="flex h-screen">
    <!-- Server List -->
    <div class="w-1/4 h-screen bg-gray-800 p-4 overflow-y-auto">
        <h1 class="text-xl font-bold text-white mb-4">Servers</h1>
        <div id="server-list" class="flex flex-col space-y-2"></div>
    </div>

    <!-- Resource List -->
    <div class="w-1/4 h-screen bg-gray-800 p-4 overflow-y-auto border-l border-gray-700">
        <h1 class="text-xl font-bold text-white mb-4">Resources</h1>
        <div id="resource-list" class="flex flex-col space-y-2"></div>
    </div>

    <!-- Main Content -->
    <div class="w-1/2 h-screen flex flex-col">
        <div id="log-header" class="p-4 bg-gray-800 border-b border-gray-700 flex items-center justify-between hidden">
            <h2 class="text-lg font-bold text-white">
                Logs for <span id="current-server" class="text-cyan-400"></span> / <span id="current-resource" class="text-cyan-400"></span>
            </h2>
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
            <div id="placeholder" class="text-gray-500">Select a server and resource to view logs.</div>
        </div>
    </div>
</div>

<script>
    const serverList = document.getElementById('server-list');
    const resourceList = document.getElementById('resource-list');
    const logContainer = document.getElementById('log-container');
    const logHeader = document.getElementById('log-header');
    const currentServerSpan = document.getElementById('current-server');
    const currentResourceSpan = document.getElementById('current-resource');
    const placeholder = document.getElementById('placeholder');
    const clearLogsBtn = document.getElementById('clear-logs-btn');
    const autoRefreshCheckbox = document.getElementById('auto-refresh');

    let activeServer = null;
    let activeResource = null;
    let refreshInterval = null;

    const typeColors = {
        'lua_to_nui': 'text-blue-400',
        'nui_to_lua': 'text-green-400',
        'fetch_call': 'text-yellow-400',
        'console':    'text-purple-400',
    };

    // --- Notification and Clipboard Helpers ---
    function showToast(message, isError = false) {
        const existingToast = document.getElementById('toast-notification');
        if (existingToast) existingToast.remove();
        const toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = \`fixed top-5 right-5 text-white py-2 px-4 rounded shadow-lg z-50 \${isError ? 'bg-red-500' : 'bg-green-500'}\`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => { if(toast.parentElement) document.body.removeChild(toast); }, 300);
        }, 2000);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'), () => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed'; textArea.style.top = '0'; textArea.style.left = '0'; textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus(); textArea.select();
        try {
            document.execCommand('copy');
            showToast('Copied to clipboard!');
        } catch (err) {
            showToast('Failed to copy.', true);
        }
        document.body.removeChild(textArea);
    }
    // --- End Helpers ---

    async function fetchServers() {
        try {
            const response = await fetch('/logs');
            const servers = await response.json();
            updateList(serverList, servers, selectServer);
        } catch (error) {
            console.error('Failed to fetch servers:', error);
            serverList.innerHTML = '<div class="text-red-400">Error loading servers.</div>';
        }
    }

    async function fetchResources(server) {
        if (!server) {
            resourceList.innerHTML = '';
            return;
        }
        try {
            const response = await fetch(\`/logs?server=\${server}\`);
            const resources = await response.json();
            updateList(resourceList, resources, (resource) => selectResource(server, resource));
        } catch (error) {
            console.error('Failed to fetch resources:', error);
            resourceList.innerHTML = '<div class="text-red-400">Error loading resources.</div>';
        }
    }
    
    function updateList(listElement, items, onClickHandler) {
        const currentButtons = new Set(Array.from(listElement.children).map(btn => btn.dataset.name));
        items.sort().forEach(item => {
            if (!currentButtons.has(item)) {
                const button = document.createElement('button');
                button.textContent = item;
                button.dataset.name = item;
                button.className = 'text-left p-2 rounded hover:bg-gray-700 focus:outline-none focus:bg-cyan-500 focus:text-white transition-colors';
                button.onclick = () => onClickHandler(item);
                listElement.appendChild(button);
            }
            currentButtons.delete(item);
        });
        currentButtons.forEach(itemName => {
            const btn = listElement.querySelector(\`button[data-name="\${itemName}"]\`);
            if(btn) btn.remove();
        });
    }

    async function fetchLogs(server, resource) {
        if (!server || !resource) return;
        try {
            const response = await fetch(\`/logs?server=\${server}&resource=\${resource}\`);
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
                
                let copyButtonHTML = '';
                let commandData = '';
                try {
                    if (log.type === 'lua_to_nui') {
                        commandData = \`top.citFrames['\${activeResource}'].contentWindow.postMessage(\${JSON.stringify(log.event)}, "*");\`;
                    } else if (log.type === 'nui_to_lua' && log.callback) {
                        commandData = \`$.post("\${log.callback}", JSON.stringify(\${JSON.stringify(log.data)}));\`;
                    } else if (log.type === 'fetch_call') {
                        const options = log.options || {};
                        const body = options.body !== null && options.body !== undefined ? JSON.stringify(options.body) : 'null';
                        commandData = \`fetch("\${log.url}", { \\n  method: "\${options.method || 'GET'}", \\n  headers: \${JSON.stringify(options.headers || {})}, \\n  body: \${body} \\n});\`;
                    }
                } catch(e) { console.error('Error generating command:', e, log); }
                
                if (commandData) {
                    const escapedCommand = commandData.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
                    copyButtonHTML = \`<button class="copy-btn text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-2 rounded" onclick="copyToClipboard(this.dataset.command)" data-command="\${escapedCommand}">Copy Cmd</button>\`;
                }

                logEntry.innerHTML = \`
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-bold \${typeColors[log.type] || ''}">\${log.type}</span>
                        <div>
                            \${copyButtonHTML}
                            <span class="text-xs text-gray-500 ml-2">\${new Date(log.timestamp).toLocaleString()}</span>
                        </div>
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

    function selectServer(server) {
        activeServer = server;
        activeResource = null; // Clear resource
        
        // Highlight server
        document.querySelectorAll('#server-list button').forEach(btn => {
            btn.classList.toggle('bg-cyan-500', btn.dataset.name === server);
            btn.classList.toggle('text-white', btn.dataset.name === server);
        });

        fetchResources(server); // Fetch resources for this server
        logContainer.innerHTML = '<div class="text-gray-500">Select a resource to view logs.</div>';
        logHeader.classList.add('hidden');
        placeholder.classList.remove('hidden');
        stopAutoRefresh();
    }

    function selectResource(server, resource) {
        activeServer = server;
        activeResource = resource;
        currentServerSpan.textContent = server;
        currentResourceSpan.textContent = resource;
        logHeader.classList.remove('hidden');
        placeholder.classList.add('hidden');
        
        // Highlight resource
        document.querySelectorAll('#resource-list button').forEach(btn => {
            btn.classList.toggle('bg-cyan-500', btn.dataset.name === resource);
            btn.classList.toggle('text-white', btn.dataset.name === resource);
        });

        fetchLogs(server, resource);
        if (autoRefreshCheckbox.checked) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    }
    
    async function clearLogs() {
        if (!activeServer || !activeResource) return;
        
        const existingModal = document.getElementById('confirm-modal');
        if (existingModal) existingModal.remove();

        const customConfirm = document.createElement('div');
        customConfirm.id = 'confirm-modal';
        customConfirm.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50';
        customConfirm.innerHTML = \`
            <div class="bg-gray-800 p-6 rounded shadow-lg">
                <p class="text-white mb-4">Are you sure you want to clear all logs for <strong class="text-cyan-400">\${activeServer} / \${activeResource}</strong>?</p>
                <div class="flex justify-end space-x-2">
                    <button id="confirm-cancel" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded">Cancel</button>
                    <button id="confirm-ok" class="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded">Clear</button>
                </div>
            </div>
        \`;
        document.body.appendChild(customConfirm);

        document.getElementById('confirm-cancel').onclick = () => {
            document.body.removeChild(customConfirm);
        };
        document.getElementById('confirm-ok').onclick = async () => {
            document.body.removeChild(customConfirm);
            try {
                await fetch('/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ server: activeServer, resource: activeResource })
                });
                fetchLogs(activeServer, activeResource); // Refresh logs
                showToast(\`Logs cleared for \${activeServer} / \${activeResource}\`);
            } catch(error) {
                console.error("Failed to clear logs:", error);
                showToast("Failed to clear logs.", true);
            }
        };
    }

    function startAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        if (activeServer && activeResource) {
            refreshInterval = setInterval(() => fetchLogs(activeServer, activeResource), 2000);
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
    fetchServers();
    setInterval(fetchServers, 5000); // Refresh server list every 5 seconds
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
    console.log(`✅ Server running, access the viewer at: http://localhost:${PORT}/login`);
    console.log(`📁 Logging to directory: ${LOG_DIR}`);
    console.log(`  POST /log         - Receive NUI intercepts (Public)`);
    console.log(`  GET  /login       - View login page`);
    console.log(`  GET  /view        - View logs (PIN Required)`);
    console.log(`  GET  /logs        - API: List servers (PIN Required)`);
    console.log(`  GET  /logs?server=<name> - API: List resources (PIN Required)`);
    console.log(`  GET  /logs?server=<name>&resource=<name> - API: View logs (PIN Required)`);
    console.log(`  POST /clear       - API: Clear logs (PIN Required)`);
    console.log(`  GET  /health      - Health check (Public)\n`);
    console.log('📡 Waiting for NUI data...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
});

