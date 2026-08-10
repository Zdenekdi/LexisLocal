# Architektura LexisLocal — dva režimy nasazení a připravené švy

_Cíl: jedna codebase, dva režimy — **solo (local-first)** pro jednotlivce a **firma (klient-server)** pro AK s více uživateli. Tento dokument popisuje architektonické švy, které jsou už zavedené tak, aby firemní režim nevyžadoval přepis business logiky._

---

## Dva režimy

**Solo / local-first (dnešní výchozí).** Backend na loopbacku (`127.0.0.1`), lokální šifrovaná JSON data, jeden implicitní uživatel s plnými právy, token volitelný. Pro samostatné advokáty a nejmenší praxi.

**Firma / klient-server (budoucí Pro tier).** Centrální backend (server v kanceláři nebo self-hosted) na LAN/síti, uživatelské účty + role + etické zdi, TLS, sdílená databáze (SQLite/Postgres), firemní kontrola střetu zájmů a audit per uživatel. Velký samostatný projekt — ale codebase je na něj připravená.

Klíčové pravidlo: **backend zůstává samostatná, stále běžící služba** (hlídá lhůty, jednání, insolvence na pozadí — i když je editor zavřený). Nikdy se neslévá do editoru.

---

## Zavedené švy (hotovo)

### 1. Autentizace = principal se scopy (`lib/principal.js`)

`resolvePrincipal(req, { apiToken, enforceToken })` vrací `{ userId, name, scopes[], isAuthenticated, kind }`:

- **solo** (bez vynucení) → jeden implicitní uživatel `local` s plnými právy (`read/write/admin`) — dnešní chování;
- **per-agent token** (`agent_tokens.js` se scopy) → identita + jeho scopy — základ budoucí per-user identity;
- **hlavní API token** → lokální správce s plnými právy;
- **vynuceno + token nesedí** → `null` (401).

Nebetonuje „jeden token = plný přístup": model je „přihlášený principal se scopy". Firemní režim doplní skutečné účty/role nad stejné rozhraní. `req.principal` se nastavuje v `authenticate` (aditivně, nemění dnešní allow/deny). Pokryto `principal.test.js`.

### 2. Datová vrstva za rozhraním (`lib/store.js`)

Jednotný kontrakt úložiště (`get/set/insert/update/delete/verifyLedger`), backend volitelný přes `LEXIS_STORE` (`json|sqlite|postgres`). Dnes deleguje na šifrované JSON (`database.js`). Firemní režim zapojí SQLite (malá kancelář) nebo **Postgres** (souběžné zápisy více uživatelů — Postgres už v stacku běží pro paperless) implementací stejného rozhraní, **bez zásahu do business logiky**. Nová logika volá `store`; migrace stávajících volajících z `database` je postupná. Pokryto `store.test.js`.

> **Pozn.:** dnešní `database.js` (JSON soubory) není vhodný pro souběžné zápisy více uživatelů — před firemním nasazením přepnout `LEXIS_STORE=postgres`.

### 3. Vazba na síť (`BIND_HOST` v `server.js`)

`BIND_HOST` (výchozí `127.0.0.1`) řídí, na jaké rozhraní se server váže. Solo = loopback (nedostupné z LAN). Firma = vědomě `BIND_HOST=0.0.0.0` (nebo konkrétní IP) — **a v tom případě je POVINNÉ** zapnout vynucení tokenu (`LEXIS_ENFORCE_TOKEN=1`) a TLS (`USE_HTTPS=true`). Dashboard zůstává webový (výhoda pro firmu: nula instalace, přístup z libovolné stanice, i pro personál bez editoru).

> Oprava mimochodem: dřív `listen(PORT)` bez hosta = vazba na `0.0.0.0` (vystaveno na LAN). Nově výchozí loopback.

### 4. Šifrovací klíč (`LEXIS_KEY_DIR` v `secure_crypto.js`)

Umístění klíče je centralizované v `secure_crypto.resolveKeyDir()` (výchozí `~/.lexislocal`, přepis přes `LEXIS_KEY_DIR`). To je šev pro firemní režim: klíč tam **drží server** (server-controlled dir), ne klientské stanice, a přístup k datům gatuje **role principalu** (viz šev 1). Sdílená firemní data nesmí viset na klíči v jednom uživatelském `~/.lexislocal`.

> Plán firemního režimu: klíč na serveru; per-user přístup přes principal.scopes; zvážit per-matter klíče pro etické zdi (kdo nesmí vidět které klienty).

---

## Co firemní režim ještě vyžaduje (samostatný projekt)

Tyto věci švy jen **nezablokovaly**, samy o sobě je neimplementují:

- **Uživatelské účty + přihlášení + role** (nad `principal`/`agent_tokens`).
- **Etické zdi / oprávnění na úrovni klienta/spisu** (firemní kontrola střetu zájmů vidí celou kancelář, ale ne každý uživatel smí vidět vše).
- **Postgres backend** pro `store` (souběh) + migrace dat.
- **TLS** ve firemním nasazení (certifikáty).
- **Per-user audit** (kdo co udělal) — `transparency_logs`/`audit` rozšířit o `userId` z principalu.

---

## Shrnutí

Dnešní solo appka funguje beze změny (loopback, JSON, implicitní uživatel). Čtyři švy — principal/scopy, store rozhraní, BIND_HOST, centrální klíč — jsou zavedené a otestované tak, aby firemní klient-server režim byl **rozšíření, ne přepis**.
