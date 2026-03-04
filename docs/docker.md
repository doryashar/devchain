# Docker Support

DevChain supports running via Docker Compose for easy deployment and isolation.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2 (comes with Docker Engine)

## Quick Start

### Build and Run

```bash
# Build and start the container
docker compose up -d

# View logs
docker compose logs -f devchain

# Stop the container
docker compose down
```

### Access the Application

Once the container is running, access DevChain at:
- Web UI: http://localhost:3001
- Health Check: http://localhost:3001/health

### Provider Configuration

The container mounts your host's AI provider configurations, allowing it to use your existing API keys and authentication:

| Provider | Host Path | Container Path | CLI |
|----------|-----------|----------------|-----|
| Claude Code | `~/.claude` | `~/.claude` | `claude` |
| OpenAI Codex | `~/.codex` | `~/.codex` | `codex` |
| Google Gemini | `~/.gemini` | `~/.gemini` | `gemini` |
| OpenCode (z.ai) | `~/.opencode` | `~/.opencode` | `opencode` |
| Projects | `~/projects` | `~/projects` | - |

All paths are mounted to the same location inside the container to ensure compatibility with existing DevChain database entries. Any changes made inside the container persist on your host.

**Important**: Ensure these directories exist on your host before starting:

```bash
mkdir -p ~/.claude ~/.codex ~/.gemini ~/.opencode ~/projects
```

**Note**: The projects directory can be customized in `docker-compose.yml` if your projects are located elsewhere.

## Configuration

### Environment Variables

You can customize the deployment by setting environment variables in `docker-compose.yml`:

- `NODE_ENV`: Runtime environment (default: production)
- `HOST`: Server host (default: 0.0.0.0)
- `PORT`: Server port (default: 3000)
- `TEMPLATES_DIR`: Templates directory path

### Volume Mounts

The following volumes are used:

| Volume | Purpose |
|--------|---------|
| `devchain-data` | Main DevChain data (named volume) |
| `${HOME}/.claude` | Claude Code config (bind mount) |
| `${HOME}/.codex` | Codex config (bind mount) |
| `${HOME}/.gemini` | Gemini CLI config (bind mount) |
| `${HOME}/.opencode` | OpenCode config (bind mount) |
| `/var/run/docker.sock` | Docker socket for container management |

### Docker Socket Access

The container mounts `/var/run/docker.sock` to enable container management features. This is required for:
- Running worktrees as isolated containers
- Container orchestration features

## Development vs Production

### Production Build

The default configuration builds a production-optimized image:

```bash
docker compose up --build
```

### Custom Build Arguments

You can customize the build by passing arguments in `docker-compose.yml`:

```yaml
services:
  devchain:
    build:
      context: .
      dockerfile: apps/local-app/Dockerfile
      args:
        PNPM_VERSION: "10.21.0"
        CLAUDE_CODE_VERSION: "2.1.47"
        CODEX_VERSION: "0.104.0"
        GEMINI_CLI_VERSION: "0.29.5"
        OPENCODE_VERSION: "1.2.14"
```

## Operations

### View Container Status

```bash
docker compose ps
```

### View Logs

```bash
# All logs
docker compose logs devchain

# Follow logs in real-time
docker compose logs -f devchain

# Last 100 lines
docker compose logs --tail=100 devchain
```

### Execute Commands in Container

```bash
# Open a shell in the container
docker compose exec devchain /bin/bash

# Run as node user
docker compose exec -u node devchain /bin/bash

# Test provider CLIs
docker compose exec devchain claude --version
docker compose exec devchain codex --version
docker compose exec devchain gemini --version
docker compose exec devchain opencode --version
```

### Restart Service

```bash
docker compose restart devchain
```

### Stop and Remove

```bash
# Stop containers
docker compose stop

# Stop and remove containers
docker compose down

# Remove containers and volumes
docker compose down -v
```

## Health Checks

The container includes a health check that verifies the application is responding:

- Endpoint: http://localhost:3000/health (internal)
- Interval: 30 seconds
- Timeout: 10 seconds
- Retries: 3
- Start period: 40 seconds

Check health status:

```bash
docker compose ps
```

## Troubleshooting

### Container Won't Start

1. Check logs:
   ```bash
   docker compose logs devchain
   ```

2. Verify Docker socket is accessible:
   ```bash
   ls -la /var/run/docker.sock
   ```

3. Ensure port 3001 is not in use:
   ```bash
   lsof -i :3001
   ```

### Build Fails

1. Ensure all dependencies are properly installed locally first
2. Check Docker has sufficient resources (memory, disk)
3. Try rebuilding without cache:
   ```bash
   docker compose build --no-cache
   ```

### Permission Issues

The container runs as the `node` user (UID 1000). If you encounter permission issues:

1. Ensure host config directories are owned by your user:
   ```bash
   mkdir -p ~/.claude ~/.codex ~/.gemini ~/.opencode
   ```

2. Check volume permissions:
   ```bash
   docker compose exec devchain ls -la /home/node/.claude
   ```

3. Reset and recreate:
   ```bash
   docker compose down
   docker compose up -d
   ```

### Provider CLI Issues

If a provider CLI fails with permission errors:

1. Check the config directory exists and is writable:
   ```bash
   docker compose exec devchain ls -la /home/node/.gemini
   ```

2. Recreate the host directory if needed:
   ```bash
   rm -rf ~/.gemini  # Only if empty
   mkdir -p ~/.gemini
   docker compose down && docker compose up -d
   ```

## Security Considerations

- The container runs as non-root user (`node`)
- Docker socket is mounted for container management (requires trust)
- Host config directories are mounted read-write (API keys are accessible)
- Consider using Docker secrets for sensitive environment variables
- Review and restrict network access as needed

## Multi-Stage Build

The Dockerfile uses multi-stage builds for optimization:

1. **Builder stage**: Compiles the application and dependencies
2. **Production stage**: Minimal runtime image with only necessary components

This results in a smaller final image and faster deployments.
