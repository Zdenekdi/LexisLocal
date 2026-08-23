#!/usr/bin/env bash
# scripts/smoke-all.sh — spustí LexisLocal v IZOLOVANÉ throwaway DB a proběhne
# end-to-end smoke test. NEŠAHÁ na tvoje reálné spisy/nastavení.
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-4000}"
export API_TOKEN="smoke-$$"
export WATCH_DIR="$(mktemp -d -t lexis-smoke-XXXX)"
export LEXIS_KEY_DIR="$WATCH_DIR/keys"
export PORT

echo "🧪 LexisLocal smoke test"
echo "   izolovaná data: $WATCH_DIR"
echo "   port: $PORT"

# 1) Ollama (nepovinné — bez něj agenti jedou fallback)
if curl -s -m 2 "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  echo "   ✅ Ollama běží"
else
  echo "   ⚠️  Ollama neběží — agenti pojedou fallback (test i tak projde). Spusť 'ollama serve' pro plný běh."
fi

# 2) Backend na pozadí
echo "   ▶️  startuji backend…"
node backend/server.js >"$WATCH_DIR/server.log" 2>&1 &
SRV_PID=$!

cleanup() {
  kill "$SRV_PID" >/dev/null 2>&1
  rm -rf "$WATCH_DIR" >/dev/null 2>&1
}
trap cleanup EXIT

# 3) Počkej, až server odpoví (max ~15 s)
for i in $(seq 1 30); do
  if curl -s -m 1 "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SRV_PID" 2>/dev/null; then echo "   ⛔ backend spadl při startu:"; tail -20 "$WATCH_DIR/server.log"; exit 2; fi
  sleep 0.5
done

# 4) Smoke test
node scripts/smoke.js
RESULT=$?

if [ $RESULT -eq 0 ]; then echo "🎉 Vše prošlo."; else echo "❌ Něco selhalo (viz výše). Log serveru: $WATCH_DIR/server.log"; fi
exit $RESULT
