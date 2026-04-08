/**
 * config.js — Shared environment-derived configuration.
 * Generic constants only — no MFE-specific or domain-specific values.
 */

// Ollama connection
export const CONFIGURED_OLLAMA_HOST = (
  import.meta.env.VITE_OLLAMA_HOST ?? "http://localhost:11434"
).replace(/\/+$/, "");
export const DEFAULT_OLLAMA_API_KEY = (
  import.meta.env.VITE_OLLAMA_API_KEY ?? ""
).trim();
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

// Context window budget (reserve 20% for the model's response)
export const CONTEXT_BUDGET_RATIO = 0.8;
