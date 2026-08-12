# RELEASE CHECKLIST — LexisLocal

Sestavení a vydání (Electron tray + Express backend). electron-builder.
Aktuální verze: viz `package.json`. Publish cíl: GitHub `Zdenekdi/LexisLocal`.
Vstupní bod aplikace: `electron/main.js` (forkuje `backend/server.js` jako službu na pozadí).

> Pozn.: kód se needituje na této VM; checklist popisuje ruční kroky na Macu/PC.

## 1. Před buildem
- [ ] Zelené testy: `npm test` (jest). Živé ARES testy jsou gatované (`RUN_LIVE_ARES`).
- [ ] `node --check` nad `backend/server.js`, `backend/lib/**`, `backend/routes/**`, `electron/main.js`.
- [ ] `.env` NENÍ v balíčku (je v `.gitignore`); citlivé hodnoty se nesmí zabalit.
- [ ] Ověřit `EMBEDDING_MODEL` / `CHAT_MODEL` (viz `.env.example`) — setup.js je nastaví dle RAM.

## 2. Ikony a assety (OVĚŘENO)
- [x] `assets/icon.png` = **skutečné PNG 1024×1024** (dřív JPEG přejmenovaný na .png → build ikon by selhal; opraveno).
- `build.mac.icon` a `build.win.icon` = `assets/icon.png`; `.icns`/`.ico` generuje electron-builder.
- `files` a `extraResources` v `package.json` obsahují `assets/`, `backend/`, `electron/`, `node_modules/` — OK.

## 3. Build
- macOS (na Macu): `npm run dist:mac`  → `dist/*.dmg` (arm64 + x64).
- Windows: `npm run dist:win`  → `dist/*.exe` (NSIS, x64). Na Macu vyžaduje wine.
- Obojí: `npm run dist:all`.
- Ověřit, že `asar: true` nevadí forku backendu (Electron čte z asar transparentně; server.js se forkuje z `electron/main.js`).

## 4. Podpis a notarizace (ZATÍM NEDĚLÁME — bod 1, čeká na certifikáty)
- macOS bez Apple Developer certifikátu + notarizace → varování „neznámý vývojář“.
- Windows bez certifikátu → SmartScreen varování.
- Doplnit `mac.hardenedRuntime` + entitlements + notarize až budou certifikáty.

## 5. Publish / auto-update
- `build.publish` míří na GitHub `Zdenekdi/LexisLocal`.
- **POZOR:** `electron-updater` NENÍ v závislostech → aplikace se sama neaktualizuje (jen ruční stažení nového DMG/EXE). Chceš-li in-app auto-update, přidat `electron-updater` a napojit `autoUpdater` v `electron/main.js` (viz LexisEditor jako vzor).
- [ ] Publikace: `GH_TOKEN` v prostředí + `electron-builder --mac --win -p always`, případně GitHub Release ručně.

## 6. Po buildu — smoke test balíčku
- [ ] Instalace na čistém profilu; spuštění tray ikony.
- [ ] Backend naběhne (fork), dashboard na `http://localhost:4000` (bind 127.0.0.1).
- [ ] Ověřit vytvoření složky spisů na ploše (`~/Desktop/LexisSpisy`).
- [ ] Ollama běží → AI dotaz projde; když neběží → čistý offline fallback (bez smyšleného práva).
- [ ] Sledování lhůt/jednání na pozadí (i při zavřeném editoru).

## 7. Bezpečnost před ostrým nasazením
- [ ] Solo režim: loopback + token volitelný — OK.
- [ ] Firemní režim (LAN): `BIND_HOST=0.0.0.0` POUZE spolu s `LEXIS_ENFORCE_TOKEN=1` a TLS (viz ARCHITECTURE.md).
- [ ] Klíč (`~/.lexislocal/lexis.key`) a `api_token` mimo datovou složku — ověřit oprávnění 0600.

## Známé mezery
- Podpis/notarizace (bod 1) — čeká na certifikáty.
- Chybí `electron-updater` (žádný in-app auto-update).
