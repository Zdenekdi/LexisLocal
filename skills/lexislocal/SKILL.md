---
name: lexislocal
description: Práce s lokálním právním systémem LexisLocal — vyhledávání ve spisech (RAG), nahrávání dokumentů, spouštění právních AI agentů (rešeršník, spisovatel, kontrolor), kalendář a lhůty, anonymizace a ověření v registrech. Použij, když uživatel chce pracovat se svými spisy/dokumenty v LexisLocalu nebo delegovat úkol na LexisLocal agenty.
---

# LexisLocal

Přes MCP server `lexislocal` máš nástroje k lokálnímu, offline-first právnímu ekosystému
LexisLocal. Data nikdy neopouštějí počítač uživatele.

## Kdy co použít

- **Najít v spisech** → `search_rag` (sémantické vyhledávání). Vždy zkus nejdřív tohle, než
  budeš něco tvrdit o obsahu spisů.
- **Přečíst konkrétní dokument** → `list_inbox` (přehled) a `get_document` (obsah podle názvu).
- **Zapsat/založit dokument** → `upload_document` (obsah v base64). Takto do systému něco přidáš.
- **Delegovat na právního agenta** → `run_agent` s `agentId` z `list_agents`
  (např. `resersnik` = rešerše, `spisovatel` = draftování podání, `kontrolor` = audit rizik).
- **Lhůta / jednání** → `add_calendar_event`.
- **Výkaz práce** → `log_activity`.
- **Anonymizace osobních údajů** → `anonymize_text` (GDPR).
- **Ověřit subjekt podle IČO** → `check_registry`.

## Zásady

- Nástroje `search_rag`, `get_document`, `list_*`, `check_registry` jsou **čtení**; ostatní
  (`upload_document`, `run_agent`, `add_calendar_event`, `log_activity`, `anonymize_text`)
  jsou **zápisy** a vyžadují token se scope `write`. Pokud dostaneš chybu „nemá oprávnění write",
  uživatel používá read-only token — řekni mu to.
- Nevymýšlej si obsah spisů — čerpej z `search_rag` / `get_document`.
- U právních výstupů připomeň, že jde o podklad k ověření advokátem, ne o závaznou radu.
- Každý zápis se automaticky loguje do auditního ledgeru LexisLocalu (AI Act transparency).

## Předpoklady

Běžící LexisLocal backend (`npm run dev`) a platný token (viz nastavení pluginu / `.env`).
