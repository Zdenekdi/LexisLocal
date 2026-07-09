#!/bin/bash
echo "🇪🇺 Spouštím LexisLocal Eko-Systém..."

# Check if Docker is installed
if ! command -v docker &> /dev/null
then
    echo "❌ Docker není nainstalován. Prosím nainstalujte Docker."
    exit 1
fi

# Check if Docker Daemon is running
if ! docker info &> /dev/null
then
    echo "❌ Docker daemon neběží. Prosím spusťte Docker Desktop."
    exit 1
fi

# Check if Ollama is running on host
echo "🔍 Kontroluji lokální službu Ollama..."
if curl -s http://localhost:11434/api/tags &> /dev/null
then
    echo "✅ Služba Ollama detekována."
else
    echo "⚠️ Lokální služba Ollama nebyla detekována na portu 11434. Ujistěte se, že běží, pokud chcete využívat AI."
fi

# Build and run containers
echo "🚀 Spouštím kontejnery přes Docker Compose..."
docker compose up -d --build

echo "✅ LexisLocal backend úspěšně spuštěn na http://localhost:4000"
echo "✅ Lexis Paperless-ngx úspěšně spuštěn na http://localhost:8000"
