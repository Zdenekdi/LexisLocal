'use strict';

/**
 * LexisLocal – Electron Tray Application
 * ==========================================
 * Spouští LexisLocal Express backend jako podproces v lokálním režimu,
 * nebo se připojuje k centrálnímu serveru (např. Mac Mini) v síťovém režimu.
 * Spravuje ikonu v systémové liště (macOS Menu Bar / Windows System Tray).
 */

const { app, Tray, Menu, shell, dialog, nativeImage, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// ─── Cesty a Konfigurace ───────────────────────────────────────────────────────
const configPath = path.join(app.getPath('userData'), 'config.json');
const SERVER_ENTRY = path.join(__dirname, '..', 'backend', 'server.js');

const defaults = {
    mode: 'local', // 'local' | 'server'
    serverUrl: 'http://localhost:4000',
    watchDir: path.join(require('os').homedir(), 'Desktop', 'LexisSpisy'),
    port: '4000',
    autostart: true,
    https: false,
    token: false
};

let config = { ...defaults };

function loadConfig() {
    if (fs.existsSync(configPath)) {
        try {
            const fileData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return { ...defaults, ...fileData };
        } catch (e) {
            console.error('Chyba při načítání config.json:', e);
        }
    }
    return { ...defaults };
}

function saveConfig(newConfig) {
    try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
        config = { ...newConfig };
        return true;
    } catch (e) {
        console.error('Chyba při ukládání config.json:', e);
        return false;
    }
}

// Načtení konfigurace před spuštěním
config = loadConfig();

// Dynamické proměnné
let PORT = parseInt(config.port) || 4000;
let DASHBOARD_URL = config.mode === 'server' ? config.serverUrl : `http://localhost:${PORT}`;
let WATCH_DIR = config.watchDir;

// ─── Globální stav ─────────────────────────────────────────────────────────────
let tray = null;
let serverProcess = null;
let serverStatus = 'starting'; // 'starting' | 'running' | 'error' | 'stopped'
let watcherPaused = false;
let healthCheckInterval = null;

// ─── Zabránit vytváření více oken v doku (macOS) ───────────────────────────────
app.dock && app.dock.hide();

// ─── Zabránit vícenásobnému spuštění ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ─── Spuštění Express serveru ──────────────────────────────────────────────────
function startServer() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }

    serverStatus = 'starting';
    updateTrayMenu();

    if (config.mode === 'server') {
        console.log(`🔗 Režim Síťový server: Připojuji se k ${DASHBOARD_URL}`);
        checkHealth();
        return;
    }

    console.log(`🚀 Režim Lokální: Spouštím backend na portu ${PORT}`);
    const env = {
        ...process.env,
        PORT: String(PORT),
        WATCH_DIR: WATCH_DIR,
        ELECTRON_RUN: 'true'
    };

    serverProcess = fork(SERVER_ENTRY, [], {
        env,
        silent: false // Výstup serveru jde do konzole
    });

    serverProcess.on('message', (msg) => {
        console.log('[Server]', msg);
    });

    serverProcess.on('error', (err) => {
        console.error('[Server] Chyba:', err.message);
        serverStatus = 'error';
        updateTrayMenu();
    });

    serverProcess.on('exit', (code) => {
        console.log(`[Server] Ukončen s kódem ${code}`);
        if (serverStatus !== 'stopped') {
            serverStatus = 'error';
            updateTrayMenu();
        }
    });

    checkHealth();
}

// ─── Kontrola zdraví (Health Check) ────────────────────────────────────────────
function checkHealth() {
    let attempts = 0;
    healthCheckInterval = setInterval(async () => {
        attempts++;
        try {
            const http = require('http');
            const https = require('https');
            const client = DASHBOARD_URL.startsWith('https') ? https : http;
            
            const req = client.get(`${DASHBOARD_URL}/api/status`, (res) => {
                if (res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 401) {
                    // Server odpovídá (i 401 Unauthorized je úspěch, server žije)
                    clearInterval(healthCheckInterval);
                    healthCheckInterval = null;
                    serverStatus = 'running';
                    updateTrayMenu();
                }
            });
            req.on('error', () => {}); // Tiché selhání
        } catch (e) {}

        if (attempts >= 20) {
            clearInterval(healthCheckInterval);
            healthCheckInterval = null;
            if (serverStatus !== 'running') {
                serverStatus = 'error';
                updateTrayMenu();
            }
        }
    }, 500);
}

// ─── Tray Menu ─────────────────────────────────────────────────────────────────
function getStatusLabel() {
    const modeSuffix = config.mode === 'server' ? ' (síťový)' : ' (lokální)';
    switch (serverStatus) {
        case 'starting': return `🟡 LexisLocal${modeSuffix} se spouští...`;
        case 'running':  return `🟢 LexisLocal${modeSuffix} je aktivní`;
        case 'error':    return `🔴 LexisLocal${modeSuffix} – chyba připojení`;
        case 'stopped':  return `⏸️ LexisLocal${modeSuffix} je pozastaven`;
        default:         return `⚪ LexisLocal${modeSuffix}`;
    }
}

function updateTrayMenu() {
    if (!tray) return;

    const isRunning = serverStatus === 'running';

    const menuTemplate = [
        {
            label: getStatusLabel(),
            enabled: false
        },
        { type: 'separator' },
        config.mode === 'local' ? {
            label: '📂 Otevřít složku Spisy',
            click: () => {
                if (!fs.existsSync(WATCH_DIR)) {
                    fs.mkdirSync(WATCH_DIR, { recursive: true });
                }
                shell.openPath(WATCH_DIR);
            }
        } : {
            label: '📂 Složka Spisy (připojte síťový disk)',
            enabled: false
        },
        {
            label: '📊 Otevřít Dashboard',
            enabled: isRunning,
            click: () => {
                shell.openExternal(DASHBOARD_URL);
            }
        },
        { type: 'separator' },
        config.mode === 'local' ? {
            label: watcherPaused ? '▶️ Obnovit sledování složky' : '⏸️ Pozastavit sledování složky',
            enabled: isRunning,
            click: () => {
                watcherPaused = !watcherPaused;
                const http = require('http');
                const req = http.get(`${DASHBOARD_URL}/api/watcher/toggle?active=${!watcherPaused}`);
                req.on('error', () => {});
                updateTrayMenu();
            }
        } : null,
        config.mode === 'local' ? { type: 'separator' } : null,
        {
            label: '🔄 Restartovat server / připojení',
            click: () => {
                restartServer();
            }
        },
        { type: 'separator' },
        {
            label: '⚙️ Nastavení',
            click: () => {
                openSettingsWindow();
            }
        },
        {
            label: '📖 Nápověda',
            click: () => {
                shell.openExternal('https://github.com/Zdenekdi/LexisLocal');
            }
        },
        { type: 'separator' },
        {
            label: '❌ Ukončit LexisLocal',
            click: () => {
                stopServer();
                app.quit();
            }
        }
    ].filter(Boolean);

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    tray.setContextMenu(contextMenu);
    tray.setToolTip(getStatusLabel());
}

// ─── Restartování a Zastavení ──────────────────────────────────────────────────
function restartServer() {
    stopServer();
    setTimeout(() => startServer(), 1000);
}

function stopServer() {
    serverStatus = 'stopped';
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
    }
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
    updateTrayMenu();
}

// ─── Okno nastavení ────────────────────────────────────────────────────────────
let settingsWindow = null;
function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 480,
        height: 480, // Zvětšeno pro dropdown a serverUrl
        resizable: false,
        title: 'LexisLocal – Nastavení',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    settingsWindow.once('ready-to-show', () => settingsWindow.show());
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── IPC Komunikace ─────────────────────────────────────────────────────────────
ipcMain.on('get-settings', (event) => {
    event.reply('settings-data', config);
});

ipcMain.on('save-settings', (event, newSettings) => {
    if (newSettings.autostart !== config.autostart) {
        app.setLoginItemSettings({
            openAtLogin: newSettings.autostart,
            name: 'LexisLocal'
        });
    }

    saveConfig(newSettings);

    PORT = parseInt(config.port) || 4000;
    DASHBOARD_URL = config.mode === 'server' ? config.serverUrl : `http://localhost:${PORT}`;
    WATCH_DIR = config.watchDir;

    restartServer();
});

// ─── Inicializace Tray ────────────────────────────────────────────────────────
app.whenReady().then(() => {
    // Vytvořit výchozí konfiguraci, pokud chybí
    if (!fs.existsSync(configPath)) {
        saveConfig(defaults);
    } else {
        config = loadConfig();
    }

    // Nastavit autostart podle konfigurace
    app.setLoginItemSettings({
        openAtLogin: config.autostart,
        name: 'LexisLocal'
    });

    // Načíst ikonu
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });
        trayIcon.setTemplateImage(true);
    } else {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('LexisLocal se spouští...');

    startServer();
    updateTrayMenu();

    console.log('🚀 LexisLocal Tray App spuštěna.');
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────
app.on('will-quit', () => {
    stopServer();
});

app.on('window-all-closed', () => {
    // Záměrně prázdné – aplikace běží v liště
});
