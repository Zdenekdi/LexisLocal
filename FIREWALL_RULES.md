# LexisLocal — Průvodce síťovou bezpečností a firewallovými pravidly

Tento dokument obsahuje detailní konfiguraci pro zabezpečení serveru **LexisLocal** v advokátní kanceláři. Cílem je garantovat 100% datovou suverenitu a zamezit nechtěnému odeslání klientských dat mimo lokální síť (LAN).

---

## 1. Doporučená firewallová pravidla ( pfSense / OPNsense / UTM )

Pro server, na kterém běží LexisLocal backend a Ollama moduly, doporučujeme nastavit následující pravidla odchozí a příchozí komunikace:

| Priorita | Rozhraní | Směr | Zdroj | Cíl | Port / Protokol | Akce | Důvod / Poznámka |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | LAN | Příchozí | Libovolný (LAN) | IP Serveru | `11434` (TCP) | **POVOLIT** | Přístup pracovních stanic k Ollama API |
| **2** | LAN | Příchozí | Libovolný (LAN) | IP Serveru | `3000` (TCP) | **POVOLIT** | Přístup k webovému dashboardu LexisLocal |
| **3** | WAN | Odchozí | IP Serveru | `justice.cz`, `isir.cz`, `ares.gov.cz` | `443` (TCP/HTTPS) | **POVOLIT** | Načítání dat z veřejných rejstříků (jednosměrný příjem) |
| **4** | WAN | Odchozí | IP Serveru | `mojedatovaschranka.cz` | `443` (TCP/HTTPS) | **POVOLIT** | Připojení k ISDS (povinná komunikace) |
| **5** | WAN | Odchozí | IP Serveru | `huggingface.co`, `ollama.com` | `443` (TCP/HTTPS) | **DOČASNĚ POVOLIT** | Stahování modelů (pouze v servisním okně) |
| **6** | WAN | Odchozí | IP Serveru | Libovolný (Internet) | Všechny | 🚫 **BLOKOVAT** | Výchozí pravidlo (Default Block) |

---

## 2. Hardening klientských stanic (MS Office Telemetrie)

Doplněk pro Microsoft Word může na pozadí odesílat diagnostická a telemetrická data společnosti Microsoft. Pro úplnou suverenitu doporučujeme nastavit Group Policy na všech stanicích takto:

1. Otevřete editor místních zásad skupiny (`gpedit.msc`).
2. Přejděte na: `Konfigurace uživatele -> Šablony pro správu -> Microsoft Office 2016 -> Nastavení ochrany osobních údajů -> Centrum zabezpečení`.
3. Aktivujte zásadu **Úroveň diagnostických dat** (Diagnostic Data Level) a nastavte ji na hodnotu `0` (Žádná diagnostická data).
4. Deaktivujte možnost **Propojené služby** (Connected Experiences).

---

## 3. Zákaz cloudových záloh

Provádění cloudových záloh (OneDrive, Google Drive, Dropbox atd.) nad pracovní složkou spisů (`Desktop/LexisSpisy`) musí být zakázáno. Zálohování by mělo být nastaveno striktně lokálně na:
- Interní firemní **NAS** (Network Attached Storage) v šifrovaném svazku.
- Lokální externí disky s šifrováním **FileVault** (macOS) nebo **BitLocker** (Windows).
