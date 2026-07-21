# LexisLocal — Claude Code / Cowork plugin

Oficiální plugin, který napojí Claude Code (i Cowork) na běžící **LexisLocal** backend přes
MCP server. Přidá nástroje pro RAG vyhledávání ve spisech, práci s dokumenty, spouštění
právních AI agentů, kalendář, anonymizaci a registry — a skill, který Claude navede, jak je používat.

## Instalace

```bash
# 1) v Claude Code přidej marketplace z tohoto repa a nainstaluj plugin
/plugin marketplace add Zdenekdi/LexisLocal
/plugin install lexislocal@lexis

# 2) doinstaluj závislosti MCP serveru (jednorázově)
cd ~/.claude/plugins/*/lexislocal*/mcp && npm install
```

Při instalaci si Claude Code vyžádá **API token** (z `.env` LexisLocalu nebo per-agent token
přes `scripts/agent-token.js`) a volitelně **URL** backendu (default `http://127.0.0.1:4000`).

## Předpoklady

Běžící LexisLocal backend: v kořeni projektu `npm run dev`.

## Nástroje

Čtení: `lexis_status`, `search_rag`, `list_inbox`, `get_document`, `list_agents`, `check_registry`.
Zápis (vyžaduje scope `write`): `upload_document`, `run_agent`, `add_calendar_event`,
`log_activity`, `anonymize_text`.
