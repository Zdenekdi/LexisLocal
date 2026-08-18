# Návrh edic: Základ vs. Pro — LexisLocal / LexisEditor

_Návrh k rozhodnutí. Mechanismus `lexis-edition.js` je hotový a otestovaný; tento dokument řeší jen **produktovou otázku: co přesně je placené**. Nic se tímto neimplementuje — čeká na tvé schválení._

---

## 1. Vodicí princip (a jedna tvrdá hranice)

Členění stavím na jedné ose, která je zároveň marketingově čitelná i eticky bezpečná:

> **Základ = „advokát a jeho spis".  Pro = „kancelář a její provoz".**

Tato osa se navíc **kryje s existujícím rozdělením `data-pack="legal|business"`** — `legal` je jádro právní práce jednotlivce, `business` je management/provoz kanceláře. Nemusíš tedy vymýšlet nové tagy, jen rozhodnout, co je v Pro.

**Tvrdá hranice (doporučuji ji držet bez výjimky):** za paywall NIKDY nedávat funkci, jejíž absence může způsobit **zmeškání lhůty, nezachycený střet zájmů, chybné doručení do ISDS nebo únik osobních údajů.** To nejsou „prémiové" funkce — to jsou pojistky proti odpovědnostní škodě a kárnému provinění. Paywallovat se má **rozsah, automatizace, hloubka AI a týmový provoz**, ne bezpečnost. Vše bezpečnostně kritické proto patří do **Základu**, i kdyby to byla „pokročilá" funkce.

---

## 2. Návrh členění

### Edice ZÁKLAD (jádro — `data-pack="core"`)

Vše, co potřebuje sólo advokát k bezpečné práci na spisu, plus všechny pojistky:

- **Editor** — psaní, šablony, vyplňování proměnných (mail-merge nad jedním dokumentem).
- **Právní linker + kalkulačky** — odkazy na §, soudní poplatky, výpočet lhůt (dny i měsíce/týdny/roky).
- **Hlídání lhůt a jednání** — extrakce lhůt (vč. jednotek) + upozornění. _(pojistka)_
- **Kontrola střetu zájmů** — RAG + historie, fail-closed při výpadku modelu. _(pojistka)_
- **Anonymizace osobních údajů** před indexací i logováním. _(pojistka / GDPR)_
- **ISDS** — odesílání, inbox, výzvy, ověřený rejstřík datových schránek soudů. _(pojistka — správné doručení)_
- **ARES + ISIR** — ověření subjektu a insolvence. _(pojistka)_
- **Lokální RAG vyhledávání** — sémantické, s lexikálním fallbackem (funguje i bez modelu).
- **1 AI asistent** (základní agent) — dotaz nad spisem, jeden model.
- **Lokální šifrování, auditní log, solo režim** (127.0.0.1).

### Edice PRO (kancelář — `data-pack="pro"`, mapuje na `business` + pokročilé `legal`)

Nadstavba pro provoz, rozsah a hloubku:

- **AI swarm / orchestrátor** — víc agentů (Rešeršník, Stylista, Kontrolor, Sekretářka, Spisovatel), vícekrokové úlohy.
- **Externí rešerše** — LawGPT, DirectCase (judikatura, ověření citací z externích zdrojů).
- **Manažerský přehled + timetracking + reporting** — vytížení, výkazy, fakturace.
- **Paperless-ngx integrace** — obousměrná synchronizace metadat.
- **E-mailové kampaně / hromadná korespondence** ve velkém.
- **Firemní režim** — víc uživatelů (principal + scopes), úložiště SQLite/PostgreSQL, provoz po LAN (token + TLS).
- **Pokročilé ladění RAG** a větší modely, priorita, in-app auto-update.

---

## 3. Přehledová tabulka

| Funkce | Základ | Pro | Proč tam patří |
|---|:---:|:---:|---|
| Editor, šablony, proměnné | ✅ | ✅ | jádro |
| Právní linker, kalkulačky (poplatky/lhůty) | ✅ | ✅ | jádro |
| Hlídání lhůt a jednání | ✅ | ✅ | **pojistka** |
| Kontrola střetu zájmů | ✅ | ✅ | **pojistka** |
| Anonymizace / GDPR | ✅ | ✅ | **pojistka** |
| ISDS + rejstřík schránek soudů | ✅ | ✅ | **pojistka** |
| ARES / ISIR insolvence | ✅ | ✅ | **pojistka** |
| Lokální RAG (sémantika + lexikální fallback) | ✅ | ✅ | jádro |
| 1 AI asistent (základní) | ✅ | ✅ | jádro |
| AI swarm / orchestrátor | — | ✅ | hloubka |
| Externí rešerše (LawGPT / DirectCase) | — | ✅ | externí data |
| Manažerský přehled + timetracking | — | ✅ | provoz |
| Paperless-ngx | — | ✅ | integrace |
| Kampaně / hromadná korespondence | — | ✅ | rozsah |
| Firemní režim (multiuser, SQLite/PG, LAN+TLS) | — | ✅ | tým |
| Auto-update, priorita, větší modely | — | ✅ | komfort |

---

## 4. Sporné body — rozhodni prosím ty

1. **Externí rešerše (LawGPT je zdarma/veřejné).** Dal bych do Pro jako „pokročilý výzkum". Alternativa: LawGPT (zdarma) nechat v Základu a paywallovat jen DirectCase (placené API). — _Doporučuji: LawGPT v Základu, DirectCase v Pro_ (neplatíš dvakrát za nic).
2. **AI: základní vs. swarm.** Nechat v Základu jednoho agenta a swarm dát do Pro? Nebo v Základu nechat swarm bez externích zdrojů? — _Doporučuji: 1 agent Základ, swarm Pro._
3. **Timetracking.** Pro sólo advokáta je to pomůcka k fakturaci, ne provoz kanceláře — zvaž ho nechat v Základu (levný „hook" k Pro upsellu). — _Doporučuji: základní timetracking v Základu, reporting/manažerský přehled v Pro._
4. **Cena/model.** Návrh je nezávislý na ceně; jen upozorňuji, že firemní režim (multiuser + TLS + DB) je jediná část s reálnými provozními náklady u tebe → přirozený strop Pro / důvod pro „Pro+/Firma".

---

## 5. Jak to zapojit (až schválíš)

Mechanismus už existuje (`lexis-edition.js`), takže jde jen o **otagování** a jeden gate:

1. **Otagovat prvky** v editoru i dashboardu atributem `data-pack`:
   - `data-pack="core"` (nebo bez atributu) — vždy dostupné,
   - `data-pack="pro"` — jen v Pro.
   Mapování na `legal|business` zůstává platné, `pro` je jen sjednocující nálepka pro fakturaci.
2. **Gating logika:** UI prvky bez oprávnění skrýt/zamknout; backend routy Pro funkcí odmítnout na serveru (ne jen skrýt v UI) — jinak jde paywall obejít přímým voláním API.
3. **Fail-open u pojistek:** kdyby edice nešla ověřit (offline, chyba licence), **jádro a všechny pojistky musí zůstat funkční** — nikdy neblokovat hlídání lhůt kvůli problému s licencí.
4. **Upgrade tok:** zamčený prvek → jasná výzva „součást edice Pro" + odkaz; žádné tiché selhání.
5. **Testy:** k `lexis-edition.js` doplnit test „prvek `data-pack=pro` je v Základu skrytý a jeho backend route vrací 403", a „všechny `core`/pojistkové prvky jsou dostupné ve všech edicích".

---

## 6. Shrnutí doporučení

Dvě edice na ose **spis (Základ) vs. kancelář (Pro)**, kryjící se s existujícím `legal|business`. Do Pro: swarm, externí rešerše (kromě LawGPT), manažerský přehled/reporting, Paperless, kampaně, firemní režim. Do Základu: vše ostatní — a **bez výjimky všechny bezpečnostní pojistky**. Gating vynutit i na backendu, u pojistek fail-open.
