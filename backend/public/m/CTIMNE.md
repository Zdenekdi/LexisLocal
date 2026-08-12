# LexisEditor Mobile (/m)

Mobilní editor LexisEditoru, servírovaný přímo z LexisLocalu na cestě **`/m`**.
Je to tenký klient: veškerá AI běží na LexisLocalu (Ollama), telefon jen volá
`POST /api/agent/:agentId`. Data zůstávají na serveru (lokálně, GDPR-friendly).

## Jak se k němu dostat

- **Ze stejného počítače (ladění):** http://127.0.0.1:4000/m
- **Z telefonu/tabletu (LAN):** LexisLocal musí být vázán na síť:
  spustit backend s `BIND_HOST=0.0.0.0` (jinak je dostupný jen z loopbacku).
  Pak na telefonu: `http://<IP-počítače>:4000/m`

## Token (zabezpečení)

Statický HTML shell `/m` se servíruje bez tokenu — a **záměrně se do něj
token nevkládá** (na rozdíl od dashboardu na `/`, kam se vkládá jen přes
loopback). Přes LAN by injektáž tokenu do stránky byla únik.

Telefon proto token zadá **jednou** přes ⚙ „Připojení" v editoru
(uloží se do `localStorage`, klíč `ll_token`). Base URL nechte prázdné —
stránka volá `/api` na stejném původu, odkud byla načtena.

Token vypíše backend při startu (řádek „Token pro editor: …").

## Poznámka k firemnímu režimu

Při `BIND_HOST=0.0.0.0` je z LAN dostupný i dashboard na `/`, do kterého se
token vkládá bez omezení na loopback. Pro nasazení do nedůvěryhodné sítě to
zvažte (viz TODO: omezit injektáž dashboardu jen na loopback / párování LexisLink).
