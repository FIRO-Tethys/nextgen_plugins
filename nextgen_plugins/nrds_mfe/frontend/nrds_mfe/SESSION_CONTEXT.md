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

### Session 9 (2026-04-08): Prop-Driven Config + Proxy Fixes + Dev Workflow
- **Root cause 1 — baked env vars**: `@chatbox/core` config used `import.meta.env.VITE_*` which got baked into `dist/` at build time. Since the core package has no `.env` files, `DEFAULT_OLLAMA_HOST` was hardcoded as `"http://localhost:11434"` in dist — all consumers inherited this wrong default.
- **config/index.js rewrite**: Removed all `import.meta.env` references. Removed `CONFIGURED_OLLAMA_HOST`. Static defaults only: `DEFAULT_OLLAMA_HOST = ""`, `DEFAULT_OLLAMA_API_KEY = ""`.
- **isEmbedded gate removed**: `listOllamaModels(isEmbedded ? ollamaHost : undefined, ...)` → `listOllamaModels(ollamaHost, ...)`. Model loading now respects `ollamaHost` prop in all modes.
- **Standalone fix**: `App.jsx` reads `VITE_OLLAMA_HOST`, `VITE_OLLAMA_API_KEY`, `VITE_MCP_SERVER_URL` from `import.meta.env` and passes as props. Env vars are read by the consumer, not the library.
- **Root cause 2 — trailing slash 404**: Ollama Cloud returns 404 for `/api/tags/` (trailing slash) but 200 for `/api/tags`. Django proxy naturally strips slashes in `_proxy_to_ollama(request, "api/tags")`. Vite proxy preserved them, causing 404 for both standalone and MFE modes.
- **Vite proxy `rewrite`**: Added `rewrite: (path) => path.replace(/\/+$/, '')` to strip trailing slashes before forwarding to Ollama Cloud.
- **Vite proxy auth**: Proxy config now injects `Authorization: Bearer <key>` header from env var. API key stays server-side (like Django proxy).
- **MFE CSRF**: `chatbox.jsx` wrapper reads `csrftoken` cookie from `document.cookie`, passes to `<Chatbox>` for Django proxy compatibility.
- **Dev source aliases**: `vite.config.js` adds `resolve.alias` in dev mode to point `@chatbox/core/*` imports to source files instead of `dist/`. Enables Vite HMR — edits to core source reflect immediately without rebuilding. Production builds still use `dist/`.
- **README.md**: Created `packages/chatbox-core/README.md` with props reference, 3 configuration patterns (standalone, MFE, sidebar), engine extensions, subpath imports.

### Session 10 (2026-04-08): Chart Migration + Client Plugin Discovery + Rendering

#### Subphase 1 — Chart Migration to Native BasePlot
- **Two-step chart chain**: LLM calls NRDS query tool → gets data → calls TethysDash `create_plotly_chart` → native BasePlot grid item (no more ChartPanel MFE).
- **Deprecated chart tool interceptor**: `DEPRECATED_CHART_TOOLS` set in `beforeNrdsToolExecution()` catches old NRDS chart tools (`create_plotly_chart_from_parquet_output_file`, `create_plotly_chart_from_output_selector`) and returns redirect message.
- **ChartPanel deprecated**: `useEffect` console.warn on mount. Component stays functional for saved dashboards.
- **chatboxPanelBridge.js**: Removed `chatbox_chart` variable publishing, `./ChartPanel` from `PANEL_HINTS`, ChartPanel creation block.
- **Inline chart fallback**: Core `Chatbox.jsx` extracts `plotlyFigure` from `result.visualizations` for standalone inline rendering and embedded text indicators.
- **NrdsMessageContent**: "Chart updated in Chart panel" → "Chart created on dashboard".
- **Generic rules**: Rule 6 updated to reference `create_plotly_chart`.

#### Subphase 1.5 — Package NRDS Panels as Client Plugins
- **`tethysdash.clientPlugins` metadata** added to chatbox `package.json`: 4 plugins (NRDS Map, Query, Markdown, Chart Deprecated) with `type: "client_custom_remote"`, `scope: "mfe_nrds_chatbox"`, `remoteType: "vite-esm"`.
- **tethysdash dependency**: `chatbox` added as file link in tethysdash `package.json`.
- **`collectClientPlugins.js` updated**: Skips import map generation for `client_custom_remote` plugins (loaded at runtime via Module Federation, not webpack build-time). Passes through `scope` and `remoteType` fields.
- **Registry populated**: `clientPluginRegistry.json` has 4 entries. `clientPluginImports.js` is empty (no build-time imports).

#### Subphase 2 — Plugin Discovery via MCP
- **Registry loader**: `_load_client_plugin_registry()` reads `clientPluginRegistry.json` at MCP server startup. Logs plugin count + path.
- **Arg schema converter**: `_convert_arg_to_schema()` / `_convert_plugin_args_to_schema()` converts tethysdash arg format (`"text"`, `["opt1","opt2"]`, `"number"`, `"checkbox"`) to structured schemas.
- **`list_available_visualizations()` enriched**: Returns `client_plugins` array with source, label, group, description, tags, args_schema, tool.
- **Discovery prompt**: System prompt tells LLM to call `list_available_visualizations` when asked about available visualizations.

#### Subphase 3 — Plugin Rendering + Validation
- **`_validate_plugin_props()`**: Validates props against registry arg schema. Returns clear error messages for invalid enum values, wrong types, missing required args, unknown sources.
- **`render_client_plugin()` tool**: For `client_custom_remote` plugins, returns Module Federation coordinates (`scope`, `module`, `remoteType`) from registry. URL resolved on frontend.
- **`prefer_native` flags**: All 6 builtin types get `prefer_native: True` in `list_available_visualizations()`.
- **Preference rules**: System prompt: "Prefer native TethysDash visualizations over client plugins."
- **`resolveVisualizationUrl` prop**: New prop on core `<Chatbox>`. Consumers pass a function that resolves MFE URLs for `client_custom_remote` specs. Core calls it before dispatching DOM events.
- **NRDS wrapper**: `chatbox.jsx` passes `resolveVisualizationUrl` using `import.meta.url` fallback.
- **Core `Chatbox.jsx` dispatch**: Assembles Module Federation args (`url`, `scope`, `module`, `remoteType`, `initialData`) for `custom` vizType specs.

#### Open: Sidebar MFE URL Resolution
- Sidebar (`ChatSidebar.js`) does not yet pass `resolveVisualizationUrl`. `window.__CHATBOX_MFE_URL__` is only set when the MFE is loaded as a grid item. Sidebar-only mode has no MFE URL source.
- **Options explored**: (A) `resolveVisualizationUrl` prop — implemented in core + NRDS wrapper, not yet in sidebar. (B) Django `chatbox_config.mfeUrl` custom setting — prototyped and reverted. (C) DashboardLayout scope-based container resolution — annotated as future work (open question #7).
- **Next step**: Decide how the sidebar discovers the MFE URL. Likely requires Django setting or dashboard-level container resolution.

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
  → Django strips trailing slash, forwards to Ollama (host + Bearer key from settings)
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

### Data Flow (standalone / MFE via Vite proxy)
```
User prompt → <Chatbox ollamaHost={from env or MFE props}>
  → listOllamaModels() → fetch("/api/tags/")
  → Vite proxy rewrites: strips trailing slash + injects Bearer auth header
  → GET https://ollama.com/api/tags → 200

  → runChatSession() → Ollama SDK → fetch("/api/chat/")
  → Vite proxy rewrites → POST https://ollama.com/api/chat → streaming response

Note: Trailing slashes cause 404 on Ollama Cloud. Django proxy strips them
in _proxy_to_ollama(). Vite proxy strips them via rewrite: (path) => path.replace(/\/+$/, '').
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
| `components/Chatbox.jsx` | Main orchestrator. Props: `ollamaHost`, `csrfToken`, `ollamaApiKey`, `engineExtensions`, `onResult`, `resolveVisualizationUrl`. Proxy-aware custom fetch. Dispatches visualization DOM events with Module Federation args for `client_custom_remote` specs. Extracts `plotlyFigure` from viz specs for inline rendering. |
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
| `config/index.js` | Static defaults only (`DEFAULT_OLLAMA_HOST = ""`, `CONTEXT_BUDGET_RATIO`). No `import.meta.env` — all config via props. |
| `messages/index.js` | `getGenericSystemRules()` (18 rules incl. visualization preferences) + `buildGenericSystemMessage()` |
| `storage/mcpStorage.js` | localStorage CRUD for MCP servers |
| `README.md` | Props reference, 3 configuration patterns (standalone, MFE, sidebar), engine extensions, subpath imports |

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
| `vite.config.js` | Vite + Module Federation. Exposes Chatbox + 4 panels. Proxy config for Ollama (rewrite trailing slashes, inject Bearer auth) + MCP. Dev mode aliases for @chatbox/core source. |
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
9. **Prop-driven library config** — `@chatbox/core` has zero `import.meta.env` references. All runtime configuration flows through `<Chatbox>` props. Consumers read their own env vars and pass as props. Prevents baked defaults in `dist/`.
10. **Vite proxy trailing slash rewrite** — Ollama Cloud rejects trailing slashes (`/api/tags/` → 404). Vite proxy uses `rewrite: (path) => path.replace(/\/+$/, '')`. Django proxy strips slashes naturally in `_proxy_to_ollama`.
11. **Dev source aliases** — `vite.config.js` maps `@chatbox/core/*` to source in dev mode, `dist/` in production. Enables HMR without rebuilding core.
12. **Chart migration to native BasePlot** — Charts render via TethysDash `create_plotly_chart` → native BasePlot grid item. NRDS chart tools deprecated with `beforeToolExecution` interceptor. ChartPanel deprecated with console.warn.
13. **Client plugin discovery via MCP** — `list_available_visualizations()` exposes npm-installed client plugins with arg schemas. `render_client_plugin()` validates props and returns Module Federation visualization specs.
14. **MCP-side arg validation (Strategy A+C)** — `_validate_plugin_props()` validates against registry schema. Rich tool descriptions guide the LLM. Two layers of protection.
15. **Prompt-based rendering preference (Approach Y)** — System prompt: "Prefer native TethysDash visualizations over client plugins." `prefer_native: True` on all builtin types.
16. **`resolveVisualizationUrl` prop** — Core `<Chatbox>` accepts a function that resolves MFE URLs for `client_custom_remote` specs. Called before DOM event dispatch. NRDS wrapper passes it; sidebar does not yet (see open question #8).
17. **`client_custom_remote` in collectClientPlugins** — Script skips import map generation for remote plugins. Registry JSON includes `scope`, `remoteType` for Module Federation loading.

---

## Open Questions

1. ~~**npm package for panels**~~ — Resolved: panels registered as `client_custom_remote` via `tethysdash.clientPlugins` metadata in chatbox `package.json`. Loaded at runtime via Module Federation.
2. **Variable name collisions** — `chatbox_chart` etc. could collide if multiple chatbox instances on same dashboard
3. **Token estimation accuracy** — `chars/4` heuristic is approximate. Could integrate tiktoken.
4. **MCP stdio transport** — Server currently SSE only. Need `--transport` flag for Claude Desktop stdio.
5. **Dark mode** — ThemeProvider is ready. Need a second theme object and toggle.
6. **Chat history persistence** — Currently lost on page refresh. Could persist to localStorage or backend.
7. **DashboardLayout scope-based URL resolution** — When `DashboardLayout` receives a `tethysdash:add-visualization` event with a `scope` but no `url`, it could check if `window[scope]` already exists (container previously loaded via Module Federation) and use it directly. Eliminates per-consumer URL resolution. Requires changes to `DashboardLayout.js` or `remoteLoader.js` to track URLs by scope.
8. **Sidebar MFE URL resolution** — The sidebar (`ChatSidebar.js`) does not yet pass `resolveVisualizationUrl`. `window.__CHATBOX_MFE_URL__` is only set when the chatbox MFE is loaded as a grid item. Options: (a) Django `chatbox_config.mfeUrl` custom setting (prototyped, reverted), (b) DashboardLayout container resolution (open question #7), (c) require chatbox MFE to be loaded as a grid item first.

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
