# Chatbox Frontend

This frontend now calls MCP tools directly over **SSE** (no REST tool map in the chat engine).

## Environment

Create `.env` (or `.env.local`) with:

```bash
VITE_OLLAMA_HOST=http://127.0.0.1:11434
VITE_MCP_SERVER_URL=/sse
VITE_MCP_TOOL_REPAIR_ATTEMPTS=0
```

Notes:
- `VITE_MCP_SERVER_URL=/sse` is recommended for local Vite dev to avoid browser CORS issues.
- Vite proxies `/sse` and `/messages` to `http://127.0.0.1:9000`.
- You can still set a full URL (e.g. `http://127.0.0.1:9000/sse`) if your MCP server is already CORS-enabled.
- The MCP server should be running with SSE transport (e.g. `mcp.run(transport="sse", port=9000)`).

## Run

```bash
npm install
npm run dev
```
