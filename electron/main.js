'use strict';

/**
 * LexisLocal – Electron Tray Application
 * ==========================================
 * Spouští LexisLocal Express backend jako podproces a spravuje
 * ikonu v systémové liště (macOS Menu Bar / Windows System Tray).
 * 
 * Uživatel nepotřebuje terminál ani technické znalosti – aplikaci
 * stačí nainstalovat a vše běží automaticky na pozadí.
 */

const { app, Tray, Menu, shell, dialog, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// ─── Konfigurace ───────────────────────────────────────────────────────────────
const PORT = 4000;
const DASHBOARD_URL = `http://localhost:${PORT}`;
const SERVER_ENTRY = path.join(__dirname, '..', 'backend', 'server.js');

// Složka spisy – výchozí je ~/Desktop/LexisSpisy, lze přepsat v .env
const WATCH_DIR = process.env.WATCH_DIR || path.join(require('os').homedir(), 'Desktop', 'LexisSpisy');

// ─── Globální stav ─────────────────────────────────────────────────────────────
let tray = null;
let serverProcess = null;
let serverStatus = 'starting'; // 'starting' | 'running' | 'error' | 'stopped'
let watcherPaused = false;

// ─── Zabránit vytváření více oken v doku (macOS) ───────────────────────────────
app.dock && app.dock.hide();

// ─── Zabránit vícenásobnému spuštění ──────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ─── Spuštění Express serveru jako podproces ───────────────────────────────────
function startServer() {
    serverStatus = 'starting';
    updateTrayMenu();

    const env = {
        ...process.env,
        PORT: String(PORT),
        WATCH_DIR: WATCH_DIR,
        ELECTRON_RUN: 'true'
    };

    serverProcess = fork(SERVER_ENTRY, [], {
        env,
        silent: false // Výstup serveru jde do konzole (viditelný přes Electron DevTools)
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

    // Ověřit dostupnost serveru po nastartování (max 10 sekund)
    let attempts = 0;
    const healthCheck = setInterval(async () => {
        attempts++;
        try {
            const http = require('http');
            const req = http.get(`${DASHBOARD_URL}/api/status`, (res) => {
                if (res.statusCode === 200 || res.statusCode === 404) {
                    // Server odpovídá – je živý
                    clearInterval(healthCheck);
                    serverStatus = 'running';
                    updateTrayMenu();
                }
            });
            req.on('error', () => {}); // Tiché selhání – ještě startuje
        } catch (e) {}

        if (attempts >= 20) {
            clearInterval(healthCheck);
            if (serverStatus !== 'running') {
                serverStatus = 'error';
                updateTrayMenu();
            }
        }
    }, 500);
}

// ─── Tray Menu ─────────────────────────────────────────────────────────────────
function getStatusLabel() {
    switch (serverStatus) {
        case 'starting': return '🟡 LexisLocal se spouští...';
        case 'running':  return '🟢 LexisLocal je aktivní';
        case 'error':    return '🔴 LexisLocal – chyba serveru';
        case 'stopped':  return '⏸️ LexisLocal je pozastaven';
        default:         return '⚪ LexisLocal';
    }
}

function updateTrayMenu() {
    if (!tray) return;

    const isRunning = serverStatus === 'running';

    const contextMenu = Menu.buildFromTemplate([
        {
            label: getStatusLabel(),
            enabled: false
        },
        { type: 'separator' },
        {
            label: '📂 Otevřít složku Spisy',
            click: () => {
                // Vytvoří složku, pokud neexistuje
                if (!fs.existsSync(WATCH_DIR)) {
                    fs.mkdirSync(WATCH_DIR, { recursive: true });
                }
                shell.openPath(WATCH_DIR);
            }
        },
        {
            label: '📊 Otevřít Dashboard',
            enabled: isRunning,
            click: () => {
                shell.openExternal(DASHBOARD_URL);
            }
        },
        { type: 'separator' },
        {
            label: watcherPaused ? '▶️ Obnovit sledování složky' : '⏸️ Pozastavit sledování složky',
            enabled: isRunning,
            click: () => {
                watcherPaused = !watcherPaused;
                // Odešle příkaz do Express serveru
                const http = require('http');
                const req = http.get(`${DASHBOARD_URL}/api/watcher/toggle?active=${!watcherPaused}`);
                req.on('error', () => {});
                updateTrayMenu();
            }
        },
        {
            label: '🔄 Restartovat server',
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
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(getStatusLabel());
}

// ─── Restartování serveru ──────────────────────────────────────────────────────
function restartServer() {
    stopServer();
    setTimeout(() => startServer(), 1000);
}

// ─── Zastavení serveru ─────────────────────────────────────────────────────────
function stopServer() {
    serverStatus = 'stopped';
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
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
        height: 400,
        resizable: false,
        title: 'LexisLocal – Nastavení',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        show: false
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    settingsWindow.once('ready-to-show', () => settingsWindow.show());
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── Inicializace Tray ────────────────────────────────────────────────────────
app.whenReady().then(() => {
    // Nastavit automatický start po přihlášení
    app.setLoginItemSettings({
        openAtLogin: true,
        name: 'LexisLocal'
    });

    // Načíst ikonu
    const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });
        trayIcon.setTemplateImage(true); // Správné chování na macOS (tmavý/světlý mód)
    } else {
        // Záložní generovaná ikona (malý čtverec), pokud chybí soubor
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('LexisLocal se spouští...');

    // Spustit server
    startServer();
    updateTrayMenu();

    console.log('🚀 LexisLocal Tray App spuštěna.');
});

// ─── Cleanup při ukončení ──────────────────────────────────────────────────────
app.on('will-quit', () => {
    stopServer();
});

app.on('window-all-closed', () => {
    // Záměrně NE app.quit() – aplikace má zůstat v liště i bez otevřených oken
});
