# LexisLocal — spuštění celého stacku jedním příkazem (Docker)

Rozjede backend + **Ollama** (a stáhne modely) + Paperless najednou.

## 1) Konfigurace

```bash
cp .env.example .env
```

Vyplň v `.env` alespoň:
- `LEXIS_API_TOKEN` — token backendu (použije ho i MCP/plugin). Např. `openssl rand -hex 32`
- `POSTGRES_PASSWORD`, `PAPERLESS_SECRET_KEY`

## 2) Start

```bash
docker compose up -d
```

Při prvním startu služba `ollama-init` **stáhne doporučené modely** (`LEXIS_LLM_MODEL`,
`LEXIS_EMBED_MODEL`) — může chvíli trvat. Backend pak běží na `http://localhost:4000`.

## Modely

Uprav v `.env`:
- `LEXIS_LLM_MODEL` (default `llama3`)
- `LEXIS_EMBED_MODEL` (default `nomic-embed-text`)

⚠️ Změna embedding modelu vyžaduje **reindex RAG** (jinak nesedí vektory).

## Napojení pluginu / MCP

Do MCP/pluginu zadej stejný `LEXIS_API_TOKEN` a URL `http://127.0.0.1:4000`.

## Publikovaný image (GHCR)

Workflow `.github/workflows/docker-publish.yml` builduje a publikuje image backendu
na `ghcr.io/<owner>/lexislocal-backend` při tagu `v*`. Compose pak může místo `build:`
použít `image: ghcr.io/<owner>/lexislocal-backend:latest`.
