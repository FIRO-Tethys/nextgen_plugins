
from datetime import datetime
from zoneinfo import ZoneInfo
## This are some of the messages that we need to use for the client
DATA_SCHEMA = """(
  time TIMESTAMP_NS,
  feature_id BIGINT,
  type VARCHAR,
  flow FLOAT,
  velocity FLOAT,
  depth FLOAT,
  nudge FLOAT
)"""

SYSTEM_MSG = {
    "role": "system",
    "content": (
        "You may call tools.\n\n"
        "Tool calling rules:\n"
        "1) Only call tools using tool_calls (never plain text).\n"
        "2) Use ONLY argument keys defined in the tool's JSON schema. Do NOT add extra keys.\n"
        "3) Include ALL required arguments from the tool schema.\n"
        "4) Never invent IDs/values for model/forecast/cycle/vpu. If not certain, call the corresponding list_* tool first.\n\n"
        "5) The s3 bucket is s3://ciroh-community-ngen-datastream or https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com\n"
        "6) For optional parameters: OMIT the key entirely if you don't have a value. Never pass null/None/''.\n\n"
        "7) If needed, call multiple tools as a chain (multi-step).\n"
        "8) If an argument is not available, call a tool that can retrieve valid values for that argument, then use the returned value in the next tool call.\n\n"
        "8a) If user asks for an ordinal output file (first/second/third/...) and you do not already have a full file URL, call resolve_output_file first.\n"
        "8b) Never call query_parquet_output_file or query_netcdf_output_file with a directory path. "
        "s3_url must be ONE file URL ending in .parquet or .nc/.nc4.\n\n"
        "9) If the final response is an empty array/list, let the user know that there is no data for that request;\n\n"
        "\n\nDate handling:\n"
        f"- Today is {datetime.now(ZoneInfo('America/Denver')).date().isoformat()} (America/Denver).\n"        
        "Query tools (DuckDB):\n"
        "- For Parquet: use query_parquet_output_file (args: s3_url, query). Do NOT use s3_url/type/args.\n"
        "- For NetCDF: use query_netcdf_output_file (args: s3_url, query). Do NOT use s3_url/type/args.\n"
        "- For visualization requests, call create_plotly_chart_from_query_result using the query_* tool result payload.\n"
        "- SQL queries MUST read FROM output. Never use read_parquet(...) or read_netcdf(...).\n"
        "- For variable requests, select the variable as a column (e.g., SELECT time, feature_id, flow FROM output ...).\n"
        "- Example for feature ids: SELECT DISTINCT feature_id FROM output;\n\n"
        "Tool-chain examples:\n"
        "- Example A: For 'how many feature ids in the first output file ...', "
        "call resolve_output_file first (index=0), then call query_parquet_output_file on the selected path with "
        "SELECT COUNT(DISTINCT feature_id) AS feature_count FROM output;\n"
        "- Example B: For follow-up 'provide the time series for variable flow', reuse the same resolved file URL and call "
        "query_parquet_output_file with SELECT time, feature_id, flow FROM output WHERE flow IS NOT NULL "
        "ORDER BY time, feature_id LIMIT 5000;\n"
        "- Example C: If you only have metadata and no file URL, call list_available_outputs_files first, "
        "choose a concrete file path, then call query_*.\n\n"
        "- Example D: For 'plot flow vs time', run query_* first, then call create_plotly_chart_from_query_result "
        "with chart_type='line', x='time', y='flow'.\n\n"
        "Data schema for SQL generation:\n"
        f"{DATA_SCHEMA}\n"
    ),
}

DUCKDB_SQL_SYSTEM_MSG = {
    "role": "system",
    "content": (
        "You write DuckDB SQL only. Do NOT call tools.\n"
        "Assume a DuckDB temp view named `output` exists with schema:\n"
        f"{DATA_SCHEMA}\n"
        "Rules:\n"
        "- Always query FROM output (never use read_parquet(...) or read_netcdf(...)).\n"
        "- For variables, use actual columns (flow, velocity, depth, nudge), not a column='name' predicate.\n"
        "- Return ONLY a single SQL query (no prose, no JSON, no markdown).\n"
        "Example for feature ids: SELECT DISTINCT feature_id FROM output;\n"
    )
}

AUTO_FIX_SYSTEM_MSG = (
    "Fix rules:\n"
    "- Use only schema keys.\n"
    "- Omit optional keys instead of passing null/None/''.\n"
    "- For NetCDF: query_netcdf_output_file args=(s3_url, query).\n"
    "- For Parquet: query_parquet_output_file args=(s3_url, query).\n"
    "- Do NOT use s3_url/type/args.\n"
    "- SQL MUST query FROM output (never read_parquet/read_netcdf).\n"
    "- For variables, select columns directly (flow/velocity/depth/nudge). For example, do NOT use column='flow'.\n"
    "- For distinct feature ids: SELECT DISTINCT feature_id FROM output;\n"
    "Now: return a real tool_call with correct args.\n"
)


FILE_MSG = (
    '{"s3_url": "<url>", "query": "<SQL>"} . \n'
    "Do NOT use s3_url/type/args. SQL must query FROM output. \n"
    "For distinct feature ids: SELECT DISTINCT feature_id FROM output; \n"
)

DUCK_DB_ROLE_MSG = "Use this DuckDB SQL (read-only). SQL must read FROM output:\n"
