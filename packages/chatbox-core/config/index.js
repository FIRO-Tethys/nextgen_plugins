/**
 * config.js — Static defaults for @chatbox/core.
 *
 * This is a library — it must NOT read import.meta.env or process.env.
 * Build-time env vars get baked into dist/ and cannot be overridden by
 * consumers. All runtime configuration flows through <Chatbox> props.
 */

// Ollama connection defaults (override via ollamaHost / ollamaApiKey props)
export const DEFAULT_OLLAMA_HOST = "";
export const DEFAULT_OLLAMA_API_KEY = "";

// MCP connection defaults (override via mcpServerUrl / mcpServers props)
export const DEFAULT_MCP_SERVER_URL = "/sse";
export const MAX_TOOL_REPAIR_ATTEMPTS = 0;

// Context window budget (reserve 20% for the model's response)
export const CONTEXT_BUDGET_RATIO = 0.8;
