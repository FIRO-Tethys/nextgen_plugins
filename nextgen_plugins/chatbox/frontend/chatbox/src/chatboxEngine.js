import { Client as MCPClient } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import { Ollama } from "ollama/browser";
import {
  bumpFailedSignatureCounts,
  compactToolResultForContext,
  extractFileUrl,
  extractInlineToolCalls,
  fileKind,
  generateAutoFixToolMsg,
  generateFileMsg,
  getMessage,
  isPlausibleOutputsFile,
  lastToolPlotlyFigure,
  lastToolFileUrl,
  maybeJoinDirAndFilename,
  normalizePlotlyChartToolArgs,
  normalizeQueryToolArgs,
  printContextUsage,
  rewriteFromToOutput,
  toolCallSignature,
  toolErrorText,
} from "./chatboxHelpers";
import { buildSystemMessage } from "./chatboxMessages";

const DEFAULT_OLLAMA_HOST = (import.meta.env.VITE_OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
const DEFAULT_MCP_SERVER_URL = (import.meta.env.VITE_MCP_SERVER_URL ?? "/sse").trim();
const MAX_TOOL_REPAIR_ATTEMPTS = Number.parseInt(import.meta.env.VITE_MCP_TOOL_REPAIR_ATTEMPTS ?? "0", 10);

function omitEmptyArgs(args) {
  const cleaned = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

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

function extractTextContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function normalizeMcpToolResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  if (result.isError) {
    const text = extractTextContent(result.content);
    return { error: text || "Tool call failed." };
  }

  if (
    Object.prototype.hasOwnProperty.call(result, "structuredContent") &&
    result.structuredContent !== null &&
    result.structuredContent !== undefined
  ) {
    return result.structuredContent;
  }

  if (Object.prototype.hasOwnProperty.call(result, "toolResult")) {
    return result.toolResult;
  }

  const text = extractTextContent(result.content);
  if (!text) {
    return result;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
      return mappedTools
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
    });
    return normalizeMcpToolResult(result);
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
    think: true,
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
      mergedMessage.tool_calls = msg.tool_calls;
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

async function processToolCalls(toolCalls, messages, mcpClient) {
  let hadError = false;
  let lastErr = null;
  const failedSignatures = [];
  let lastQueryResultPayload = null;

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
    if (toolName === "create_plotly_chart_from_query_result") {
      args = normalizePlotlyChartToolArgs(args, messages, lastQueryResultPayload);
    }

    const s3Url = typeof args?.s3_url === "string" ? args.s3_url : null;
    if (s3Url && s3Url.toLowerCase().endsWith(".parquet") && toolName === "query_netcdf_output_file") {
      toolName = "query_parquet_output_file";
    }
    if (
      s3Url &&
      (s3Url.toLowerCase().endsWith(".nc") || s3Url.toLowerCase().endsWith(".nc4")) &&
      toolName === "query_parquet_output_file"
    ) {
      toolName = "query_netcdf_output_file";
    }

    if (toolName === "query_parquet_output_file" || toolName === "query_netcdf_output_file") {
      const currentS3 = typeof args?.s3_url === "string" ? args.s3_url : "";
      if (!isPlausibleOutputsFile(currentS3)) {
        const fallback =
          toolName === "query_parquet_output_file"
            ? lastToolFileUrl(messages, [".parquet"])
            : lastToolFileUrl(messages, [".nc", ".nc4"]);
        if (fallback) {
          args.s3_url = fallback;
        }
      }
    }

    if (toolName === "query_parquet_output_file" || toolName === "query_netcdf_output_file") {
      if (typeof args?.query === "string") {
        args.query = rewriteFromToOutput(args.query);
      }
    }

    if (toolName === "query_parquet_output_file") {
      if (typeof args?.s3_url === "string" && typeof args?.query === "string") {
        args.s3_url = maybeJoinDirAndFilename(args.s3_url, args.query);
        args.query = rewriteFromToOutput(args.query);
      }
    }

    const signatureArgs = args && typeof args === "object" ? args : { _raw: args };
    const callSignature = toolCallSignature(toolName, signatureArgs);

    const toolResult = await executeTool(toolName, args, mcpClient);
    if (
      (toolName === "query_parquet_output_file" || toolName === "query_netcdf_output_file") &&
      toolResult &&
      typeof toolResult === "object" &&
      !Array.isArray(toolResult)
    ) {
      lastQueryResultPayload = toolResult;
    }
    const compactResult = compactToolResultForContext(toolResult);
    messages.push({
      role: "tool",
      tool_name: toolName,
      content:
        compactResult && typeof compactResult === "object"
          ? JSON.stringify(compactResult)
          : String(compactResult),
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
  const ollamaClient = new Ollama({ host: ollamaHost });
  const messages = [buildSystemMessage()];

  const text = typeof prompt === "string" ? prompt : "";
  if (!text || [":q", ":quit", "quit", "exit"].includes(text.trim().toLowerCase())) {
    return { assistantText: "", messages, plotlyFigure: null };
  }

  const mcpConnection = await createMcpConnection(mcpServerUrl);
  const mcpClient = mcpConnection.client;
  const tools = await loadTools(mcpClient);

  try {
    messages.push({ role: "user", content: text });

    const fileUrl = extractFileUrl(text);
    const kind = fileKind(fileUrl ?? "");
    if (fileUrl) {
      messages.push(generateFileMsg(fileUrl, kind));
    }

    const failedSigCounts = {};

    while (true) {
      const response = await chatWithOptionalThinkingStream({
        messages,
        tools,
        model,
        thinkingEnabled,
        onThinkingChunk,
        ollamaClient,
      });

      await printContextUsage(response, model, ollamaHost, ollamaClient);

      const message = getMessage(response);
      let toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!toolCalls.length) {
        const assistantContent = typeof message.content === "string" ? message.content : "";
        toolCalls = extractInlineToolCalls(assistantContent);
      }

      if (!toolCalls.length) {
        const assistantText = typeof message.content === "string" ? message.content : "";
        messages.push({ role: "assistant", content: assistantText });
        return { assistantText, messages, plotlyFigure: lastToolPlotlyFigure(messages) };
      }

      if (!Object.prototype.hasOwnProperty.call(message, "tool_calls")) {
        message.tool_calls = toolCalls;
      }
      messages.push(message);

      let { hadError, lastErr, failedSignatures } = await processToolCalls(toolCalls, messages, mcpClient);

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
              ollamaClient,
            });
            await printContextUsage(repairResponse, model, ollamaHost, ollamaClient);
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

          ({ hadError, lastErr, failedSignatures } = await processToolCalls(repairCalls, messages, mcpClient));
          repeatedSignature = bumpFailedSignatureCounts(failedSigCounts, failedSignatures);
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
