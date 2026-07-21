# LexisLocal MCP server

MCP server, který zpřístupňuje REST API LexisLocalu jako nástroje pro **Claude**, **Claude Code**
a libovolné AI agenty. Je to zároveň bezpečná „agent write" brána — agenti přes něj zapisují
dokumenty, spouštějí LexisLocal agenty, přidávají lhůty do kalendáře atd.

## Instalace

```bash
cd mcp
npm install
```

Vyžaduje Node.js ≥ 18 a běžící LexisLocal backend (`npm run dev` v kořeni projektu).

## Konfigurace

Server se konfiguruje proměnnými prostředí:

| Proměnná | Default | Popis |
|---|---|---|
| `LEXISLOCAL_URL` | `http://127.0.0.1:4000` | Adresa běžícího LexisLocal backendu |
| `LEXISLOCAL_API_TOKEN` | – | API token (viz `.env` LexisLocalu / per-agent tokeny) |
| `LEXISLOCAL_AUTOSTART_CMD` | – | Volitelné: shell příkaz, kterým se backend automaticky spustí, když neběží (např. `docker compose up -d`). Server pak počká, než naběhne. |

Při startu server ověří dostupnost backendu (health-check) a vypíše stav. Když backend neběží
a `LEXISLOCAL_AUTOSTART_CMD` je nastavený, spustí ho a počká; jinak vypíše návod, jak ho spustit.

### Napojení do Claude Desktop / Claude Code

Přidej do konfigurace MCP serverů (`claude_desktop_config.json`, resp. `.mcp.json` u Claude Code):

```json
{
  "mcpServers": {
    "lexislocal": {
      "command": "node",
      "args": ["/ABSOLUTNÍ/CESTA/LexisLocal/mcp/index.js"],
      "env": {
        "LEXISLOCAL_URL": "http://127.0.0.1:4000",
        "LEXISLOCAL_API_TOKEN": "<tvůj-token>"
      }
    }
  }
}
```

## Nástroje

Čtení: `lexis_status`, `search_rag`, `list_inbox`, `get_document`, `list_agents`,
`check_registry`.
Zápis (agent → LexisLocal): `upload_document`, `run_agent`, `add_calendar_event`,
`log_activity`, `anonymize_text`.

## Test

```bash
npm test   # smoke test proti falešnému serveru (nevyžaduje běžící LexisLocal)
```
