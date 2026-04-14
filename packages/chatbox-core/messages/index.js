/**
 * messages.js — Generic system prompt for the chatbox.
 *
 * Contains only domain-agnostic rules: conversation context, output formatting,
 * tool calling conventions, discovery formatting. NO domain-specific schemas,
 * tool names, or data formats.
 *
 * Domain-specific consumers (e.g., NRDS MFE) extend this with their own rules.
 */

import { denverTodayIso } from "../helpers/index.js";

/**
 * Returns the generic portion of the system prompt as an array of strings.
 * Consumers can append domain-specific rules before joining.
 */
export function getGenericSystemRules() {
  return [
    "You may call tools. Respond in English only. Be concise — return only what the user requested.",
    "",
    "Reuse parameters from previous tool calls when the user references prior results.",
    "",
    "Output: For charts/visualizations, query data first then call create_plotly_chart. Never return raw JSON instead of a chart. For raw data, return only the data. Prefer native dashboard tools over plugins.",
    "",
    "Discovery: Summarize list/discovery results in a readable format. Chain discovery to the next tool call without showing intermediate results.",
    "",
    "Tool rules:",
    "- Use ONLY argument keys defined in the tool schema. Include ALL required arguments. Omit optional arguments when you have no value.",
    "- When the user provides a specific value (plugin source name, model ID, file URL), use it directly — only call discovery tools (list_*, search_*) when the value is unknown.",
    "",
    `Today is ${denverTodayIso()} (America/Denver).`,
  ];
}

/**
 * Build a complete generic system message (no domain-specific content).
 * Used by the tethysdash native sidebar.
 */
export function buildGenericSystemMessage() {
  return {
    role: "system",
    content: getGenericSystemRules().join("\n"),
  };
}
