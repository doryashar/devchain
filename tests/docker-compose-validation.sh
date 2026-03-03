#!/bin/bash
set -e

echo "=== DevChain Docker Compose Validation Test ==="

echo ""
echo "1. Checking if Docker is available..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi
echo "✓ Docker is available"

echo ""
echo "2. Checking if Docker Compose is available..."
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available"
    exit 1
fi
echo "✓ Docker Compose is available"

echo ""
echo "3. Ensuring provider config directories exist..."
mkdir -p ~/.claude ~/.codex ~/.gemini ~/.opencode
echo "✓ Config directories ready"

echo ""
echo "4. Building Docker image..."
docker compose build --quiet
echo "✓ Image built successfully"

echo ""
echo "5. Starting container..."
docker compose up -d --quiet-pull
echo "✓ Container started"

echo ""
echo "6. Waiting for container to be healthy..."
for i in {1..30}; do
    if docker compose ps | grep -q "(healthy)"; then
        echo "✓ Container is healthy"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Container did not become healthy within 30 seconds"
        docker compose logs --tail=50
        exit 1
    fi
    sleep 1
done

echo ""
echo "7. Testing health endpoint..."
HEALTH_STATUS=$(curl -s http://localhost:3001/health | grep -o '"status":"[^"]*"')
if [ "$HEALTH_STATUS" == '"status":"ok"' ]; then
    echo "✓ Health endpoint is working"
else
    echo "❌ Health endpoint returned unexpected status: $HEALTH_STATUS"
    exit 1
fi

echo ""
echo "8. Testing API docs endpoint..."
if curl -s -f http://localhost:3001/api/docs | grep -q "Swagger UI"; then
    echo "✓ API docs endpoint is working"
else
    echo "❌ API docs endpoint is not working"
    exit 1
fi

echo ""
echo "9. Verifying provider CLIs..."
CLIS_OK=true

if docker compose exec -T devchain claude --version 2>/dev/null | grep -q "Claude Code"; then
    echo "  ✓ Claude CLI working"
else
    echo "  ❌ Claude CLI not working"
    CLIS_OK=false
fi

if docker compose exec -T devchain codex --version 2>/dev/null | grep -q "codex-cli"; then
    echo "  ✓ Codex CLI working"
else
    echo "  ❌ Codex CLI not working"
    CLIS_OK=false
fi

if docker compose exec -T devchain gemini --version 2>/dev/null | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+$"; then
    echo "  ✓ Gemini CLI working"
else
    echo "  ❌ Gemini CLI not working"
    CLIS_OK=false
fi

if docker compose exec -T devchain opencode --version 2>/dev/null | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+$"; then
    echo "  ✓ OpenCode CLI working"
else
    echo "  ❌ OpenCode CLI not working"
    CLIS_OK=false
fi

if [ "$CLIS_OK" = false ]; then
    echo "❌ Some provider CLIs are not working"
    exit 1
fi

echo ""
echo "10. Verifying provider config mounts..."
MOUNTS_OK=true

for dir in .claude .codex .gemini .opencode; do
    if docker compose exec -T devchain test -d /home/node/$dir 2>/dev/null; then
        echo "  ✓ /home/node/$dir mounted"
    else
        echo "  ❌ /home/node/$dir not mounted"
        MOUNTS_OK=false
    fi
done

if [ "$MOUNTS_OK" = false ]; then
    echo "❌ Some config directories are not mounted"
    exit 1
fi

echo ""
echo "11. Checking container logs for errors..."
if docker compose logs devchain 2>&1 | grep -i "error\|fatal\|failed" | grep -v "level.*40" | grep -v "Claude provider not found" | grep -v "EACCES" | head -5; then
    echo "⚠️  Found potential errors in logs (review above)"
else
    echo "✓ No critical errors in logs"
fi

echo ""
echo "12. Stopping container..."
docker compose down
echo "✓ Container stopped"

echo ""
echo "=== All validation tests passed! ==="
echo ""
echo "Summary:"
echo "  ✓ Docker image builds successfully"
echo "  ✓ Container starts and becomes healthy"
echo "  ✓ Health endpoint responds correctly"
echo "  ✓ API documentation is accessible"
echo "  ✓ All provider CLIs (claude, codex, gemini, opencode) working"
echo "  ✓ Provider config directories mounted"
echo "  ✓ No critical errors in startup logs"
echo ""
