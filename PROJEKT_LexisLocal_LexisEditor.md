# LexisLocal + LexisEditor — projektový dossier

_Stav k 26. 7. 2026. Jeden zdroj pravdy pro směřování obou aplikací: kde jsme, co je hotové, co zbývá a v jakém pořadí to dělat._

---

## 1. Shrnutí (executive summary)

LexisLocal a LexisEditor tvoří dvojici propojených desktopových aplikací pro českou advokacii, které běží **lokálně u uživatele** (žádná data neopouštějí stroj). LexisLocal je lokální AI ekosystém (Express backend + Electron tray + Docker/paperless-ngx), LexisEditor je AI-native textový editor pro advokáty (Electron + Quill).

V poslední fázi vývoje se projekt posunul z „funkční, ale rizikové bety" do stavu, kdy jsou **uzavřené hlavní bezpečnostní díry**, backend je **architektonicky rozbitý z monolitu do modulů**, přibyla **rozsáhlá testovací síť** a obě aplikace se **automaticky propojují přes API token** bez ručního zadávání. Zbývají spíš „produktové" a „úklidové" věci než kritické opravy: dokončit rozbití posledních dvou velkých souborů, dotáhnout vynucení tokenu na výchozí, a pak stavět nové funkce (příprava e-mailové přílohy, auto-koncept e-mailu klientovi, mobilní aplikace).

**Doporučení pro nejbližší krok:** provést reálný smoke test vynucení tokenu v editoru a přepnout ho na výchozí zapnuto — je to poslední bezpečnostní položka a všechno kolem je připravené. Teprve pak novou funkcionalitu.

---

## 2. Architektura

### LexisLocal (backend + tray)

- **`backend/server.js`** — už jen bootstrap (~136 řádků): autentizace, montáž routerů, `/api/status`, background úlohy.
- **`backend/routes/*.js`** — 22 doménových routerů (agents, document, workflows, audit, activity, conflicts, judikatura, managerial, alerts, rag, watcher, calendar, models, system, registry, registries, paperless, email, campaigns, inbox, agent, agent-swarm).
- **`backend/lib/*`** — 33 modulů (orchestrator, rag, watcher, ocr, anonymizer, database, audit, `secure_crypto`, `api_token`, `pathsafe`, `rag_request`, `ollama_client`, `agent_fallback`, green_monitor…).
- **`backend/public/*`** — dashboard (webové UI, třída `LexisLocalApp`).
- **Docker compose** — paperless-ngx + postgres + redis (správa dokumentů).
- **Testy** — `backend/tests/*` (jest), 35 souborů.

### LexisEditor (desktop editor)

- **`main.js`** (1677 řádků) — Electron main proces / IPC handlery.
- **`preload.js`** — contextBridge (bezpečné API pro renderer).
- **`index.html`** (2116 řádků) — renderer.
- **`js/core/*`** — jádro (`lexis-lock.js` zámek/scrypt, `lexis-zfo.js` parsování .zfo, `lexis-link-security.js`, isds-client, isds-inbox, isds-outbox, lexis-contacts, lexis-calendar, lexis-legal-* …).
- **`js/providers/ai-provider.js`** — napojení na AI (vč. LexisLocal).
- **`js/ui/*`** — UI. `lexis-ui.js` je stále velký (~340 KB), ale část už je vytažená do modulů (lexis-datovka, lexis-dialogs, lexis-forward-client, lexis-parties, lexis-reply, lexis-actions…).
- **Testy** — `tests/unit/*` (jest, 18 souborů) + Playwright e2e.

---

## 3. Co je hotové (poslední fáze)

### 🔒 Bezpečnost

- **Šifrovací klíč mimo data + AES-256-GCM.** `secure_crypto.js` je jediný zdroj; klíč v `~/.lexislocal/lexis.key` (0600) mimo `WATCH_DIR`, starý klíč se při startu zmigruje a smaže z dat. Nové zápisy GCM (integrita přes autentizační tag), starý CBC se stále přečte. Pokryto testy (round-trip, legacy, detekce manipulace, migrace).
- **Šifrování auditního logu** stejným mechanismem (GCM, sdílený klíč).
- **Zúžení sítě** — backend na `127.0.0.1` (LAN jen vědomě přes `BIND_HOST`), omezený CORS, Host-guard proti DNS-rebindingu.
- **API token — auto-provisioning.** `lib/api_token.js` token vezme z `API_TOKEN`, jinak vygeneruje a perzistuje mimo data (`<keydir>/api_token`, 0600, atomicky). Dashboard ho dostane vstříknutím (`window.LEXIS_API_TOKEN`), editor ho čte přímo ze souboru přes IPC. **Uživatel nic nevkládá ručně.**
- **Editor — zámek aplikace** scrypt hash + konstantní porovnání, min. délka hesla vynucená v main procesu, legacy hash se při ověření migruje.
- **Editor — parsování `.zfo`** korektně přes node-forge (PKCS#7/CMS), heuristika jako fallback.
- **Editor — offline AI už nevymýšlí právo** (dřív vracel konkrétní paragrafy; teď jen upozornění „AI je offline").
- **LexisLink (párování s telefonem)** zabezpečen tokenem z QR (32 B náhody, konstantní porovnání, omezený CORS, strop velikosti těla).
- **Docker secrety** z `.env` (bez nich `docker compose up` selže).

### 🏗️ Architektura / refaktoring

- **`server.js` rozbit z ~2254 na ~136 řádků** — 22 routerů, sdílené helpery v `lib/`.
- **Bezpečnostní logika editoru vytažena z `main.js`** do testovatelných modulů (`lexis-lock.js`, `lexis-zfo.js`).
- **Dashboard resuscitován** — byl mrtvý kvůli uklouzlé `}`; opraveno a zajištěno regresním testem (`node --check` nad `public/*.js`).

### ✅ Testy

- **LexisLocal:** přibyly `frontend_syntax`, `pathsafe`, `mutex`, `ragRequest`, `hearings`, `apiToken`, `auth` (živé ARES gatované přes `RUN_LIVE_ARES`).
- **LexisEditor:** přibyly `lock`, `zfo`, `isdsInbox`, `isdsOutbox`, `contacts`.

### 🔗 Integrace

- **Editor ↔ LexisLocal token** — editor posílá token automaticky v hlavičce `X-API-Token` (`ai-provider.js` i `lexis-ui.js`); až se na backendu zapne vynucení, editor funguje bez zásahu.

---

## 4. Co zbývá — prioritizovaný backlog

Legenda náročnosti: 🟢 malá (hodiny) · 🟡 střední (dny) · 🔴 velká (týden+). Riziko = šance, že to něco rozbije.

| # | Úkol | Náročnost | Riziko | Hodnota |
|---|------|-----------|--------|---------|
| 1 | **Smoke test + přepnutí vynucení tokenu na výchozí** (`LEXIS_ENFORCE_TOKEN=1`) | 🟢 | nízké | vysoká (poslední bezpeč. položka) |
| 2 | **CHANGELOG editoru** doplnit záznam 3.4.1 (README už sedí) | 🟢 | žádné | nízká (hygiena) |
| 3 | **Rozbít `public/app.js`** (3942 ř.) do prototype-mixinů | 🔴 | střední | střední (údržba) |
| 4 | **Dorozbít `js/ui/lexis-ui.js`** (~340 KB) + oddělit JS z `index.html` | 🔴 | střední | střední (údržba) |
| 5 | **Příprava e-mailové přílohy** automaticky (viz §6) | 🟡 | nízké | vysoká (uživatelská) |
| 6 | **Auto-koncept e-mailu klientovi** z adresáře, advokát jen potvrdí | 🟡 | nízké | vysoká (uživatelská) |
| 7 | **Pro edice pro advokáty** oddělená od základu (viz §5) | 🔴 | střední | vysoká (produkt) |
| 8 | **Mobilní aplikace editoru** (odloženo naposled) | 🔴 | vysoké | vysoká (produkt) |
| 9 | Integrační testy IPC handlerů v `main.js` (ISDS auth flow) | 🟡 | nízké | střední |

---

## 5. Produktová strategie

**Dva stupně produktu:**

- **Základ (general)** — cílí na širší publikum: OSVČ, malé firmy i jednotlivce. Editor + lokální AI, správa dokumentů, datové schránky, kalendář. Bez specializovaných právních modulů.
- **Pro pro advokáty** — nadstavba: judikatura, kontrola citací, hlídání lhůt a jednání, konflikty zájmů, spisové značky, ISDS workflow, manažerské přehledy.

Oddělení edic je v kódu už rozjeté (`js/core/lexis-edition.js`, test `edition.test.js`). Klíčové rozhodnutí: co přesně je za paywallem Pro vs. v základu, a jak se edice licencuje offline (bez cloudu). To je produktové rozhodnutí, které je vhodné potvrdit před dalším kódováním v tomto směru.

**Cílení:** firmy (advokátní kanceláře) i jednotlivci (samostatní advokáti, koncipienti, OSVČ). Základ jako vstupní bod, Pro jako upsell.

---

## 6. Feature roadmapa (nové funkce)

### E-mailová příloha automaticky připravená

Cíl: když advokát dokončí dokument, systém rovnou nachystá e-mail s dokumentem jako přílohou — advokát jen zkontroluje a odešle. Základ už existuje (`compose-email-attach` IPC v editoru, `js/ui/lexis-forward-client.js`, backend `routes/email.js`). Zbývá: propojit „hotový dokument → export do PDF/DOCX → příloha → předvyplněný e-mail" do jednoho plynulého kroku.

### Auto-koncept e-mailu klientovi z adresáře

Cíl: podle klienta ve spisu / adresáři (`lexis-contacts.js`, `contacts.test.js` už hotové) systém předvyplní adresáta, předmět a tělo e-mailu; advokát jen potvrdí. Navazuje na předchozí bod. Riziko nízké (jde o koncept, ne automatické odeslání) — vždy člověk potvrzuje.

### Mobilní aplikace editoru

Odloženo záměrně naposled. Nejtěžší položka (nová platforma, distribuce přes App Store/Google Play, synchronizace s desktopem). LexisLink (párování telefon ↔ PC) už existuje jako most. Doporučený přístup: začít „tenkým" mobilním klientem, který se přes LexisLink napojí na desktop, ne plnou nativní appku.

### On-device AI na telefonu (hybridní model) — doporučení z výzkumu

Telefony dnes mají vestavěnou AI (Apple Foundation Models, Gemini Nano). Doporučená strategie je **hybridní tiering**: telefonní AI pro lehké offline úkoly (shrnutí, přepis, návrh formulace), ale **autoritativní právní práci (citace, judikatura, lhůty) nechat na LexisLocal** — telefonní modely nejsou dost přesné a nesmí „vymýšlet právo". Toto pravidlo už platí i pro offline fallback v editoru.

---

## 7. Build a distribuce

- **Podepsání buildu (macOS):** OSVČ / IČO může podepisovat. Pro distribuci mimo dev je potřeba **Apple Developer Program** — **99 USD/rok** (individual/organization; Enterprise 299 USD/rok). Bez něj macOS build hlásí „neznámý vývojář" a Gatekeeper ho blokuje.
- **Windows build** (`npm run dist:win`) — code-signing certifikát zvlášť (EV/OV), řeší SmartScreen varování.
- **Auto-updater** — proto je důležité sjednotit verze (`package.json` jako jediný zdroj pravdy) a udržovat CHANGELOG.

---

## 8. Doporučené další kroky (co udělat teď)

Seřazeno podle poměru hodnota/riziko:

1. **Smoke test vynucení tokenu** — spustit backend s `LEXIS_ENFORCE_TOKEN=1`, otevřít editor, vyzkoušet AI dotaz. Když projde, přepnout vynucení na výchozí (nouzový vypínač `LEXIS_ENFORCE_TOKEN=0`). Tím se uzavře poslední bezpečnostní položka. **Vyžaduje reálný běh na Macu — je to jediná věc, kterou nemůžu odškrtnout za tebe.**
2. **Doplnit CHANGELOG 3.4.1** — triviální hygiena, důležité kvůli auto-updateru.
3. **Příprava e-mailové přílohy + auto-koncept klientovi** (§6) — vysoká uživatelská hodnota, nízké riziko, stavební kameny existují.
4. **Rozbití `public/app.js` a `lexis-ui.js`** — čistě údržbové; velké, ale bez funkčního rizika, pokud se dělá po částech s testy (jako u `server.js`).
5. **Produktové rozhodnutí o edicích** (§5) — potřebuje tvé potvrzení, co je Pro; teprve pak kódovat.
6. **Mobil** — až úplně nakonec.

---

## 9. Rizika a otevřené otázky

- **Vynucení tokenu** se nedá bezpečně přepnout na výchozí bez reálného smoke testu na Macu (riziko zamčení appky). → potřeba tvůj běh.
- **Rozdělení edic (Pro vs. základ)** — co přesně je placené, jak licencovat offline. → produktové rozhodnutí.
- **Distribuce** — bez Apple Developer účtu (99 USD/rok) nejde macOS build rozdávat mimo vlastní stroj.
- **Historie commitů** — pokud v ní bylo někdy staré heslo/secret, zvážit přepsání historie zvlášť.
- **Paralelní session** — na projektu se pracuje z více míst; před zápisy vždy ověřit živý stav (proto se soubory před editací čtou z Macu).

---

_Podklady připravil asistent. Detailní TODO stavy jsou v `CLAUDE.md` v obou repozitářích (aktualizováno)._
