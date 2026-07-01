#!/usr/bin/env bash
# Rebuild and redeploy the local devchain container.
#
# Usage:
#   scripts/redeploy-local.sh
#
# Overrides (via env):
#   PROJECTS_DIR  host projects dir to mount (default: $HOME/projects)
#   IMAGE         image tag            (default: devchain-local:latest)
#   CONTAINER     container name       (default: devchain-local)
#
# Note: the container runs as uid 1000 (node). The host user owning
# $PROJECTS_DIR / ~/.devchain must also be uid 1000 for file access to work.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-devchain-local:latest}"
CONTAINER="${CONTAINER:-devchain-local}"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"

if [ ! -d "$PROJECTS_DIR" ]; then
  echo "!! PROJECTS_DIR not found: $PROJECTS_DIR" >&2
  exit 1
fi

echo "==> Building image $IMAGE ..."
docker build -t "$IMAGE" -f "$REPO_ROOT/apps/local-app/Dockerfile" "$REPO_ROOT"

echo "==> Removing existing container '$CONTAINER' (if any) ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "==> Running '$CONTAINER' (mounting $PROJECTS_DIR) ..."
docker run -d --name "$CONTAINER" \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.devchain:/home/node/.devchain" \
  -v "$PROJECTS_DIR:$PROJECTS_DIR" \
  "$IMAGE"

echo "==> Done."
docker ps --filter "name=$CONTAINER" --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
echo "    UI: http://localhost:3000"
