// chatboxHelpers.js
import { AUTO_FIX_SYSTEM_MSG, FILE_MSG } from "./chatboxMessages";

const CONFIGURED_OLLAMA_HOST = (import.meta.env.VITE_OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
const DEFAULT_OLLAMA_API_KEY = (import.meta.env.VITE_OLLAMA_API_KEY ?? "").trim();
// In dev mode, use same-origin so requests go through the Vite proxy (avoids CORS with Ollama Cloud).
const DEFAULT_OLLAMA_HOST = import.meta.env.DEV ? "" : CONFIGURED_OLLAMA_HOST;
const URL_RE = /(https?:\/\/\S+|s3:\/\/\S+)/i;
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

const SELECTOR_TOOLS = new Set([
  "resolve_output_file",
  "list_available_output_files",
  "query_output_file_from_output_selector",
  "create_plotly_chart_from_output_selector",
]);

export function denverTodayIso() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

export function stripThinkTags(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^submitButton\s*/i, "")
    .trim();
}

function normalizeModelLiteral(value) {
  const s = String(value ?? "").trim().toLowerCase();

  if (s === "cfe nom" || s === "cfe-nom" || s === "cfe_nom") {
    return "cfe_nom";
  }
  if (s === "routing only" || s === "routing-only" || s === "routing_only") {
    return "routing_only";
  }
  if (s === "lstm") {
    return "lstm";
  }

  return value;
}

function normalizeForecastLiteral(value) {
  const s = String(value ?? "").trim().toLowerCase();

  if (s === "short range" || s === "short-range" || s === "short_range") {
    return "short_range";
  }
  if (s === "medium range" || s === "medium-range" || s === "medium_range") {
    return "medium_range";
  }
  if (
    s === "analysis assim extend" ||
    s === "analysis-assim-extend" ||
    s === "analysis_assim_extend"
  ) {
    return "analysis_assim_extend";
  }

  return value;
}

function normalizeVpuLiteral(value) {
  const s = String(value ?? "").trim().toUpperCase();
  const match = s.match(/(?:VPU[_\s-]*)?(\d{1,2})$/);

  if (!match) {
    return value;
  }

  return `VPU_${match[1].padStart(2, "0")}`;
}

function userAskedForToday(text) {
  return /\btoday\b|\btoday's date\b/i.test(String(text ?? ""));
}

export function invalidOutputFileToolResult(toolName, args) {
  const file = typeof args?.s3_url === "string" ? args.s3_url : "";
  return {
    ok: false,
    error: {
      code: "invalid_s3_url",
      message:
        `${toolName} requires one real NRDS output file URL returned by ` +
        `resolve_output_file or list_available_output_files, or explicitly ` +
        `provided by the user. Got: ${file || "<missing>"}`,
    },
    file,
    query: typeof args?.query === "string" ? args.query : "",
  };
}

export function mergeToolCalls(existing = [], incoming = []) {
  const merged = existing.map((call) => ({
    ...call,
    function: { ...(call?.function ?? {}) },
  }));

  incoming.forEach((call, index) => {
    if (!call || typeof call !== "object") return;

    const current = merged[index] ?? { function: {} };
    const currentFn = current.function ?? {};
    const nextFn = call.function ?? {};

    const currArgs = currentFn.arguments;
    const nextArgs = nextFn.arguments;

    let mergedArgs = currArgs;

    if (typeof currArgs === "string" && typeof nextArgs === "string") {
      mergedArgs = currArgs + nextArgs;
    } else if (
      currArgs &&
      typeof currArgs === "object" &&
      !Array.isArray(currArgs) &&
      nextArgs &&
      typeof nextArgs === "object" &&
      !Array.isArray(nextArgs)
    ) {
      mergedArgs = { ...currArgs, ...nextArgs };
    } else if (nextArgs !== undefined) {
      mergedArgs = nextArgs;
    }

    merged[index] = {
      ...current,
      ...call,
      function: {
        ...currentFn,
        ...nextFn,
        arguments: mergedArgs,
      },
    };
  });

  return merged;
}

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

  if (typeof payload.selected_path === "string" && payload.selected_path) {
    return payload.selected_path;
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

export function normalizeQueryToolArgs(toolName, args, originalUserText = "") {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }

  let normalized = { ...args };

  const fileTools = new Set([
    "query_output_file",
    "create_plotly_chart_from_parquet_output_file",
  ]);

  if (fileTools.has(toolName)) {
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
    normalized = result;
  }

  if (SELECTOR_TOOLS.has(toolName)) {
    if (Object.prototype.hasOwnProperty.call(normalized, "model")) {
      normalized.model = normalizeModelLiteral(normalized.model);
    }

    if (Object.prototype.hasOwnProperty.call(normalized, "forecast")) {
      normalized.forecast = normalizeForecastLiteral(normalized.forecast);
    }

    if (Object.prototype.hasOwnProperty.call(normalized, "vpu")) {
      normalized.vpu = normalizeVpuLiteral(normalized.vpu);
    }

    if (userAskedForToday(originalUserText)) {
      normalized.date = denverTodayIso();
    }
  }

  if (typeof normalized.query === "string") {
    normalized.query = rewriteFromToOutput(normalized.query);
  }

  return normalized;
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
      "Your previous file-based tool call used an invalid file URL. If you do not already have a full file URL, call a prerequisite tool first: resolve_output_file (preferred for ordinal output-file requests) or list_available_output_files. If the original request already includes model/date/forecast/cycle/vpu selector inputs and does not require a direct s3_url, prefer selector tools such as query_output_file_from_output_selector or create_plotly_chart_from_output_selector.",
    );
  }

  if (repeatedSignature) {
    chainHints.push(
      "You repeated the same failing tool call arguments. Do not repeat them. Call a prerequisite tool first or switch to the appropriate selector-based tool.",
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

function normalizeToolError(errorValue) {
  if (!errorValue) {
    return null;
  }

  if (typeof errorValue === "string") {
    return errorValue;
  }

  if (typeof errorValue === "object" && !Array.isArray(errorValue)) {
    const message =
      typeof errorValue.message === "string" && errorValue.message.trim()
        ? errorValue.message.trim()
        : null;
    const code =
      typeof errorValue.code === "string" && errorValue.code.trim()
        ? errorValue.code.trim()
        : null;

    if (message && code) {
      return `${code}: ${message}`;
    }
    if (message) {
      return message;
    }

    try {
      return JSON.stringify(errorValue);
    } catch {
      return String(errorValue);
    }
  }

  return String(errorValue);
}

export function toolErrorText(toolResult) {
  if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
    if (toolResult.ok === false) {
      return normalizeToolError(toolResult.error) ?? "Tool returned ok=false";
    }

    if (toolResult.error) {
      return normalizeToolError(toolResult.error);
    }
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

    if (toolErrorText(compact)) {
      return compact;
    }

    for (const key of ["data", "files", "models", "dates", "forecasts", "cycles", "vpus"]) {
      const value = compact[key];
      if (Array.isArray(value) && value.length > maxItems) {
        compact[key] = value.slice(0, maxItems);
        compact[`${key}_truncated`] = true;
        compact[`${key}_total`] = value.length;
        if (typeof compact.count === "number") {
          compact.count = compact[key].length;
        }
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

    if (typeof compact.total_count !== "number" && typeof compact.count === "number") {
      compact.total_count = compact.count;
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

function normalizeOllamaModelName(entry) {
  if (typeof entry === "string" && entry.trim()) {
    return entry.trim();
  }
  if (typeof entry?.name === "string" && entry.name.trim()) {
    return entry.name.trim();
  }
  if (typeof entry?.model === "string" && entry.model.trim()) {
    return entry.model.trim();
  }
  return "";
}

function canonicalOllamaModelKey(modelName) {
  const normalized = normalizeOllamaModelName(modelName);
  if (!normalized) {
    return "";
  }
  return normalized.includes(":")
    ? normalized.toLowerCase()
    : `${normalized}:latest`.toLowerCase();
}

function parseModelCapabilities(entry) {
  if (!entry || typeof entry !== "object") return [];
  const caps = entry.capabilities ?? entry.details?.capabilities;
  return Array.isArray(caps)
    ? caps.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
}

export async function listOllamaModels(ollamaHost = DEFAULT_OLLAMA_HOST, options = {}) {
  const host = String(ollamaHost ?? DEFAULT_OLLAMA_HOST).replace(/\/+$/, "");
  const apiKey = typeof options?.apiKey === "string" ? options.apiKey.trim() : DEFAULT_OLLAMA_API_KEY;
  const authHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const requiredCapabilities = Array.isArray(options?.requiredCapabilities)
    ? options.requiredCapabilities
        .map((capability) => String(capability ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  const extraModels = Array.isArray(options?.extraModels)
    ? options.extraModels.map((entry) => normalizeOllamaModelName(entry)).filter(Boolean)
    : [];
  const response = await fetch(`${host}/api/tags`, { headers: authHeaders });

  if (!response.ok) {
    throw new Error(`Failed to load Ollama models (${response.status})`);
  }

  const payload = await response.json();
  const rawModels = Array.isArray(payload?.models) ? payload.models : [];

  // Build a map of capabilities from /api/tags (cloud includes them inline).
  const tagsCapsMap = new Map();
  for (const entry of rawModels) {
    const name = normalizeOllamaModelName(entry);
    if (name) {
      tagsCapsMap.set(canonicalOllamaModelKey(name), parseModelCapabilities(entry));
    }
  }

  const modelEntries = Array.from(
    [...rawModels, ...extraModels]
      .map((entry) => normalizeOllamaModelName(entry))
      .filter(Boolean)
      .reduce((deduped, modelName) => {
        const key = canonicalOllamaModelKey(modelName);
        if (!key || deduped.has(key)) return deduped;
        deduped.set(key, modelName);
        return deduped;
      }, new Map())
      .values()
  );

  // Try /api/show for capability inspection (works on local Ollama).
  // If it fails (e.g. Ollama Cloud 404), fall back to /api/tags capabilities.
  const inspectedModels = await Promise.all(
    modelEntries.map(async (modelName) => {
      const canonKey = canonicalOllamaModelKey(modelName);
      let capabilities = tagsCapsMap.get(canonKey) ?? [];

      try {
        const showResponse = await fetch(`${host}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ model: modelName }),
        });

        if (showResponse.ok) {
          console.log(`Fetched capabilities for model ${modelName} from /api/show.`);
          const showPayload = await showResponse.json();
          const showCaps = Array.isArray(showPayload?.capabilities)
            ? showPayload.capabilities.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean)
            : [];
          if (showCaps.length) {
            capabilities = showCaps;
          }
        }
      } catch {
        console.log(`Could not fetch capabilities for model ${modelName} from /api/show, falling back to /api/tags if available.`);
        // /api/show unavailable (e.g. Ollama Cloud) — use /api/tags capabilities.
      }

      if (requiredCapabilities.length && !requiredCapabilities.every((cap) => capabilities.includes(cap))) {
        return null;
      }

      return { name: modelName, capabilities };
    })
  );

  return inspectedModels.filter(Boolean);
}

export function omitEmptyArgs(args) {
  const cleaned = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}
