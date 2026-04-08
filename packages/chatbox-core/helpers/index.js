/**
 * helpers.js — Generic utility functions for the chatbox.
 *
 * Model loading, URL normalization, JSON parsing, tool call extraction.
 * NO domain-specific logic (no NRDS, S3, hydrofabric, parquet).
 */

import { DEFAULT_OLLAMA_HOST, DEFAULT_OLLAMA_API_KEY } from "../config/index.js";

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

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
      .map((part) => [part.type, part.value]),
  );

  return `${map.year}-${map.month}-${map.day}`;
}

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

export function stripThinkTags(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^submitButton\s*/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Tool call merging
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
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

export function maybeParseJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
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

// ---------------------------------------------------------------------------
// Inline tool call extraction
// ---------------------------------------------------------------------------

function parseFirstJsonObject(text, startIndex) {
  if (text[startIndex] !== "{") return null;

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

    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { depth += 1; continue; }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const raw = text.slice(startIndex, i + 1);
        try { return JSON.parse(raw); } catch { return null; }
      }
    }
  }
  return null;
}

export function extractInlineToolCalls(text) {
  if (typeof text !== "string" || !text.trim()) return [];

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    const obj = parseFirstJsonObject(text, i);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

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

// ---------------------------------------------------------------------------
// Response / args utilities
// ---------------------------------------------------------------------------

export function getMessage(resp) {
  if (!resp || typeof resp !== "object") return {};
  const message = resp.message;
  if (!message || typeof message !== "object") return {};
  return message;
}

export function omitEmptyArgs(args) {
  const cleaned = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    cleaned[key] = value;
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Ollama model loading
// ---------------------------------------------------------------------------

function normalizeOllamaModelName(entry) {
  if (typeof entry === "string" && entry.trim()) return entry.trim();
  if (typeof entry?.name === "string" && entry.name.trim()) return entry.name.trim();
  if (typeof entry?.model === "string" && entry.model.trim()) return entry.model.trim();
  return "";
}

function canonicalOllamaModelKey(modelName) {
  const normalized = normalizeOllamaModelName(modelName);
  if (!normalized) return "";
  return normalized.includes(":")
    ? normalized.toLowerCase()
    : `${normalized}:latest`.toLowerCase();
}

export function extractContextLength(showPayload) {
  const modelInfo = showPayload?.model_info;
  if (!modelInfo || typeof modelInfo !== "object") return null;
  for (const key of Object.keys(modelInfo)) {
    if (key.endsWith(".context_length")) {
      const val = modelInfo[key];
      return typeof val === "number" && val > 0 ? val : null;
    }
  }
  return null;
}

function parseModelCapabilities(entry) {
  if (!entry || typeof entry !== "object") return [];
  const caps = entry.capabilities ?? entry.details?.capabilities;
  return Array.isArray(caps)
    ? caps.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
}

export async function listOllamaModels(ollamaHost = DEFAULT_OLLAMA_HOST, options = {}) {
  const host = String(ollamaHost ?? "").replace(/\/+$/, "");
  const apiKey = typeof options?.apiKey === "string" ? options.apiKey.trim() : DEFAULT_OLLAMA_API_KEY;
  const csrf = typeof options?.csrfToken === "string" ? options.csrfToken : "";
  const authHeaders = {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(csrf ? { "x-csrftoken": csrf } : {}),
  };
  const requiredCapabilities = Array.isArray(options?.requiredCapabilities)
    ? options.requiredCapabilities
        .map((capability) => String(capability ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  const extraModels = Array.isArray(options?.extraModels)
    ? options.extraModels.map((entry) => normalizeOllamaModelName(entry)).filter(Boolean)
    : [];
  const response = await fetch(`${host}/api/tags/`, { headers: authHeaders });

  if (!response.ok) {
    throw new Error(`Failed to load Ollama models (${response.status})`);
  }

  const payload = await response.json();
  const rawModels = Array.isArray(payload?.models) ? payload.models : [];

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
      .values(),
  );

  const inspectedModels = await Promise.all(
    modelEntries.map(async (modelName) => {
      const canonKey = canonicalOllamaModelKey(modelName);
      let capabilities = tagsCapsMap.get(canonKey) ?? [];
      let contextLength = null;

      try {
        const showResponse = await fetch(`${host}/api/show/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ model: modelName }),
        });

        if (showResponse.ok) {
          const showPayload = await showResponse.json();
          const showCaps = Array.isArray(showPayload?.capabilities)
            ? showPayload.capabilities.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean)
            : [];
          if (showCaps.length) {
            capabilities = showCaps;
          }
          contextLength = extractContextLength(showPayload);
        }
      } catch {
        // /api/show unavailable (e.g. Ollama Cloud) — use /api/tags capabilities.
      }

      if (requiredCapabilities.length && !requiredCapabilities.every((cap) => capabilities.includes(cap))) {
        return null;
      }

      return { name: modelName, capabilities, contextLength };
    }),
  );

  return inspectedModels.filter(Boolean);
}
