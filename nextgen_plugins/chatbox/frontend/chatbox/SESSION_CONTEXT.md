# NextGen Plugins — Session Context

Covers the chatbox MFE, panel components, MCP server, and chat engine. For tethysdash-side changes (sidebar, layout, custom settings), see `tethysapp-tethys_dash/TETHYSDASH_ARCHITECTURE.md`.

---

## Sessions

### Session 2 (2026-03-31): Query Panel + Embedded UX + Dynamic Panel Creation
- QueryPanel for MCP query results (scrollable table, sticky headers)
- Embedded mode: chatbox publishes to `variableInputValues`, shows text indicators
- Option C: dynamic panel creation via `tethysdash:add-visualization` DOM events
- `initialData` in args for first-mount data delivery

### Session 3 (2026-04-01–02): Panel Polish + MCP Package
- Panel styles (`panelStyles.js`): rounded corners, box-shadow, height chain fix
- `SyntaxHighlighter` margin fix in `markdownContent.jsx`
- Ollama model discovery via Vite proxy (no CORS skip)
- `nextgen_mcp/` self-contained: duplicated `rest.py`, `validators.py`, `utils_rest.py`
- `requirements.txt`, `setup-mcp.sh`, MCP `README.md`

### Session 4 (2026-04-03): Multi-turn Conversation + Tool Chaining
- Persistent engine messages across prompts (`engineMessagesRef`)
- Dynamic context window detection (`extractContextLength` from `/api/show`)
- Token usage indicator (SVG ring, green/amber/red)
- `trimConversation()` removes oldest turns when approaching budget
- Discovery tool chaining: removed `lastListResult` early return
- Text-only responses stay in chat (not sent to panels)

### Session 5 (2026-04-04–05): Styled Components + Multi-MCP + Cleanup
- **Styled-components migration**: Converted `chatbox.css` (338 rules) to styled-components. Fixes CSS race condition with `cssInjectedByJsPlugin`. Created `chatTheme.js` design tokens + `ThemeProvider`.
- **Component extraction**: `ChatMessage`, `ChatLog`, `ChatInputBar`, `ChatErrorPanel`, `MCPServerPanel` — each under 100 lines
- **Multi-MCP**: Engine connects to multiple servers via `connectMcpServers()`. `toolServerMap` routes calls. Backward compat with single URL.
- **MCP Server Manager UI**: `MCPServerPanel` + `chatboxMcpStorage.js` (localStorage). Users add/remove/toggle servers. No default server.
- **Query chaining**: Removed `lastQueryResult` early return for multi-query workflows
- **DRY refactor**: `chatboxConfig.js` (shared env constants), `chatboxPanelBridge.js` (panel publishing), `TOOL_CATEGORIES` object, `checkEarlyReturn()` helper
- **Cleanup**: Deleted ThinkingSwitch, ModelSelector, App.css. Removed 18 debug console.logs. Removed `vite-plugin-css-injected-by-js`.

---

## Chatbox MFE Architecture

### Component Tree
```
chatbox.jsx (ThemeProvider + state orchestrator)
├── ChatLog (scrollable message list)
│   └── ChatMessage (per message: avatar + bubble + content routing)
├── ChatErrorPanel (role="alert")
├── ChatInputBar (textarea + thinking toggle + model select + MCP button + context ring + send/stop)
└── MCPServerPanel (add/remove/toggle MCP servers, localStorage)
```

### Engine (`chatboxEngine.js`)
```
runChatSession({ prompt, model, history, maxContextTokens, mcpServers, ... })
  → connectMcpServers(servers)  // connect to all, aggregate tools
  → main loop:
      → Ollama streaming (thinking + content chunks)
      → tool calls → processToolCalls() → executeTool() (routes via toolServerMap)
      → checkEarlyReturn() — terminal: chart, map, hydrofabric
      → continuation prompt — non-terminal: query, list (LLM decides next action)
  → returns { assistantText, plotlyFigure, mapConfig, queryResult, messages }
```

### Data Flow (embedded in tethysdash)
```
User prompt → chatboxEngine → Ollama + MCP tools → result
  → publishResultToVariables() → variableInputValues context → panels update
  → requestPanelCreation() → DOM event → tethysdash creates grid items
  → text-only responses → render in chat bubble (no panel)
```

### Multi-turn Conversation
```
Prompt 1: messages = [system, user1] → Ollama → [system, user1, assistant1, tool1]
Prompt 2: messages = [system, user1, assistant1, tool1, user2] → Ollama → ...
  → LLM sees previous tool calls + params → "Make it a table" works
  → trimConversation() removes oldest turns when approaching 80% of context window
```

---

## Files

### Chatbox Core
| File | Description |
|------|-------------|
| `src/chatbox.jsx` | Main component. ThemeProvider, state, sendMessage, renders sub-components |
| `src/components/ChatMessage.jsx` | Message bubble: avatar, content routing (map/chart/query/text), thinking dropdown |
| `src/components/ChatLog.jsx` | Scrollable message list + loading bubble. `role="log"` |
| `src/components/ChatInputBar.jsx` | Textarea, thinking toggle, model select, context indicator, MCP button, send/stop |
| `src/components/ChatErrorPanel.jsx` | Error display. `role="alert"` |
| `src/components/MCPServerPanel.jsx` | MCP server management: add/remove/toggle, localStorage, default badge |
| `src/components/chatTheme.js` | Design tokens: colors, spacing, fontSize, radius |
| `src/components/ContextUsageIndicator.jsx` | SVG ring for token usage |
| `src/components/markdownContent.jsx` | Markdown + JSON syntax highlighting |
| `src/components/PlotlyChart.jsx` | Plotly wrapper with base64 array decoding |
| `src/components/FlowpathsPmtilesMap.jsx` | MapLibre + PMTiles hydrofabric map |

### Engine & Libraries
| File | Description |
|------|-------------|
| `src/lib/chatboxEngine.js` | Chat session orchestration: multi-MCP, tool dispatch, early returns, conversation loop |
| `src/lib/chatboxConversation.js` | `estimateTokens()`, `trimConversation()`, `groupIntoTurns()` |
| `src/lib/chatboxHelpers.js` | Model loading, tool arg normalization, `extractContextLength()` |
| `src/lib/chatboxMessages.js` | System prompt with conversation context + discovery rules |
| `src/lib/chatboxConfig.js` | Shared env constants (`DEFAULT_OLLAMA_HOST`, `CONTEXT_BUDGET_RATIO`, MFE constants) |
| `src/lib/chatboxPanelBridge.js` | `publishResultToVariables()`, `requestPanelCreation()` |
| `src/lib/chatboxMcpStorage.js` | localStorage CRUD for MCP servers |

### Panels
| File | Description |
|------|-------------|
| `src/panels/ChartPanel.jsx` | Reads `chatbox_chart` from variableInputValues, renders PlotlyChart |
| `src/panels/MapPanel.jsx` | Reads `chatbox_map`, renders FlowpathsPmtilesMap |
| `src/panels/MarkdownPanel.jsx` | Reads `chatbox_markdown`, renders MarkdownContent |
| `src/panels/QueryPanel.jsx` | Reads `chatbox_query`, renders scrollable table |
| `src/panels/panelStyles.js` | Shared inline styles for all panels |

### MCP Server (`nextgen_mcp/`)
| File | Description |
|------|-------------|
| `mcp_server.py` | FastMCP entry point, 13+ tool definitions |
| `utils.py` | REST API bridge |
| `rest.py` | S3/DuckDB query functions (duplicated from chatbox) |
| `validators.py` | Pydantic validators (duplicated from chatbox) |
| `utils_rest.py` | DuckDB, Plotly, S3 helpers (duplicated from chatbox) |
| `validations.py` | Type literals (FORECASTS, MODELS) |
| `requirements.txt` | Python dependencies |
| `README.md` | Setup, Claude Desktop/Code integration |

### Backend Plugin
| File | Description |
|------|-------------|
| `chatjs.py` | `NRDSChatJS` intake plugin. Returns MFE coordinates + props |

### Build Config
| File | Description |
|------|-------------|
| `vite.config.js` | Vite + Module Federation. Exposes Chatbox + 4 panels. Proxy config for Ollama + MCP |
| `package.json` | Dependencies (styled-components, plotly, maplibre, ollama SDK, MCP SDK) |

---

## Key Decisions

1. **Styled-components over CSS files** — Eliminates `cssInjectedByJsPlugin` race condition. Theme tokens via ThemeProvider.
2. **Multi-MCP with tool routing** — `connectMcpServers()` aggregates tools, `toolServerMap` routes calls. No default server.
3. **Persistent conversation** — Engine messages accumulate. LLM sees full history. Oldest turns trimmed at 80% budget.
4. **Discovery + query chaining** — No early returns for list/query results. LLM chains tools or produces readable summary.
5. **Component extraction (SRP)** — chatbox.jsx is orchestrator only. Each sub-component under 100 lines.
6. **localStorage MCP config** — Users add their own servers. Merges with prop-provided defaults.

---

## Open Questions

1. **npm package for panels** — Package with `tethysdash.clientPlugins` metadata for build-time approach
2. **Variable name collisions** — `chatbox_chart` etc. could collide if multiple chatbox instances on same dashboard
3. **Token estimation accuracy** — `chars/4` heuristic is approximate. Could integrate tiktoken.
4. **MCP stdio transport** — Server currently SSE only. Need `--transport` flag for Claude Desktop stdio.
5. **Dark mode** — ThemeProvider is ready. Need a second theme object and toggle.
6. **Chat history persistence** — Currently lost on page refresh. Could persist to localStorage or backend.
