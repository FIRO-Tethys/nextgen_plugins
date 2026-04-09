/**
 * nrdsMessages.js — NRDS-specific system prompt, repair messages, and file messages.
 *
 * Extends the generic system rules from @chatbox/core with NRDS domain knowledge:
 * hydrofabric schema, tool selection rules, SQL patterns, S3 bucket paths.
 */

import { getGenericSystemRules } from "@chatbox/core/messages";
import { extractFileUrl, fileKind } from "./chatboxHelpers";

export const DATA_SCHEMA = `(
  time TIMESTAMP_NS,
  feature_id BIGINT,
  type VARCHAR,
  flow FLOAT,
  velocity FLOAT,
  depth FLOAT,
  nudge FLOAT
)`;

export const HYDROFABRIC_DATA_SCHEMA = `(
  layer VARCHAR,
  id VARCHAR,
  lon DOUBLE,
  lat DOUBLE,
  toid VARCHAR,
  vpuid VARCHAR,
  poi_id BIGINT,
  type VARCHAR,
  ds_id VARCHAR,
  areasqkm DOUBLE,
  lengthkm DOUBLE,
  tot_drainage_areasqkm DOUBLE,
  has_flowline BIGINT,
  LkArea DOUBLE,
  LkMxE DOUBLE,
  WeirC DOUBLE,
  WeirL BIGINT,
  OrificeC DOUBLE,
  OrificeA BIGINT,
  OrificeE DOUBLE,
  WeirE DOUBLE,
  Dam_Length BIGINT,
  domain VARCHAR,
  hf_id BIGINT,
  reservoir_index_AnA BIGINT,
  reservoir_index_Extended_AnA BIGINT,
  reservoir_index_GDL_AK VARCHAR,
  reservoir_index_Medium_Range BIGINT,
  reservoir_index_Short_Range BIGINT,
  res_id BIGINT,
  lake_x DOUBLE,
  lake_y DOUBLE,
  mainstem BIGINT,
  flow_order BIGINT,
  hydroseq BIGINT,
  has_divide BIGINT,
  divide_id VARCHAR
)`;

export function buildNrdsSystemMessage() {
  const genericRules = getGenericSystemRules();

  const nrdsRules = [
    "",
    "NRDS-specific tool calling rules:",
    "18) Never invent model, forecast, cycle, vpu, ensemble, file values, or s3_url values. If unknown, call a discovery tool first.",
    "",
    "File and path rules:",
    "19) The bucket is s3://ciroh-community-ngen-datastream or https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com.",
    "20) query_output_file requires ONE file URL, not a directory path.",
    "21) Never call a query or chart tool with a directory path. The s3_url must end in .parquet, .nc, or .nc4.",
    "22) Never invent or synthesize s3_url values.",
    "23) If no exact file URL is already available, call resolve_output_file or list_available_output_files first.",
    "",
    "Selector-first tool rules:",
    "24) If the user asks for raw output data using model/date/forecast/cycle/vpu, prefer query_output_file_from_output_selector.",
    "25) Prefer selector tools over chaining resolve_output_file + another tool.",
    "",
    "Discovery tool rules:",
    "27) If the user asks for available models, use list_available_models.",
    "28) If the user asks for available dates for a model, use list_available_dates with {model}.",
    "29) If the user asks for available forecasts, use list_available_forecasts.",
    "30) If the user asks for available cycles, use list_available_cycles.",
    "31) If the user asks for available VPUs, use list_available_vpus.",
    "32) If the user asks for available output files, use list_available_output_files.",
    "33) If you do not know a model, date, forecast, cycle, or vpu value, call the corresponding list tool first.",
    "",
    "Tool selection rules:",
    '34) For hydrofabric metadata lookups, use query_hydrofabric_parquet_file with {"hydrofabric_id":"<id>"}.',
    '35) For hydrofabric map/highlight requests, use build_hydrofabric_feature_map_config with {"hydrofabric_id":"<id>"}.',
    "36-43) Hydrofabric tools do not take s3_url or raw SQL. Output file tools are separate from hydrofabric tools.",
    "",
    "SQL rules for output-file tools only:",
    "- SQL MUST query FROM output.",
    "- Never use read_parquet(...) or external table functions.",
    "- For time series: SELECT time, flow FROM output WHERE feature_id = 1019290",
    "- For distinct ids: SELECT DISTINCT feature_id FROM output LIMIT 10",
    "",
    "Hydrofabric lookup rules:",
    "- For hydrofabric lookups, do not generate SQL. Use query_hydrofabric_parquet_file.",
    "",
    "Chart rules:",
    "- For chart requests, first query data using query_output_file_from_output_selector (preferred) or query_output_file, then call create_plotly_chart (TethysDash MCP) with the data as Plotly trace objects.",
    "- The create_plotly_chart tool expects data as [{x: [...], y: [...], type: 'scatter', name: 'label'}]. Transform query result rows into this column-oriented format.",
    "- Only line charts are supported. X is time, Y is a metric (flow, velocity, etc.).",
    "- Do NOT use create_plotly_chart_from_parquet_output_file or create_plotly_chart_from_output_selector — these are deprecated.",
    "",
    "Visualization discovery:",
    "- To discover available visualizations, call list_available_visualizations (TethysDash MCP). It returns built-in types and installed client plugins with argument schemas.",
    "- When the user asks 'what visualizations can you create?' or 'what charts are available?', call list_available_visualizations first.",
    "",
    "Visualization preference rules:",
    "- Prefer native TethysDash visualizations (create_plotly_chart, create_data_table, create_map_visualization, create_card, create_text) over client plugins when the request can be fulfilled natively.",
    "- Use render_client_plugin only for specialized visualizations that native tools cannot handle, or when the user explicitly requests a specific client plugin by name.",
    "",
    "Output-file schema:",
    DATA_SCHEMA,
    "",
    "Hydrofabric index schema:",
    HYDROFABRIC_DATA_SCHEMA,
  ];

  return {
    role: "system",
    content: [...genericRules, ...nrdsRules].join("\n"),
  };
}

/**
 * Inject a file URL detection message before the first LLM call.
 * Used as the `beforeFirstMessage` extension point.
 */
export function buildNrdsBeforeFirstMessage(text) {
  const fileUrl = extractFileUrl(text);
  if (!fileUrl) return null;
  const kind = fileKind(fileUrl);

  return {
    role: "user",
    content: [
      "Detected file URL.",
      "Use this file directly when the user already provided a full file URL.",
      'For raw-data queries, call query_output_file with {"s3_url":"<file-url>","query":"<SQL>"}.',
      "For chart requests, first call query_output_file to get the data rows, then call create_plotly_chart (TethysDash MCP) with the data as Plotly trace objects.",
      "SQL must query FROM output.",
    ].join("\n"),
  };
}

export const NRDS_AUTO_FIX_MSG = [
  "Fix rules: Respond in English only. Return a real tool_call only.",
  "Use only argument keys that exist in the selected tool schema.",
  "For hydrofabric lookups use query_hydrofabric_parquet_file with {hydrofabric_id}.",
  "For raw output data use query_output_file or query_output_file_from_output_selector.",
  "For charts, first query data with query_output_file or query_output_file_from_output_selector, then call create_plotly_chart (TethysDash MCP).",
  "SQL must query FROM output. Never invent s3_url values.",
  "Now return one corrected tool_call.",
].join("\n");

export function buildNrdsRepairMessage(lastErr, priorUserText, repeatedSignature) {
  const parts = [NRDS_AUTO_FIX_MSG];
  if (lastErr) parts.push(`Last error: ${lastErr}`);
  if (priorUserText) parts.push(`Original request: ${priorUserText}`);
  if (repeatedSignature) parts.push(`Repeated failing call signature: ${repeatedSignature}. Try a different approach.`);
  return { role: "user", content: parts.join("\n") };
}
