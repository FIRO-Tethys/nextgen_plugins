# Micro Frontend Architecture: Multi-Panel Chatbox

## Goal

Refactor the existing monolithic chatbox React app into a **multi-panel architecture** where 4 independent UI panels share state via a Zustand store. When the chatbox receives a response from the LLM, the appropriate panel updates automatically:

- **Chatbox panel** — chat input, message thread, model selector, thinking toggle
- **Chart panel** — Plotly chart display (currently `PlotlyChart.jsx`)
- **Map panel** — MapLibre GL + PMTiles map (currently `FlowpathsPmtilesMap.jsx`)
- **Markdown panel** — markdown/JSON rendering (currently `markdownContent.jsx`)

The chatbox panel is the **orchestrator** — it owns the chat engine and publishes typed results to a shared Zustand store. The other three panels are **reactive consumers** that subscribe to their relevant slice of state.

---

## Current Architecture (as-is)

### Project location

```
nextgen_plugins/chatbox/frontend/chatbox/
```

### Key files

| File | Purpose |
|------|---------|
| `src/chatbox.jsx` (342 lines) | Main component. All state is local via `useState`. Renders `PlotlyChart`, `FlowpathsPmtilesMap`, and `MarkdownContent` inline inside chat bubbles |
| `src/lib/chatboxEngine.js` (686 lines) | Chat logic: MCP connection, Ollama streaming, tool execution, result type detection. Returns `{ assistantText, plotlyFigure, mapConfig }` |
| `src/lib/chatboxHelpers.js` (808 lines) | Utilities: model loading, argument normalization, JSON parsing |
| `src/lib/chatboxMessages.js` (262 lines) | System prompts and message templates |
| `src/components/PlotlyChart.jsx` (149 lines) | Renders Plotly charts. Handles base64-encoded numpy arrays. Props: `{ figure }` |
| `src/components/FlowpathsPmtilesMap.jsx` (427 lines) | Renders PMTiles vector maps. Props: `{ mapConfig, styleUrl, height, ...colors }` |
| `src/components/markdownContent.jsx` (90 lines) | Renders markdown with syntax highlighting. Props: `{ content }` |
| `src/App.jsx` | Root: renders `<ChatBox>` with env-based model config |
| `vite.config.js` | Vite + Module Federation (exposes `./Chatbox`), CSS injection, proxy config |

### Current data flow

```
User input
  -> chatbox.jsx sendMessage()
  -> chatboxEngine.js runChatSession()
    -> Ollama streaming + MCP tool calls
    -> Returns: { assistantText?, plotlyFigure?, mapConfig?, aborted? }
  -> chatbox.jsx stores result in messages[] state
  -> Renders inline: PlotlyChart | FlowpathsPmtilesMap | MarkdownContent
```

### Current state (all local in chatbox.jsx)

```javascript
const [messages, setMessages] = useState([])          // Chat history
const [input, setInput] = useState(prompt)             // User input
const [thinkingBuffer, setThinkingBuffer] = useState("") // Streaming thinking
const [contentBuffer, setContentBuffer] = useState("")   // Streaming content
const [selectedModel, setSelectedModel] = useState(model)
const [isThinkingEnabled, setIsThinkingEnabled] = useState(Boolean(thinkingEnabled))
const [loading, setLoading] = useState(false)
const [loadingModels, setLoadingModels] = useState(false)
const [discoveredModels, setDiscoveredModels] = useState([])
const [error, setError] = useState("")
```

### Message shape

```javascript
{
  role: "user" | "assistant" | "tool",
  content: string,
  thinking?: string,
  plotlyFigure?: object,    // Plotly spec from chart tools
  mapConfig?: object,       // { highlight: {...}, camera: {...} }
  tool_calls?: Array,
  tool_name?: string,
}
```

### chatboxEngine.js result routing

The engine detects result types via tool name sets:

```javascript
CHART_RESULT_TOOLS  -> state.lastChartResult  -> return { plotlyFigure }
QUERY_RESULT_TOOLS  -> state.lastQueryResult  -> return { assistantText: JSON }
LIST_RESULT_TOOLS   -> state.lastListResult   -> return { assistantText: JSON }
"build_hydrofabric_feature_map_config" -> state.lastMapResult -> return { mapConfig }
HYDROFABRIC_QUERY_TOOL -> state.lastHydrofabricResult -> return { assistantText: JSON }
```

### Current rendering logic in chatbox.jsx (lines 292-302)

```jsx
{message.mapConfig ? (
  <FlowpathsPmtilesMap mapConfig={message.mapConfig} />
) : message.plotlyFigure ? (
  <PlotlyChart figure={message.plotlyFigure} />
) : message.content ? (
  <MarkdownContent content={message.content} />
) : null}
```

### Existing dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.27.1",
  "maplibre-gl": "^5.20.0",
  "ollama": "^0.6.3",
  "plotly.js-basic-dist-min": "^3.4.0",
  "pmtiles": "^4.4.0",
  "react": "18.2.0",
  "react-dom": "18.2.0",
  "react-markdown": "^10.1.0",
  "react-plotly.js": "^2.6.0",
  "react-syntax-highlighter": "^16.1.1",
  "remark-breaks": "^4.0.0",
  "remark-gfm": "^4.0.1",
  "vite-plugin-css-injected-by-js": "^4.0.1"
}
```

### Existing Module Federation config (vite.config.js)

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

### Environment variables

```
VITE_OLLAMA_HOST              # Ollama server URL (default: http://localhost:11434)
VITE_OLLAMA_API_KEY           # Auth token for Ollama Cloud (optional)
VITE_MCP_SERVER_URL           # MCP server endpoint (default: /sse)
VITE_CHATBOX_MODELS           # Comma-separated model names (fallback)
VITE_MCP_TOOL_REPAIR_ATTEMPTS # Auto-repair attempts (default: 0)
```

---

## Target Architecture (to-be)

### Approach: Single-app, multi-panel with Zustand

This is a **single Vite build** with a shared Zustand store, not separate independently deployed micro frontends. The components are already well-isolated — they just need a shared state layer and a shell layout. This approach:

- Keeps 1 dev server, 1 build, 1 deploy
- Avoids Module Federation complexity for inter-panel communication
- Still exposes panels via Module Federation for Tethys embedding
- Can be promoted to true separate MFEs later if needed (the Zustand boundary makes extraction trivial)

### New file structure

```
src/
├── App.jsx                         # MODIFY — new shell layout with 4 panels
├── App.css                         # MODIFY — grid/panel layout styles
├── store/
│   └── chatStore.js                # NEW — Zustand store (shared state)
├── panels/
│   ├── ChatPanel.jsx               # NEW — wraps chatbox logic, publishes to store
│   ├── ChartPanel.jsx              # NEW — subscribes to store, renders PlotlyChart
│   ├── MapPanel.jsx                # NEW — subscribes to store, renders FlowpathsPmtilesMap
│   └── MarkdownPanel.jsx           # NEW — subscribes to store, renders MarkdownContent
├── chatbox.jsx                     # MODIFY — remove inline rich renders, publish to store
├── chatbox.css                     # KEEP
├── components/
│   ├── PlotlyChart.jsx             # KEEP — no changes needed
│   ├── FlowpathsPmtilesMap.jsx     # KEEP — no changes needed
│   ├── markdownContent.jsx         # KEEP — no changes needed
│   ├── ModelSelector.jsx           # KEEP
│   ├── ModelSelector.css           # KEEP
│   ├── ThinkingSwitch.jsx          # KEEP
│   └── ThinkingSwitch.css          # KEEP
├── lib/
│   ├── chatboxEngine.js            # KEEP — no changes needed
│   ├── chatboxHelpers.js           # KEEP
│   └── chatboxMessages.js          # KEEP
├── main.jsx                        # KEEP
└── index.css                       # KEEP
```

### New dependency

```
zustand (^5.0.0)
```

Install with: `npm install zustand`

---

## Implementation Steps

### Step 1: Create the Zustand store

**File: `src/store/chatStore.js`**

```javascript
import { create } from 'zustand'

export const useChatStore = create((set, get) => ({
  // === Panel display state ===
  // These are the latest results from the chat engine.
  // Each panel subscribes to its own slice.
  plotlyFigure: null,       // Latest Plotly figure spec (object)
  mapConfig: null,           // Latest map config { highlight, camera }
  markdownContent: null,     // Latest markdown/JSON text (string)
  activePanel: null,         // Which panel was most recently updated: "chart" | "map" | "markdown" | null

  // === Actions (called by chatbox after runChatSession completes) ===
  setPlotlyFigure: (figure) => set({
    plotlyFigure: figure,
    activePanel: "chart",
  }),

  setMapConfig: (config) => set({
    mapConfig: config,
    activePanel: "map",
  }),

  setMarkdownContent: (content) => set({
    markdownContent: content,
    activePanel: "markdown",
  }),

  clearPanels: () => set({
    plotlyFigure: null,
    mapConfig: null,
    markdownContent: null,
    activePanel: null,
  }),
}))
```

**Design notes:**
- `activePanel` tracks which display panel should be prominent (for tabbed or conditional layouts)
- Each setter updates only its own data + sets itself as active
- The three display components (`PlotlyChart`, `FlowpathsPmtilesMap`, `markdownContent`) are NOT modified — they still accept the same props
- The store is intentionally flat and minimal. Do NOT put chat messages, loading state, or model selection in the store — those stay local to the chatbox

### Step 2: Create panel wrapper components

Each panel is a thin wrapper that subscribes to the store and renders the existing component.

**File: `src/panels/ChartPanel.jsx`**

```javascript
import { useChatStore } from '../store/chatStore'
import PlotlyChart from '../components/PlotlyChart'

export default function ChartPanel() {
  const plotlyFigure = useChatStore((s) => s.plotlyFigure)

  if (!plotlyFigure) {
    return (
      <div className="panel-empty">
        <p>Charts will appear here</p>
      </div>
    )
  }

  return (
    <div className="panel-content chart-panel-wrapper">
      <PlotlyChart figure={plotlyFigure} />
    </div>
  )
}
```

**File: `src/panels/MapPanel.jsx`**

```javascript
import { useChatStore } from '../store/chatStore'
import FlowpathsPmtilesMap from '../components/FlowpathsPmtilesMap'

export default function MapPanel() {
  const mapConfig = useChatStore((s) => s.mapConfig)

  return (
    <div className="panel-content map-panel-wrapper">
      <FlowpathsPmtilesMap mapConfig={mapConfig} height="100%" />
    </div>
  )
}
```

**Note:** The map panel always renders (MapLibre GL needs a persistent DOM node). The `mapConfig` prop being `null` just means no highlight is applied — the base map is still visible and useful.

**File: `src/panels/MarkdownPanel.jsx`**

```javascript
import { useChatStore } from '../store/chatStore'
import MarkdownContent from '../components/markdownContent'

export default function MarkdownPanel() {
  const markdownContent = useChatStore((s) => s.markdownContent)

  if (!markdownContent) {
    return (
      <div className="panel-empty">
        <p>Results will appear here</p>
      </div>
    )
  }

  return (
    <div className="panel-content markdown-panel-wrapper">
      <MarkdownContent content={markdownContent} />
    </div>
  )
}
```

**File: `src/panels/ChatPanel.jsx`**

This is a thin wrapper around the existing ChatBox component (which will be modified in Step 3).

```javascript
import ChatBox from '../chatbox'

export default function ChatPanel({ model, modelOptions, thinkingEnabled, prompt }) {
  return (
    <div className="panel-content chat-panel-wrapper">
      <ChatBox
        model={model}
        modelOptions={modelOptions}
        thinkingEnabled={thinkingEnabled}
        prompt={prompt}
      />
    </div>
  )
}
```

### Step 3: Modify chatbox.jsx — publish to store instead of rendering inline

This is the core change. The chatbox still manages its own local state (messages, input, loading, etc.) but **publishes results to the shared store** instead of rendering rich content inline.

**Changes to `sendMessage()` in chatbox.jsx:**

After `runChatSession` returns, publish to the store:

```javascript
import { useChatStore } from './store/chatStore'

// Inside sendMessage(), after getting the result (around line 126-161):

const result = await runChatSession({ /* ... */ })

// Publish to shared store for external panels
if (result.plotlyFigure) {
  useChatStore.getState().setPlotlyFigure(result.plotlyFigure)
}
if (result.mapConfig) {
  useChatStore.getState().setMapConfig(result.mapConfig)
}
// For text/JSON results that should appear in the markdown panel:
const textContent = result.assistantText || ""
if (textContent) {
  useChatStore.getState().setMarkdownContent(textContent)
}
```

**Changes to the rendering section (lines 285-303):**

Replace the inline rich content with text indicators in the chat bubbles:

```jsx
<article className={`chat-bubble ${isUser ? "chat-user" : "chat-assistant"}`}>
  {!isUser && message.thinking && (
    <details className="thinking-dropdown">
      <summary>Thinking</summary>
      <pre>{message.thinking}</pre>
    </details>
  )}
  {message.mapConfig ? (
    <p className="chat-panel-indicator">Map updated in map panel</p>
  ) : message.plotlyFigure ? (
    <p className="chat-panel-indicator">Chart updated in chart panel</p>
  ) : message.content ? (
    <MarkdownContent content={message.content} />
  ) : null}
</article>
```

**Important:** Keep `MarkdownContent` imported in chatbox.jsx for rendering text-only responses in the chat bubble itself. The chat thread should still show conversational text inline. Only charts and maps get externalized to their panels. The markdown panel shows structured data (JSON query results, lists, etc.).

### Step 4: Modify App.jsx — shell layout

Replace the current single-component render with a multi-panel layout.

**File: `src/App.jsx`**

```jsx
import { lazy, Suspense } from 'react'
import ChatPanel from './panels/ChatPanel'
import './App.css'

const ChartPanel = lazy(() => import('./panels/ChartPanel'))
const MapPanel = lazy(() => import('./panels/MapPanel'))
const MarkdownPanel = lazy(() => import('./panels/MarkdownPanel'))

function App() {
  const fallbackModels = String(import.meta.env.VITE_CHATBOX_MODELS ?? "qwen3")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const defaultModel = fallbackModels[0] ?? "qwen3"

  return (
    <div className="app-shell">
      <div className="panel panel-chat">
        <ChatPanel
          thinkingEnabled={false}
          model={defaultModel}
          modelOptions={fallbackModels}
          prompt=""
        />
      </div>
      <div className="panel-display-area">
        <Suspense fallback={<div className="panel-loading">Loading...</div>}>
          <div className="panel panel-chart">
            <ChartPanel />
          </div>
          <div className="panel panel-map">
            <MapPanel />
          </div>
          <div className="panel panel-markdown">
            <MarkdownPanel />
          </div>
        </Suspense>
      </div>
    </div>
  )
}

export default App
```

### Step 5: Add shell layout CSS

**Add to `src/App.css`:**

```css
.app-shell {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: #0f172a;
}

.panel-chat {
  height: 100vh;
  overflow: hidden;
  border-right: 1px solid #1e293b;
}

.panel-display-area {
  display: grid;
  grid-template-rows: 1fr 1fr 1fr;
  height: 100vh;
  overflow: hidden;
}

.panel {
  overflow: auto;
  position: relative;
}

.panel-chart,
.panel-map,
.panel-markdown {
  border-bottom: 1px solid #1e293b;
  min-height: 0;
}

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #64748b;
  font-size: 0.875rem;
}

.panel-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #64748b;
}

.chat-panel-indicator {
  color: #94a3b8;
  font-style: italic;
  font-size: 0.85rem;
  margin: 4px 0;
}

/* Responsive: stack on narrow screens */
@media (max-width: 900px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .panel-display-area {
    grid-template-rows: 1fr;
    grid-template-columns: 1fr 1fr 1fr;
  }
}
```

**Layout:**

```
Desktop (>900px):                     Mobile (<900px):
┌──────────┬──────────────┐          ┌──────────────────────┐
│          │  Chart Panel │          │      Chat Panel      │
│  Chat    ├──────────────┤          ├───────┬───────┬──────┤
│  Panel   │  Map Panel   │          │ Chart │  Map  │  MD  │
│          ├──────────────┤          └───────┴───────┴──────┘
│          │ Markdown     │
└──────────┴──────────────┘
```

### Step 6: Update Module Federation exports

Update `vite.config.js` to expose individual panels for Tethys embedding:

```javascript
federation({
  name: "mfe_nrds_chatbox",
  filename: "remoteEntry.js",
  exposes: {
    "./Chatbox": "./src/chatbox",
    "./ChartPanel": "./src/panels/ChartPanel",
    "./MapPanel": "./src/panels/MapPanel",
    "./MarkdownPanel": "./src/panels/MarkdownPanel",
    "./ChatStore": "./src/store/chatStore",
  },
  shared: ["react", "react-dom"],
})
```

This allows a Tethys host to import any individual panel and the shared store, enabling custom layouts outside of this app.

---

## Design Decisions (already made)

### State ownership

- **Chat state stays local** in chatbox.jsx: `messages`, `input`, `loading`, `selectedModel`, `thinkingBuffer`, `contentBuffer`, etc. These do NOT go in the Zustand store.
- **Only display panel data goes in the Zustand store**: `plotlyFigure`, `mapConfig`, `markdownContent`, `activePanel`.
- Rationale: The chatbox is the only producer of these results. Putting chat internals in a global store would add complexity with no benefit.

### One-way data flow (chatbox -> panels)

- The chatbox publishes results. The display panels consume them.
- There is NO bidirectional communication in this phase. Clicking a map feature does NOT send a message back to the chatbox.
- This can be added later by extending the store with `pendingQuery`, `mapSelection`, etc.

### Chat bubble content

- Chat bubbles show **text indicators** ("Chart updated in chart panel") for chart/map results instead of rendering rich content inline.
- Chat bubbles still render text/markdown responses inline via `<MarkdownContent>` for conversational text.
- The dedicated markdown panel shows structured data (JSON query results, list results).

### Chat engine unchanged

- `chatboxEngine.js` is NOT modified. It still returns `{ assistantText, plotlyFigure, mapConfig }`.
- The publishing to Zustand happens in `chatbox.jsx`'s `sendMessage()`, which is the integration point.

### Existing components unchanged

- `PlotlyChart.jsx`, `FlowpathsPmtilesMap.jsx`, and `markdownContent.jsx` are NOT modified. They still accept the same props. The panel wrappers handle store subscription.

---

## Testing Checklist

After implementation, verify:

- [ ] Chat input sends messages and receives streaming responses
- [ ] Text responses render in chat bubbles AND markdown panel
- [ ] Chart tool results update the chart panel (not rendered inline in chat)
- [ ] Map tool results update the map panel (not rendered inline in chat)
- [ ] Chat bubbles show "Chart updated" / "Map updated" text for rich results
- [ ] Thinking toggle still works (streaming thinking shown in chat)
- [ ] Model selector still works
- [ ] Stop generation button still works
- [ ] Map panel shows base map even with no `mapConfig`
- [ ] Chart/markdown panels show empty state when no data
- [ ] Layout is responsive (grid stacks on narrow screens)
- [ ] Module Federation still exposes `./Chatbox` correctly
- [ ] `npm run dev` works (single server)
- [ ] `npm run build && npm run preview` works
- [ ] No regressions in MCP tool execution or error recovery

---

## Future Enhancements (not in scope for this task)

These are documented for context but should NOT be implemented now:

1. **Bidirectional communication** — Map click -> chatbox query. Add `pendingQuery` to store.
2. **Tabbed display panels** — Show only the active panel instead of all three. Use `activePanel` from store.
3. **Panel history** — Let users scroll back through previous chart/map results, not just the latest.
4. **True MFE extraction** — Split panels into separate Vite projects with independent builds if independent deployment is needed.
5. **Persistent panel state** — Save last chart/map to localStorage so panels survive page reload.
