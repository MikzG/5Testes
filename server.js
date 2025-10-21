const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Configuration
const PORT = 7654;
const LOG_FILE = 'nui-intercept.jsonl';
const LOG_DIR = './logs';

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

const logFilePath = path.join(LOG_DIR, LOG_FILE);

// Middleware
app.use(express.json({limit: '50mb'}));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Helper function to write logs
function writeLog(data) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        ...data
    };

    // Write to file (JSONL format - one JSON per line)
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(logFilePath, logLine);

    // Console output with colors
    const icons = {
        'lua_to_nui': '📨',
        'nui_to_lua': '📤',
        'fetch_call': '🌐',
        'console': '🖥️'
    };

    const icon = icons[data.type] || '📝';
    console.log(`${icon} [${data.type}]`, JSON.stringify(data.data || data.event || data.callback, null, 2));
}

// Main logging endpoint
app.post('/log', (req, res) => {
    try {
        writeLog(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error logging data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Optional: View recent logs endpoint
app.get('/logs', (req, res) => {
    try {
        if (!fs.existsSync(logFilePath)) {
            return res.json([]);
        }

        const logs = fs.readFileSync(logFilePath, 'utf8')
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line))
            .slice(-100); // Last 100 entries

        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Optional: Clear logs endpoint
app.post('/clear', (req, res) => {
    try {
        fs.writeFileSync(logFilePath, '');
        console.log('🗑️ Logs cleared');
        res.json({ message: 'Logs cleared' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'running',
        logFile: logFilePath,
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   🎮 FiveM NUI Interceptor Logger Server   ║');
    console.log('╚══════════════════════════════════════════════╝\n');
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📁 Logging to: ${logFilePath}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /log     - Receive NUI intercepts`);
    console.log(`  GET  /logs    - View last 100 logs`);
    console.log(`  POST /clear   - Clear all logs`);
    console.log(`  GET  /health  - Health check\n`);
    console.log('📡 Waiting for NUI data...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
});
