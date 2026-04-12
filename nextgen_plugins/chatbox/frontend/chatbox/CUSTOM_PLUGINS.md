# Custom MFE Plugins for TethysDash

Guide for creating, registering, and testing custom microfrontend (MFE) visualization plugins that work with the TethysDash chatbox, MCP server, and LLM.

---

## Overview

A custom MFE plugin is a React component exposed via [Module Federation](https://module-federation.io/) that renders a visualization on the TethysDash dashboard. The chatbox LLM can discover registered plugins, send them data via MCP tools, and create them as dashboard grid items.

**How it works:**

```
Plugin registered (build-time or runtime)
  → MCP server discovers it via registry
  → LLM calls render_client_plugin(source, props)
  → MCP validates props against declared arg schema
  → Chatbox dispatches tethysdash:add-visualization event
  → DashboardLayout creates grid item
  → ModuleLoader loads component via Module Federation
  → Component renders with props
```

---

## Quick Start

### 1. Create a React component

```jsx
// src/WeatherPanel.jsx
export default function WeatherPanel({ data, variableInputValues, dataKey = "weather" }) {
  const weatherData = data || variableInputValues?.[dataKey];

  if (!weatherData) {
    return <div style={{ padding: 20, color: "#888" }}>No weather data</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>{weatherData.city}</h3>
      <p>{weatherData.temperature}°{weatherData.unit}</p>
      <p>{weatherData.description}</p>
    </div>
  );
}
```

### 2. Expose via Module Federation

```javascript
// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "mfe_weather",
      filename: "remoteEntry.js",
      exposes: {
        "./WeatherPanel": "./src/WeatherPanel",
      },
      shared: ["react", "react-dom"],
    }),
  ],
  build: {
    target: "esnext",
    minify: false,
  },
});
```

### 3. Declare plugin metadata in package.json

```json
{
  "name": "my-weather-plugin",
  "tethysdash": {
    "clientPlugins": [
      {
        "source": "Weather Panel",
        "label": "Weather Forecast",
        "module": "./WeatherPanel",
        "type": "client_custom_remote",
        "scope": "mfe_weather",
        "remoteType": "vite-esm",
        "group": "Weather",
        "tags": ["weather", "forecast"],
        "description": "Displays weather forecast for a city",
        "args": {
          "data": {
            "type": "object",
            "description": "Object with city (string), temperature (number), unit (string: C or F), description (string)",
            "required": true
          }
        }
      }
    ]
  }
}
```

### 4. Register in TethysDash

**Build-time (npm):** Install as a dependency of tethysdash, run `node scripts/collectClientPlugins.js`.

**Runtime (UI):** Open VisualizationSelector → click "Register" → enter URL, scope, module, label → Save.

### 5. Test with the LLM

Ask the chatbox: *"Show me the weather for Denver using the Weather Panel"*

The LLM calls `render_client_plugin(source="Weather Panel", props={data: {city: "Denver", temperature: 72, unit: "F", description: "Sunny"}})` → panel appears on dashboard.

---

## Plugin Structure

### Required: Props Contract

Every plugin component must accept these props:

| Prop | Type | Description |
|------|------|-------------|
| `data` | any | **Primary data source.** Direct data delivery from the LLM/MCP. |
| `dataKey` | string | Which key to read from `variableInputValues`. Set a default per plugin. |
| `variableInputValues` | object | Dashboard variable context for reactive cross-panel updates. |
| `updateVariableInputValues` | function | Setter for publishing data back to the dashboard context. |

**Resolution order:** `data || variableInputValues?.[dataKey]`

```jsx
export default function MyPanel({ data, dataKey = "my_data", variableInputValues }) {
  const panelData = data || variableInputValues?.[dataKey];
  if (!panelData) return <EmptyState />;
  return <Visualization data={panelData} />;
}
```

### Required: Module Federation Config

Your `vite.config.js` (or `webpack.config.js`) must:
- Define a unique `name` (scope) — e.g., `"mfe_weather"`
- Expose your component(s) with `./` prefix — e.g., `"./WeatherPanel"`
- Share `react` and `react-dom` as singletons
- Output a `remoteEntry.js` file

### Required: Empty State

Always handle the case where no data is provided. The component will mount before data arrives.

```jsx
if (!panelData) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
    <p>Waiting for data...</p>
  </div>;
}
```

---

## MCP Compatibility

The MCP server uses plugin metadata to help the LLM discover and correctly use your plugin. Without proper metadata, the LLM will guess (hallucinate) what props to send.

### Declaring args in package.json

The `args` field in `tethysdash.clientPlugins` tells the MCP server what props your component expects. The server converts this to a JSON schema that the LLM reads.

**Supported arg types:**

| Type | package.json value | MCP schema | LLM sees |
|------|-------------------|------------|----------|
| String | `"text"` or `{ "type": "string", ... }` | `{ type: "string" }` | Sends a string |
| Number | `"number"` or `{ "type": "number", ... }` | `{ type: "number" }` | Sends a number |
| Boolean | `"checkbox"` or `{ "type": "boolean", ... }` | `{ type: "boolean" }` | Sends true/false |
| Enum | `["opt1", "opt2"]` | `{ type: "string", enum: [...] }` | Picks from list |
| Object | `"object"` or `{ "type": "object", ... }` | `{ type: "object" }` | Sends JSON object |
| Array | `"array"` or `{ "type": "array", ... }` | `{ type: "array" }` | Sends JSON array |

**Rich schema format (recommended):**

Use the object format to add descriptions and mark optional args:

```json
{
  "args": {
    "data": {
      "type": "array",
      "description": "Array of row objects, e.g., [{name: 'Alice', age: 30}]",
      "required": true
    },
    "title": {
      "type": "string",
      "description": "Optional table title",
      "required": false
    }
  }
}
```

The LLM sees the `description` field and knows exactly what to send. The MCP server validates props against this schema — unknown props are stripped, wrong types are rejected, missing required args return an error.

### Anti-hallucination

With an empty `args: {}`, the MCP has no schema to validate against. The LLM can send anything. **Always declare your args.**

The validation flow:

```
LLM calls render_client_plugin(source="My Plugin", props={...})
  → _validate_plugin_props checks:
    ✓ All required args present
    ✓ Types match declared schema
    ✗ Unknown props stripped (logged as warning)
    ✗ Wrong types rejected with clear error message
  → Valid props passed to component
```

### Optional: ./meta Export

For runtime-registered plugins (via the UI), the MFE can export a `./meta` module that auto-fills registration fields:

```javascript
// Expose in vite.config.js: "./meta": "./src/meta"

// src/meta.js
export default {
  label: "Weather Forecast",
  description: "Displays weather forecast for a city",
  args: {
    data: {
      type: "object",
      description: "Object with city, temperature, unit, description",
      required: true,
    },
  },
  dataKey: "weather",
  tags: ["weather", "forecast"],
};
```

When a user registers the MFE and clicks "Auto-fill", the registration form fetches `./meta` via Module Federation and pre-populates label, description, and args.

---

## Registration

### Method 1: Build-time (npm install)

For plugins distributed as npm packages:

1. Add `tethysdash.clientPlugins` metadata to your `package.json` (see Quick Start step 3)
2. Install the package in tethysdash: `npm install my-weather-plugin`
3. Run the discovery script: `node scripts/collectClientPlugins.js`
4. The plugin appears in `reactapp/generated/clientPluginRegistry.json`
5. Rebuild tethysdash: `npm run build`
6. Plugin appears in the VisualizationSelector under its declared group

For local development, use `npm link` or `file:` dependencies.

### Method 2: Runtime (UI registration)

For plugins served from a dev server or remote URL:

1. Start your MFE dev server (e.g., `npm run dev` → `http://localhost:5002`)
2. Open TethysDash → enter edit mode → Add Dashboard Item → click grid item → search icon
3. Click "Register" button in VisualizationSelector
4. Fill in:
   - **URL**: `http://localhost:5002/assets/remoteEntry.js`
   - **Scope**: `mfe_weather`
   - **Module**: `./WeatherPanel`
   - **Label**: `Weather Panel`
5. Click "Auto-fill" (if your MFE exports `./meta`) or fill remaining fields manually
6. Click "Save"

The plugin is saved to localStorage and synced to the server. The MCP server reads it on next tool call.

### Removing a Runtime Plugin

In the VisualizationSelector, runtime plugins show a red × button on their card. Click it → confirm removal → plugin is deleted from localStorage and server registry.

---

## Testing

### Test 1: Standalone (dev server)

```bash
cd my-weather-plugin
npm run dev
# Open http://localhost:5002 — verify component renders with mock data
```

### Test 2: Module Federation loading

Register the plugin in TethysDash (runtime method). Select it from the VisualizationSelector → it should load and show the empty state.

### Test 3: MCP discovery

With the tethysdash MCP server running, ask the chatbox:

> "What visualizations are available?"

Your plugin should appear in the response with its `args_schema`:

```json
{
  "source": "Weather Panel",
  "label": "Weather Forecast",
  "args_schema": {
    "data": { "type": "object", "description": "...", "required": true }
  },
  "tool": "render_client_plugin"
}
```

### Test 4: LLM-driven creation

Ask the chatbox to use your plugin:

> "Show me the weather for Denver using the Weather Panel"

Verify:
- LLM calls `render_client_plugin` (not `render_mfe`)
- Props match your declared schema
- Panel appears on dashboard with data
- Panel persists after page refresh (auto-saved)

### Test 5: Prop validation

Ask the LLM to send wrong data:

> "Create a Weather Panel with data as a string 'hello'"

The MCP server should return a validation error: `'data' must be an object, got: str`

---

## Reference

### Prop Resolution Order

```
data (direct from MCP/LLM)
  → variableInputValues[dataKey] (reactive dashboard context)
    → chatbox_* initial prop (backward compat with existing dashboards)
```

### Example: package.json clientPlugins entry

```json
{
  "source": "My Plugin",
  "label": "My Plugin Display Name",
  "module": "./MyComponent",
  "type": "client_custom_remote",
  "scope": "mfe_my_plugin",
  "remoteType": "vite-esm",
  "group": "My Group",
  "tags": ["tag1", "tag2"],
  "description": "Human-readable description for the LLM and UI",
  "args": {
    "data": {
      "type": "array",
      "description": "What this arg expects — be specific, the LLM reads this",
      "required": true
    },
    "theme": {
      "type": "string",
      "description": "Color theme",
      "required": false
    }
  }
}
```

### Module Federation Checklist

- [ ] `name` in federation config matches `scope` in clientPlugins
- [ ] `exposes` keys start with `./` (e.g., `"./MyPanel"`)
- [ ] `module` in clientPlugins matches the expose key exactly
- [ ] `shared: ["react", "react-dom"]` present
- [ ] `remoteType` matches your bundler (`"vite-esm"` for Vite, `"webpack"` for Webpack)
- [ ] `remoteEntry.js` is accessible at the declared URL
- [ ] Component handles missing data with an empty state
- [ ] `args` declared with descriptions so the LLM knows what to send
