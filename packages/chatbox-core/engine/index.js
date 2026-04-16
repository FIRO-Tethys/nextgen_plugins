/**
 * engine.js — Generic chatbox engine with strategy pattern extension points.
 *
 * Handles MCP connection, streaming, tool execution, and conversation loop.
 * Classifies each MCP server as "search-facade" (BM25) or "full-catalog"
 * and groups tools by server for per-server selection.
 *
 * NO domain-specific logic — consumers inject behavior via extension points:
 *   - systemPromptBuilder: provides the system message
 *   - toolCategories: maps tool names to state keys
 *   - earlyReturnCheck: decides if a result should end the session
 *   - beforeToolExecution: preprocesses tool args (e.g., S3 URL validation)
 */

import { Client as MCPClient } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";

import {
  extractInlineToolCalls,
  getMessage,
  maybeParseJson,
  omitEmptyArgs,
  mergeToolCalls,
  stripThinkTags,
} from "../helpers/index.js";
import { trimConversation } from "../conversation/index.js";
import { buildGenericSystemMessage } from "../messages/index.js";
import {
  DEFAULT_MCP_SERVER_URL,
  MAX_TOOL_REPAIR_ATTEMPTS,
  MAX_TOOL_RESULT_CHARS,
  ALWAYS_ON_TOOLS,
} from "../config/index.js";

import { streamChat as openaiStreamChat } from "./adapters/openai.js";
import { streamChat as anthropicStreamChat } from "./adapters/anthropic.js";
import { streamChat as ollamaStreamChat } from "./adapters/ollama.js";

const PROVIDER_ADAPTERS = {
  openai: openaiStreamChat,
  anthropic: anthropicStreamChat,
  ollama: ollamaStreamChat,
  custom: openaiStreamChat,
};

// ---------------------------------------------------------------------------
// Server Classification
// ---------------------------------------------------------------------------

const SMALL_CATALOG_THRESHOLD = 8;

/**
 * Classify an MCP server as "search-facade" or "full-catalog" based on its
 * exposed tool list. A search-facade server has BM25SearchTransform enabled
 * and exposes search_tools + call_tool alongside a small set of pinned tools.
 */
function classifyServerTools(serverTools) {
  const names = new Set(serverTools.map((t) => t.function.name));
  const hasSearchFacade =
    names.has("search_tools") &&
    names.has("call_tool") &&
    serverTools.length < SMALL_CATALOG_THRESHOLD;

  return hasSearchFacade ? "search-facade" : "full-catalog";
}

// ---------------------------------------------------------------------------
// Tool Budget & Per-Server Selection
// ---------------------------------------------------------------------------

const TOOL_BUDGET = 25;

/**
 * Select tools for the LLM based on per-server classification and a global budget.
 *
 * Called once per user message — the returned tool set remains stable across
 * the entire chat loop (continuations, repairs).
 *
 * @param {string} prompt - Original user prompt (used for future semantic matching)
 * @param {Object} toolsByServer - Map of serverId -> tool definitions
 * @param {Object} classificationByServer - Map of serverId -> "search-facade"|"full-catalog"
 * @param {Object} embeddingsByServer - Map of serverId -> embeddings (null until Unit 5)
 * @returns {Array} Selected tools to send to the LLM
 */
async function selectToolsForPrompt(prompt, toolsByServer, classificationByServer, embeddingsByServer = {}) {
  const selected = [];
  let budgetRemaining = TOOL_BUDGET;
  const largeCatalogServers = [];

  // Phase 1: Fixed-cost servers (search-facade + small full-catalog)
  for (const [serverId, serverTools] of Object.entries(toolsByServer)) {
    const kind = classificationByServer[serverId] || "full-catalog";

    if (kind === "search-facade") {
      selected.push(...serverTools);
      budgetRemaining -= serverTools.length;
      continue;
    }

    // Full-catalog: small vs large
    if (serverTools.length < SMALL_CATALOG_THRESHOLD) {
      selected.push(...serverTools);
      budgetRemaining -= serverTools.length;
      continue;
    }

    largeCatalogServers.push({ serverId, serverTools });
  }

  // Phase 2: Large full-catalog servers share remaining budget
  if (largeCatalogServers.length > 0 && budgetRemaining > 0) {
    const perServer = Math.max(3, Math.floor(budgetRemaining / largeCatalogServers.length));

    for (const { serverId, serverTools } of largeCatalogServers) {
      const embeddings = embeddingsByServer[serverId];

      if (embeddings) {
        try {
          const { selectTopTools } = await import("./embeddings.js");
          const topTools = await selectTopTools(prompt, serverTools, embeddings, perServer);
          selected.push(...topTools);
          continue;
        } catch { /* fall through to keyword matching */ }
      }

      // Keyword-based tool selection (fallback when no embeddings)
      const alwaysOn = new Set(ALWAYS_ON_TOOLS);
      const promptWords = new Set(
        prompt.toLowerCase().split(/[\s,.:;!?()]+/).filter((w) => w.length > 2),
      );

      const scored = serverTools.map((tool) => {
        const fn = tool.function || {};
        const nameWords = (fn.name || "").toLowerCase().split("_");
        const descWords = (fn.description || "").toLowerCase().split(/\s+/);
        let score = 0;
        for (const w of promptWords) {
          if (nameWords.some((nw) => nw.includes(w) || w.includes(nw))) score += 3;
          if (descWords.some((dw) => dw.includes(w) || w.includes(dw))) score += 1;
        }
        // Always-on tools get max score
        if (alwaysOn.has(fn.name)) score = Infinity;
        return { tool, score };
      });

      scored.sort((a, b) => b.score - a.score);

      // Take top N per budget, but at least 5 tools as a safety net
      const limit = Math.max(5, perServer);
      const picked = scored.slice(0, limit).map((s) => s.tool);
      selected.push(...picked);
    }
  } else if (largeCatalogServers.length > 0) {
    // Budget exhausted by fixed-cost servers — send always-on tools only
    const alwaysOn = new Set(ALWAYS_ON_TOOLS);
    for (const { serverTools } of largeCatalogServers) {
      selected.push(...serverTools.filter((t) => alwaysOn.has(t.function?.name)));
    }
  }

  return selected;
}

// ---------------------------------------------------------------------------
// MCP Connection Infrastructure
// ---------------------------------------------------------------------------

function normalizeMcpSseUrl(serverUrl) {
  const raw = String(serverUrl ?? "").trim();
  if (!raw) throw new Error("MCP server URL is empty.");

  const hasProtocol = /^https?:\/\//i.test(raw);
  const isRelativePath = raw.startsWith("/");

  let normalized;
  if (hasProtocol) {
    normalized = raw;
  } else if (isRelativePath) {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    normalized = `${origin}${raw}`;
  } else {
    normalized = `http://${raw}`;
  }

  // 0.0.0.0 is a server bind address, not a browser-reachable connect address.
  // Auto-correct to localhost to prevent ERR_ADDRESS_INVALID.
  normalized = normalized.replace(/\/\/0\.0\.0\.0([:/])/g, "//localhost$1");

  normalized = normalized.replace(/\/+$/, "");
  if (!normalized.endsWith("/sse")) {
    normalized = `${normalized}/sse`;
  }
  return normalized;
}

async function createMcpConnection(mcpServerUrl) {
  const sseUrl = normalizeMcpSseUrl(mcpServerUrl);
  const client = new MCPClient({ name: "chatbox-core", version: "0.1.0" });
  const transport = new SSEClientTransport(new URL(sseUrl));
  await client.connect(transport);
  return { client, transport };
}

async function closeMcpConnection(connection) {
  if (!connection?.transport) return;
  try { await connection.transport.close(); } catch { /* best effort */ }
}

export async function connectMcpServers(mcpServers) {
  const connections = [];
  const tools = [];
  const toolServerMap = new Map();
  const toolsByServer = {};
  const classificationByServer = {};

  for (let i = 0; i < mcpServers.length; i++) {
    const server = mcpServers[i];
    const serverId = String(i);
    toolsByServer[serverId] = [];

    try {
      const conn = await createMcpConnection(server.url);
      connections.push(conn);

      const response = await conn.client.listTools();
      const toolsList = Array.isArray(response?.tools) ? response.tools : [];

      for (const tool of toolsList) {
        const parameters =
          tool?.inputSchema && typeof tool.inputSchema === "object"
            ? tool.inputSchema
            : { type: "object", properties: {}, additionalProperties: false };

        const toolDef = {
          type: "function",
          function: { name: tool.name, description: tool.description ?? "", parameters },
        };
        tools.push(toolDef);
        toolsByServer[serverId].push(toolDef);

        if (toolServerMap.has(tool.name)) {
          console.warn(
            `Tool name collision: "${tool.name}" exists on server ${toolServerMap.get(tool.name)} and server ${i}. ` +
            `Keeping first server's mapping. Consider using unique tool names across servers.`
          );
        } else {
          toolServerMap.set(tool.name, i);
        }
      }

      classificationByServer[serverId] = classifyServerTools(toolsByServer[serverId]);
    } catch (error) {
      console.error(`Failed to connect to MCP server ${server.name || server.url}:`, error);
      connections.push(null);
      classificationByServer[serverId] = "full-catalog";
    }
  }

  return { connections, tools, toolServerMap, toolsByServer, classificationByServer };
}

async function closeAllMcpConnections(connections) {
  for (const conn of connections) {
    await closeMcpConnection(conn);
  }
}

export async function executeTool(toolName, args, connections, toolServerMap) {
  const serverIdx = toolServerMap.get(toolName);
  const conn = serverIdx != null ? connections[serverIdx] : null;
  const mcpClient = conn?.client;

  if (!mcpClient) {
    return { error: `No MCP server found for tool: ${toolName}` };
  }

  try {
    const result = await mcpClient.callTool({
      name: toolName,
      arguments: omitEmptyArgs(args),
      raiseOnError: false,
    });

    const data = result?.data;
    if (data !== undefined && data !== null) return maybeParseJson(data);

    try {
      return maybeParseJson(result?.content?.[0]?.text ?? result);
    } catch {
      return result;
    }
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

// ---------------------------------------------------------------------------
// Provider-Agnostic Streaming (via adapters)
// ---------------------------------------------------------------------------

async function streamWithAdapter({
  messages, tools, model, thinkingEnabled,
  onThinkingChunk, onContentChunk, providerConfig, csrfToken, signal,
}) {
  const { provider } = providerConfig;
  const adapter = PROVIDER_ADAPTERS[provider] || openaiStreamChat;

  return adapter({
    ...providerConfig,
    model,
    messages,
    tools,
    csrfToken,
    signal,
    onThinkingChunk: thinkingEnabled ? onThinkingChunk : undefined,
    onContentChunk,
  });
}

// ---------------------------------------------------------------------------
// Generic Tool Processing
// ---------------------------------------------------------------------------

async function processToolCalls(
  toolCalls, messages, connections, toolServerMap, state, originalUserText,
  { toolCategories, beforeToolExecution, toolErrorCheck },
) {
  let hadError = false;
  let lastErr = null;
  const failedSignatures = [];

  for (const toolCall of toolCalls) {
    let toolName = toolCall?.function?.name;
    let args = toolCall?.function?.arguments ?? {};

    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = { _raw: args }; }
    }

    // Extension point: domain-specific preprocessing (S3 validation, arg normalization)
    if (beforeToolExecution) {
      const preResult = beforeToolExecution(toolName, args, messages);
      if (preResult?.skip) {
        // Domain hook wants to skip this tool (e.g., invalid S3 URL)
        if (preResult.message) {
          messages.push({ role: "tool", tool_name: toolName, content: JSON.stringify(preResult.message) });
        }
        if (preResult.error) {
          hadError = true;
          lastErr = preResult.error;
          if (preResult.signature) failedSignatures.push(preResult.signature);
        }
        continue;
      }
      if (preResult?.args) args = preResult.args;
      if (preResult?.toolName) toolName = preResult.toolName;
    }

    const toolResult = await executeTool(toolName, args, connections, toolServerMap);

    // Categorize tool result via injected categories
    if (toolResult && typeof toolResult === "object" && toolCategories) {
      const errText = toolErrorCheck ? toolErrorCheck(toolResult) : null;
      if (!errText) {
        for (const category of Object.values(toolCategories)) {
          if (category.tools.has(toolName)) {
            state[category.stateKey] = toolResult;
            category.onSuccess?.(state, toolResult, args);
            break;
          }
        }
      }
    }

    // Collect visualization specs from the ORIGINAL result (before truncation)
    if (toolResult && typeof toolResult === "object" && toolResult.visualization) {
      state.pendingVisualizations.push(toolResult.visualization);
    }

    // Collect layer updates (from add_map_service_layer) before truncation
    if (toolResult && typeof toolResult === "object" && toolResult.layer_update) {
      state.pendingLayerUpdates.push(toolResult.layer_update);
    }

    // Truncate large results before storing in conversation history
    let resultContent = toolResult && typeof toolResult === "object"
      ? JSON.stringify(toolResult)
      : String(toolResult ?? "");

    if (resultContent.length > MAX_TOOL_RESULT_CHARS) {
      if (toolResult?.visualization) {
        // Preserve visualization reference in a compact summary
        resultContent = JSON.stringify({
          visualization: { source: toolResult.visualization.source, vizType: toolResult.visualization.vizType },
          _truncated: true,
          _originalChars: resultContent.length,
        });
      } else {
        const originalLen = resultContent.length;
        resultContent = resultContent.slice(0, MAX_TOOL_RESULT_CHARS)
          + `\n...[truncated, full result was ${originalLen} chars]`;
      }
    }

    messages.push({
      role: "tool",
      tool_call_id: toolCall.id || toolName,
      tool_name: toolName,
      content: resultContent,
    });

    const errText = toolErrorCheck ? toolErrorCheck(toolResult) : null;
    if (errText) {
      hadError = true;
      lastErr = errText;
      // Use domain-provided signature or fallback
      failedSignatures.push(`${toolName}|${JSON.stringify(args)}`);
    }
  }

  return { hadError, lastErr, failedSignatures };
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export async function runChatSession({
  prompt,
  model,
  thinkingEnabled,
  onThinkingChunk,
  onContentChunk,
  onToolStatus,
  signal,
  providerConfig = { provider: "custom", baseUrl: "", apiKey: "" },
  csrfToken = "",
  mcpServerUrl = DEFAULT_MCP_SERVER_URL,
  mcpServers,
  history,
  maxContextTokens,

  // Extension points (all optional — defaults produce a generic chatbox)
  systemPromptBuilder = buildGenericSystemMessage,
  toolCategories = null,
  earlyReturnCheck = null,
  beforeToolExecution = null,
  toolErrorCheck = null,
  repairMessageBuilder = null,
  beforeFirstMessage = null,
}) {
  const state = {
    lastChartResult: null,
    lastQueryResult: null,
    lastQuerySQL: null,
    lastListResult: null,
    lastMapResult: null,
    lastHydrofabricResult: null,
    pendingVisualizations: [],
    pendingLayerUpdates: [],
  };

  let messages =
    Array.isArray(history) && history.length > 0
      ? [...history]
      : [systemPromptBuilder()];

  const text = typeof prompt === "string" ? prompt : "";

  const servers = Array.isArray(mcpServers) && mcpServers.length > 0
    ? mcpServers
    : mcpServerUrl
      ? [{ url: mcpServerUrl, name: "Default" }]
      : [];

  const { connections, tools, toolServerMap, toolsByServer, classificationByServer } =
    await connectMcpServers(servers);

  // Build embeddings for large full-catalog servers (lazy, cached across messages).
  const embeddingsByServer = {};
  for (const [serverId, serverTools] of Object.entries(toolsByServer)) {
    const kind = classificationByServer[serverId];
    if (kind === "full-catalog" && serverTools.length >= SMALL_CATALOG_THRESHOLD) {
      try {
        const { buildEmbeddingsForServer } = await import("./embeddings.js");
        const serverUrl = servers[Number(serverId)]?.url || serverId;
        embeddingsByServer[serverId] = await buildEmbeddingsForServer(serverUrl, serverTools);
      } catch {
        // Embedding module unavailable — selection will fall back to all tools
      }
    }
  }

  // Select tools once per user message — stable across the entire chat loop.
  const selectedTools = await selectToolsForPrompt(
    typeof prompt === "string" ? prompt : "",
    toolsByServer,
    classificationByServer,
    embeddingsByServer,
  );

  try {
    messages.push({ role: "user", content: text });

    if (maxContextTokens && maxContextTokens > 0) {
      messages = trimConversation(messages, maxContextTokens);
    }

    // Extension point: inject additional messages before first LLM call
    // (e.g., file URL detection message for NRDS)
    if (beforeFirstMessage) {
      const extra = beforeFirstMessage(text, messages);
      if (extra) messages.push(extra);
    }

    const failedSigCounts = {};

    while (true) {
      if (signal?.aborted) {
        return { assistantText: "", messages, aborted: true };
      }

      const response = await streamWithAdapter({
        messages, tools: selectedTools, model, thinkingEnabled,
        onThinkingChunk, onContentChunk, providerConfig, csrfToken, signal,
      });

      const message = getMessage(response);
      let toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      if (!toolCalls.length) {
        const assistantContent = typeof message.content === "string" ? message.content : "";
        toolCalls = extractInlineToolCalls(assistantContent);
      }

      // No tool calls → return final text response
      if (!toolCalls.length) {
        const assistantText = stripThinkTags(
          typeof message.content === "string" ? message.content : "",
        );
        messages.push({ role: "assistant", content: assistantText });
        return {
          assistantText,
          queryResult: state.lastQueryResult
            ? { data: state.lastQueryResult, sql: state.lastQuerySQL }
            : undefined,
          visualizations: state.pendingVisualizations.length > 0
            ? state.pendingVisualizations
            : undefined,
          layerUpdates: state.pendingLayerUpdates.length > 0
            ? state.pendingLayerUpdates
            : undefined,
          messages,
        };
      }

      messages.push({
        role: "assistant",
        content: stripThinkTags(typeof message.content === "string" ? message.content : ""),
        tool_calls: toolCalls,
      });

      // All tool calls go directly to MCP servers — no discover_tools interception.
      onToolStatus?.("calling_tools");
      let { hadError, lastErr, failedSignatures } = await processToolCalls(
        toolCalls, messages, connections, toolServerMap, state, text,
        { toolCategories, beforeToolExecution, toolErrorCheck },
      );
      onToolStatus?.(null);

      // Extension point: early return for terminal results
      if (!hadError && earlyReturnCheck) {
        const earlyResult = earlyReturnCheck(state, messages);
        if (earlyResult) return earlyResult;
      }

      // Visualizations are accumulated in state.pendingVisualizations but do NOT
      // trigger an early return. The LLM may need additional rounds (e.g., create
      // a variable input in round 1, then render a plugin in round 2). The normal
      // "no tool calls" exit at the top of the loop includes pendingVisualizations.

      if (!hadError) {
        continue;
      }

      // Error handling + repair loop
      // Guard uses `hadError` alone — lastErr can be falsy (empty string) when
      // toolErrorCheck returns "". Both cases must enter this block.
      if (hadError) {
        const errorMsg = lastErr || "Tool call failed with unknown error.";
        let repeatedSignature = null;
        for (const sig of failedSignatures) {
          failedSigCounts[sig] = (failedSigCounts[sig] ?? 0) + 1;
          if (failedSigCounts[sig] >= 2) repeatedSignature = sig;
        }

        // When repair attempts are disabled (MAX_TOOL_REPAIR_ATTEMPTS=0),
        // inject a repair message for context and let the LLM retry naturally
        // on the next loop iteration. Do NOT continue unconditionally here —
        // the LLM gets one chance to self-correct via the normal loop.
        if (MAX_TOOL_REPAIR_ATTEMPTS <= 0) {
          if (repeatedSignature && repairMessageBuilder) {
            messages.push(repairMessageBuilder(errorMsg, text, repeatedSignature));
          } else {
            messages.push({ role: "user", content: `Tool error: ${errorMsg}. Please try a different approach.` });
          }
          continue;
        }

        for (let attempt = 1; attempt <= MAX_TOOL_REPAIR_ATTEMPTS; attempt += 1) {
          if (repairMessageBuilder) {
            messages.push(repairMessageBuilder(errorMsg, text, repeatedSignature));
          } else {
            messages.push({ role: "user", content: `Tool error: ${errorMsg}. Please fix and try again.` });
          }

          let repairResponse;
          try {
            repairResponse = await streamWithAdapter({
              messages, tools: selectedTools, model, thinkingEnabled,
              onThinkingChunk, onContentChunk, providerConfig, csrfToken, signal,
            });
          } catch (error) {
            lastErr = `LLM error during repair attempt ${attempt}: ${String(error?.message ?? error)}`;
            continue;
          }

          const repairMessage = getMessage(repairResponse);
          let repairCalls = Array.isArray(repairMessage.tool_calls) ? repairMessage.tool_calls : [];
          if (!repairCalls.length) {
            repairCalls = extractInlineToolCalls(typeof repairMessage.content === "string" ? repairMessage.content : "");
          }
          if (!repairCalls.length) {
            lastErr = "Model did not return tool_calls; it responded with text instead.";
            continue;
          }

          messages.push({
            role: "assistant",
            content: stripThinkTags(typeof repairMessage.content === "string" ? repairMessage.content : ""),
            tool_calls: repairCalls,
          });

          onToolStatus?.("calling_tools");
          ({ hadError, lastErr, failedSignatures } = await processToolCalls(
            repairCalls, messages, connections, toolServerMap, state, text,
            { toolCategories, beforeToolExecution, toolErrorCheck },
          ));
          onToolStatus?.(null);

          for (const sig of failedSignatures) {
            failedSigCounts[sig] = (failedSigCounts[sig] ?? 0) + 1;
            if (failedSigCounts[sig] >= 2) repeatedSignature = sig;
          }

          if (!hadError && earlyReturnCheck) {
            const repairEarlyResult = earlyReturnCheck(state, messages);
            if (repairEarlyResult) return repairEarlyResult;
          }

          if (!hadError) {
            break;
          }
        }
        continue;
      }
    }
  } finally {
    await closeAllMcpConnections(connections);
  }
}
