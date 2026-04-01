# Session Context: Client Plugins Implementation

## What was accomplished

We designed and implemented a **client plugin system** for tethysdash that allows React microfrontend components to be loaded without Python backend plugins. The chatbox's chart, map, and markdown rendering was split into independent panel components that communicate via tethysdash's existing `variableInputValues` system.

### Session 2 (2026-03-31): Query Panel + Embedded UX fixes + Option C

Added a **QueryPanel** for displaying MCP query results in a table, fixed several UX issues with embedded mode rendering, and implemented **Option C (dynamic panel creation)** so panels are created automatically when the chatbox produces results.

### Session 3 (2026-04-01): Tiling layout algorithm + CSS leak fix

Implemented a **tiling window manager-style layout algorithm** for dynamically created panels. Panels are arranged using a generic row-packing algorithm that respects size hints from the sender. Added **batch event protocol** so multiple panels from a single prompt are laid out atomically. Fixed **CSS leak** where chatbox's `#root` styles constrained the entire tethysdash page to 960px.

---

## Implementation status

### Fully implemented (code written)

#### TethysDash (`tethysapp-tethys_dash/`)

| File | Status | Description |
|------|--------|-------------|
| `scripts/collectClientPlugins.js` | CREATED | Build-time discovery script. Scans `node_modules` for packages with `tethysdash.clientPlugins` metadata. Outputs both `clientPluginRegistry.json` (metadata) and `clientPluginImports.js` (static import map for webpack code-splitting) |
| `reactapp/generated/clientPluginRegistry.json` | CREATED | Auto-generated empty registry (gitignored, populated by prebuild script) |
| `reactapp/generated/clientPluginImports.js` | CREATED | Auto-generated empty import map (gitignored, populated by prebuild script) |
| `reactapp/components/visualizations/ClientModuleLoader.js` | CREATED | Loads npm-installed client plugins by `source` name via the generated import map. Passes `variableInputValues` and `updateVariableInputValues` to loaded components (same contract as `ModuleLoader`) |
| `package.json` | MODIFIED | Added `prebuild`, `prestart`, `precollect` scripts that run `collectClientPlugins.js` |
| `.gitignore` | MODIFIED | Added `reactapp/generated/clientPluginRegistry.json` and `reactapp/generated/clientPluginImports.js` |
| `reactapp/components/loader/AppLoader.js` | MODIFIED | Imports `clientPluginRegistry.json` and merges discovered client plugins into the visualization list by group. Also added "Client Custom" to the Default group (`client_custom_remote` type) for runtime loading via URL |
| `reactapp/components/visualizations/utilities.js` | MODIFIED | Added `client_custom` branch (build-time, no API call) and `client_custom_remote` branch (runtime, reuses existing `ModuleLoader`) in `getVisualization()`. Both short-circuit before the backend API call. Added `visualizations` parameter to `getVisualization()`. The `client_custom_remote` branch forwards `args.initialData` as `vizData.props` for first-mount data delivery |
| `reactapp/components/visualizations/Base.js` | MODIFIED | Added `client_custom` case in `Visualization` switch rendering `ClientModuleLoader`. Excluded `client_custom` from refresh rate interval. Passes `visualizations` to `getVisualization()`. Imports `ClientModuleLoader` |
| `reactapp/components/dashboard/DashboardLayout.js` | MODIFIED (Session 2+3) | Added `useEffect` listener for `tethysdash:add-visualization` DOM events. Supports both batch and single events. For batches: filters duplicates, calls `computePanelLayout()`, creates all grid items in a single `updateTab()` call. Imports `useEffect`, `uuidv4`, and `computePanelLayout` |
| `reactapp/components/dashboard/panelLayoutUtils.js` | CREATED (Session 3) | Generic tiling layout utility. `computePanelLayout(panels, existingGridItems)` arranges panels using row-packing. Single panels scan bottom-to-top for horizontal space; if found, slot in side-by-side at hint width; if not, start a new row at full width. Batch panels pack left-to-right, wrapping when the row fills. Panels alone on their row expand to full width. No knowledge of specific plugin types |

#### Chatbox MFE (`plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/`)

| File | Status | Description |
|------|--------|-------------|
| `src/panels/ChartPanel.jsx` | CREATED | Reads `variableInputValues.chatbox_chart` (falls back to `chatbox_chart` initial prop). Renders `PlotlyChart` |
| `src/panels/MapPanel.jsx` | CREATED | Reads `variableInputValues.chatbox_map` (falls back to `chatbox_map` initial prop). Renders `FlowpathsPmtilesMap` |
| `src/panels/MarkdownPanel.jsx` | CREATED | Reads `variableInputValues.chatbox_markdown` (falls back to `chatbox_markdown` initial prop). Renders `MarkdownContent` |
| `src/panels/QueryPanel.jsx` | CREATED (Session 2) | Reads `variableInputValues.chatbox_query` (falls back to `chatbox_query` initial prop). Displays query results in a scrollable table with sticky headers and alternating row colors. Parses both row-oriented and columnar data shapes. Reads `response.data` (the actual row array from the MCP response) and `response.columns` for column headers |
| `src/chatbox.jsx` | MODIFIED | Accepts `updateVariableInputValues`/`variableInputValues` props. Detects embedded mode via `isEmbedded = typeof updateVariableInputValues === "function"`. Publishes `chatbox_chart`/`chatbox_map`/`chatbox_markdown`/`chatbox_query` to variable inputs after LLM results. Dispatches a single batch `tethysdash:add-visualization` event with `PANEL_HINTS` (w/h/priority per panel type) for layout. Sorts panels by priority so visual panels (map, chart) get prominent positions. Shows text indicators when embedded. User messages always render their original text. Thinking streams in the chat bubble in both modes. Derives MFE URL from `import.meta.url`. Skips Ollama model discovery when embedded |
| `src/lib/chatboxEngine.js` | MODIFIED (Session 2) | Added `lastQuerySQL` to state. Captures SQL string from `args.query` when query tools run. Returns `queryResult: { data, sql }` alongside `assistantText` for query results (`QUERY_RESULT_TOOLS`) and hydrofabric results (`HYDROFABRIC_QUERY_TOOL`) |
| `src/App.css` | MODIFIED (Session 2) | Changed `#root` selector to `.chatbox-standalone` to prevent CSS leaking into tethysdash host page |
| `index.html` | MODIFIED (Session 2) | Added `class="chatbox-standalone"` to `#root` div for standalone mode |
| `vite.config.js` | MODIFIED | Exposes `./ChartPanel`, `./MapPanel`, `./MarkdownPanel`, `./QueryPanel` alongside `./Chatbox` via Module Federation |

#### Backend plugin (`plugins/nextgen_plugins/nextgen_plugins/chatbox/chatjs.py`)

| File | Status | Description |
|------|--------|-------------|
| `chatjs.py` | MODIFIED | Added `modelOptions: [self.ollama_model]` to the props returned by `read()`. Default model changed to `qwen3.5:397b-cloud` |

### Not yet implemented

| Item | Description |
|------|-------------|
| npm package for panels | Need to create a `package.json` with `tethysdash.clientPlugins` metadata and build/install the panel package into tethysdash for the build-time approach |
| End-to-end testing | Testing checklist in `CLIENT_PLUGINS_SPEC.md` has not been verified |

---

## Three loading approaches

### Build-time (`client_custom` type)

- npm package declares plugins in `package.json` `tethysdash.clientPlugins` field
- `collectClientPlugins.js` runs at prebuild, generates registry JSON + JS import map
- `ClientModuleLoader` looks up source name in import map -> webpack code-splits the module
- No runtime fetching, no Module Federation, no CORS
- Panels appear in visualization picker automatically under their declared group
- Must rebuild tethysdash when plugin changes

### Runtime manual (`client_custom_remote` type, Option B)

- User selects "Client Custom" from the Default group in the visualization picker
- Fills in `url`, `scope`, `module`, `remoteType` via the existing DataViewer args UI
- `getVisualization()` short-circuits to set `vizType="custom"` and reuses existing `ModuleLoader` + `remoteLoader.js`
- No Python backend needed, no build-time bundling
- Plugin can update independently without rebuilding tethysdash

### Runtime dynamic (`client_custom_remote` type, Option C) -- IMPLEMENTED

- Dashboard starts with **only the Chatbox** -- no pre-placed panels needed
- When the chatbox gets a result, it:
  1. Writes data to `variableInputValues`
  2. Dispatches a `tethysdash:add-visualization` custom DOM event with `source: "Client Custom"` and `args: { url, scope, module, remoteType, initialData }`
- `DashboardLayout.js` listens for the event, deduplicates by `args.module`, and creates a new grid item via `updateTab()`
- `getVisualization()` forwards `args.initialData` as `vizData.props` so the panel has data at mount time
- `ModuleLoader` spreads `props.props` onto the component, delivering the initial data before `variableInputValues` context propagates
- Subsequent updates come through `variableInputValues` context as normal
- MFE URL is auto-derived from `import.meta.url` (no hardcoding needed)

### How to use the runtime approach right now

1. Build and serve the chatbox: `cd chatbox && npm run build && npm run preview` (serves on port 5001)
2. The chatbox itself loads via its existing Python plugin (`nrds_chat_js_service`)
3. **Option B (manual):** Add panels as "Client Custom" dashboard items with:
   - url: `http://localhost:5001/assets/remoteEntry.js`
   - scope: `mfe_nrds_chatbox`
   - module: `./ChartPanel` (or `./MapPanel`, `./MarkdownPanel`, `./QueryPanel`)
   - remoteType: `vite-esm`
4. **Option C (automatic):** Just place the Chatbox on a dashboard and ask a question. Panels are created automatically based on result type.
5. All items on the same dashboard share `VariableInputsContext` -- chatbox writes, panels read

---

## Data flow

### Option B (pre-placed panels)

```
User types question in Chatbox
  -> chatboxEngine.js: runChatSession() -> Ollama streaming + MCP tools
  -> Returns: { assistantText?, plotlyFigure?, mapConfig?, queryResult? }
  -> chatbox.jsx: if (isEmbedded) updateVariableInputValues({
      chatbox_chart: result.plotlyFigure,
      chatbox_map: result.mapConfig,
      chatbox_markdown: result.assistantText,
      chatbox_query: result.queryResult,
    })
  -> VariableInputsContext updates across dashboard
  -> ChartPanel reads variableInputValues.chatbox_chart -> renders PlotlyChart
  -> MapPanel reads variableInputValues.chatbox_map -> renders FlowpathsPmtilesMap
  -> MarkdownPanel reads variableInputValues.chatbox_markdown -> renders MarkdownContent
  -> QueryPanel reads variableInputValues.chatbox_query -> renders table
```

### Option C (dynamic panel creation)

```
Dashboard loads with only:
  [Chatbox]
      |
User asks question -> LLM returns { queryResult }
      |
chatbox.jsx calls:
  1. updateVariableInputValues({ chatbox_query: result.queryResult })
  2. window.dispatchEvent('tethysdash:add-visualization', {
       source: "Client Custom",
       args: { url, scope, module: "./QueryPanel", remoteType, initialData: { chatbox_query } }
     })
      |
DashboardLayout listener:
  -> deduplicates by args.module (no duplicate panels)
  -> creates grid item { source: "Client Custom", args_string: JSON.stringify(args) }
  -> updateTab()
      |
BaseVisualization renders new item:
  -> getVisualization() hits client_custom_remote branch
  -> sets vizData.props = args.initialData (first-mount data)
  -> ModuleLoader loads QueryPanel via Module Federation
  -> QueryPanel receives initialData as props AND variableInputValues from context
  -> Table renders with query results
      |
Subsequent queries:
  -> Panel already exists (dedup skips creation)
  -> variableInputValues.chatbox_query updates
  -> QueryPanel re-renders with new data from context
```

### MCP query result structure

The MCP `query_output_file` tool returns:
```json
{
  "ok": true,
  "error": null,
  "file": "s3://...",
  "file_type": "parquet",
  "query": "SELECT DISTINCT feature_id FROM output LIMIT 10",
  "columns": ["feature_id"],
  "rows": 10,
  "data": [{"feature_id": 1009740}, {"feature_id": 1009823}, ...],
  "dir": "s3://...",
  "count": 1,
  "selected": { "name": "...", "path": "..." }
}
```

The engine wraps this as `queryResult: { data: <full MCP response>, sql: <SQL string> }`.
QueryPanel reads `queryData.data.data` for table rows and `queryData.data.columns` for column headers.

---

## Session 2 changes in detail

### QueryPanel (`src/panels/QueryPanel.jsx`)

- Displays query results in a scrollable HTML table
- Row/column count summary bar at top
- Sticky table headers, alternating row colors
- Handles row-oriented (`[{col: val}, ...]`) and columnar (`{col: [...]}`) data
- Uses `response.columns` from the MCP result for header ordering when available
- No SQL display -- table data only
- Accepts `chatbox_query` as a direct prop fallback for first-mount delivery

### Option C: Dynamic panel creation

- **DashboardLayout.js**: Added `useEffect` listener for `tethysdash:add-visualization` DOM events. Supports both batch and single events. For batches: filters duplicates by `args.module`, calls `computePanelLayout()` from `panelLayoutUtils.js`, creates all grid items in a single `updateTab()` call. Single events still work for backward compat.
- **chatbox.jsx**: Dispatches a single batch `tethysdash:add-visualization` event with all panels from the response. Each panel includes `w`/`h` size hints and is sorted by priority (visual panels first). `initialData` is passed in args for first-mount delivery. MFE URL is auto-derived from `import.meta.url`.
- **utilities.js**: `client_custom_remote` branch forwards `args.initialData` as `vizData.props`.
- **All panels**: Accept their specific variable key as a destructured prop fallback (e.g., `chatbox_query: initialQuery`), used when `variableInputValues` context hasn't propagated yet.

### Tiling layout algorithm (Session 3)

- **panelLayoutUtils.js** (new): Generic layout utility inspired by tiling window managers (i3/dwm). `computePanelLayout(panels, existingGridItems)` arranges panels without any knowledge of specific plugin types.
- **Single-panel path**: Scans existing rows bottom-to-top looking for horizontal space. If space is found, panel slots in side-by-side at its hint width. If no space exists, starts a new row at full width (`w:100`).
- **Batch path**: Packs panels left-to-right into rows, wrapping when the next panel doesn't fit. Panels alone on their row expand to full width. Respects each panel's `w`/`h` hints — column count is derived naturally from `floor(100 / panelW)`.
- **chatbox.jsx**: `PANEL_HINTS` map provides `w`/`h`/`priority` per panel type. Panels sorted by priority before dispatch so visual panels (map, chart) get prominent top-row positions.
- **Event protocol**: Batch events use `{ batch: true, panels: [{args, w, h}] }`. Size hints are optional — tethysdash falls back to `w:50, h:20` if not provided. Any plugin can use the same protocol.

### Embedded mode UX fixes (`src/chatbox.jsx`)

- **User messages preserved**: Added `isUser` guard at top of message rendering conditional. User messages always render via `MarkdownContent` regardless of embedded mode -- no longer replaced with "Response sent to panels"
- **Thinking streams in chat bubble**: The `<details>` thinking block renders in both standalone and embedded mode, during streaming and in completed messages
- **Streaming indicator**: When embedded, the loading bubble shows "Running..." then "Streaming to panels..." instead of rendering content inline. Content streams to panels via `updateVariableInputValues({ chatbox_markdown: accumulatedContent })` on each chunk
- **Query result indicator**: Completed messages with `queryResult` show "Query results sent to Query panel" when embedded

### Engine changes (`src/lib/chatboxEngine.js`)

- Added `lastQuerySQL` to engine state
- Captures `args.query` when `QUERY_RESULT_TOOLS` match
- Returns `queryResult: { data, sql }` for both `lastQueryResult` and `lastHydrofabricResult`

---

## Bugs found and fixed

### CORS error when embedded (Session 1)

**Problem:** When loaded as MFE inside tethysdash, the chatbox tried to fetch `https://ollama.com/api/tags` directly from the browser, which was blocked by CORS.

**Fix:** When `isEmbedded` is true, skip the `listOllamaModels()` fetch entirely and use the `modelOptions` prop from the backend plugin instead.

### Infinite loop on model fetch failure (Session 1)

**Problem:** When the CORS-blocked fetch failed, the `useEffect` watching `configuredModels` would re-trigger repeatedly.

**Fix:** Same as above -- skipping the fetch when embedded eliminates the loop.

### User message text replaced in embedded mode (Session 2)

**Problem:** User messages fell through to the `message.content` branch which, when `isEmbedded`, showed "Response sent to panels" instead of the user's actual text.

**Fix:** Added `isUser` check at the top of the rendering conditional so user messages always render via `MarkdownContent`.

### "Visualization (client_custom_remote) is not installed" (Session 2)

**Problem:** Dynamic panel creation dispatched events with `source: "client_custom_remote"` but the visualization list registers it as `source: "Client Custom"` with `type: "client_custom_remote"`. The lookup in `Base.js` matches by source name, not type.

**Fix:** Changed dispatched event to use `source: "Client Custom"`. Updated deduplication to check `args.module` instead of source name (since all dynamic panels share the same source).

### Remote entry URL resolved to relative path (Session 2)

**Problem:** The MFE URL defaulted to `/assets/remoteEntry.js` which resolved against tethysdash's origin, not the chatbox dev server.

**Fix:** Derive URL from `import.meta.url` (`new URL("remoteEntry.js", import.meta.url).href`) which gives the absolute URL of the chatbox's own origin.

### Dynamic panel empty on first mount (Session 2)

**Problem:** When a panel was created dynamically via Option C, `variableInputValues` context hadn't flushed yet, so the panel rendered with no data. On the second prompt it worked because the panel already existed.

**Fix:** Pass initial data through the grid item's `args.initialData`. `getVisualization()` forwards it as `vizData.props`, `ModuleLoader` spreads it onto the component. All panels accept their variable key as a destructured prop fallback (e.g., `chatbox_query: initialQuery`).

### MFE CSS leaking into host page (Session 2)

**Problem:** The chatbox's `App.css` had a `#root` selector with `max-width: 960px; margin: 0 auto`. When the chatbox loaded as an MFE inside tethysdash, this CSS leaked globally and matched tethysdash's own `#root` element, constraining the entire dashboard to 960px.

**Fix:** Changed `#root` to `.chatbox-standalone` class selector in `App.css`. Added `class="chatbox-standalone"` to `index.html` so standalone mode retains the centered layout. The MFE no longer affects the host page's `#root`.

**Files:** `src/App.css`, `index.html`

---

## Key architectural decisions

1. **variableInputValues instead of Zustand** -- Uses tethysdash's existing React context for cross-plugin communication. No new dependencies. Works regardless of how components are loaded (npm or Module Federation).

2. **No Python backend plugins for panels** -- Chart/Map/Markdown/Query panels are purely client-side. The `client_custom` and `client_custom_remote` types short-circuit before the backend API call.

3. **Zero impact on existing `custom` type Python plugins** -- The new branches execute before the API call. The `case "custom"` switch case and `ModuleLoader` are untouched.

4. **Standalone vs embedded mode** -- The chatbox detects embedded mode via `typeof updateVariableInputValues === "function"`. When standalone, it renders charts/maps inline. When embedded, it publishes to `variableInputValues` and shows text indicators.

5. **Query data extraction** -- QueryPanel reads the nested `data.data` array from the MCP response (not the full response envelope), using `data.columns` for header ordering.

6. **Dual data delivery for Option C** -- Initial data travels via `args.initialData` -> `vizData.props` -> component props (synchronous, available at mount). Subsequent updates travel via `variableInputValues` context (reactive, survives re-renders). Panels prefer context when available, fall back to initial props.

7. **MFE URL auto-discovery** -- `import.meta.url` provides the chatbox module's absolute URL at runtime. `new URL("remoteEntry.js", import.meta.url)` resolves to the correct remoteEntry regardless of where the MFE is served.

8. **Scoped MFE CSS** -- MFE stylesheets must not use global selectors like `#root` that match the host page. The chatbox's `App.css` uses `.chatbox-standalone` instead. This is a general rule for any MFE loaded into tethysdash.

9. **Generic layout utility** -- `panelLayoutUtils.js` has zero knowledge of chatbox or any specific plugin. It takes panels with optional `w`/`h` hints and existing grid items, returns positions. Plugin-specific knowledge (panel dimensions, priority) lives in the sender (chatbox). This separation means any plugin can use the same `tethysdash:add-visualization` event with its own hints.

10. **Batch event protocol** -- Multiple panels from a single action are dispatched as one batch event (`batch: true`), laid out atomically in a single `updateTab()` call. This prevents intermediate states where panels are partially placed. Single events still work for backward compat.

---

## Key file locations

### TethysDash
- `tethysapp-tethys_dash/scripts/collectClientPlugins.js`
- `tethysapp-tethys_dash/reactapp/generated/clientPluginRegistry.json`
- `tethysapp-tethys_dash/reactapp/generated/clientPluginImports.js`
- `tethysapp-tethys_dash/reactapp/components/visualizations/ClientModuleLoader.js`
- `tethysapp-tethys_dash/reactapp/components/visualizations/Base.js`
- `tethysapp-tethys_dash/reactapp/components/visualizations/utilities.js`
- `tethysapp-tethys_dash/reactapp/components/dashboard/DashboardLayout.js`
- `tethysapp-tethys_dash/reactapp/components/dashboard/panelLayoutUtils.js`
- `tethysapp-tethys_dash/reactapp/components/loader/AppLoader.js`

### Chatbox MFE
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/src/chatbox.jsx`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/src/panels/ChartPanel.jsx`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/src/panels/MapPanel.jsx`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/src/panels/MarkdownPanel.jsx`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/src/panels/QueryPanel.jsx`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/src/lib/chatboxEngine.js`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/vite.config.js`
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/chatjs.py`

### Spec documents
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/CLIENT_PLUGINS_SPEC.md` -- Full architecture spec
- `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/MICRO_FRONTENDS_SPEC.md` -- Original Zustand-based spec (partially superseded)

---

## Open questions for next session

1. **npm package for build-time approach** -- Need to package the panels with `tethysdash.clientPlugins` metadata and install into tethysdash.

2. **Variable name collisions** -- If multiple chatbox instances exist on the same dashboard, `chatbox_chart` etc. would collide. Consider scoping with grid item UUID.

3. **Shared dependencies** -- ChartPanel needs `plotly.js`, MapPanel needs `maplibre-gl` + `pmtiles`. When bundled into tethysdash, these add to bundle size. TethysDash already has `plotly.js-strict-dist-min` but uses OpenLayers, not MapLibre.

4. **Ollama proxy for chat messages** -- The model discovery CORS issue is fixed, but the actual chat streaming calls (`chatboxEngine.js` -> Ollama) may also hit CORS when embedded.

5. **List result handling** -- `lastListResult` (from `list_available_models`, `list_available_dates`, etc.) is still returned as raw `assistantText` JSON. Could also be routed to the QueryPanel for tabular display.

6. **Panel cleanup** -- If the chatbox is removed from the dashboard, dynamically created panels remain. No parent-child tracking exists yet.

7. **Panel positioning** -- Dynamic panels default to `y: Infinity, w: 50`. Smarter layout logic could arrange panels side-by-side or in a grid pattern.
