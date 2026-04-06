// chatboxEngine.js
import { Client as MCPClient } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import { Ollama } from "ollama/browser";
import {
  bumpFailedSignatureCounts,
  extractFileUrl,
  extractInlineToolCalls,
  fileKind,
  generateAutoFixToolMsg,
  generateFileMsg,
  getMessage,
  isPlausibleOutputsFile,
  lastToolFileUrl,
  normalizeQueryToolArgs,
  rewriteFromToOutput,
  toolCallSignature,
  toolErrorText,
  maybeParseJson,
  omitEmptyArgs,
  mergeToolCalls,
  invalidOutputFileToolResult,
  stripThinkTags
} from "./chatboxHelpers";
import { trimConversation } from "./chatboxConversation";
import { buildSystemMessage } from "./chatboxMessages";
import {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_API_KEY,
  DEFAULT_MCP_SERVER_URL,
  MAX_TOOL_REPAIR_ATTEMPTS,
} from "./chatboxConfig";

// Tool categories — each maps tool names to a state key set on success.
// Used by processToolCalls to update state and by early-return logic.
const TOOL_CATEGORIES = {
  chart: {
    tools: new Set(["create_plotly_chart_from_parquet_output_file", "create_plotly_chart_from_output_selector"]),
    stateKey: "lastChartResult",
  },
  query: {
    tools: new Set(["query_output_file", "query_output_file_from_output_selector"]),
    stateKey: "lastQueryResult",
    onSuccess: (state, _result, args) => {
      state.lastQuerySQL = typeof args?.query === "string" ? args.query : null;
    },
  },
  list: {
    tools: new Set([
      "list_available_models", "list_available_dates", "list_available_forecasts",
      "list_available_cycles", "list_available_vpus", "list_available_output_files",
    ]),
    stateKey: "lastListResult",
  },
  map: {
    tools: new Set(["build_hydrofabric_feature_map_config"]),
    stateKey: "lastMapResult",
  },
  hydrofabric: {
    tools: new Set(["query_hydrofabric_parquet_file"]),
    stateKey: "lastHydrofabricResult",
  },
};

// Derived sets for specific logic (S3 URL rewriting, output file validation)
const OUTPUT_FILE_QUERY_TOOLS = new Set([
  "query_output_file",
  "create_plotly_chart_from_parquet_output_file",
]);
const S3_URL_DEPENDENT_TOOLS = OUTPUT_FILE_QUERY_TOOLS;

function normalizeMcpSseUrl(serverUrl) {
  const raw = String(serverUrl ?? "").trim();
  if (!raw) {
    throw new Error("MCP server URL is empty.");
  }

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
  const client = new MCPClient({
    name: "nextgen-chatbox",
    version: "0.0.1",
  });
  const transport = new SSEClientTransport(new URL(sseUrl));
  await client.connect(transport);
  return { client, transport };
}

async function closeMcpConnection(connection) {
  if (!connection?.transport) {
    return;
  }
  try {
    await connection.transport.close();
  } catch {
    // Best effort close.
  }
}

/**
 * Connect to multiple MCP servers and aggregate their tools.
 * Each tool is tagged with its server index for routing.
 * Returns { connections, tools, toolServerMap }.
 */
async function connectMcpServers(mcpServers) {
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

        const mapped = {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description ?? "",
            parameters,
          },
        };
        tools.push(mapped);
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

async function executeTool(toolName, args, connections, toolServerMap) {
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
    if (data !== undefined && data !== null) {
      return maybeParseJson(data);
    }

    try {
      return maybeParseJson(result?.content?.[0]?.text ?? result);
    } catch {
      return result;
    }
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

async function chatWithOptionalThinkingStream({
  messages,
  tools,
  model,
  thinkingEnabled,
  onThinkingChunk,
  onContentChunk,
  ollamaClient,
  signal,
}) {
  const basePayload = {
    model,
    messages,
    think: Boolean(thinkingEnabled),
    tools,
    options: { temperature: 0, num_ctx: 16384 },
  };

  const responseStream = await ollamaClient.chat({ ...basePayload, stream: true });

  const merged = {};
  const mergedMessage = {
    role: "assistant",
    content: "",
    thinking: "",
    tool_calls: null,
  };

  let thinkingBuffer = "";
  let lastFlushMs = Date.now();

  const flushThinking = async (force = false) => {
    if (!thinkingBuffer) {
      return;
    }
    const shouldFlush =
      force ||
      thinkingBuffer.length >= 80 ||
      /[.!?\n:]$/.test(thinkingBuffer) ||
      Date.now() - lastFlushMs >= 400;

    if (!shouldFlush) {
      return;
    }
    onThinkingChunk?.(thinkingBuffer);
    thinkingBuffer = "";
    lastFlushMs = Date.now();
  };

  for await (const chunk of responseStream) {
    if (signal?.aborted) {
      break;
    }
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
      mergedMessage.tool_calls = mergeToolCalls(
        mergedMessage.tool_calls ?? [],
        msg.tool_calls
      );
    }

    for (const key of [
      "model",
      "created_at",
      "done",
      "done_reason",
      "total_duration",
      "load_duration",
      "prompt_eval_count",
      "prompt_eval_duration",
      "eval_count",
      "eval_duration",
    ]) {
      if (Object.prototype.hasOwnProperty.call(chunk, key)) {
        merged[key] = chunk[key];
      }
    }
  }

  await flushThinking(true);

  if (mergedMessage.tool_calls === null) {
    delete mergedMessage.tool_calls;
  }
  merged.message = mergedMessage;

  return merged;
}

async function processToolCalls(toolCalls, messages, connections, toolServerMap, state, originalUserText) {
  let hadError = false;
  let lastErr = null;

  const failedSignatures = [];

  for (const toolCall of toolCalls) {
    let toolName = toolCall?.function?.name;
    let args = toolCall?.function?.arguments ?? {};

    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = { _raw: args };
      }
    }

    args = normalizeQueryToolArgs(toolName, args, originalUserText);
    if (OUTPUT_FILE_QUERY_TOOLS.has(toolName)) {
      const currentS3 = typeof args?.s3_url === "string" ? args.s3_url : "";

      if (!isPlausibleOutputsFile(currentS3)) {
        const fallback =
          S3_URL_DEPENDENT_TOOLS.has(toolName)
            ? lastToolFileUrl(messages, [".parquet", ".nc", ".nc4"])
            : null;

        if (fallback) {
          args.s3_url = fallback;
        } else {
          const toolResult = invalidOutputFileToolResult(toolName, args);
          const callSignature = toolCallSignature(toolName, args);

          messages.push({
            role: "tool",
            tool_name: toolName,
            content: JSON.stringify(toolResult),
          });

          hadError = true;
          lastErr = toolErrorText(toolResult);
          failedSignatures.push(callSignature);
          continue;
        }
      }

      if (typeof args?.query === "string") {
        args.query = rewriteFromToOutput(args.query);
      }
    }

    const signatureArgs = args && typeof args === "object" ? args : { _raw: args };
    const callSignature = toolCallSignature(toolName, signatureArgs);

    const toolResult = await executeTool(toolName, args, connections, toolServerMap);
    // Categorize the tool result and update state
    if (toolResult && typeof toolResult === "object" && !toolErrorText(toolResult)) {
      for (const category of Object.values(TOOL_CATEGORIES)) {
        if (category.tools.has(toolName)) {
          state[category.stateKey] = toolResult;
          category.onSuccess?.(state, toolResult, args);
          break;
        }
      }

      // Collect visualization specs from TethysDash MCP server
      if (toolResult.visualization) {
        state.pendingVisualizations.push(toolResult.visualization);
      }
    }

    messages.push({
      role: "tool",
      tool_name: toolName,
      content:
        toolResult && typeof toolResult === "object"
          ? JSON.stringify(toolResult)
          : String(toolResult ?? ""),
    });

    const errText = toolErrorText(toolResult);
    if (errText) {
      hadError = true;
      lastErr = errText;
      failedSignatures.push(callSignature);
    }
  }

  return { hadError, lastErr, failedSignatures };
}

/**
 * Check if a terminal result (chart, map, hydrofabric) should end the session.
 * Query and list results are intentionally NOT terminal — the LLM may need
 * to chain multiple queries or produce a readable summary.
 */
function checkEarlyReturn(state, messages) {
  if (state.lastChartResult) {
    return {
      assistantText: "",
      plotlyFigure: state.lastChartResult.figure ?? state.lastChartResult,
      messages,
    };
  }
  if (state.lastMapResult) {
    return { assistantText: "", mapConfig: state.lastMapResult, messages };
  }
  if (state.lastHydrofabricResult) {
    return {
      assistantText: JSON.stringify(state.lastHydrofabricResult),
      queryResult: { data: state.lastHydrofabricResult, sql: null },
      messages,
    };
  }
  return null;
}

export async function runChatSession({
  prompt,
  model,
  thinkingEnabled,
  onThinkingChunk,
  onContentChunk,
  signal,
  ollamaHost = DEFAULT_OLLAMA_HOST,
  ollamaApiKey = DEFAULT_OLLAMA_API_KEY,
  mcpServerUrl = DEFAULT_MCP_SERVER_URL,
  mcpServers,
  history,
  maxContextTokens,
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

  // In dev mode, host is empty — use the current origin so SDK requests
  // (e.g. http://localhost:5173/api/chat) go through the Vite proxy.
  const effectiveHost = ollamaHost || window.location.origin;
  const ollamaOpts = { host: effectiveHost };
  if (ollamaApiKey) {
    ollamaOpts.headers = { Authorization: `Bearer ${ollamaApiKey}` };
  }
  const ollamaClient = new Ollama(ollamaOpts);

  // Build on previous conversation if history is provided, otherwise start fresh.
  let messages =
    Array.isArray(history) && history.length > 0
      ? [...history]
      : [buildSystemMessage()];

  const text = typeof prompt === "string" ? prompt : "";

  // Normalize MCP servers: support both single URL and array of servers
  const servers = Array.isArray(mcpServers) && mcpServers.length > 0
    ? mcpServers
    : mcpServerUrl
      ? [{ url: mcpServerUrl, name: "Default" }]
      : [];

  const { connections, tools, toolServerMap } = await connectMcpServers(servers);

  try {
    messages.push({ role: "user", content: text });

    // Trim old turns if conversation exceeds token budget
    if (maxContextTokens && maxContextTokens > 0) {
      messages = trimConversation(messages, maxContextTokens);
    }

    const fileUrl = extractFileUrl(text);
    const kind = fileKind(fileUrl ?? "");
    if (fileUrl) {
      messages.push(generateFileMsg(fileUrl, kind));
    }

    const failedSigCounts = {};

    while (true) {
      if (signal?.aborted) {
        return { assistantText: "", messages, aborted: true };
      }

      const response = await chatWithOptionalThinkingStream({
        messages,
        tools,
        model,
        thinkingEnabled,
        onThinkingChunk,
        onContentChunk,
        ollamaClient,
        signal,
      });

      const message = getMessage(response);
      let toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      if (!toolCalls.length) {
        const assistantContent = typeof message.content === "string" ? message.content : "";
        toolCalls = extractInlineToolCalls(assistantContent);
      }

      if (!toolCalls.length) {
        const assistantText = stripThinkTags(
          typeof message.content === "string" ? message.content : ""
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

      let { hadError, lastErr, failedSignatures } = await processToolCalls(toolCalls, messages, connections, toolServerMap, state, text);

      const earlyResult = !hadError && checkEarlyReturn(state, messages);
      if (earlyResult) return earlyResult;

      if (!hadError) {
        messages.push({
          role: "user",
          content:
            `Use the tool result above to continue. ` +
            `If the user's request is fully answered, respond with a clear, readable summary — do not return raw JSON. ` +
            `If more tool calls are needed to fulfill the request, make them now. ` +
            `Original request: ${text}`,
        });
        continue;
      }

      if (hadError && lastErr) {
        let repeatedSignature = bumpFailedSignatureCounts(failedSigCounts, failedSignatures);

        if (MAX_TOOL_REPAIR_ATTEMPTS <= 0 && repeatedSignature) {
          messages.push(generateAutoFixToolMsg(lastErr, text, repeatedSignature));
          continue;
        }

        for (let attempt = 1; attempt <= MAX_TOOL_REPAIR_ATTEMPTS; attempt += 1) {
          messages.push(generateAutoFixToolMsg(lastErr, text, repeatedSignature));

          let repairResponse;
          try {
            repairResponse = await chatWithOptionalThinkingStream({
              messages,
              tools,
              model,
              thinkingEnabled,
              onThinkingChunk,
              onContentChunk,
              ollamaClient,
              signal,
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
          ({ hadError, lastErr, failedSignatures } = await processToolCalls(repairCalls, messages, connections, toolServerMap, state, text));
          repeatedSignature = bumpFailedSignatureCounts(failedSigCounts, failedSignatures);

          const repairEarlyResult = !hadError && checkEarlyReturn(state, messages);
          if (repairEarlyResult) return repairEarlyResult;

          if (!hadError) {
            messages.push({
              role: "user",
              content:
                `Use the tool result above to continue. ` +
                `If the user's request is fully answered, respond with a clear, readable summary — do not return raw JSON. ` +
                `If more tool calls are needed to fulfill the request, make them now. ` +
                `Original request: ${text}`,
            });
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