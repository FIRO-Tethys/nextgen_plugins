# Devcontainer Quickstart

This devcontainer runs only:
- `mcp` on `http://localhost:9000/sse`
- `ollama` on `http://localhost:11434`

## Use It

1. Open this repo in VS Code.
2. Run `Dev Containers: Reopen in Container`.
3. Wait for services to start (`mcp` + `ollama`).

## Pull A Model

Inside the container:

```bash
curl http://ollama:11434/api/tags
ollama pull qwen3
```

## Plugin Env

Use these values when consuming from `nextgen_plugins`:

```bash
MCP_SERVER_URL=http://localhost:9000/sse
OLLAMA_HOST=http://localhost:11434
```
