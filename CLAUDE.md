# CLAUDE.md — LexisLocal

Kontext pro Claude Code. LexisLocal je lokální AI ekosystém pro advokacii (Express API + Electron tray).
Hlavní části: `backend/server.js` (Express bootstrap, ~130 řádků — jen autentizace, montáž routerů,
`/api/status` a background úlohy), `backend/routes/*.js` (22 doménových routerů), `backend/lib/*`
(orchestrator, rag, watcher, ocr, anonymizer, database, audit, api_token, pathsafe, green_monitor…),
`backend/public/*` (dashboard), Docker compose (paperless-ngx + postgres + redis).
Sesterský projekt: **LexisEditor** (desktop editor).

Build/test: `npm run dev` (nodemon), `npm test` (jest), `npm run electron:dev`, `npm run dist:mac|win`.

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

- [~] **Skoro hotovo — Zúžení sítě + auto-provisioning tokenu; zbývá jen přepnout vynucení na výchozí.**
  `backend/server.js` se váže na **`127.0.0.1`** (nedostupné z LAN; LAN jen vědomě přes `BIND_HOST`),
  CORS je omezený na localhost originy (+ požadavky bez Originu pro Electron) a je tu **Host-guard** proti
  DNS-rebindingu. Token je teď **vždy k dispozici**: `lib/api_token.js` ho vezme z `API_TOKEN`, jinak
  vygeneruje (`crypto.randomBytes(32).hex`) a perzistuje mimo data (`<keydir>/api_token`, 0600, atomicky).
  Dashboard ho dostane automaticky (vstřikuje se `window.LEXIS_API_TOKEN` před `express.static`), editor
  ho čte přímo ze souboru přes IPC (`get-lexislocal-token`). **Vynucení je zatím opt-in** (`ENFORCE_TOKEN`
  = `API_TOKEN` v env, nebo `LEXIS_ENFORCE_TOKEN=1`) — jádro je hotové, chybí jen reálný smoke test editoru
  (`LEXIS_ENFORCE_TOKEN=1`, spustit editor, vyzkoušet AI dotaz; nouzový vypínač `LEXIS_ENFORCE_TOKEN=0`)
  a pak přepnout na výchozí zapnuto. Pokryto testy (`apiToken.test.js`, `auth.test.js`).
  Přidán skript **`scripts/smoke-token.sh`**, který 401/200 ověří automaticky — zbývá ho jen spustit
  na Macu a otevřít editor s AI dotazem.

### 🟡 Střední

- [x] **HOTOVO — Secrety z `docker-compose.yml`.** Hesla (`PAPERLESS_DB_PASSWORD`) a `PAPERLESS_SECRET_KEY`
  se načítají z `.env` (`${VAR:?...}` — bez nastavení `docker compose up` selže s hláškou). Přidán
  `.env.example`; `.env` je v `.gitignore`. (Historii commitů se starým heslem zvaž přepsat zvlášť.)

- [x] **HOTOVO — Šifrování auditního logu.** `.audit_log.json` se nově šifruje **AES-256-GCM** přes
  sdílený `secure_crypto` (stejný klíč jako DB, mimo `WATCH_DIR`); legacy plaintext se stále přečte a
  přemigruje při zápisu.

- [x] **Rozbít monolity — HOTOVO (server.js i dashboard).** `backend/server.js` je rozbitý z ~2254
  na ~130 řádků: všechny domény jsou v **22 routerech** v `backend/routes/*.js` (agents, document, workflows,
  audit, activity, conflicts, judikatura, managerial, alerts, rag, watcher, calendar, models, system,
  registry, registries, paperless, email, campaigns, inbox, agent, agentSwarm). Sdílené helpery vytažené do
  `lib/` (`pathsafe`, `rag_request`, `ollama_client`, `agent_fallback`, `api_token`). **Dashboard `backend/public/app.js` rozbit z 3942 na ~580 řádků** — 88 metod vytaženo do 7
  prototype-mixin modulů (`app-inbox`, `app-chat`, `app-alerts-audit`, `app-agents`, `app-calendar`,
  `app-managerial`, `app-email`), načítaných v `index.html` po `app.js`. Rozbití přes AST (@babel/parser)
  s kontrolou úplnosti, ověřeno `node --check` + vm-harnessem (prototyp má všech 96 metod).
  Pozn.: dashboard byl v jednu chvíli mrtvý (uklouzlá `}` uzavřela třídu předčasně) — opraveno a zajištěno
  regresním testem `frontend_syntax.test.js` (`node --check` nad `public/*.js`).

### 🟢 Nízké (hygiena)

- [x] **HOTOVO — Sjednotit verze.** `/api/status` v `server.js` nově čte verzi z `package.json`
  (jeden zdroj pravdy).

- [x] **HOTOVO — Behaviorální testy dashboardu.** XSS-kritický `escapeHtml` vytažen z `public/app.js`
  do `public/app-helpers.js` (jeden zdroj pravdy, načítá se před `app.js`) a pokryt testy
  `tests/appHelpers.test.js` (escapování, `<script>` payload, atributový breakout).

- [x] **HOTOVO — Rozšířené testy.** Přibyly testy kolem nových/kritických míst: `frontend_syntax.test.js`
  (`node --check` nad `public/*.js`), `pathsafe.test.js`, `mutex.test.js`, `ragRequest.test.js`,
  `hearings.test.js`, `apiToken.test.js`. Živé ARES testy jsou gatované (`RUN_LIVE_ARES`), aby CI nezávisel
  na síti.
