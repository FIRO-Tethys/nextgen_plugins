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
  invalidOutputFileToolResult
} from "./chatboxHelpers";
import { buildSystemMessage } from "./chatboxMessages";

const DEFAULT_OLLAMA_HOST = (import.meta.env.VITE_OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
const DEFAULT_MCP_SERVER_URL = (import.meta.env.VITE_MCP_SERVER_URL ?? "/sse").trim();
console.log("Default Ollama host:", DEFAULT_OLLAMA_HOST);
console.log("Default MCP server URL:", DEFAULT_MCP_SERVER_URL);
const MAX_TOOL_REPAIR_ATTEMPTS = Number.parseInt(import.meta.env.VITE_MCP_TOOL_REPAIR_ATTEMPTS ?? "0", 10);

const OUTPUT_FILE_QUERY_TOOLS = new Set([
  "query_parquet_output_file",
  "query_netcdf_output_file",
  "create_plotly_chart_from_parquet_output_file",
]);

const HYDROFABRIC_QUERY_TOOL = "query_hydrofabric_parquet_file";
const LIST_RESULT_TOOLS = new Set([
  "list_available_models",
  "list_available_dates",
  "list_available_forecasts",
  "list_available_cycles",
  "list_available_vpus",
  "list_available_output_files",
]);

const CHART_RESULT_TOOLS = new Set([
  "create_plotly_chart_from_parquet_output_file",
  "create_plotly_chart_from_output_selector",
]);



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

async function loadTools(mcpClient) {
  try {
    const response = await mcpClient.listTools();
    const toolsList = Array.isArray(response?.tools) ? response.tools : [];
    if (toolsList.length) {
      const mappedTools = toolsList.map((tool) => {
        const parameters =
          tool?.inputSchema && typeof tool.inputSchema === "object"
            ? tool.inputSchema
            : { type: "object", properties: {}, additionalProperties: false };

        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description ?? "",
            parameters,
          },
        };
      });
      console.log("Loaded tools from MCP server:", mappedTools);
      return mappedTools;
    }
  } catch (error) {
    console.error("Error loading tools from MCP server:", error);
  }
}

async function executeTool(toolName, args, mcpClient) {
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
  ollamaClient,
}) {
  const basePayload = {
    model,
    messages,
    think: Boolean(thinkingEnabled),
    tools,
    options: { temperature: 0 },
  };

  if (!thinkingEnabled) {
    return ollamaClient.chat({ ...basePayload, stream: false });
  }

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
    const msg = chunk?.message && typeof chunk.message === "object" ? chunk.message : {};

    if (typeof msg.thinking === "string" && msg.thinking) {
      mergedMessage.thinking += msg.thinking;
      thinkingBuffer += msg.thinking;
      await flushThinking(false);
    }

    if (typeof msg.content === "string" && msg.content) {
      mergedMessage.content += msg.content;
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

  console.log("Merged assistant message:", {
    role: mergedMessage.role,
    hasToolCalls: Array.isArray(mergedMessage.tool_calls) && mergedMessage.tool_calls.length > 0,
    toolCalls: mergedMessage.tool_calls,
    contentPreview: mergedMessage.content.slice(0, 300),
    thinkingPreview: mergedMessage.thinking.slice(-800),
  });

  return merged;
}

async function processToolCalls(toolCalls, messages, mcpClient, state) {
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

    args = normalizeQueryToolArgs(toolName, args);

    if (OUTPUT_FILE_QUERY_TOOLS.has(toolName)) {
      const currentS3 = typeof args?.s3_url === "string" ? args.s3_url : "";

      if (!isPlausibleOutputsFile(currentS3)) {
        console.log(`Tool ${toolName} called with s3_url that doesn't look like a valid outputs file:`, { currentS3 });
        const fallback =
          toolName === "query_parquet_output_file" ||
          toolName === "create_plotly_chart_from_parquet_output_file" ||
          toolName === "create_plotly_chart_from_output_selector"
            ? lastToolFileUrl(messages, [".parquet"])
            : lastToolFileUrl(messages, [".nc", ".nc4"]);

        if (fallback) {
          console.log(`Using fallback s3_url for tool ${toolName}:`, { fallback });
          args.s3_url = fallback;
        } else {
          console.log(`No valid fallback s3_url found for tool ${toolName}. Returning error result.`);
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

    const toolResult = await executeTool(toolName, args, mcpClient);
    console.log("Tool result type:", {
      toolName,
      type: typeof toolResult,
      isArray: Array.isArray(toolResult),
      keys: toolResult && typeof toolResult === "object" ? Object.keys(toolResult) : null,
      preview:
        typeof toolResult === "string"
          ? toolResult.slice(0, 200)
          : JSON.stringify(toolResult)?.slice(0, 200),
    });

    if (  
      CHART_RESULT_TOOLS.has(toolName) &&
      toolResult &&
      typeof toolResult === "object" &&
      !toolErrorText(toolResult)
    ) {
      state.lastChartResult = toolResult;
    }

    if (
      LIST_RESULT_TOOLS.has(toolName) &&
      toolResult &&
      typeof toolResult === "object" &&
      !toolErrorText(toolResult)
    ) {
      state.lastListResult = toolResult;
    }

    if (
      toolName === "build_hydrofabric_feature_map_config" &&
      toolResult &&
      typeof toolResult === "object" &&
      !toolErrorText(toolResult)
    ) {
      state.lastMapResult = toolResult;
    }

    if (
      toolName === HYDROFABRIC_QUERY_TOOL &&
      toolResult &&
      typeof toolResult === "object" &&
      !toolErrorText(toolResult)
    ) {
      state.lastHydrofabricResult = toolResult;
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

export async function runChatSession({
  prompt,
  model,
  thinkingEnabled,
  onThinkingChunk,
  ollamaHost = DEFAULT_OLLAMA_HOST,
  mcpServerUrl = DEFAULT_MCP_SERVER_URL,
}) {
  const state = {
    lastChartResult: null,
    lastListResult: null,
    lastMapResult: null,
    lastHydrofabricResult: null,
  };

  const ollamaClient = new Ollama({ host: ollamaHost });
  const messages = [buildSystemMessage()];

  const text = typeof prompt === "string" ? prompt : "";

  const mcpConnection = await createMcpConnection(mcpServerUrl);
  const mcpClient = mcpConnection.client;
  const tools = await loadTools(mcpClient);

  console.log(
    "Tool names sent to Ollama:",
    (tools ?? []).map((t) => t?.function?.name)
  );

  const plotlyTool = (tools ?? []).find(
    (t) => t?.function?.name === "create_plotly_chart_from_parquet_output_file"
  );
  console.log("Plotly tool schema sent to Ollama:", plotlyTool);

  try {
    messages.push({ role: "user", content: text });

    const fileUrl = extractFileUrl(text);
    const kind = fileKind(fileUrl ?? "");
    if (fileUrl) {
      messages.push(generateFileMsg(fileUrl, kind));
    }

    const failedSigCounts = {};

    while (true) {
      console.log("About to call Ollama with messages summary:", messages.slice(-4).map((m) => ({
        role: m.role,
        tool_name: m.tool_name,
        contentPreview:
          typeof m.content === "string" ? m.content.slice(0, 300) : JSON.stringify(m.content)?.slice(0, 300),
      })));
      console.log("Total messages:", messages.length);

      const response = await chatWithOptionalThinkingStream({
        messages,
        tools,
        model,
        thinkingEnabled,
        onThinkingChunk,
        ollamaClient,
      });

      console.log("Received response from Ollama:", response);
      const message = getMessage(response);
      let toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

      if (!toolCalls.length) {
        const assistantContent = typeof message.content === "string" ? message.content : "";
        toolCalls = extractInlineToolCalls(assistantContent);
      }

      if (!toolCalls.length) {
        const assistantText = typeof message.content === "string" ? message.content : "";
        const thinkingText = typeof message.thinking === "string" ? message.thinking : "";

        console.log("No tool calls found. Returning final assistant text.", {
          assistantTextPreview: assistantText.slice(0, 300),
          thinkingPreview: thinkingText.slice(-1000),
          extractedInlineCalls: extractInlineToolCalls(assistantText),
        });

        messages.push({ role: "assistant", content: assistantText });
        return { assistantText, messages };
      }

      if (!Object.prototype.hasOwnProperty.call(message, "tool_calls")) {
        message.tool_calls = toolCalls;
      }
      messages.push(message);

      let { hadError, lastErr, failedSignatures } = await processToolCalls(toolCalls, messages, mcpClient, state);

      if (!hadError && state.lastChartResult) {
        console.log("Returning Plotly chart result from state:", state.lastChartResult);
        return {
          assistantText: "",
          plotlyFigure: state.lastChartResult.figure ?? state.lastChartResult,
          messages,
        };
      }

      if (!hadError && state.lastListResult) {
        return {
          assistantText: JSON.stringify(state.lastListResult),
          messages,
        };
      }

      if (!hadError && state.lastMapResult) {
        return {
          assistantText: "",
          mapConfig: state.lastMapResult,
          messages,
        };
      }

      if (!hadError && state.lastHydrofabricResult) {
        return {
          assistantText: JSON.stringify(state.lastHydrofabricResult),
          messages,
        };
      }

      if (hadError && lastErr) {
        let repeatedSignature = bumpFailedSignatureCounts(failedSigCounts, failedSignatures);

        if (MAX_TOOL_REPAIR_ATTEMPTS <= 0 && repeatedSignature) {
          messages.push(generateAutoFixToolMsg(lastErr, text, repeatedSignature));
          continue;
        }

        for (let attempt = 1; attempt <= MAX_TOOL_REPAIR_ATTEMPTS; attempt += 1) {
          console.log(`Attempting tool call repair ${attempt}/${MAX_TOOL_REPAIR_ATTEMPTS}`);
          messages.push(generateAutoFixToolMsg(lastErr, text, repeatedSignature));

          let repairResponse;
          try {
            repairResponse = await chatWithOptionalThinkingStream({
              messages,
              tools,
              model,
              thinkingEnabled,
              onThinkingChunk,
              ollamaClient,
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

          if (!Object.prototype.hasOwnProperty.call(repairMessage, "tool_calls")) {
            repairMessage.tool_calls = repairCalls;
          }
          messages.push(repairMessage);

          ({ hadError, lastErr, failedSignatures } = await processToolCalls(repairCalls, messages, mcpClient, state));
          repeatedSignature = bumpFailedSignatureCounts(failedSigCounts, failedSignatures);

          if (!hadError && state.lastChartResult) {
            return {
              assistantText: "",
              plotlyFigure: state.lastChartResult.figure ?? state.lastChartResult,
              messages,
            };
          }

          if (!hadError && state.lastListResult) {
            return {
              assistantText: JSON.stringify(state.lastListResult),
              messages,
            };
          }

          if (!hadError && state.lastMapResult) {
            return {
              assistantText: "",
              mapConfig: state.lastMapResult,
              messages,
            };
          }

          if (!hadError && state.lastHydrofabricResult) {
            return {
              assistantText: JSON.stringify(state.lastHydrofabricResult),
              messages,
            };
          }

          if (!hadError) {
            break;
          }
        }
        continue;
      }
    }
  } finally {
    await closeMcpConnection(mcpConnection);
  }
}
