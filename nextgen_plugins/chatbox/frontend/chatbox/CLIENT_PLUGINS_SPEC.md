# Client Plugins for TethysDash: NPM-Based Microfrontend Integration

## Overview

This spec describes how to split the chatbox's chart, map, and markdown components into independent **client plugins** — npm-installable React microfrontends that tethysdash discovers at build time, renders without a backend Python plugin, and communicates with via the existing `variableInputValues` system.

This builds on top of the existing `MICRO_FRONTENDS_SPEC.md` (panel extraction) but replaces the Zustand store approach with tethysdash's native variable input system for cross-plugin data flow.

---

## Architecture Summary

### Current state

- The chatbox is a single custom MFE plugin (`NRDSChatJS` in `chatjs.py`) loaded into tethysdash via Module Federation
- Charts, maps, and markdown are rendered **inline** inside chat bubbles in `chatbox.jsx`
- Every tethysdash visualization — including custom MFEs — requires a Python backend plugin registered via intake entry points
- There is no mechanism for purely client-side plugins

### Target state

- Chart, map, and markdown panels are extracted into standalone React components
- They are published as an **npm package** installed into tethysdash
- Tethysdash discovers them at build time via `package.json` metadata (no Python plugin needed)
- A new `client_custom` visualization type renders them without any backend API call
- Data flows from the chatbox to the panels via tethysdash's existing `variableInputValues` / `updateVariableInputValues` props
- Users can add panels to dashboards from the visualization picker like any other plugin

---

## Codebase Reference

### Chatbox MFE (producer)

**Root:** `plugins/nextgen_plugins/nextgen_plugins/chatbox/frontend/chatbox/`

| File | Purpose | Lines |
|------|---------|-------|
| `src/chatbox.jsx` | Main chat component. All state local via `useState`. Renders PlotlyChart, FlowpathsPmtilesMap, MarkdownContent inline in chat bubbles | 342 |
| `src/lib/chatboxEngine.js` | Chat logic: MCP connection, Ollama streaming, tool execution. Returns `{ assistantText, plotlyFigure, mapConfig }` | 686 |
| `src/lib/chatboxHelpers.js` | Utilities: model loading, arg normalization, JSON parsing | 808 |
| `src/lib/chatboxMessages.js` | System prompts and message templates | 262 |
| `src/components/PlotlyChart.jsx` | Renders Plotly charts. Handles base64-encoded numpy arrays. Props: `{ figure }` | 149 |
| `src/components/FlowpathsPmtilesMap.jsx` | Renders PMTiles vector maps with MapLibre GL. Props: `{ mapConfig, styleUrl, height, ...colors }` | 427 |
| `src/components/markdownContent.jsx` | Renders markdown/JSON with syntax highlighting. Props: `{ content }` | 90 |
| `src/App.jsx` | Root: renders `<ChatBox>` with env-based model config | — |
| `vite.config.js` | Vite + Module Federation (currently exposes `./Chatbox`), CSS injection, proxy config | 59 |
| `MICRO_FRONTENDS_SPEC.md` | Original spec for Zustand-based multi-panel refactor (partially superseded by this spec) | — |

**Build system:** Vite 7.3.1 with `@originjs/vite-plugin-federation` and `vite-plugin-css-injected-by-js`

**Current Module Federation config:**
```javascript
federation({
  name: "mfe_nrds_chatbox",
  filename: "remoteEntry.js",
  exposes: {
    "./Chatbox": "./src/chatbox",
  },
  shared: ["react", "react-dom"],
})
```

**Current backend plugin** (`nextgen_plugins/chatbox/chatjs.py`):
```python
class NRDSChatJS(base.DataSource):
    visualization_type = "custom"
    # read() returns { url, scope, module, remoteType, props }
```

**Registered in** `plugins/nextgen_plugins/pyproject.toml`:
```toml
[project.entry-points."intake.drivers"]
nrds_chat_js_service = "nextgen_plugins.chatbox.chatjs:NRDSChatJS"
```

**chatboxEngine.js result routing:**
```
CHART_RESULT_TOOLS  → state.lastChartResult  → return { plotlyFigure }
QUERY_RESULT_TOOLS  → state.lastQueryResult  → return { assistantText: JSON }
LIST_RESULT_TOOLS   → state.lastListResult   → return { assistantText: JSON }
"build_hydrofabric_feature_map_config" → state.lastMapResult → return { mapConfig }
HYDROFABRIC_QUERY_TOOL → state.lastHydrofabricResult → return { assistantText: JSON }
```

**Current rendering logic in chatbox.jsx (lines 292-302):**
```jsx
{message.mapConfig ? (
  <FlowpathsPmtilesMap mapConfig={message.mapConfig} />
) : message.plotlyFigure ? (
  <PlotlyChart figure={message.plotlyFigure} />
) : message.content ? (
  <MarkdownContent content={message.content} />
) : null}
```

**Message shape:**
```javascript
{
  role: "user" | "assistant" | "tool",
  content: string,
  thinking?: string,
  plotlyFigure?: object,
  mapConfig?: object,
  tool_calls?: Array,
  tool_name?: string,
}
```

### TethysDash (consumer/host)

**Root:** `tethysapp-tethys_dash/`

| File | Purpose |
|------|---------|
| `reactapp/config/webpack.config.js` | Webpack 5 + ModuleFederationPlugin (host). Shared React singleton. Output to `tethysapp/tethysdash/public/frontend/` |
| `reactapp/components/visualizations/Base.js` | `BaseVisualization` — decides when to fetch data, renders `<Visualization>` switch |
| `reactapp/components/visualizations/utilities.js` | `getVisualization()` — handles backend API calls and client-side shortcuts for Map, Text, Custom Image |
| `reactapp/components/visualizations/ModuleLoader.js` | Loads remote MFE components via Module Federation. Passes `variableInputValues` and `updateVariableInputValues` to all custom components |
| `reactapp/components/visualizations/remoteLoader.js` | Low-level loader. Supports both webpack and **vite-esm** remotes. Caches loaded containers |
| `reactapp/components/loader/AppLoader.js` | Fetches backend visualization list, hardcodes "Default" client sources (Map, Text, Custom Image, Variable Input, Live Chat), populates `AppContext` |
| `reactapp/components/contexts/Contexts.js` | Context definitions: `AppContext`, `VariableInputsContext`, `GridItemContext`, `EditingContext` |
| `reactapp/components/loader/DashboardLoader.js` | Initializes `VariableInputsContext` provider. Manages tab/grid item state |
| `reactapp/components/dashboard/DashboardLayout.js` | Renders react-grid-layout grid. Provides `GridItemContext` per item. Has access to `TabContext` |
| `reactapp/components/dashboard/DashboardItem.js` | Individual grid item. Operations: edit, delete, copy, export, reorder |
| `reactapp/components/layout/Header.js` | "Add Dashboard Item" button. `onAddGridItem()` creates grid items |
| `reactapp/services/api/app.js` | Frontend API client: `listVisualizations()`, `getVisualizationData()`, dashboard CRUD |
| `tethysapp/tethysdash/visualizations.py` | Backend: `get_available_visualizations()` queries intake registry, `get_visualization()` calls plugin `read()` |
| `tethysapp/tethysdash/plugin_helpers.py` | `TethysDashPlugin` base class. Valid types: plotly, table, image, card, text, variable_input, map, map_layer, custom |
| `tethysapp/tethysdash/controllers.py` | Django endpoints: `/visualizations/list/`, `/visualizations/get/` |
| `tethysapp/tethysdash/collect_plugin_static.py` | Pre-build script: discovers intake plugins, copies thumbnails/data to static dirs |
| `docs/source/plugins.rst` | Plugin development documentation |

**Existing client-side-only sources (no backend call):**

In `getVisualization()` (utilities.js lines 88-113), these sources short-circuit before the API call:
```javascript
if (itemData.source === "Map") { setVizType("map"); setVizData({...}); return; }
else if (itemData.source === "Text") { setVizType("text"); setVizData({...}); return; }
else if (itemData.source === "Custom Image") { setVizType("image"); setVizData({...}); return; }
```

In `BaseVisualization` (Base.js lines 290-300):
```javascript
if (gridItemSource === "") { setVizType("unknown"); }
else if (gridItemSource === "Variable Input") { setVizType("variableInput"); setVizData({...}); }
```

These are hardcoded in `AppLoader.js` (lines 193-264) as a "Default" group in the visualization list.

**Grid item structure:**
```javascript
{
  id: number | null,
  uuid: string,           // UUID v4
  i: string,              // Grid identifier
  x: number, y: number,   // Position
  w: number, h: number,   // Size
  source: string,          // Visualization source name
  args_string: string,     // JSON stringified args
  metadata_string: string  // JSON stringified styling/config
}
```

**Grid item lifecycle:**
```
CREATE: Header.onAddGridItem() → create object → updateTab()
READ:   DashboardLoader.getDashboard() → load tabs with gridItems → render
UPDATE: DataViewerModal → modify → updateTab() | drag/resize → updateLayout() → updateTab()
DELETE: DashboardItem.deleteGridItem() → splice → updateTab()
SAVE:   saveLayoutContext({ tabs }) → API call → backend persists
```

**ModuleLoader props passed to custom MFE components (ModuleLoader.js lines 96-99):**
```jsx
<Component
  {...props.props}                          // backend-defined props
  ref={props.visualizationRef}              // ref
  variableInputValues={memoizedVariableInputValues}  // dashboard variables
  updateVariableInputValues={updateVariableInputValues}  // variable setter
/>
```

**Variable input data flow:**
```
VariableInput component onChange
  → updateVariableInputs() → setVariableInputValues(new values)
  → VariableInputsContext updates
  → Base.js useEffect triggers (watches variableInputValues)
  → setVariableDependentVisualizations() called
  → For backend plugins: interpolates args, calls API
  → For client-only sources: sets vizType/vizData directly, no API call
```

---

## Implementation Plan

### Phase 1: NPM Client Plugin Infrastructure (tethysdash)

#### 1.1 Create the discovery script

**New file:** `tethysapp-tethys_dash/scripts/collectClientPlugins.js`

Mirrors `collect_plugin_static.py` but for npm packages. Scans all dependencies in `package.json` for packages with a `tethysdash.clientPlugins` field. Writes a JSON registry to `reactapp/generated/clientPluginRegistry.json`.

```javascript
// scripts/collectClientPlugins.js
const fs = require('fs');
const path = require('path');

function discoverClientPlugins() {
  const pkgJsonPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const registry = [];

  for (const depName of Object.keys(allDeps)) {
    try {
      const depPkgPath = require.resolve(`${depName}/package.json`);
      const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'));
      if (depPkg.tethysdash?.clientPlugins) {
        for (const plugin of depPkg.tethysdash.clientPlugins) {
          registry.push({ ...plugin, packageName: depName });
        }
      }
    } catch (e) { /* skip */ }
  }

  const outDir = path.resolve(__dirname, '../reactapp/generated');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'clientPluginRegistry.json'),
    JSON.stringify(registry, null, 2)
  );
  console.log(`Discovered ${registry.length} client plugin(s)`);
}

discoverClientPlugins();
```

#### 1.2 Add prebuild/prestart hooks

**Modify:** `tethysapp-tethys_dash/package.json` scripts:
```json
{
  "prebuild": "node scripts/collectClientPlugins.js",
  "prestart": "node scripts/collectClientPlugins.js"
}
```

#### 1.3 Merge client plugins into the visualization list

**Modify:** `reactapp/components/loader/AppLoader.js`

After the existing backend visualization fetch and the hardcoded "Default" group push, merge client plugins from the registry:

```javascript
import clientPluginRegistry from 'generated/clientPluginRegistry.json';

// ... inside Loader, after allVisualizations is built ...

for (const plugin of clientPluginRegistry) {
  const entry = {
    source: plugin.source,
    label: plugin.label,
    type: plugin.type,           // "client_custom"
    tags: plugin.tags ?? [],
    description: plugin.description ?? "",
    args: plugin.args ?? {},
    loading_icon: false,
    packageName: plugin.packageName,
    module: plugin.module,
  };
  const existing = allVisualizations.find(g => g.label === plugin.group);
  if (existing) {
    existing.options.push(entry);
  } else {
    allVisualizations.push({ label: plugin.group, options: [entry] });
  }
}
```

#### 1.4 Add the `client_custom` rendering path

**Modify:** `reactapp/components/visualizations/utilities.js` — in `getVisualization()`, add a branch before the API call (after the "Custom Image" block at line 113):

```javascript
} else if (sourceType === "client_custom") {
  const pluginMeta = findSelectOptionByValue(visualizations, itemData.source, "source");
  setVizType("client_custom");
  setVizData({
    packageName: pluginMeta.packageName,
    module: pluginMeta.module,
    props: itemData.args,
  });
  return;  // No backend call
}
```

Note: The `visualizations` array is available in `Base.js` via `AppContext` and is already passed contextually. The `findSelectOptionByValue` helper already exists in `utilities.js`. The `sourceType` comes from looking up the plugin in the visualizations list (see `Base.js` line 340-344 where it calls `findSelectOptionByValue` to get the visualization object and reads its `.type`).

**Modify:** `reactapp/components/visualizations/Base.js` — add `"Client Custom"` source to exclusion lists where "Variable Input", "Text", etc. are excluded (e.g., the refresh rate useEffect at line 320).

#### 1.5 Add `client_custom` case to the Visualization switch

**Modify:** `reactapp/components/visualizations/Base.js` — in the `<Visualization>` switch statement, add:

```jsx
case "client_custom":
  return (
    <ClientModuleLoader
      packageName={vizData.packageName}
      module={vizData.module}
      props={vizData.props}
      visualizationRef={vizRef}
    />
  );
```

#### 1.6 Create ClientModuleLoader component

**New file:** `reactapp/components/visualizations/ClientModuleLoader.js`

Loads npm-installed React components via dynamic import. Passes `variableInputValues` and `updateVariableInputValues` to the component (same contract as `ModuleLoader`).

```jsx
import { Suspense, lazy, useMemo, useContext, useCallback, memo } from 'react';
import { VariableInputsContext } from 'components/contexts/Contexts';
import LoadingAnimation from 'components/loader/LoadingAnimation';

const componentCache = new Map();

function ClientModuleLoader({ packageName, module, props, visualizationRef }) {
  const { variableInputValues, setVariableInputValues } = useContext(VariableInputsContext);

  const updateVariableInputValues = useCallback(
    (updated) => setVariableInputValues(prev => ({ ...prev, ...updated })),
    [setVariableInputValues]
  );

  const memoizedVariableInputValues = useMemo(
    () => variableInputValues,
    [variableInputValues]
  );

  const Component = useMemo(() => {
    const key = `${packageName}/${module}`;
    if (!componentCache.has(key)) {
      componentCache.set(key, lazy(() =>
        import(/* webpackIgnore: true */ `${packageName}/${module}`)
      ));
    }
    return componentCache.get(key);
  }, [packageName, module]);

  return (
    <Suspense fallback={<LoadingAnimation text="Loading..." />}>
      <Component
        {...props}
        ref={visualizationRef}
        variableInputValues={memoizedVariableInputValues}
        updateVariableInputValues={updateVariableInputValues}
      />
    </Suspense>
  );
}

export default memo(ClientModuleLoader);
```

**Note on import strategy:** `/* webpackIgnore: true */` tells webpack not to process the import at build time. This means the npm package must serve pre-built ESM bundles that the browser can load. Alternatively, if the packages should be bundled at build time, use a generated import map (a switch/case mapping source names to static `() => import(...)` calls) instead. The right choice depends on whether you want build-time bundling (single output, must rebuild tethysdash on plugin update) or runtime loading (independent updates, needs asset hosting). Start with build-time if both codebases deploy together.

---

### Phase 2: Chatbox Panel Extraction (npm package)

#### 2.1 Create panel wrapper components

Extract chart, map, and markdown into thin wrapper components that read data from `variableInputValues` props (passed by `ClientModuleLoader`).

**New file:** `src/panels/ChartPanel.jsx`
```jsx
import PlotlyChart from '../components/PlotlyChart'

export default function ChartPanel({ variableInputValues }) {
  const figure = variableInputValues?.chatbox_chart
  if (!figure) return <div className="panel-empty"><p>Charts will appear here</p></div>
  return <PlotlyChart figure={figure} />
}
```

**New file:** `src/panels/MapPanel.jsx`
```jsx
import FlowpathsPmtilesMap from '../components/FlowpathsPmtilesMap'

export default function MapPanel({ variableInputValues }) {
  const mapConfig = variableInputValues?.chatbox_map ?? null
  return <FlowpathsPmtilesMap mapConfig={mapConfig} height="100%" />
}
```

**New file:** `src/panels/MarkdownPanel.jsx`
```jsx
import MarkdownContent from '../components/markdownContent'

export default function MarkdownPanel({ variableInputValues }) {
  const content = variableInputValues?.chatbox_markdown
  if (!content) return <div className="panel-empty"><p>Results will appear here</p></div>
  return <MarkdownContent content={content} />
}
```

#### 2.2 Modify chatbox.jsx to publish via variableInputValues

In `sendMessage()`, after `runChatSession()` returns, write results to `variableInputValues` if the prop is available (meaning the chatbox is loaded inside tethysdash, not standalone):

```javascript
const result = await runChatSession({ /* ... */ })

// Publish to tethysdash variable inputs for external panels
if (props.updateVariableInputValues) {
  if (result.plotlyFigure) {
    props.updateVariableInputValues({ chatbox_chart: result.plotlyFigure })
  }
  if (result.mapConfig) {
    props.updateVariableInputValues({ chatbox_map: result.mapConfig })
  }
  if (result.assistantText) {
    props.updateVariableInputValues({ chatbox_markdown: result.assistantText })
  }
}
```

The chatbox still renders text inline in chat bubbles. Charts and maps show text indicators ("Chart updated in chart panel") instead of inline rendering when running inside tethysdash.

#### 2.3 Package for npm

The panel components need to be published as an npm package (or linked locally) with the `tethysdash` metadata field in `package.json`:

```json
{
  "name": "@nextgen/chatbox-panels",
  "version": "1.0.0",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "tethysdash": {
    "clientPlugins": [
      {
        "source": "chatbox_chart_panel",
        "label": "NextGen Chart Panel",
        "group": "NextGen",
        "type": "client_custom",
        "module": "./ChartPanel",
        "tags": ["chart", "plotly", "nextgen"],
        "description": "Plotly chart panel driven by the NextGen chatbox"
      },
      {
        "source": "chatbox_map_panel",
        "label": "NextGen Map Panel",
        "group": "NextGen",
        "type": "client_custom",
        "module": "./MapPanel",
        "tags": ["map", "maplibre", "pmtiles", "nextgen"],
        "description": "PMTiles map panel driven by the NextGen chatbox"
      },
      {
        "source": "chatbox_markdown_panel",
        "label": "NextGen Markdown Panel",
        "group": "NextGen",
        "type": "client_custom",
        "module": "./MarkdownPanel",
        "tags": ["markdown", "json", "nextgen"],
        "description": "Markdown/JSON results panel driven by the NextGen chatbox"
      }
    ]
  }
}
```

#### 2.4 Install in tethysdash

```bash
cd tethysapp-tethys_dash
npm install @nextgen/chatbox-panels   # or npm link for local dev
npm run build                          # prebuild script discovers the plugins
```

---

### Phase 3: Dynamic Panel Creation via DOM Events (IMPLEMENTED)

Panels are created automatically when the chatbox produces results, without requiring users to pre-place them.

#### 3.1 Event listener in DashboardLayout (IMPLEMENTED)

**Modified:** `reactapp/components/dashboard/DashboardLayout.js`

Added a `useEffect` that listens for `tethysdash:add-visualization` events and creates grid items. Uses a ref (`gridItemsUpdated`) to read current grid items without stale closures. Deduplicates by `args.module` (not source name, since all dynamic panels share `source: "Client Custom"`).

```javascript
useEffect(() => {
  function handleAddVisualization(e) {
    const { source, args, position } = e.detail || {};
    if (!source) return;

    const current = gridItemsUpdated.current;
    // Deduplicate by module name for Client Custom panels
    if (args?.module) {
      const alreadyExists = current.some((item) => {
        try { return JSON.parse(item.args_string).module === args.module; }
        catch { return false; }
      });
      if (alreadyExists) return;
    }

    const maxI = current.reduce((max, item) => Math.max(max, parseInt(item.i) || 0), 0);
    const newItem = {
      x: position?.x ?? 0,
      y: position?.y ?? Infinity,
      w: position?.w ?? 50,
      h: position?.h ?? 20,
      source, args_string: JSON.stringify(args ?? {}),
      metadata_string: JSON.stringify({ refreshRate: 0 }),
      uuid: uuidv4(), id: null, i: `${maxI + 1}`,
    };
    updateTab(tabId, { gridItems: [...current, newItem] });
  }

  window.addEventListener("tethysdash:add-visualization", handleAddVisualization);
  return () => window.removeEventListener("tethysdash:add-visualization", handleAddVisualization);
}, [tabId, updateTab]);
```

#### 3.2 Chatbox dispatches events (IMPLEMENTED)

In `chatbox.jsx`, after writing to `variableInputValues`, the chatbox dispatches events with `initialData` for first-mount delivery:

```javascript
const mfeUrl = window.__CHATBOX_MFE_URL__ || new URL("remoteEntry.js", import.meta.url).href;
const requestPanel = (module, initialData) => {
  window.dispatchEvent(new CustomEvent("tethysdash:add-visualization", {
    detail: {
      source: "Client Custom",
      args: { url: mfeUrl, scope: "mfe_nrds_chatbox", module, remoteType: "vite-esm", initialData },
    },
  }));
};
if (result.plotlyFigure) requestPanel("./ChartPanel", { chatbox_chart: result.plotlyFigure });
if (result.mapConfig) requestPanel("./MapPanel", { chatbox_map: result.mapConfig });
if (result.queryResult) requestPanel("./QueryPanel", { chatbox_query: result.queryResult });
if (result.assistantText && !result.plotlyFigure && !result.mapConfig && !result.queryResult) {
  requestPanel("./MarkdownPanel", { chatbox_markdown: result.assistantText });
}
```

#### 3.3 Initial data delivery (IMPLEMENTED)

**Problem solved:** When a panel is dynamically created, `variableInputValues` context may not have flushed yet, leaving the panel with no data on first mount.

**Solution:** Initial data is passed through `args.initialData`. The `getVisualization()` function in `utilities.js` forwards `args.initialData` as `vizData.props`. `ModuleLoader` spreads `props.props` onto the component. Each panel accepts its variable key as a destructured prop fallback:

```javascript
// QueryPanel.jsx
export default function QueryPanel({ variableInputValues, chatbox_query: initialQuery }) {
  const queryData = variableInputValues?.chatbox_query || initialQuery;
  // ...
}
```

**Key details:**
- `source` must be `"Client Custom"` (the display name from the visualization list), not `"client_custom_remote"` (the type). The lookup in `Base.js` matches by source name.
- MFE URL is auto-derived from `import.meta.url` so it works regardless of where the chatbox is served.
- Deduplication is by `args.module`, not source name, since all dynamic panels share the same source.

---

## Data Flow Diagrams

### Option B: Pre-placed panels (primary approach)

```
Dashboard loads with pre-placed items:
  [Chatbox]  [ChartPanel]  [MapPanel]  [MarkdownPanel]
      |            |            |            |
      | (client_custom: no backend call for any of them)
      |
User asks question → LLM returns { plotlyFigure, mapConfig, assistantText }
      |
chatbox.jsx calls:
  props.updateVariableInputValues({
    chatbox_chart: result.plotlyFigure,
    chatbox_map: result.mapConfig,
    chatbox_markdown: result.assistantText,
  })
      |
VariableInputsContext updates
      |
  ┌───┴───────────────┬──────────────────┐
  ↓                   ↓                  ↓
ChartPanel reads    MapPanel reads     MarkdownPanel reads
variableInputValues variableInputValues variableInputValues
  .chatbox_chart      .chatbox_map       .chatbox_markdown
  ↓                   ↓                  ↓
PlotlyChart renders FlowpathsPmtilesMap MarkdownContent
                    renders              renders
```

### Option C: Dynamic creation (IMPLEMENTED)

```
Dashboard loads with only:
  [Chatbox]
      |
User asks question → LLM returns { queryResult }
      |
chatbox.jsx calls:
  1. updateVariableInputValues({ chatbox_query: result.queryResult })
  2. window.dispatchEvent('tethysdash:add-visualization', {
       source: "Client Custom",
       args: { url, scope, module: "./QueryPanel", remoteType, initialData: { chatbox_query } }
     })
      |
DashboardLayout listener:
  → deduplicates by args.module: ./QueryPanel already on dashboard? No
  → creates grid item { source: "Client Custom", args_string: JSON.stringify(args) }
  → updateTab()
      |
BaseVisualization renders new item:
  → getVisualization() hits client_custom_remote branch (no API call)
  → sets vizData.props = args.initialData (first-mount data)
  → ModuleLoader loads QueryPanel via Module Federation
  → QueryPanel receives initialData as props (immediate) + variableInputValues from context (reactive)
  → ChartPanel reads variableInputValues.chatbox_chart (already set)
  → PlotlyChart renders
```

---

## Design Decisions

### Why variableInputValues instead of Zustand

The original `MICRO_FRONTENDS_SPEC.md` proposed a Zustand store for cross-panel communication. This spec replaces that with `variableInputValues` because:

1. **Already exists** — `ModuleLoader` and `ClientModuleLoader` both pass `variableInputValues` and `updateVariableInputValues` to every custom component. No new dependency needed.
2. **Works across independent grid items** — Zustand store sharing requires both components to load from the same Module Federation remote and relies on module deduplication. `variableInputValues` is a React context that works regardless of how components are loaded.
3. **Consistent with tethysdash patterns** — This is how all inter-visualization communication works in tethysdash (Variable Input → dependent visualizations).
4. **Simpler** — No store creation, no selectors, no subscription management.

**Trade-off:** `variableInputValues` is a flat key-value object, not a typed store. Variable names like `chatbox_chart` are conventions, not contracts. This is acceptable for the chatbox use case but may need revisiting for more complex plugin-to-plugin communication.

### Why npm packages instead of backend Python plugins

The chart/map/markdown panels are **purely client-side** components. They receive data from the chatbox (which already lives in the browser) and render it. No server-side processing is needed. Requiring a Python plugin for each would mean:

1. Unnecessary round-trips: client → server → client for data that never left the client
2. Boilerplate: thin Python classes that just return MFE coordinates
3. Deployment coupling: panel changes require Python package updates

The npm approach mirrors the Python intake pattern (package metadata → build-time discovery → registry) but stays entirely in the JavaScript ecosystem.

### Existing precedent in tethysdash

The `client_custom` type extends an existing pattern. Map, Text, Custom Image, Variable Input, and Live Chat are all client-side-only sources that skip the backend API call. They are hardcoded in `AppLoader.js`. The npm client plugin system makes this pattern **extensible** rather than hardcoded.

### Standalone vs embedded mode

The chatbox must work in two modes:
1. **Standalone** (`npm run dev` in the chatbox project) — renders charts/maps inline in chat bubbles as it does today
2. **Embedded in tethysdash** — delegates charts/maps to external panels via `variableInputValues`

Detection: check if `props.updateVariableInputValues` exists. If yes, the chatbox is inside tethysdash and should publish to variables. If no, render inline.

### CSS scoping for MFEs

MFE stylesheets **must not** use global selectors (like `#root`, `body`, `html`) that match elements in the host page. When a Vite MFE is loaded via Module Federation, its CSS is injected into the host document and applies globally. The chatbox's `App.css` originally had `#root { max-width: 960px }` which constrained tethysdash's entire `#root` element to 960px.

**Rule:** Use scoped class selectors (e.g., `.chatbox-standalone`) instead of ID or element selectors. Apply the class in the standalone `index.html` so the styles only take effect when the MFE runs on its own.

---

## Files to Create/Modify Summary

### TethysDash changes (IMPLEMENTED)

| Action | File | Description |
|--------|------|-------------|
| CREATE | `scripts/collectClientPlugins.js` | Discovery script — scans node_modules, writes JSON registry + JS import map |
| CREATE | `reactapp/generated/clientPluginRegistry.json` | Auto-generated registry (gitignored) |
| CREATE | `reactapp/generated/clientPluginImports.js` | Auto-generated build-time import map (gitignored) |
| CREATE | `reactapp/components/visualizations/ClientModuleLoader.js` | Loads npm-installed client plugins by source name via import map, passes variableInputValues |
| MODIFY | `package.json` | Added `prebuild`, `prestart`, `precollect` scripts |
| MODIFY | `.gitignore` | Added generated registry + import map |
| MODIFY | `reactapp/components/loader/AppLoader.js` | Imports clientPluginRegistry.json, merges into visualization list; added "Client Custom" to Default group (`client_custom_remote` type) |
| MODIFY | `reactapp/components/visualizations/utilities.js` | Added `client_custom` branch (build-time, no API call); added `client_custom_remote` branch (runtime, reuses `ModuleLoader`); added `visualizations` parameter |
| MODIFY | `reactapp/components/visualizations/Base.js` | Added `client_custom` case rendering `ClientModuleLoader`; excluded from refresh rate; passes `visualizations` to `getVisualization()` |

### Chatbox/Panel package changes (IMPLEMENTED)

| Action | File | Description |
|--------|------|-------------|
| CREATE | `src/panels/ChartPanel.jsx` | Reads `variableInputValues.chatbox_chart` (falls back to `chatbox_chart` initial prop), renders PlotlyChart |
| CREATE | `src/panels/MapPanel.jsx` | Reads `variableInputValues.chatbox_map` (falls back to `chatbox_map` initial prop), renders FlowpathsPmtilesMap |
| CREATE | `src/panels/MarkdownPanel.jsx` | Reads `variableInputValues.chatbox_markdown` (falls back to `chatbox_markdown` initial prop), renders MarkdownContent |
| CREATE | `src/panels/QueryPanel.jsx` | Reads `variableInputValues.chatbox_query` (falls back to `chatbox_query` initial prop), renders scrollable HTML table |
| MODIFY | `src/chatbox.jsx` | Accepts updateVariableInputValues/variableInputValues props; detects embedded mode; publishes chatbox_chart/chatbox_map/chatbox_markdown/chatbox_query; dispatches `tethysdash:add-visualization` events for Option C; derives MFE URL from `import.meta.url`; shows text indicators when embedded |
| MODIFY | `src/lib/chatboxEngine.js` | Returns `queryResult: { data, sql }` for query/hydrofabric results |
| MODIFY | `src/App.css` | Changed `#root` to `.chatbox-standalone` to prevent CSS leaking into host page |
| MODIFY | `index.html` | Added `class="chatbox-standalone"` to `#root` div for standalone mode |
| MODIFY | `vite.config.js` | Exposes `./QueryPanel` via Module Federation |

### TethysDash changes for Option C (IMPLEMENTED)

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `reactapp/components/dashboard/DashboardLayout.js` | Added `useEffect` listener for `tethysdash:add-visualization` DOM events; deduplicates by `args.module`; imports `useEffect` and `uuidv4` |
| MODIFY | `reactapp/components/visualizations/utilities.js` | `client_custom_remote` branch forwards `args.initialData` as `vizData.props` |

### Remaining work (NOT YET IMPLEMENTED)

| Action | File | Description |
|--------|------|-------------|
| CREATE | npm package `package.json` | `tethysdash.clientPlugins` metadata for the panel components |
| TODO | npm package build setup | Build the panels as an installable package, `npm link` or `npm install` into tethysdash |

---

## Two Loading Approaches

### Build-time (npm-installed client plugins, `client_custom` type)

- `collectClientPlugins.js` generates `clientPluginImports.js` with static `import()` calls
- Webpack resolves and code-splits these at build time
- `ClientModuleLoader` looks up the source name in the import map
- No runtime fetching, no Module Federation, no CORS
- Must rebuild tethysdash when plugin changes

### Runtime (user-provided remote URL, `client_custom_remote` type)

- User selects "Client Custom" from the visualization picker (in Default group)
- Fills in url, scope, module, remoteType via the existing DataViewer args UI
- `getVisualization()` short-circuits to set `vizType="custom"` with MFE coordinates
- Reuses existing `ModuleLoader` and `remoteLoader.js` — zero new loading code
- No Python backend needed — the args contain everything to load the remote
- Plugin can update independently without rebuilding tethysdash

Both approaches coexist. Build-time plugins appear in the picker under their declared group. Runtime plugins are added via the "Client Custom" option in the Default group.

---

## Testing Checklist

### Build-time client plugins (`client_custom`)
- [ ] `npm run build` in tethysdash runs `collectClientPlugins.js` and generates registry + import map
- [ ] Client plugins appear in the visualization picker under their declared group
- [ ] Adding a client plugin to a dashboard does NOT trigger a backend API call
- [ ] `ClientModuleLoader` renders the component and passes `variableInputValues`
- [ ] Chatbox writes to `variableInputValues` when `updateVariableInputValues` prop is available
- [ ] ChartPanel renders when `variableInputValues.chatbox_chart` is populated
- [ ] MapPanel renders with no data, updates when `variableInputValues.chatbox_map` is set
- [ ] MarkdownPanel renders when `variableInputValues.chatbox_markdown` is populated
- [ ] Chatbox still works standalone (renders inline when `updateVariableInputValues` is not available)

### Runtime client plugins (`client_custom_remote`)
- [ ] "Client Custom" appears in the Default group in the visualization picker
- [ ] User can fill in url, scope, module, remoteType via DataViewer
- [ ] Adding to dashboard does NOT trigger a backend API call
- [ ] Component loads via existing `ModuleLoader` / `remoteLoader.js`
- [ ] `variableInputValues` and `updateVariableInputValues` are passed to the loaded component

### No regressions
- [ ] Existing backend plugin visualizations (plotly, table, map, card, etc.) work unchanged
- [ ] Existing `custom` type Python plugins (like NRDSChatJS) load via ModuleLoader as before
- [ ] Existing client-only sources (Map, Text, Custom Image, Variable Input, Live Chat) work unchanged

### Dynamic panel creation (Phase 3 / Option C) -- IMPLEMENTED
- [ ] DOM event creates a panel dynamically and data is available immediately via `initialData`
- [ ] Duplicate panels are not created when the same event fires twice (dedup by `args.module`)
- [ ] MFE URL is correctly derived from `import.meta.url`
- [ ] Panels work on first mount (initial data via props) and on subsequent prompts (context updates)
- [ ] QueryPanel displays table rows from MCP query results

---

## Open Questions

1. ~~**Build-time vs runtime import**~~ — RESOLVED: Both approaches are supported. Build-time for npm-installed packages, runtime for user-provided URLs.

2. **Scoped namespacing:** Variable names like `chatbox_chart` could collide if multiple chatbox instances are on the same dashboard. Should the variable names include the grid item UUID? e.g., `chatbox_chart_${gridItemUUID}`. This adds complexity but prevents conflicts.

3. **Panel cleanup:** If the chatbox is removed from the dashboard (Phase 3 dynamic creation), should its child panels be removed too? This requires tracking which panels were created by which parent.

4. **Thumbnail images:** The `collectClientPlugins.js` script could also collect thumbnail images from the npm packages (similar to `collect_plugin_static.py`). The `package.json` metadata could include an `icon` field pointing to a bundled image.

5. **Shared dependencies:** The chart panel needs `plotly.js`, the map panel needs `maplibre-gl` and `pmtiles`. When bundled into tethysdash, these add to the bundle size. Tethysdash already has `plotly.js-strict-dist-min` and `ol` (OpenLayers) — the map panel uses MapLibre which is a different library. Evaluate whether to make these peer dependencies or bundle them.
