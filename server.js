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
/**
 * Sanitizes a resource name to create a safe filename.
 * @param {string} resourceName - The name of the resource.
 * @returns {string} A sanitized filename-safe string.
 */
function sanitizeResourceName(resourceName) {
    if (!resourceName || typeof resourceName !== 'string') {
        return 'unknown_resource';
    }
    // Replaces non-alphanumeric characters (except - and _) with an underscore.
    return resourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Writes a log entry to the appropriate resource file.
 * @param {string} resource - The name of the resource.
 * @param {object} data - The log data to write.
 */
function writeLog(resource, data) {
    const safeResource = sanitizeResourceName(resource);
    const logFilePath = path.join(LOG_DIR, `${safeResource}.jsonl`);

    const logEntry = {
        timestamp: new Date().toISOString(),
        ...data
    };

    // Write to file (JSONL format - one JSON object per line)
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(logFilePath, logLine);

    // Console output with colors and resource name
    const icons = {
        'lua_to_nui': '📨',
        'nui_to_lua': '📤',
        'fetch_call': '🌐',
        'console': '🖥️'
    };

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

// View logs (either list resources or get logs for a specific one)
app.get('/logs', (req, res) => {
    try {
        const { resource } = req.query;

        if (!resource) {
            // No resource specified, return a list of all available log files
            const files = fs.readdirSync(LOG_DIR)
                .filter(file => file.endsWith('.jsonl'))
                .map(file => file.replace('.jsonl', ''));
            return res.json(files);
        }

        // Resource specified, return its logs
        const safeResource = sanitizeResourceName(resource);
        const logFilePath = path.join(LOG_DIR, `${safeResource}.jsonl`);

        if (!fs.existsSync(logFilePath)) {
            return res.json([]);
        }

        const logs = fs.readFileSync(logFilePath, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line))
            .slice(-200); // Return the last 200 entries

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
        if (!resource) {
            return res.status(400).json({ error: 'Resource name is required to clear logs.' });
        }

        const safeResource = sanitizeResourceName(resource);
        const logFilePath = path.join(LOG_DIR, `${safeResource}.jsonl`);

        if (fs.existsSync(logFilePath)) {
            fs.writeFileSync(logFilePath, '');
            console.log(`🗑️ Logs cleared for resource: ${safeResource}`);
            return res.json({ message: `Logs cleared for ${safeResource}` });
        } else {
            return res.status(404).json({ message: `No logs found for ${safeResource}` });
        }
    } catch (error) {
        console.error(`❌ Error clearing logs for "${req.body.resource}":`, error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        logDirectory: LOG_DIR,
        timestamp: new Date().toISOString()
    });
});

// --- Server Start ---
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   🎮 FiveM NUI Interceptor Logger Server   ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📁 Logging to directory: ${LOG_DIR}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /log         - Receive NUI intercepts (body: { resource, ... })`);
    console.log(`  GET  /logs        - List all resources with logs`);
    console.log(`  GET  /logs?resource=<name> - View last 200 logs for a resource`);
    console.log(`  POST /clear       - Clear logs for a resource (body: { resource })`);
    console.log(`  GET  /health      - Health check\n`);
    console.log('📡 Waiting for NUI data...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
});
