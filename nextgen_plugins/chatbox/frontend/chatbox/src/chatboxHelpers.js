// chatboxHelpers.js
import { AUTO_FIX_SYSTEM_MSG, FILE_MSG } from "./chatboxMessages";

const URL_RE = /(https?:\/\/\S+|s3:\/\/\S+)/i;
const PARQUET_NAME_RE = /\b([A-Za-z0-9._-]+\.parquet)\b/i;
const FROM_TARGET_RE = /\bfrom\s+([^\s;]+)/i;
const TOOL_ERROR_TOKENS = [
  "validation error",
  "error calling tool",
  "unknown tool",
  "httperror",
  "traceback",
  "server error",
  "failed",
];
export function maybeParseJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}
function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    const sorted = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sorted[key] = sortObject(value[key]);
      });
    return sorted;
  }
  return value;
}

function parseFirstJsonObject(text, startIndex) {
  if (text[startIndex] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const raw = text.slice(startIndex, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}


function getFirstPath(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const selected = payload.selected;
  if (selected && typeof selected === "object" && typeof selected.path === "string" && selected.path) {
    return selected.path;
  }

  for (const key of ["file", "path"]) {
    if (typeof payload[key] === "string" && payload[key]) {
      return payload[key];
    }
  }

  for (const listKey of ["files", "items"]) {
    const values = payload[listKey];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const item of values) {
      if (item && typeof item === "object" && typeof item.path === "string" && item.path) {
        return item.path;
      }
    }
  }

  return null;
}

export function bumpFailedSignatureCounts(counts, signatures) {
  let repeated = null;
  for (const sig of signatures) {
    counts[sig] = (counts[sig] ?? 0) + 1;
    if (counts[sig] >= 2) {
      repeated = sig;
    }
  }
  return repeated;
}

export function isPlausibleOutputsFile(url) {
  if (typeof url !== "string") {
    return false;
  }
  const lower = url.toLowerCase();
  return (
    (lower.startsWith("s3://") || lower.startsWith("https://")) &&
    lower.includes("/outputs/") &&
    (lower.endsWith(".parquet") || lower.endsWith(".nc") || lower.endsWith(".nc4"))
  );
}

export function lastToolFileUrl(messages, exts = [".parquet", ".nc", ".nc4"]) {
  const validUrl = (url) => {
    if (typeof url !== "string") {
      return false;
    }
    const lower = url.toLowerCase();
    return (
      (lower.startsWith("s3://") || lower.startsWith("https://")) &&
      exts.some((ext) => lower.endsWith(ext))
    );
  };

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "tool") {
      continue;
    }

    let payload = message.content;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = null;
      }
    }

    if (!payload || typeof payload !== "object") {
      continue;
    }

    const directPath = getFirstPath(payload);
    if (validUrl(directPath)) {
      return directPath;
    }
  }

  return null;
}


export function rewriteFromToOutput(query) {
  if (typeof query !== "string" || !query.trim()) {
    return query;
  }

  const match = query.match(FROM_TARGET_RE);
  if (!match) {
    return query;
  }

  const target = match[1].trim().replace(/,+$/, "");
  const unquoted = target.replace(/^['"`]|['"`]$/g, "");

  if (
    unquoted.toLowerCase().startsWith("read_parquet") ||
    unquoted.toLowerCase().startsWith("parquet_scan") ||
    unquoted.toLowerCase().startsWith("read_csv") ||
    unquoted.toLowerCase().startsWith("read_json")
  ) {
    return query;
  }

  if (unquoted.toLowerCase() === "output") {
    return query;
  }

  if (
    unquoted.includes("://") ||
    unquoted.toLowerCase().endsWith(".parquet") ||
    unquoted.toLowerCase().endsWith(".nc") ||
    unquoted.toLowerCase().endsWith(".nc4")
  ) {
    return query.replace(FROM_TARGET_RE, "FROM output");
  }

  return query;
}

export function extractFileUrl(text) {
  if (typeof text !== "string") {
    return null;
  }
  const match = text.match(URL_RE);
  if (!match) {
    return null;
  }
  return match[1].replace(/[).,;\]}>]+$/, "").replace(/["']+$/, "");
}

export function fileKind(url) {
  if (typeof url !== "string" || !url) {
    return null;
  }
  const lower = url.toLowerCase();
  if (lower.endsWith(".parquet")) {
    return "parquet";
  }
  if (lower.endsWith(".nc") || lower.endsWith(".nc4")) {
    return "netcdf";
  }
  return null;
}

export function extractInlineToolCalls(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") {
      continue;
    }
    const obj = parseFirstJsonObject(text, i);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      continue;
    }

    const name = obj.name ?? obj.tool ?? obj.tool_name;
    const args = obj.parameters ?? obj.arguments ?? obj.params ?? obj.args;
  

    if (
      typeof name === "string" &&
      name &&
      (typeof args === "string" || (args && typeof args === "object" && !Array.isArray(args)))
    ) {
      return [{ function: { name, arguments: args } }];
    }
  }

  return [];
}

export function normalizeQueryToolArgs(toolName, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }

  const queryTools = new Set(["query_parquet_output_file", "query_netcdf_output_file", "create_plotly_chart_from_parquet_output_file"]);
  if (queryTools.has(toolName)) {
    const normalized = { ...args };
    const s3Url = normalized.s3_url;
    const fileName = normalized.files_names ?? normalized.file_name ?? normalized.filename;

    if (
      typeof s3Url === "string" &&
      fileName &&
      !s3Url.toLowerCase().endsWith(".parquet") &&
      !s3Url.toLowerCase().endsWith(".nc") &&
      !s3Url.toLowerCase().endsWith(".nc4")
    ) {
      normalized.s3_url = `${s3Url.replace(/\/+$/, "")}/${String(fileName).replace(/^\/+/, "")}`;
    }

    const result = {};
    for (const key of ["s3_url", "query"]) {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        result[key] = normalized[key];
      }
    }
    return result;
  }

  return args;
}

export function generateAutoFixToolMsg(lastErr, priorUserText = "", repeatedSignature = null) {
  const errLower = (lastErr ?? "").toLowerCase();
  const chainHints = [];

  if (
    ((errLower.includes("s3_url") &&
      (errLower.includes("pattern") ||
        errLower.includes("validation error") ||
        errLower.includes(".parquet") ||
        errLower.includes(".nc"))) ||
      errLower.includes("provide one parquet s3_url"))
  ) {
    chainHints.push(
      "Your previous query tool call used an invalid file URL. If you do not already have a full file URL, call a prerequisite tool first: resolve_output_file (preferred for ordinal output-file requests) or list_available_outputs_files. Then call query_* with one full file URL ending in .parquet or .nc/.nc4 (not a directory).",
    );
  }

  if (repeatedSignature) {
    chainHints.push(
      "You repeated the same failing tool call arguments. Do not repeat them. Call a prerequisite tool first, then issue a corrected query tool call.",
    );
  }

  const userFocus = priorUserText ? `Original user request:\n${priorUserText}\n\n` : "";
  const chainHintBlock = chainHints.length
    ? `Chain guidance:\n${chainHints.map((hint) => `- ${hint}`).join("\n")}\n\n`
    : "";

  return {
    role: "user",
    content: `Previous tool call failed with:\n${lastErr}\n\n${userFocus}${chainHintBlock}${AUTO_FIX_SYSTEM_MSG}`,
  };
}


export function generateFileMsg(fileUrl, fileType) {
  return {
    role: "assistant",
    content: `Context: detected file URL ${fileUrl} (${fileType}). Use this exact file URL if a file-based tool call is needed.`,
  };
}
export function getMessage(resp) {
  if (!resp || typeof resp !== "object") {
    return {};
  }
  const message = resp.message;
  if (!message || typeof message !== "object") {
    return {};
  }
  return message;
}


export function toolCallSignature(toolName, args) {
  let argsBlob = "";
  try {
    argsBlob = JSON.stringify(sortObject(args));
  } catch {
    argsBlob = String(args);
  }
  return `${toolName}|${argsBlob}`;
}

export function toolErrorText(toolResult) {
  if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult) && toolResult.error) {
    return String(toolResult.error);
  }

  if (typeof toolResult === "string") {
    const lower = toolResult.toLowerCase();
    if (TOOL_ERROR_TOKENS.some((token) => lower.includes(token))) {
      return toolResult;
    }
  }

  return null;
}

export function compactToolResultForContext(toolResult, maxItems = 50) {
  if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
    const compact = { ...toolResult };

    if (compact.error) {
      return compact;
    }

    for (const key of ["data", "files", "models", "dates", "forecasts", "cycles", "vpus"]) {
      const value = compact[key];
      if (Array.isArray(value) && value.length > maxItems) {
        compact[key] = value.slice(0, maxItems);
        compact[`${key}_truncated`] = true;
        compact[`${key}_total`] = value.length;
      }
    }

    const selectedPath = getFirstPath(compact);
    if (selectedPath) {
      compact.selected_path = selectedPath;
      if (!compact.selected) {
        compact.selected = { path: selectedPath };
      }
    }

    if (Array.isArray(compact.files)) {
      compact.files_total = compact.files.length;
    }

    return compact;
  }

  if (Array.isArray(toolResult) && toolResult.length > maxItems) {
    const items = toolResult.slice(0, maxItems);
    const compactList = {
      items,
      items_truncated: true,
      items_total: toolResult.length,
    };
    if (items.length && items[0] && typeof items[0] === "object" && typeof items[0].path === "string") {
      compactList.selected_path = items[0].path;
      compactList.selected = { path: items[0].path };
    }
    return compactList;
  }

  return toolResult;
}

// export async function getContextLengthFromPs(modelName, ollamaHost, ollamaClient = null) {
//   try {
//     const client = ollamaClient ?? new Ollama({ host: ollamaHost });
//     const payload = await client.ps();
//     const models = Array.isArray(payload.models) ? payload.models : [];
//     const direct = models.find(
//       (model) => model?.name === modelName || model?.model === modelName,
//     );
//     if (direct && Number.isFinite(Number(direct.context_length))) {
//       return Number(direct.context_length);
//     }

//     const base = String(modelName ?? "").split(":", 1)[0];
//     const fallback = models.find((model) => {
//       const nameBase = String(model?.name ?? "").split(":", 1)[0];
//       const modelBase = String(model?.model ?? "").split(":", 1)[0];
//       return nameBase === base || modelBase === base;
//     });

//     if (fallback && Number.isFinite(Number(fallback.context_length))) {
//       return Number(fallback.context_length);
//     }
//   } catch {
//     return null;
//   }
//   return null;
// }

// export async function printContextUsage(response, modelName, ollamaHost, ollamaClient = null) {
//   const promptTokens = Number.isFinite(Number(response?.prompt_eval_count))
//     ? Number(response.prompt_eval_count)
//     : null;
//   const outTokens = Number.isFinite(Number(response?.eval_count))
//     ? Number(response.eval_count)
//     : 0;

//   const totalContext = await getContextLengthFromPs(modelName, ollamaHost, ollamaClient);

//   if (totalContext && promptTokens !== null) {
//     const leftAfterPrompt = Math.max(totalContext - promptTokens, 0);
//     const usedNow = promptTokens + outTokens;
//     const leftNow = Math.max(totalContext - usedNow, 0);
//     console.debug(
//       `Context: prompt ${promptTokens}/${totalContext} (left ${leftAfterPrompt}); output ${outTokens}; total ${usedNow}/${totalContext} (left ${leftNow})`,
//     );
//     return;
//   }

//   if (promptTokens !== null) {
//     console.debug(`Tokens: prompt ${promptTokens}; output ${outTokens}`);
//   }
// }
