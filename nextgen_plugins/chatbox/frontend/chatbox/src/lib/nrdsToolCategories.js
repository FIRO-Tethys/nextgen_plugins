/**
 * nrdsToolCategories.js — NRDS-specific tool categorization, early returns,
 * S3 URL validation, and error checking.
 *
 * Injected into @chatbox/core engine as extension points.
 */

import {
  isPlausibleOutputsFile,
  lastToolFileUrl,
  normalizeQueryToolArgs,
  rewriteFromToOutput,
  invalidOutputFileToolResult,
  toolCallSignature,
  toolErrorText,
} from "./chatboxHelpers";

// ---------------------------------------------------------------------------
// Tool categories
// ---------------------------------------------------------------------------

export const NRDS_TOOL_CATEGORIES = {
  chart: {
    tools: new Set([
      "create_plotly_chart_from_parquet_output_file",
      "create_plotly_chart_from_output_selector",
    ]),
    stateKey: "lastChartResult",
  },
  query: {
    tools: new Set([
      "query_output_file",
      "query_output_file_from_output_selector",
    ]),
    stateKey: "lastQueryResult",
    onSuccess: (state, _result, args) => {
      state.lastQuerySQL = typeof args?.query === "string" ? args.query : null;
    },
  },
  list: {
    tools: new Set([
      "list_available_models",
      "list_available_dates",
      "list_available_forecasts",
      "list_available_cycles",
      "list_available_vpus",
      "list_available_output_files",
    ]),
    stateKey: "lastListResult",
  },
  map: {
    tools: new Set(["build_hydrofabric_feature_map_config"]),
    stateKey: "lastMapResult",
  },
  hydrofabric: {
    tools: new Set(["query_hydrofabric_parquet_file"]),
    stateKey: "lastHydrofabricResult",
  },
};

const OUTPUT_FILE_QUERY_TOOLS = new Set([
  "query_output_file",
  "create_plotly_chart_from_parquet_output_file",
]);

const S3_URL_DEPENDENT_TOOLS = OUTPUT_FILE_QUERY_TOOLS;

// ---------------------------------------------------------------------------
// Early return check
// ---------------------------------------------------------------------------

export function checkNrdsEarlyReturn(state, messages) {
  if (state.lastChartResult) {
    return {
      assistantText: "",
      plotlyFigure: state.lastChartResult.figure ?? state.lastChartResult,
      messages,
    };
  }
  if (state.lastMapResult) {
    return { assistantText: "", mapConfig: state.lastMapResult, messages };
  }
  if (state.lastHydrofabricResult) {
    return {
      assistantText: JSON.stringify(state.lastHydrofabricResult),
      queryResult: { data: state.lastHydrofabricResult, sql: null },
      messages,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Before tool execution (S3 URL validation + arg normalization)
// ---------------------------------------------------------------------------

export function beforeNrdsToolExecution(toolName, args, messages) {
  // Normalize NRDS-specific args (model literals, forecast, VPU, query rewriting)
  args = normalizeQueryToolArgs(toolName, args);

  // S3 URL validation for output file tools
  if (OUTPUT_FILE_QUERY_TOOLS.has(toolName)) {
    const currentS3 = typeof args?.s3_url === "string" ? args.s3_url : "";

    if (!isPlausibleOutputsFile(currentS3)) {
      const fallback = S3_URL_DEPENDENT_TOOLS.has(toolName)
        ? lastToolFileUrl(messages, [".parquet", ".nc", ".nc4"])
        : null;

      if (fallback) {
        args.s3_url = fallback;
      } else {
        const toolResult = invalidOutputFileToolResult(toolName, args);
        return {
          skip: true,
          message: toolResult,
          error: toolErrorText(toolResult),
          signature: toolCallSignature(toolName, args),
        };
      }
    }

    if (typeof args?.query === "string") {
      args.query = rewriteFromToOutput(args.query);
    }
  }

  return { args };
}

// ---------------------------------------------------------------------------
// Tool error check
// ---------------------------------------------------------------------------

export { toolErrorText as nrdsToolErrorCheck } from "./chatboxHelpers";
