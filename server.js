const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser'); // <-- ADD THIS
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
app.use(express.urlencoded({ extended: true })); // <-- For parsing login form
app.use(cookieParser()); // <-- For reading cookies

// --- NEW: Authentication Middleware ---
const checkAuth = (req, res, next) => {
    if (req.cookies[AUTH_COOKIE_NAME] === VIEWER_PIN) {
        // User is authenticated
        return next();
    }
    // User is not authenticated, redirect to login
    res.redirect('/login');
};

// --- Helper Functions ---
function sanitizeResourceName(resourceName) {
    if (!resourceName || typeof resourceName !== 'string') return 'unknown_resource';
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

// Main logging endpoint - DOES NOT require auth
app.post('/log', (req, res) => {
    try {
        // --- NEW: Resource Name Parsing ---
        let actualResource = req.body.resource;
        const logData = { ...req.body };
        delete logData.resource; // logData now only contains the log payload

        try {
            let urlToParse = null;
            if (logData.type === 'nui_to_lua' && logData.callback) {
                urlToParse = logData.callback;
            } else if (logData.type === 'fetch_call' && typeof logData.url === 'string') {
                urlToParse = logData.url;
            }

            if (urlToParse) {
                // Regex to find nui resource name (e.g., https://resource_name/...)
                const match = urlToParse.match(/^https?:\/\/([a-zA-Z0-9_-]+)\//);
                if (match && match[1]) {
                    actualResource = match[1]; // We found a better resource name!
                }
            }
        } catch (e) {
            console.warn('Error parsing resource from log data:', e);
        }
        // --- End of New Logic ---

        if (!actualResource) {
            return res.status(400).json({ error: 'Resource name is required.' });
        }
        
        writeLog(actualResource, logData); // Use the corrected resource name
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error logging data:', error);
        res.status(500).json({ error: error.message });
    }
});

// API for log data - NOW REQUIRES AUTH
app.get('/logs', checkAuth, (req, res) => {
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

// Clear logs for a specific resource - NOW REQUIRES AUTH
app.post('/clear', checkAuth, (req, res) => {
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

// Health check - DOES NOT require auth
app.get('/health', (req, res) => {
    res.json({ status: 'running', logDirectory: LOG_DIR, timestamp: new Date().toISOString() });
});

// --- NEW: Login Page Endpoints ---
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
        // Correct PIN. Set a cookie that expires in 1 day.
        res.cookie(AUTH_COOKIE_NAME, VIEWER_PIN, {
            httpOnly: true,
            secure: req.protocol === 'https', // Use 'secure' if running on HTTPS
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });
        res.redirect('/view');
    } else {
        // Incorrect PIN
        res.redirect('/login');
    }
});

// --- Interactive Log Viewer ---
app.get('/', (req, res) => res.redirect('/view'));

// Main viewer page - NOW REQUIRES AUTH
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
        #toast-notification {
            transition: opacity 0.3s ease-in-out;
        }
    </style>
</head>
<body class="bg-gray-900 text-gray-300 font-mono">
<div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-1/4 h-screen bg-gray-800 p-4 overflow-y-auto">
        <h1 class="text-xl font-bold text-white mb-4">Resources</h1>
        <div id="resource-list" class="flex flex-col space-y-2"></div>
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

    // --- NEW: Notification and Clipboard Helpers ---
    function showToast(message, isError = false) {
        // Remove existing toast
        const existingToast = document.getElementById('toast-notification');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = \`fixed top-5 right-5 text-white py-2 px-4 rounded shadow-lg z-50 \${isError ? 'bg-red-500' : 'bg-green-500'}\`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if(toast.parentElement) document.body.removeChild(toast);
            }, 300);
        }, 2000);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Copied to clipboard!');
            }, () => {
                fallbackCopy(text); // Fallback
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed'; // Avoid scrolling
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showToast('Copied to clipboard!');
        } catch (err) {
            showToast('Failed to copy.', true);
        }
        document.body.removeChild(textArea);
    }
    // --- End Helpers ---

    async function fetchResources() {
        try {
            const response = await fetch('/logs');
            const resources = await response.json();
            
            // Track current buttons
            const currentButtons = new Set(Array.from(resourceList.children).map(btn => btn.dataset.resource));
            
            // Add new buttons
            resources.sort().forEach(resource => {
                if (!currentButtons.has(resource)) {
                    const button = document.createElement('button');
                    button.textContent = resource;
                    button.dataset.resource = resource;
                    button.className = 'text-left p-2 rounded hover:bg-gray-700 focus:outline-none focus:bg-cyan-500 focus:text-white transition-colors';
                    button.onclick = () => selectResource(resource);
                    resourceList.appendChild(button);
                }
                currentButtons.delete(resource); // Mark as seen
            });

            // Remove old buttons (if a file was deleted)
            currentButtons.forEach(resourceName => {
                const btn = resourceList.querySelector(\`button[data-resource="\${resourceName}"]\`);
                if(btn) btn.remove();
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
                
                // --- NEW: Copy Command Logic ---
                let copyButtonHTML = '';
                let commandData = '';

                try {
                    if (log.type === 'lua_to_nui') {
                        // Command for lua_to_nui: top.citFrames['resource'].contentWindow.postMessage({event_data}, "*");
                        commandData = \`top.citFrames['\${activeResource}'].contentWindow.postMessage(\${JSON.stringify(log.event)}, "*");\`;
                    } else if (log.type === 'nui_to_lua' && log.callback) {
                        // Command for nui_to_lua ($.post): $.post("url", JSON.stringify({data}));
                        commandData = \`$.post("\${log.callback}", JSON.stringify(\${JSON.stringify(log.data)}));\`;
                    } else if (log.type === 'fetch_call') {
                        // Command for fetch_call: fetch("url", {options...});
                        const options = log.options || {};
                        // body needs to be stringified *if it's not null/undefined*
                        const body = options.body !== null && options.body !== undefined ? JSON.stringify(options.body) : 'null';
                        commandData = \`fetch("\${log.url}", { \\n  method: "\${options.method || 'GET'}", \\n  headers: \${JSON.stringify(options.headers || {})}, \\n  body: \${body} \\n});\`;
                    }
                } catch(e) {
                    console.error('Error generating command:', e, log);
                }
                
                if (commandData) {
                    // Store command data in a data attribute, escaped for HTML
                    const escapedCommand = commandData.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
                    copyButtonHTML = \`
                        <button class="copy-btn text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 py-1 px-2 rounded"
                                onclick="copyToClipboard(this.dataset.command)"
                                data-command="\${escapedCommand}">
                            Copy Cmd
                        </button>
                    \`;
                }
                // --- End Copy Command Logic ---

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
        } else {
            stopAutoRefresh();
        }
    }
    
    // --- NEW: Custom Confirm Modal for Clear Logs ---
    async function clearLogs() {
        if (!activeResource) return;
        
        const existingModal = document.getElementById('confirm-modal');
        if (existingModal) existingModal.remove();

        const customConfirm = document.createElement('div');
        customConfirm.id = 'confirm-modal';
        customConfirm.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50';
        customConfirm.innerHTML = \`
            <div class="bg-gray-800 p-6 rounded shadow-lg">
                <p class="text-white mb-4">Are you sure you want to clear all logs for <strong class="text-cyan-400">\${activeResource}</strong>?</p>
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
                    body: JSON.stringify({ resource: activeResource })
                });
                fetchLogs(activeResource); // Refresh logs
                showToast(\`Logs cleared for \${activeResource}\`);
            } catch(error) {
                console.error("Failed to clear logs:", error);
                showToast("Failed to clear logs.", true);
            }
        };
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
    console.log(`✅ Server running, access the viewer at: http://localhost:${PORT}/login`);
    console.log(`📁 Logging to directory: ${LOG_DIR}`);
    console.log(`  POST /log         - Receive NUI intercepts (Public)`);
    console.log(`  GET  /login       - View login page`);
    console.log(`  GET  /view        - View logs (PIN Required)`);
    console.log(`  GET  /logs        - API: List resources (PIN Required)`);
    console.log(`  GET  /logs?resource=<name> - API: View logs (PIN Required)`);
    console.log(`  POST /clear       - API: Clear logs (PIN Required)`);
    console.log(`  GET  /health      - Health check (Public)\n`);
    console.log('📡 Waiting for NUI data...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
});

