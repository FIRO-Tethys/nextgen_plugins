import json
from typing import Optional, Dict, Any, List, Literal
from typing_extensions import Annotated
from pydantic import Field
from fastmcp import FastMCP
from datetime import datetime

from .utils import (
    _get_json_raw,
    _prefer_id_objects,
    _as_id,
    REST_API_HOST,
    _parse_iso_date,
    DEFAULT_TZ,
    DEFAULT_START,
    DATE_PATTERN,
    _date_from_item,
)
from .validations import (
    FORECASTS,
    VPUS,
    MODELS
)

mcp = FastMCP("NRDS MCP Server")

# ---- Date bounds helpers (DEFAULT_START .. today in DEFAULT_TZ) ----
_MIN_ALLOWED_DATE = _parse_iso_date(DEFAULT_START)


def _validate_date_bounds(d, field_name: str):
    today = datetime.now(DEFAULT_TZ).date()
    if d < _MIN_ALLOWED_DATE or d > today:
        raise ValueError(
            f"'{field_name}' must be between {_MIN_ALLOWED_DATE} and {today} (got {d})"
        )
    return d


def _parse_date_or_today(date_str: Optional[str], field_name: str):
    d = (
        _parse_iso_date(date_str)
        if date_str is not None
        else datetime.now(DEFAULT_TZ).date()
    )
    return _validate_date_bounds(d, field_name)


@mcp.tool(name="healthcheck", description="Check connectivity to the NRDS REST API host.")
def healthcheck() -> Dict[str, Any]:
    raw = _get_json_raw("list_available_models")
    raw = _prefer_id_objects(raw, "models")

    models = raw.get("models") or []
    sample_models = [m.get("id") for m in models[:5] if isinstance(m, dict)]

    return {
        "ok": True,
        "host": REST_API_HOST,
        "model_count": len(models),
        "sample_models": sample_models,
    }


@mcp.tool(name="list_available_models", description="List available NRDS models. It should not have any arguments when called.")
def list_available_models_tool() -> Dict[str, Any]:
    raw = _get_json_raw("list_available_models")
    raw = _prefer_id_objects(raw, "models")
    return raw


@mcp.tool(
    name="list_available_dates",
    description=(
        "List available dates for a given model (returns id + label). "
        "Supports date-range filtering with start/end (ISO YYYY-MM-DD or YYYY/MM/DD). "
        "Defaults: start=2025-08-01, end=today (America/Denver). "
        "Pagination is applied after filtering using offset/limit."
    ),
)
def list_available_dates_tool(
    model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
    offset: Annotated[
        int, Field(ge=0, description="Number of items to skip for pagination (default 0)")
    ] = 0,
    limit: Annotated[
        int,
        Field(ge=0, description="Maximum number of items to return (default 0 for all)"),
    ] = 0,
    start: Annotated[
        str,
        Field(
            default=DEFAULT_START,
            pattern=DATE_PATTERN,
            description="Start date (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD. Default 2025-08-01.",
        ),
    ] = DEFAULT_START,
    end: Annotated[
        Optional[str],
        Field(
            default=None,
            pattern=DATE_PATTERN,
            description="End date (inclusive). ISO YYYY-MM-DD or YYYY/MM/DD. Default is today's date.",
        ),
    ] = None,
) -> Dict[str, Any]:
    # Resolve defaults and validate range
    start_date = _validate_date_bounds(_parse_iso_date(start), "start")
    end_date = _parse_date_or_today(end, "end")

    if start_date > end_date:
        raise ValueError(
            f"'start' must be <= 'end' (got start={start_date}, end={end_date})"
        )

    raw = _get_json_raw("list_available_dates", params={"model": model})

    dates = raw.get("dates") or []
    if isinstance(dates, list) and dates and isinstance(dates[0], dict):
        # Filter by date range (inclusive)
        filtered: list[dict] = []
        for item in dates:
            di = _date_from_item(item)
            if di is None:
                continue
            if start_date <= di <= end_date:
                filtered.append(item)

        # Apply pagination after filtering
        if offset or (limit and limit > 0):
            raw["dates"] = filtered[offset : (offset + limit) if limit else None]
        else:
            raw["dates"] = filtered

    return raw


@mcp.tool(
    name="list_available_forecasts",
    description="List available forecasts for a given model and date",
)
def list_available_forecasts_tool(
    model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
    date: Annotated[
        Optional[str],
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ] = None,
) -> Dict[str, Any]:
    end_date = _parse_date_or_today(date, "date")
    raw = _get_json_raw(
        "list_available_forecasts", params={"model": model, "date": end_date}
    )
    raw = _prefer_id_objects(raw, "forecasts")
    return raw


@mcp.tool(
    name="list_available_cycles",
    description="List available cycles for a given model, date, and forecast",
)
def list_available_cycles_tool(
    model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
    date: Annotated[
        Optional[str],
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ] = None,
    forecast: Annotated[
        FORECASTS,
        Field(
            description="Forecast id",
            pattern=r"^(short_range|medium_range|analysis_assim_extend)$",
        ),
    ] = "short_range",
) -> Dict[str, Any]:
    forecast_id = _as_id(forecast)
    end_date = _parse_date_or_today(date, "date")
    raw = _get_json_raw(
        "list_available_cycles",
        params={"model": model, "date": end_date, "forecast": forecast_id},
    )
    # cycles are already stable, but normalize to {id,label} anyway
    raw = _prefer_id_objects(raw, "cycles")
    return raw


@mcp.tool(
    name="list_available_vpus",
    description="List available VPUs for a given model, date, forecast, and cycle",
)
def list_available_vpus_tool(
    model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
    date: Annotated[
        Optional[str],
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ] = None,
    forecast: Annotated[
        FORECASTS,
        Field(
            description="Forecast id",
            pattern=r"^(short_range|medium_range|analysis_assim_extend)$",
        ),
    ] = "short_range",
    cycle: Annotated[
        str,
        Field(
            description="Hourly cycle (00-23). short_range forecast (hourly, every hour), "
            "medium_range forecast (4 times per day, every 6 hours, first member), "
            "analysis_assim_extend forecast (once per day at 16z)",
            pattern=r"^(?:[01]\d|2[0-3])$",
        ),
    ] = "00",
) -> List [str]:
    forecast_id = _as_id(forecast)
    end_date = _parse_date_or_today(date, "date")
    raw = _get_json_raw(
        "list_available_vpus",
        params={"model": model, "date": end_date, "forecast": forecast_id, "cycle": cycle},
    )
    vpus = raw.get("vpus") 
    return vpus


@mcp.tool(
    name="list_available_outputs_files",
    description="List available output files for a given model, date, forecast, cycle, and VPU (accepts id or label). Optional ensemble member for applicable forecast.",
)
def list_available_outputs_files_tool(
    model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
    date: Annotated[
        Optional[str],
        Field(
            description="YYYY-MM-DD or YYYY/MM/DD",
            pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
        ),
    ] = None,
    forecast: Annotated[
        FORECASTS,
        Field(
            description="Forecast id",
            pattern=r"^(short_range|medium_range|analysis_assim_extend)$",
        ),
    ] = "short_range",
    cycle: Annotated[
        str,
        Field(
            description="Hourly cycle (00-23). short_range forecast (hourly, every hour), "
            "medium_range forecast (4 times per day, every 6 hours, first member), "
            "analysis_assim_extend forecast (once per day at 16z)",
            pattern=r"^(?:[01]\d|2[0-3])$",
        ),
    ] = "00",
    vpu: Annotated[VPUS, Field(description="VPU id")] = "VPU_6",
    ensemble: Annotated[
        Optional[str], Field(description="Optional ensemble member (1 or 16)", pattern=r"^(?:1|16)$")
    ] = None,
) -> Dict[str, Any]:
    end_date = _parse_date_or_today(date, "date")
    params: Dict[str, Any] = {
        "model": model,
        "date": end_date,
        "forecast": _as_id(forecast),
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    if ensemble is not None:
        params["ensemble"] = int(ensemble)

    raw = _get_json_raw("list_available_outputs_files", params=params)
    return raw

@mcp.tool(
    name="resolve_output_file",
    description="Resolve a single output file path for model/date/forecast/cycle/vpu by file_name or index.",
)
def resolve_output_file_tool(
    model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
    date: Annotated[Optional[str], Field(description="YYYY-MM-DD or YYYY/MM/DD", pattern=DATE_PATTERN)] = None,
    forecast: Annotated[FORECASTS, Field(description="Forecast id")] = "short_range",
    cycle: Annotated[str, Field(description="Cycle", pattern=r"^(?:[01]\d|2[0-3])$")] = "00",
    vpu: Annotated[VPUS, Field(description="VPU id")] = "VPU_06",
    ensemble: Annotated[Optional[str], Field(description="Ensemble (medium_range)", pattern=r"^\d+$")] = None,
    file_name: Annotated[Optional[str], Field(description="Exact filename (e.g. troute_output_...parquet)")] = None,
    index: Annotated[Optional[int], Field(description="0-based index into sorted file list", ge=0)] = None,
) -> Dict[str, Any]:
    end_date = _parse_date_or_today(date, "date")
    params: Dict[str, Any] = {
        "model": model,
        "date": end_date,
        "forecast": _as_id(forecast),
        "cycle": cycle,
        "vpu": _as_id(vpu),
    }
    if ensemble is not None:
        params["ensemble"] = ensemble
    if file_name is not None:
        params["file_name"] = file_name
    if index is not None:
        params["index"] = index

    return _get_json_raw("get_output_file", params=params)

@mcp.tool(
    name="read_parquet_output_file",
    description="Read a parquet output file from S3 given its s3_url. Returns columns and data (as list of lists).",
)
def read_parquet_output_file_tool(
    s3_url: Annotated[
        str,
        Field(
            description="Full URL to the parquet file (s3://... or https://...)", 
            pattern=r"^(?:https://|s3://).+\.parquet$",
        ),
    ],
) -> Dict[str, Any]:
    return _get_json_raw("read_parquet_output_file", params={"s3_url": s3_url})

@mcp.tool(
    name="query_parquet_output_file",
    description=(
        "Run a SQL query against a parquet output file in S3 using DuckDB. "
        "Provide ONE parquet s3_url and a SQL query. "
        "SQL MUST read FROM output."
    ),
)
def query_parquet_output_file_tool(
    s3_url: Annotated[
        str,
        Field(
            description="Full URL to the parquet file (s3://... or https://...)",
            pattern=r"^(?:https://|s3://).+\.parquet$",
        ),
    ],
    query: Annotated[
        str,
        Field(
            description="DuckDB SQL query (read-only). Must start with SELECT or WITH. Must read FROM output.",
            pattern=r"(?is)^\s*(?:WITH\b.*?\bSELECT\b|SELECT\b).*$",
        ),
    ],
) -> Dict[str, Any]:
    return _get_json_raw("query_parquet_output_file", params={"s3_url": s3_url, "query": query})

@mcp.tool(
    name="query_netcdf_output_file",
    description=(
        "Run a SQL query against a netcdf output file in S3 using DuckDB. "
        "Provide ONE netcdf s3_url and a SQL query. "
        "SQL MUST read FROM output."
    ),
)
def query_netcdf_output_file_tool(
    s3_url: Annotated[
        str,
        Field(
            description="Full URL to the netcdf file (s3://... or https://...)",
            pattern=r"^(?:https://|s3://).+\.nc$",
        ),
    ],
    query: Annotated[
        str,
        Field(
            description="DuckDB SQL query (read-only). Must start with SELECT or WITH. Must read FROM output.",
            pattern=r"(?is)^\s*(?:WITH\b.*?\bSELECT\b|SELECT\b).*$",
        ),
    ],
) -> Dict[str, Any]:
    return _get_json_raw("query_netcdf_output_file", params={"s3_url": s3_url, "query": query})


def _parse_query_result_payload(query_result: Dict[str, Any] | str) -> Dict[str, Any]:
    if isinstance(query_result, dict):
        return query_result
    if isinstance(query_result, str):
        payload = json.loads(query_result)
        if isinstance(payload, dict):
            return payload
    raise ValueError("query_result must be a JSON object or JSON object string.")


def _is_numeric_value(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _auto_pick_axes(columns: List[str], rows: List[Dict[str, Any]], x: Optional[str], y: Optional[str]) -> tuple[str, str]:
    if not columns:
        raise ValueError("No columns available to infer x/y axes.")

    picked_x = x if x in columns else ("time" if "time" in columns else columns[0])
    if y in columns and y != picked_x:
        return picked_x, y

    for col in columns:
        if col == picked_x:
            continue
        if any(_is_numeric_value(r.get(col)) for r in rows):
            return picked_x, col

    raise ValueError(
        "Could not infer a numeric y axis. Provide y=<numeric column name> explicitly."
    )


@mcp.tool(
    name="create_plotly_chart_from_query_result",
    description=(
        "Create a Plotly-compatible chart JSON from the output of "
        "query_parquet_output_file or query_netcdf_output_file. "
        "Input can be a JSON object or a JSON string containing keys like columns/data."
    ),
)
def create_plotly_chart_from_query_result_tool(
    query_result: Annotated[
        Dict[str, Any] | str,
        Field(
            description=(
                "Result payload returned by query_parquet_output_file or "
                "query_netcdf_output_file (dict or JSON string)."
            )
        ),
    ],
    chart_type: Annotated[
        Literal["line", "scatter", "bar"],
        Field(description="Chart type: line, scatter, or bar."),
    ] = "line",
    x: Annotated[
        Optional[str],
        Field(description="Column name for x-axis. Defaults to time, otherwise first column."),
    ] = None,
    y: Annotated[
        Optional[str],
        Field(description="Numeric column name for y-axis. Auto-detected if omitted."),
    ] = None,
    color: Annotated[
        Optional[str],
        Field(description="Optional categorical column for multi-trace grouping."),
    ] = None,
    title: Annotated[
        Optional[str],
        Field(description="Optional chart title."),
    ] = None,
    max_points: Annotated[
        int,
        Field(ge=1, le=50000, description="Maximum number of rows to plot."),
    ] = 5000,
) -> Dict[str, Any]:
    payload = _parse_query_result_payload(query_result)

    if payload.get("error"):
        raise ValueError(f"Cannot chart errored query result: {payload.get('error')}")

    rows = payload.get("data") or []
    if not isinstance(rows, list):
        raise ValueError("query_result.data must be a list.")
    if not rows:
        return {
            "figure": {"data": [], "layout": {"title": title or "No data to plot"}},
            "rows": 0,
            "message": "Query returned no rows.",
        }

    first_row = rows[0]
    if not isinstance(first_row, dict):
        raise ValueError("query_result.data must be a list of objects.")

    columns = payload.get("columns")
    if not isinstance(columns, list) or not columns:
        columns = list(first_row.keys())
    columns = [str(c) for c in columns]

    if color is not None and color not in columns:
        raise ValueError(f"color column '{color}' not found in result columns: {columns}")

    x_col, y_col = _auto_pick_axes(columns, rows, x, y)
    limited_rows = rows[:max_points]

    mode = "lines" if chart_type == "line" else "markers"
    trace_type = "bar" if chart_type == "bar" else "scatter"

    traces: List[Dict[str, Any]] = []
    if color:
        groups: Dict[str, List[Dict[str, Any]]] = {}
        for row in limited_rows:
            key = str(row.get(color, "null"))
            groups.setdefault(key, []).append(row)

        for group_name, group_rows in groups.items():
            traces.append(
                {
                    "type": trace_type,
                    "mode": mode if trace_type == "scatter" else None,
                    "name": f"{y_col} ({group_name})",
                    "x": [r.get(x_col) for r in group_rows],
                    "y": [r.get(y_col) for r in group_rows],
                }
            )
    else:
        traces.append(
            {
                "type": trace_type,
                "mode": mode if trace_type == "scatter" else None,
                "name": y_col,
                "x": [r.get(x_col) for r in limited_rows],
                "y": [r.get(y_col) for r in limited_rows],
            }
        )

    # Remove null mode for bar traces to keep clean plotly spec
    for t in traces:
        if t.get("type") == "bar":
            t.pop("mode", None)

    figure = {
        "data": traces,
        "layout": {
            "title": title or f"{chart_type.title()} chart of {y_col} vs {x_col}",
            "template": "plotly_white",
            "xaxis": {"title": x_col},
            "yaxis": {"title": y_col},
        },
    }

    return {
        "figure": figure,
        "chart_type": chart_type,
        "x": x_col,
        "y": y_col,
        "color": color,
        "rows": len(rows),
        "rows_plotted": len(limited_rows),
        "rows_truncated": len(rows) > len(limited_rows),
    }


if __name__ == "__main__":
    mcp.run(transport="sse", port=9000)