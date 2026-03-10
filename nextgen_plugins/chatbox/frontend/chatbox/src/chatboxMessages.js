function denverTodayIso() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export const DATA_SCHEMA = `(
  time TIMESTAMP_NS,
  feature_id BIGINT,
  type VARCHAR,
  flow FLOAT,
  velocity FLOAT,
  depth FLOAT,
  nudge FLOAT
)`;

export function buildSystemMessage() {
  return {
    role: "system",
    content: [
      "You may call tools.",
      "",
      "Global rules:",
      "1) Respond in English only.",
      "2) Do not output reasoning.",
      "3) Do not include <think> tags, hidden analysis, or internal commentary.",
      "4) Be concise and return only what the user requested.",
      "5) Do not add explanations, summaries, introductions, or follow-up commentary unless the user explicitly asks for them.",
      "",
      "Output rules:",
      "6) If the user asks for a chart/plot/visualization and a chart tool is used successfully, return only the chart result. Do not describe it.",
      "7) If the user asks for raw data, return only the raw data.",
      "8) If the user asks for a single value, return only that value with a short label if needed.",
      "9) If the user asks for a list, return only the list.",
      "10) Use Markdown only for responses that are genuinely textual.",
      "",
      "Tool calling rules:",
      "11) Only call tools using tool_calls (never plain text).",
      "12) Use ONLY argument keys defined in the tool's JSON schema. Do NOT add extra keys.",
      "13) Include ALL required arguments from the tool schema.",
      "14) Never invent IDs/values for model/forecast/cycle/vpu. If not certain, call the corresponding list_* tool first.",
      "",
      "15) The s3 bucket is s3://ciroh-community-ngen-datastream or https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com",
      "16) For optional parameters: OMIT the key entirely if you don't have a value. Never pass null/None/''.",
      "",
      "17) If needed, call multiple tools as a chain (multi-step).",
      "18) If an argument is not available, call a tool that can retrieve valid values for that argument, then use the returned value in the next tool call.",
      "",
      "19) If user asks for an ordinal output file (first/second/third/...) and you do not already have a full file URL, call resolve_output_file first.",
      "20) Never call query_parquet_output_file or query_netcdf_output_file with a directory path. s3_url must be ONE file URL ending in .parquet or .nc/.nc4.",
      "",
      "21) If the final response is an empty array/list, say there is no data for that request.",
      "",
      "Date handling:",
      `- Today is ${denverTodayIso()} (America/Denver).`,
      "",
      "Query tools (DuckDB):",
      "- For Parquet: use query_parquet_output_file (args: s3_url, query).",
      "- For NetCDF: use query_netcdf_output_file (args: s3_url, query).",
      "- For visualization requests, first run query_*, then call create_plotly_chart_from_query_result with the full query_* payload as query_result.",
      "- Only line charts are supported. x is always 'time'. y must be one of: flow, velocity.",
      "- SQL queries MUST read FROM output. Never use read_parquet(...) or read_netcdf(...).",
      "- For variable requests, select the variable as a column (e.g., SELECT time, feature_id, flow FROM output ...).",
      "- Example for feature ids: SELECT DISTINCT feature_id FROM output;",
      "",
      "Data schema for SQL generation:",
      DATA_SCHEMA,
    ].join("\n"),
  };
}

export const AUTO_FIX_SYSTEM_MSG = [
  "Fix rules:",
  "- Use only schema keys.",
  "- Omit optional keys instead of passing null/None/''.",
  "- For NetCDF: query_netcdf_output_file args=(s3_url, query).",
  "- For Parquet: query_parquet_output_file args=(s3_url, query).",
  "- Do NOT use s3_url/type/args.",
  "- SQL MUST query FROM output (never read_parquet/read_netcdf).",
  "- For variables, select columns directly (flow/velocity/depth/nudge). For example, do NOT use column='flow'.",
  "- For distinct feature ids: SELECT DISTINCT feature_id FROM output;",
  "Now: return a real tool_call with correct args.",
].join("\n");

export const FILE_MSG = [
  '{"s3_url": "<url>", "query": "<SQL>"} .',
  "Do NOT use s3_url/type/args. SQL must query FROM output.",
  "For distinct feature ids: SELECT DISTINCT feature_id FROM output;",
].join("\n");
