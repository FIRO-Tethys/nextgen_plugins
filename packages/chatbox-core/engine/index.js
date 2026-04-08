/**
 * engine.js — Generic chatbox engine with strategy pattern extension points.
 *
 * Handles MCP connection, Ollama streaming, tool execution, and conversation loop.
 * NO domain-specific logic — consumers inject behavior via extension points:
 *   - systemPromptBuilder: provides the system message
 *   - toolCategories: maps tool names to state keys
 *   - earlyReturnCheck: decides if a result should end the session
 *   - beforeToolExecution: preprocesses tool args (e.g., S3 URL validation)
 *   - continuationPrompt: custom "continue solving" message
 */

import { Client as MCPClient } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import { Ollama } from "ollama/browser";
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
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_API_KEY,
  DEFAULT_MCP_SERVER_URL,
  MAX_TOOL_REPAIR_ATTEMPTS,
} from "../config/index.js";

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

  for (let i = 0; i < mcpServers.length; i++) {
    const server = mcpServers[i];
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

        tools.push({
          type: "function",
          function: { name: tool.name, description: tool.description ?? "", parameters },
        });
        toolServerMap.set(tool.name, i);
      }
    } catch (error) {
      console.error(`Failed to connect to MCP server ${server.name || server.url}:`, error);
      connections.push(null);
    }
  }

  return { connections, tools, toolServerMap };
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
// Ollama Streaming
// ---------------------------------------------------------------------------

async function chatWithOptionalThinkingStream({
  messages, tools, model, thinkingEnabled,
  onThinkingChunk, onContentChunk, ollamaClient, signal,
}) {
  const responseStream = await ollamaClient.chat({
    model, messages, think: Boolean(thinkingEnabled), tools,
    options: { temperature: 0, num_ctx: 16384 },
    stream: true,
  });

  const merged = {};
  const mergedMessage = { role: "assistant", content: "", thinking: "", tool_calls: null };
  let thinkingBuffer = "";
  let lastFlushMs = Date.now();

  const flushThinking = async (force = false) => {
    if (!thinkingBuffer) return;
    const shouldFlush = force || thinkingBuffer.length >= 80 ||
      /[.!?\n:]$/.test(thinkingBuffer) || Date.now() - lastFlushMs >= 400;
    if (!shouldFlush) return;
    onThinkingChunk?.(thinkingBuffer);
    thinkingBuffer = "";
    lastFlushMs = Date.now();
  };

  for await (const chunk of responseStream) {
    if (signal?.aborted) break;
    const msg = chunk?.message && typeof chunk.message === "object" ? chunk.message : {};

    if (typeof msg.thinking === "string" && msg.thinking) {
      mergedMessage.thinking += msg.thinking;
      thinkingBuffer += msg.thinking;
      await flushThinking(false);
    }
    if (typeof msg.content === "string" && msg.content) {
      mergedMessage.content += msg.content;
      onContentChunk?.(msg.content);
    }
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      mergedMessage.tool_calls = mergeToolCalls(mergedMessage.tool_calls ?? [], msg.tool_calls);
    }

    for (const key of [
      "model", "created_at", "done", "done_reason", "total_duration",
      "load_duration", "prompt_eval_count", "prompt_eval_duration",
      "eval_count", "eval_duration",
    ]) {
      if (Object.prototype.hasOwnProperty.call(chunk, key)) merged[key] = chunk[key];
    }
  }

  await flushThinking(true);
  if (mergedMessage.tool_calls === null) delete mergedMessage.tool_calls;
  merged.message = mergedMessage;
  return merged;
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

    // Collect visualization specs (from TethysDash MCP or any viz-returning server)
    if (toolResult && typeof toolResult === "object" && toolResult.visualization) {
      state.pendingVisualizations.push(toolResult.visualization);
    }

    messages.push({
      role: "tool",
      tool_name: toolName,
      content: toolResult && typeof toolResult === "object"
        ? JSON.stringify(toolResult)
        : String(toolResult ?? ""),
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
// Default continuation prompt
// ---------------------------------------------------------------------------

const DEFAULT_CONTINUATION = (text) =>
  `Use the tool result above to continue. ` +
  `If the user's request is fully answered, respond with a clear, readable summary — do not return raw JSON. ` +
  `If more tool calls are needed to fulfill the request, make them now. ` +
  `Original request: ${text}`;

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export async function runChatSession({
  prompt,
  model,
  thinkingEnabled,
  onThinkingChunk,
  onContentChunk,
  signal,
  ollamaHost = DEFAULT_OLLAMA_HOST,
  ollamaApiKey = DEFAULT_OLLAMA_API_KEY,
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
  continuationPrompt = DEFAULT_CONTINUATION,
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
  };

  // When ollamaHost is a relative path (e.g. "/apps/tethysdash/ollama-proxy"),
  // use proxy:true to skip the SDK's formatHost() which would mangle it into
  // "http://apps:11434/...". The custom fetch prepends the proxy path instead.
  const isProxyPath = ollamaHost && ollamaHost.startsWith("/");
  const ollamaOpts = {
    ...(isProxyPath ? { proxy: true } : { host: ollamaHost || window.location.origin }),
    fetch: (url, init) => {
      let finalUrl = typeof url === "string" ? url : String(url);
      if (isProxyPath && finalUrl.startsWith("/api/")) {
        finalUrl = `${ollamaHost}${finalUrl}`;
      }
      finalUrl = finalUrl.replace(/\/api\/([^/?#]+)(?=[?#]|$)/, "/api/$1/");
      if (csrfToken) {
        init = { ...init, headers: { ...(init?.headers || {}), "x-csrftoken": csrfToken } };
      }
      return fetch(finalUrl, init);
    },
  };
  if (ollamaApiKey) {
    ollamaOpts.headers = { Authorization: `Bearer ${ollamaApiKey}` };
  }
  const ollamaClient = new Ollama(ollamaOpts);

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

  const { connections, tools, toolServerMap } = await connectMcpServers(servers);

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

      const response = await chatWithOptionalThinkingStream({
        messages, tools, model, thinkingEnabled,
        onThinkingChunk, onContentChunk, ollamaClient, signal,
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
          messages,
        };
      }

      messages.push({
        role: "assistant",
        content: stripThinkTags(typeof message.content === "string" ? message.content : ""),
        tool_calls: toolCalls,
      });

      let { hadError, lastErr, failedSignatures } = await processToolCalls(
        toolCalls, messages, connections, toolServerMap, state, text,
        { toolCategories, beforeToolExecution, toolErrorCheck },
      );

      // Extension point: early return for terminal results
      if (!hadError && earlyReturnCheck) {
        const earlyResult = earlyReturnCheck(state, messages);
        if (earlyResult) return earlyResult;
      }

      if (!hadError) {
        messages.push({ role: "user", content: continuationPrompt(text) });
        continue;
      }

      // Error handling + repair loop
      if (hadError && lastErr) {
        let repeatedSignature = null;
        for (const sig of failedSignatures) {
          failedSigCounts[sig] = (failedSigCounts[sig] ?? 0) + 1;
          if (failedSigCounts[sig] >= 2) repeatedSignature = sig;
        }

        if (MAX_TOOL_REPAIR_ATTEMPTS <= 0 && repeatedSignature && repairMessageBuilder) {
          messages.push(repairMessageBuilder(lastErr, text, repeatedSignature));
          continue;
        }

        for (let attempt = 1; attempt <= MAX_TOOL_REPAIR_ATTEMPTS; attempt += 1) {
          if (repairMessageBuilder) {
            messages.push(repairMessageBuilder(lastErr, text, repeatedSignature));
          } else {
            messages.push({ role: "user", content: `Tool error: ${lastErr}. Please fix and try again.` });
          }

          let repairResponse;
          try {
            repairResponse = await chatWithOptionalThinkingStream({
              messages, tools, model, thinkingEnabled,
              onThinkingChunk, onContentChunk, ollamaClient, signal,
            });
          } catch (error) {
            lastErr = `Ollama error during repair attempt ${attempt}: ${String(error?.message ?? error)}`;
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

          ({ hadError, lastErr, failedSignatures } = await processToolCalls(
            repairCalls, messages, connections, toolServerMap, state, text,
            { toolCategories, beforeToolExecution, toolErrorCheck },
          ));

          for (const sig of failedSignatures) {
            failedSigCounts[sig] = (failedSigCounts[sig] ?? 0) + 1;
            if (failedSigCounts[sig] >= 2) repeatedSignature = sig;
          }

          if (!hadError && earlyReturnCheck) {
            const repairEarlyResult = earlyReturnCheck(state, messages);
            if (repairEarlyResult) return repairEarlyResult;
          }

          if (!hadError) {
            messages.push({ role: "user", content: continuationPrompt(text) });
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
