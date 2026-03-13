# Devcontainer Quickstart

This devcontainer runs only:
- `mcp` on `http://localhost:9000/sse`
- `ollama` on `http://localhost:11434`

## Use In VS Code

1. Open this repo in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. Wait for services to start (`mcp` + `ollama`).

## Use From CLI (No VS Code)

From the repo root:

```bash
cd /home/aquagio/tethysdev/firoh/plugins/nextgen_plugins
```

Start the devcontainer:

```bash
npx -y @devcontainers/cli up --workspace-folder .
```

Open a shell inside the devcontainer:

```bash
npx -y @devcontainers/cli exec --workspace-folder . bash
```

Stop the devcontainer:

```bash
npx -y @devcontainers/cli down --workspace-folder .
```

## Pull A Model

Inside the container:

```bash
curl http://ollama:11434/api/tags
ollama pull qwen3
```

## MCP Logs

```bash
docker compose -f .devcontainer/docker-compose.dev.yml logs -f mcp
```

## Frontend Dev

If you want to run the chatbox frontend directly for development:

```bash
cd nextgen_plugins/chatbox/frontend/chatbox
```

Run Vite dev mode:

```bash
npm run dev
```

Run preview mode to test with TethysDash:

```bash
npm run serve
```

## Plugin Env

Use these values when consuming from `nextgen_plugins`:

```bash
MCP_SERVER_URL=http://localhost:9000/sse
OLLAMA_HOST=http://localhost:11434
```
