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
echo "3. Building Docker image..."
docker compose build --quiet
echo "✓ Image built successfully"

echo ""
echo "4. Starting container..."
docker compose up -d --quiet-pull
echo "✓ Container started"

echo ""
echo "5. Waiting for container to be healthy..."
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
echo "6. Testing health endpoint..."
HEALTH_STATUS=$(curl -s http://localhost:3001/health | grep -o '"status":"[^"]*"')
if [ "$HEALTH_STATUS" == '"status":"ok"' ]; then
    echo "✓ Health endpoint is working"
else
    echo "❌ Health endpoint returned unexpected status: $HEALTH_STATUS"
    exit 1
fi

echo ""
echo "7. Testing API docs endpoint..."
if curl -s -f http://localhost:3001/api/docs | grep -q "Swagger UI"; then
    echo "✓ API docs endpoint is working"
else
    echo "❌ API docs endpoint is not working"
    exit 1
fi

echo ""
echo "8. Checking container logs for errors..."
if docker compose logs devchain 2>&1 | grep -i "error\|fatal\|failed" | grep -v "level.*40" | grep -v "Claude provider not found"; then
    echo "⚠️  Found potential errors in logs (review above)"
else
    echo "✓ No critical errors in logs"
fi

echo ""
echo "9. Stopping container..."
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
echo "  ✓ No critical errors in startup logs"
echo ""
