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
      "Tool calling rules:",
      "1) Only call tools using tool_calls (never plain text).",
      "2) Use ONLY argument keys defined in the tool's JSON schema. Do NOT add extra keys.",
      "3) Include ALL required arguments from the tool schema.",
      "4) Never invent IDs/values for model/forecast/cycle/vpu. If not certain, call the corresponding list_* tool first.",
      "",
      "5) The s3 bucket is s3://ciroh-community-ngen-datastream or https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com",
      "6) For optional parameters: OMIT the key entirely if you don't have a value. Never pass null/None/''.",
      "",
      "7) If needed, call multiple tools as a chain (multi-step).",
      "8) If an argument is not available, call a tool that can retrieve valid values for that argument, then use the returned value in the next tool call.",
      "",
      "8a) If user asks for an ordinal output file (first/second/third/...) and you do not already have a full file URL, call resolve_output_file first.",
      "8b) Never call query_parquet_output_file or query_netcdf_output_file with a directory path. s3_url must be ONE file URL ending in .parquet or .nc/.nc4.",
      "",
      "9) If the final response is an empty array/list, let the user know there is no data for that request.",
      "",
      "Date handling:",
      `- Today is ${denverTodayIso()} (America/Denver).`,
      "",
      "Query tools (DuckDB):",
      "- For Parquet: use query_parquet_output_file (args: s3_url, query). Do NOT use s3_url/type/args.",
      "- For NetCDF: use query_netcdf_output_file (args: s3_url, query). Do NOT use s3_url/type/args.",
      "- For visualization requests, first run query_*, then call create_plotly_chart_from_query_result with the full query_* payload as query_result (not just query_result.data).",
      "- SQL queries MUST read FROM output. Never use read_parquet(...) or read_netcdf(...).",
      "- For variable requests, select the variable as a column (e.g., SELECT time, feature_id, flow FROM output ...).",
      "- Example for feature ids: SELECT DISTINCT feature_id FROM output;",
      "",
      "Tool-chain examples:",
      "- Example A: For 'how many feature ids in the first output file ...', call resolve_output_file first (index=0), then call query_parquet_output_file on the selected path with SELECT COUNT(DISTINCT feature_id) AS feature_count FROM output;",
      "- Example B: For follow-up 'provide the time series for variable flow', reuse the same resolved file URL and call query_parquet_output_file with SELECT time, feature_id, flow FROM output WHERE flow IS NOT NULL ORDER BY time, feature_id LIMIT 5000;",
      "- Example C: If you only have metadata and no file URL, call list_available_outputs_files first, choose a concrete file path, then call query_*.",
      "- Example D: For 'plot flow vs time', run query_* first, then call create_plotly_chart_from_query_result with chart_type='line', x='time', y='flow'.",
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
