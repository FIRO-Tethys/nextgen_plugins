/**
 * chatboxConfig.js — NRDS MFE-specific constants + re-exports from @chatbox/core.
 */

// Re-export generic constants from core
export {
  DEFAULT_OLLAMA_API_KEY,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_MCP_SERVER_URL,
  MAX_TOOL_REPAIR_ATTEMPTS,
  CONTEXT_BUDGET_RATIO,
} from "@chatbox/core/config";

// MFE-specific constants (used by chatboxPanelBridge and chatbox.jsx)
export const MFE_SCOPE = "mfe_nrds_chatbox";
export const MFE_REMOTE_TYPE = "vite-esm";
export const ADD_VISUALIZATION_EVENT = "tethysdash:add-visualization";
export const PANEL_SOURCE = "Client Custom";
