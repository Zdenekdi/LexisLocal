require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
// Doménová logika je vytažená do routes/*.js; server.js drží už jen bootstrap,
// autentizaci, montáž routerů, /api/status a background úlohy.
const { WATCH_DIR } = require('./lib/config');
const { loadAgents } = require('./lib/agents');
const HearingsWatcher = require('./lib/hearings');

const app = express();
const PORT = process.env.PORT || 4000;

// API token je vždy k dispozici (z prostředí, jinak vygenerovaný a perzistovaný
// mimo datovou složku). VYNUCENÍ je opt-in: zapne se, když je API_TOKEN v prostředí
// (zpětná kompatibilita) nebo LEXIS_ENFORCE_TOKEN=1. Jinak backend jede bez vynucení
// (chrání ho bind na loopback), ale token je připravený pro klienty i pro přepnutí.
const { resolveApiToken } = require('./lib/api_token');
const API_TOKEN = resolveApiToken();
const ENFORCE_TOKEN = !!process.env.API_TOKEN || process.env.LEXIS_ENFORCE_TOKEN === '1';
if (ENFORCE_TOKEN && !process.env.API_TOKEN) {
    // Dashboard token dostane automaticky (vstřikuje se). Editor si ho vlož ručně
    // do nastavení poskytovatele LexisLocal (pole klíč).
    console.log(`🔑 Vynucení API tokenu ZAPNUTO. Token pro editor: ${API_TOKEN}`);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Dashboard servírujeme s vstříknutým API tokenem (jen loopback), aby ho klient
// nemusel vkládat ručně, až se vynucení zapne. Musí být PŘED express.static.
app.get(['/', '/index.html'], (req, res, next) => {
    try {
        const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
        const inject = `<script>window.LEXIS_API_TOKEN=${JSON.stringify(API_TOKEN)};</script>`;
        res.type('html').send(html.includes('</head>') ? html.replace('</head>', inject + '</head>') : inject + html);
    } catch (e) {
        next();
    }
});
app.use(express.static(path.join(__dirname, 'public')));

// --- Ochrana proti path traversal (sdílený helper) ---
const { safePathInWatchDir, sanitizeFileName } = require('./lib/pathsafe');

// Secure API Token Middleware — rozhodovací logika je v lib/auth.js (čistá,
// bezstavová, pokrytá testy). Vynucení je opt-in (ENFORCE_TOKEN, viz výše).
const { checkAuth } = require('./lib/auth');
const authenticate = (req, res, next) => {
    if (!ENFORCE_TOKEN) return next();
    if (checkAuth(API_TOKEN, req).allowed) return next();
    console.warn(`🔒 Nepovolený přístup k API: ${req.method} ${req.path}`);
    return res.status(401).json({ error: "Přístup odepřen: Neplatný nebo chybějící API token." });
};

app.use(authenticate);

// ─── Modulární routery (postupné rozbití monolitu) ───────────────────────────
// Domény se vytahují ze server.js do samostatných souborů v routes/.
app.use('/api/agents', require('./routes/agents'));
app.use('/api/document', require('./routes/document'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/conflicts', require('./routes/conflicts'));
app.use('/api/judikatura', require('./routes/judikatura'));
app.use('/api/managerial', require('./routes/managerial'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/rag', require('./routes/rag'));
app.use('/api/watcher', require('./routes/watcher'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/models', require('./routes/models'));
app.use('/api/system', require('./routes/system'));
app.use('/api/registry', require('./routes/registry'));
app.use('/api/registries', require('./routes/registries'));
app.use('/api/paperless', require('./routes/paperless'));
app.use('/api/email', require('./routes/email'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/inbox', require('./routes/inbox'));
app.use('/api/agent', require('./routes/agent'));
app.use('/api/agent-swarm', require('./routes/agentSwarm'));

// Root Status
app.get('/api/status', (req, res) => {
    const agents = loadAgents();
    res.json({
        status: "online",
        project: "LexisLocal AI Ecosystem",
        version: "1.2.0",
        watcherDir: WATCH_DIR,
        activeAgents: Object.keys(agents)
    });
});

// Spouštět kontrolu změn soudních jednání na pozadí (každou hodinu)
setInterval(() => {
    HearingsWatcher.checkAllHearings(WATCH_DIR).catch(err => {
        console.error("⚠️ Background monitored hearings check error:", err.message);
    });
}, 60 * 60 * 1000);

const USE_HTTPS = process.env.USE_HTTPS === 'true';

const SSL_KEY_PATH = process.env.SSL_KEY_PATH || 'key.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || 'cert.pem';

if (require.main === module) {
    if (USE_HTTPS && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
        try {
            const https = require('https');
            const sslOptions = {
                key: fs.readFileSync(SSL_KEY_PATH),
                cert: fs.readFileSync(SSL_CERT_PATH)
            };
            https.createServer(sslOptions, app).listen(PORT, () => {
                console.log(`🚀🔒 LexisLocal AI ZABEZPEČENÝ backend (HTTPS) běží na https://localhost:${PORT}`);
            });
        } catch (httpsErr) {
            console.error("❌ Nepodařilo se spustit HTTPS server, padám zpět na HTTP:", httpsErr.message);
            app.listen(PORT, () => {
                console.log(`🚀 LexisLocal AI backend běží na http://localhost:${PORT}`);
            });
        }
    } else {
        if (USE_HTTPS) {
            console.warn(`⚠️ V konfiguraci je vyžadováno HTTPS, ale chybí soubory certifikátu (${SSL_KEY_PATH} / ${SSL_CERT_PATH}). Spouštím na HTTP.`);
        }
        app.listen(PORT, () => {
            console.log(`🚀 LexisLocal AI backend běží na http://localhost:${PORT}`);
        });
    }
}

module.exports = app;
