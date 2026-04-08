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

### Session 6 (2026-04-05): TethysDash MCP Server + Inline Data + Native Visualizations
- **Phase A — inlineData support**: Added `inlineData` + `vizType` check in `utilities.js` and `Base.js`. Grid items can carry data directly in `args_string` and render using native tethysdash components (BasePlot, DataTable, MapVisualization) without a backend API call.
- **Phase B — TethysDash MCP server**: Created `tethysdash_mcp_server.py` (port 9001) with tools: `create_plotly_chart`, `create_data_table`, `create_card`, `create_text`, `create_custom_image`, `create_map_visualization`, `render_mfe`, `list_available_visualizations`. Each returns a visualization spec with `vizType` + `inlineData`.
- **Phase C — Engine integration**: Added `pendingVisualizations` to engine state. Tool results with `.visualization` are collected. Chatbox dispatches them as DOM events. Coexists with existing NRDS MCP flow.
- **BasePlot infinite loop fix**: `EMPTY_VERTICAL_LINE` module-level constant in `BasePlot.js` prevents `useEffect` re-render loop caused by `plotlyVerticalLine = {}` default creating new object references.
- **Map tool update**: Corrected `create_map_visualization` to match OpenLayers schema — ArcGIS base map URLs, proper layer configuration structure, `map_extent` as `{extent: string}` object, `BASE_MAPS` shorthand lookup.

### Session 7 (2026-04-06): @chatbox/core extraction — Phase 1 complete
- **`@chatbox/core` package** (1,036 lines across 6 files):
  - `config.js` — generic env constants
  - `conversation.js` — token estimation, trimming (100% copy)
  - `helpers.js` — 8 exported + 6 internal generic functions
  - `messages.js` — `getGenericSystemRules()` + `buildGenericSystemMessage()` (extensible)
  - `engine.js` — generic engine with 8 strategy pattern extension points: `systemPromptBuilder`, `toolCategories`, `earlyReturnCheck`, `beforeToolExecution`, `toolErrorCheck`, `repairMessageBuilder`, `continuationPrompt`, `beforeFirstMessage`
  - `index.js` — barrel export
- **NRDS MFE updated to use core**:
  - `chatboxEngine.js` → 30-line thin wrapper injecting NRDS extensions into core engine
  - `nrdsToolCategories.js` (new) — `NRDS_TOOL_CATEGORIES`, `checkNrdsEarlyReturn()`, `beforeNrdsToolExecution()`, S3 validation
  - `nrdsMessages.js` (new) — NRDS system prompt extending `getGenericSystemRules()` from core
  - `chatboxConfig.js` → MFE constants + re-exports from core
  - `chatboxConversation.js` → deleted (moved to core)
  - `chatbox.jsx` → imports `estimateTokens` + `listOllamaModels` from core
- **Phase 2 complete**: Moved 9 UI components + storage + theme into `@chatbox/core/components/`. Created generic `Chatbox.jsx` orchestrator. TethysDash sidebar renders `<Chatbox>` natively (no Module Federation). Vite library mode builds to `dist/` — bundles all deps except react/styled-components. Webpack 5 consumes compiled JS with zero config changes. Header toggle button always visible (no `chatboxConfig` check needed).

### Session 8 (2026-04-07): Phase 2b — Django Ollama Proxy + CORS + CSRF
- **Settings rename**: `chatbox_api_host` → `chatbox_ollama_host`, `chatbox_api_key` → `chatbox_ollama_key` in `app.py`
- **Django Ollama proxy**: 3 streaming proxy endpoints in `controllers.py` (`/api/tags/`, `/api/show/`, `/api/chat/`). Uses `StreamingHttpResponse` + `requests` with `stream=True`. API key stays server-side.
- **CORS fix**: Browser→Ollama blocked by CORS (Ollama Cloud returns no CORS headers, `ollama/browser` import doesn't help). Proxy makes all requests same-origin.
- **CSRF token flow**: `AppContext.csrf` → `ChatSidebar` → `csrfToken` prop on `<Chatbox>` → injected into custom fetch wrapper as `x-csrftoken` header. Same pattern as all other POST endpoints.
- **Ollama SDK `formatHost` workaround**: SDK's `formatHost()` mangles relative paths (`/apps/...` → `http://apps:11434/...`). Fix: `proxy: true` option skips `formatHost`, custom fetch prepends proxy path + adds trailing slashes for Django `APPEND_SLASH`.
- **Controller simplification**: `dashboards()` always returns `{"ollamaHost": "/apps/tethysdash/ollama-proxy"}`. No `mfeUrl`, `mcpServerUrl`, or API key in frontend config.
- **`ollamaApiKey` prop**: Added to `Chatbox.jsx` for direct-connection use cases (NRDS MFE), but sidebar doesn't use it (proxy handles auth).

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
  → returns { assistantText, plotlyFigure, mapConfig, queryResult, visualizations, messages }
```

### Data Flow (sidebar in tethysdash)
```
User prompt → <Chatbox> → runChatSession() → custom fetch (CSRF + trailing slashes)
  → Django proxy (/apps/tethysdash/ollama-proxy/api/chat/)
  → Django forwards to Ollama (host + Bearer key from settings)
  → Streaming NDJSON response → Django → Browser

Path 1 (NRDS MCP — deterministic, MFE panels):
  → publishResultToVariables() → variableInputValues context → MFE panels update
  → requestPanelCreation() → DOM event → tethysdash creates MFE grid items

Path 2 (TethysDash MCP — LLM-driven, native visualizations):
  → result.visualizations[] → DOM events with vizType + inlineData
  → tethysdash creates native grid items (BasePlot, DataTable, Map, etc.)

Path 3 (text-only):
  → render in chat bubble (no panel)
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

### @chatbox/core Package (`packages/chatbox-core/`)
| File | Description |
|------|-------------|
| `components/Chatbox.jsx` | Main orchestrator. Props: `ollamaHost`, `csrfToken`, `ollamaApiKey`, `engineExtensions`, `onResult`. Proxy-aware custom fetch (trailing slashes, CSRF header, proxy path prefix). |
| `components/ChatMessage.jsx` | Message bubble: avatar, content routing, thinking dropdown |
| `components/ChatLog.jsx` | Scrollable message list + loading bubble. `role="log"` |
| `components/ChatInputBar.jsx` | Textarea, thinking toggle, model select, context indicator, MCP button, send/stop |
| `components/ChatErrorPanel.jsx` | Error display. `role="alert"` |
| `components/MCPServerPanel.jsx` | MCP server management: add/remove/toggle, localStorage, default badge |
| `theme/index.js` | Design tokens: colors, spacing, fontSize, radius |
| `components/ContextUsageIndicator.jsx` | SVG ring for token usage |
| `components/markdownContent.jsx` | Markdown + JSON syntax highlighting |
| `engine/index.js` | Generic engine with 8 extension points. Proxy-aware: `proxy: true` for relative hosts, custom fetch with CSRF + trailing slashes. |
| `helpers/index.js` | Model loading (with CSRF header), tool arg normalization, `extractContextLength()` |
| `conversation/index.js` | `estimateTokens()`, `trimConversation()`, `groupIntoTurns()` |
| `config/index.js` | Shared env constants (`DEFAULT_OLLAMA_HOST`, `CONTEXT_BUDGET_RATIO`) |
| `messages/index.js` | `getGenericSystemRules()` + `buildGenericSystemMessage()` |
| `storage/mcpStorage.js` | localStorage CRUD for MCP servers |

### NRDS MFE Engine & Libraries
| File | Description |
|------|-------------|
| `src/lib/chatboxEngine.js` | 30-line thin wrapper injecting NRDS extensions into core engine |
| `src/lib/nrdsToolCategories.js` | `NRDS_TOOL_CATEGORIES`, `checkNrdsEarlyReturn()`, `beforeNrdsToolExecution()`, S3 validation |
| `src/lib/nrdsMessages.js` | NRDS system prompt extending `getGenericSystemRules()` from core |
| `src/lib/chatboxConfig.js` | MFE-specific constants + re-exports from core |
| `src/lib/chatboxPanelBridge.js` | `publishResultToVariables()`, `requestPanelCreation()` |

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
7. **Django Ollama proxy** — All Ollama API calls go through Django server-side proxy. Avoids CORS (Ollama Cloud has no CORS headers). API key stays server-side. CSRF token injected via custom fetch wrapper.
8. **Ollama SDK `proxy: true`** — Skips SDK's `formatHost()` which mangles relative paths. Custom fetch prepends proxy path + adds trailing slashes for Django `APPEND_SLASH`.

---

## Open Questions

1. **npm package for panels** — Package with `tethysdash.clientPlugins` metadata for build-time approach
2. **Variable name collisions** — `chatbox_chart` etc. could collide if multiple chatbox instances on same dashboard
3. **Token estimation accuracy** — `chars/4` heuristic is approximate. Could integrate tiktoken.
4. **MCP stdio transport** — Server currently SSE only. Need `--transport` flag for Claude Desktop stdio.
5. **Dark mode** — ThemeProvider is ready. Need a second theme object and toggle.
6. **Chat history persistence** — Currently lost on page refresh. Could persist to localStorage or backend.

---

## Future Work: Migrate Chart/Map Rendering to TethysDash MCP

### Goal
Shift visualization rendering from chatbox MFE panels to tethysdash native components. The LLM queries data with NRDS MCP, then creates visualizations with TethysDash MCP.

### Chart migration (Low effort, ~20 lines)
- Add system prompt rules: "Query data first with NRDS, then visualize with TethysDash `create_plotly_chart`"
- Remove chart early return from `checkEarlyReturn()`
- Remove ChartPanel auto-creation from `chatboxPanelBridge.js`
- NRDS chart tools remain for backward compat

### Map migration — hydrofabric (Option A: keep MFE, Option B: OpenLayers translation)
- **Option A (now)**: Keep MFE MapPanel for hydrofabric (MapLibre + PMTiles). No changes needed.
- **Option B (future, ~150 lines)**: Translate MapLibre config → OpenLayers format in TethysDash MCP. New helpers: `_maplibre_to_openlayers_layer()`, `_maplibre_camera_to_extent()`.

### Custom MFE discovery — 3 levels
- **Level 1 (Low)**: TethysDash MCP reads `clientPluginRegistry.json` at startup, exposes registered MFEs in `list_available_visualizations()`. LLM uses `render_mfe(name, props)`.
- **Level 2 (Medium)**: MCP server calls tethysdash `/visualizations/list/` API to discover ALL visualizations dynamically (backend + client + runtime MFEs). Auto-includes user-imported custom MFEs.
- **Level 3 (High)**: Each MFE exports tool metadata alongside its component. MCP aggregates MFE-provided tool descriptions — new MFEs become LLM-accessible automatically.

### Two MCP server architecture
```
NRDS MCP (port 9000)              TethysDash MCP (port 9001)
├── query_output_file              ├── create_plotly_chart
├── query_output_file_from_*       ├── create_data_table
├── list_available_models          ├── create_map_visualization
├── list_available_dates           ├── create_card
├── build_hydrofabric_*            ├── create_text
├── query_hydrofabric_*            ├── create_custom_image
│                                  ├── render_mfe
│  Data + domain tools             ├── list_available_visualizations
│                                  │
│                                  │  Visualization + rendering tools
```

LLM chains: NRDS (get data) → TethysDash (create visualization) → native grid item

### Publish chatbox panels as npm package
Package ChartPanel, MapPanel, QueryPanel, MarkdownPanel as `@nextgen/chatbox-panels` npm package with `tethysdash.clientPlugins` metadata. Enables build-time discovery via `collectClientPlugins.js`. Users install with `npm install @nextgen/chatbox-panels` — panels appear in tethysdash's visualization picker automatically. Currently panels are only available via runtime Module Federation (`client_custom_remote`).
