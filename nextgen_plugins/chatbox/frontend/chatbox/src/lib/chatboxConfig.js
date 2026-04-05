/**
 * chatboxConfig.js
 *
 * Single source of truth for environment-derived configuration
 * and semantic constants used across the chatbox MFE.
 */

// Ollama connection
export const CONFIGURED_OLLAMA_HOST = (
  import.meta.env.VITE_OLLAMA_HOST ?? "http://localhost:11434"
).replace(/\/+$/, "");
export const DEFAULT_OLLAMA_API_KEY = (
  import.meta.env.VITE_OLLAMA_API_KEY ?? ""
).trim();
// In dev mode, use same-origin so requests go through the Vite proxy.
export const DEFAULT_OLLAMA_HOST = import.meta.env.DEV
  ? ""
  : CONFIGURED_OLLAMA_HOST;

// MCP connection
export const DEFAULT_MCP_SERVER_URL = (
  import.meta.env.VITE_MCP_SERVER_URL ?? "/sse"
).trim();
export const MAX_TOOL_REPAIR_ATTEMPTS = Number.parseInt(
  import.meta.env.VITE_MCP_TOOL_REPAIR_ATTEMPTS ?? "0",
  10,
);

// Cloud detection
export const IS_CLOUD =
  Boolean(DEFAULT_OLLAMA_API_KEY) &&
  !/^https?:\/\/(localhost|127\.\d)/.test(CONFIGURED_OLLAMA_HOST);

// Context window budget (reserve 20% for the model's response)
export const CONTEXT_BUDGET_RATIO = 0.8;

// MFE identity (used when dispatching panel creation events)
export const MFE_SCOPE = "mfe_nrds_chatbox";
export const MFE_REMOTE_TYPE = "vite-esm";
export const ADD_VISUALIZATION_EVENT = "tethysdash:add-visualization";
export const PANEL_SOURCE = "Client Custom";
