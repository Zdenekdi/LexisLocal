# CLAUDE.md — LexisLocal

Kontext pro Claude Code. LexisLocal je lokální AI ekosystém pro advokacii (Express API + Electron tray).
Hlavní části: `backend/server.js` (Express, ~96 KB monolit), `backend/lib/*` (orchestrator, rag, watcher,
ocr, anonymizer, database, audit, green_monitor…), `backend/public/*` (dashboard), Docker compose
(paperless-ngx + postgres + redis). Sesterský projekt: **LexisEditor** (desktop editor).

Build/test: `npm run dev` (nodemon), `npm test` (jest, ~116 testů), `npm run electron:dev`, `npm run dist:mac|win`.

---

## TODO / Známé problémy

Seřazeno podle priority. Frontendové položky (LexisEditor) jsou v CLAUDE.md tamního repa.

### 🔴 Kritické (bezpečnost)

- [x] **HOTOVO — Klíč mimo data + AES-GCM.** Nový `backend/lib/secure_crypto.js` je jediný zdroj:
  klíč se ukládá do `~/.lexislocal/lexis.key` (0600) mimo `WATCH_DIR`, starý klíč od dat se při startu
  ZMIGRUJE (přesune) a z datové složky smaže. Šifrování je nově **AES-256-GCM** (autentizační tag →
  integrita); starý CBC formát se stále přečte (zpětná kompatibilita), nové zápisy jsou GCM (data se
  přemigrují při prvním uložení). Napojeno v `database.js` i `rag.js` (partitions). Umístění klíče lze
  přepsat přes `LEXIS_KEY_DIR`. Pokryto testy (round-trip, legacy CBC, detekce manipulace, migrace).

### 🟠 Vysoké

- [~] **Částečně — Zúžení sítě hotové, povinný token zbývá.** `backend/server.js` se nově váže na
  **`127.0.0.1`** (nedostupné z LAN; LAN jen vědomě přes `BIND_HOST`), CORS je omezený na localhost
  originy (+ požadavky bez Originu pro Electron) a přibyl **Host-guard** proti DNS-rebindingu. Per-request
  `API_TOKEN` zůstává zatím opt-in — udělat povinným vyžaduje, aby editor/dashboard token automaticky
  získaly (jinak by se appka zamkla); doladit s reálným smoke testem.

### 🟡 Střední

- [x] **HOTOVO — Secrety z `docker-compose.yml`.** Hesla (`PAPERLESS_DB_PASSWORD`) a `PAPERLESS_SECRET_KEY`
  se načítají z `.env` (`${VAR:?...}` — bez nastavení `docker compose up` selže s hláškou). Přidán
  `.env.example`; `.env` je v `.gitignore`. (Historii commitů se starým heslem zvaž přepsat zvlášť.)

- [x] **HOTOVO — Šifrování auditního logu.** `.audit_log.json` se nově šifruje **AES-256-GCM** přes
  sdílený `secure_crypto` (stejný klíč jako DB, mimo `WATCH_DIR`); legacy plaintext se stále přečte a
  přemigruje při zápisu.

- [ ] **Rozbít monolity.** `backend/server.js` (96 KB) a `backend/public/app.js` (191 KB) jsou obří.
  Vytáhnout routy ze `server.js` do samostatných routerů (lib/ moduly už existují).

### 🟢 Nízké (hygiena)

- [x] **HOTOVO — Sjednotit verze.** `/api/status` v `server.js` nově čte verzi z `package.json`
  (jeden zdroj pravdy).
