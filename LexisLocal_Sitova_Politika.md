# Dodatek k projektovému návrhu
## Síťová politika a datová suverenita
**Verze 1.0 | Květen 2026**

---

### 1. Účel dokumentu
Tento dodatek explicitně definuje, které síťové operace systém **LexisLocal** provádí, jakým směrem data toků probíhají a zda při nich dochází k přenosu klientských dat mimo lokální síť (LAN). Dokument slouží jako podklad pro bezpečnostní audit, GDPR dokumentaci a nastavení firewallových pravidel v advokátní kanceláři.

---

### 2. Základní princip: jednosměrný tok
Klíčové rozlišení, které hlavní projektový návrh explicitně neuvádí:
* **Lokální izolace klientských dat**: Veškerá klientská data (obsah dokumentů, vstupy do chatu, historie dotazů, sémantická paměť a systémové logy) jsou uložena a zpracovávána výhradně lokálně uvnitř privátní sítě (LAN) na dedikovaném serveru kanceláře. Lokální LLM instance (Ollama) i Whisper přepis běží 100% offline.
* **Jednosměrný odchozí provoz pro veřejná data**: Komunikace s vnějším internetem je striktně jednosměrná. Systém se dotazuje pouze na veřejné registry (stahuje metadata a veřejné údaje) bez odesílání obsahu klientských spisů. Jedinou výjimkou z tohoto pravidla je zákonem definovaná komunikace s ISDS.

---

### 3. Mapa síťového provozu
Následující tabulka klasifikuje veškerý síťový provoz systému LexisLocal:

| ID | Služba / Účel | Směr komunikace | Protokol | Cílová adresa / Doména | Port | Obsahuje klientská data? | Bezpečnostní dopad |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Lokální LLM (Ollama)** | LAN (Příchozí) | TCP | IP lokálního serveru | `11434` | **ANO** (pouze v LAN) | Zcela bezpečné – data neopouští vnitřní síť kanceláře. |
| **2** | **LexisLocal API** | LAN (Příchozí) | TCP | IP lokálního serveru | `3000` | **ANO** (pouze v LAN) | Zcela bezpečné – data neopouští vnitřní síť kanceláře. |
| **3** | **Registr ARES** | WAN (Odchozí) | HTTPS | `ares.gov.cz` | `443` | **NE** (pouze dotazované IČO) | Minimální – odesílá se pouze veřejné identifikační číslo. |
| **4** | **Insolvenční rejstřík (ISIR)** | WAN (Odchozí) | HTTPS | `isir.justice.cz` | `443` | **NE** (pouze dotazované IČO/jméno) | Minimální – vyhledávání subjektů ve veřejném rejstříku. |
| **5** | **e-Sbírka / Zákony pro lidi** | WAN (Odchozí) | HTTPS | `zakonyprolidi.cz` | `443` | **NE** (pouze ID/paragraf zákona) | Bezpečné – dotazování na legislativní předpisy. |
| **6** | **Datové schránky (ISDS)** | WAN (Obousměrný) | HTTPS | `mojedatovaschranka.cz` | `443` | **ANO** (odesílaná podání) | Vyžadováno zákonem. End-to-end šifrovaný státní kanál. |
| **7** | **DopisOnline (Česká pošta)** | WAN (Odchozí) | HTTPS | `postservis.cz` | `443` | **ANO** (generovaný dopis) | Služba hybridní pošty, přenos šifrovaným HTTPS. |

---

### 4. Risková upozornění
Následující body vyžadují explicitní konfiguraci při implementaci:
1. **Ochrana před Cloud LLM Fallbackem**:
   Některé AI knihovny standardně používají cloudové zálohy (např. OpenAI API), pokud lokální Ollama neodpovídá. V souboru `backend/config/deployment_security.json` musí být striktně nastaveno `"OLLAMA_FALLBACK": "none"`.
2. **Globální zakázání telemetrie**:
   Je nutné se ujistit, že externí sledovací balíčky (telemetrie, chybové reporty Sentry) jsou deaktivovány. To je vynuceno volbou `"TELEMETRY_ENABLED": false`.
3. **Zákaz synchronizace se spotřebitelským cloudem**:
   Pracovní složka spisů (`Desktop/LexisSpisy`) nesmí být pod správou programů jako OneDrive, Google Drive nebo Dropbox, aby nedocházelo k automatickému nahrávání rozpracovaných spisů na servery amerických korporací.
4. **Vynucení politik na klientských stanicích (MS Word)**:
   MS Word může odesílat telemetrická data přes tzv. *Propojené služby* (Connected Experiences). Administrátor musí na všech stanicích nastavit Group Policy (`gpedit.msc` -> `Centrum zabezpečení Microsoft Office`) na hodnotu diagnostických dat `0` (vypnuto).

---

### 5. Doporučená firewallová pravidla
Konfigurace pro AI server (platí pro pfSense, OPNsense nebo firemní UTM):

* **Pravidlo 1 (LAN Allow)**:
  * **Zdroj**: `LAN Net`
  * **Cíl**: `IP_Serveru_LexisLocal`
  * **Porty**: `11434`, `3000` (TCP)
  * **Akce**: `PASS` (Povolit)
* **Pravidlo 2 (WAN Allow State Services)**:
  * **Zdroj**: `IP_Serveru_LexisLocal`
  * **Cíl**: `Alias_Verejne_Registry` (obsahuje `ares.gov.cz`, `isir.justice.cz`, `mojedatovaschranka.cz`)
  * **Porty**: `443` (TCP)
  * **Akce**: `PASS` (Povolit)
* **Pravidlo 3 (WAN Block Default)**:
  * **Zdroj**: `IP_Serveru_LexisLocal`
  * **Cíl**: `ANY` (Internet)
  * **Porty**: `ANY`
  * **Akce**: `BLOCK` (Zakázat)

---

### 6. Datové schránky (ISDS) — zvláštní případ
ISDS je jedinou službou v návrhu, kde dochází k obousměrné komunikaci s klientskými dokumenty:
* Systém stahuje přijaté zprávy z datové schránky (internet → LAN) — bezpečné.
* Systém odesílá dokumenty přes datovou schránku (LAN → internet) — nevyhnutelné ze zákona.

Toto nepředstavuje bezpečnostní riziko ve smyslu GDPR, protože:
* ISDS je ze zákona povinný komunikační kanál (zákon č. 300/2008 Sb.).
* Správcem systému je Ministerstvo vnitra ČR, nikoliv komerční třetí strana.
* Komunikace je end-to-end šifrována a archivována ze zákona.
* Advokát již nyní datové schránky používá — LexisLocal pouze automatizuje stávající právní povinnosti.

---

### 7. Závěr: klasifikace systému
Na základě výše uvedené analýzy lze systém LexisLocal klasifikovat takto:
* **Třída systému**: *Strictly On-Premise, Local-First Legal Information System*.
* **GDPR status**: Systém nezavádí žádné nové externí zpracovatele osobních údajů (Cloud Processors). Všechna citlivá klientská data podléhají plné kontrole a suverenitě advokátní kanceláře. Splňuje nejvyšší požadavky na ochranu advokátního tajemství dle zákona č. 85/1996 Sb.

---
*Zdeněk Dias • Antigravity AI*

*© 2026 | LexisLocal Projektový návrh — Dodatečná dokumentace*
