@echo off
echo 🇪🇺 Spoustim LexisLocal Eko-System...

rem Check if Docker is installed
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo X Docker neni nainstalovan. Prosim nainstalujte Docker.
    exit /b 1
)

rem Check if Docker Daemon is running
docker info >nul 2>nul
if %errorlevel% neq 0 (
    echo X Docker daemon nebezi. Prosim spustte Docker Desktop.
    exit /b 1
)

rem Check if Ollama is running on host
echo 🔍 Kontroluji lokalni sluzbu Ollama...
curl -s http://localhost:11434/api/tags >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Sluzba Ollama detekovana.
) else (
    echo [VAROVANI] Lokalni sluzba Ollama nebyla detekovana.
)

rem Build and run containers
echo Spoustim kontejnery pres Docker Compose...
docker compose up -d --build

echo [OK] LexisLocal backend uspesne spusten na http://localhost:4000
echo [OK] Lexis Paperless-ngx uspesne spusten na http://localhost:8000
pause
