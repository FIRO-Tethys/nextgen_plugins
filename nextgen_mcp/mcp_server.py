from typing import Optional, Dict, Any, List
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
    MODELS,
    MEDIUM_RANGE_CYCLES,
    SHORT_RANGE_CYCLES,
    ANALYSIS_ASSIM_EXTEND_CYCLES,
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

# @mcp.tool(
#     name="list_available_outputs_files_short_range",
#     description="List available output files for short_range (hourly) forecast. cycle must be 00-23.",
# )
# def list_available_outputs_files_short_range_tool(
#     model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
#     date: Annotated[
#         Optional[str],
#         Field(
#             description="YYYY-MM-DD or YYYY/MM/DD",
#             pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
#         ),
#     ] = None,
#     cycle: Annotated[SHORT_RANGE_CYCLES, Field(description="Hourly cycle for short_range (00-23)")] = "00",
#     vpu: Annotated[VPUS, Field(description="VPU id")] = "VPU_6",
# ) -> Dict[str, Any]:
#     end_date = _parse_date_or_today(date, "date")
#     params: Dict[str, Any] = {
#         "model": model,
#         "date": end_date,
#         "forecast": "short_range",
#         "cycle": cycle,
#         "vpu": _as_id(vpu),
#     }
#     return _get_json_raw("list_available_outputs_files", params=params)


# @mcp.tool(
#     name="list_available_outputs_files_medium_range",
#     description="List available output files for medium_range (6-hourly) forecast. cycle must be 00/06/12/18. Uses ensemble=1 (first member).",
# )
# def list_available_outputs_files_medium_range_tool(
#     model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
#     date: Annotated[
#         Optional[str],
#         Field(
#             description="YYYY-MM-DD or YYYY/MM/DD",
#             pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
#         ),
#     ] = None,
#     cycle: Annotated[MEDIUM_RANGE_CYCLES, Field(description="6-hourly cycle for medium_range (00/06/12/18)")] = "00",
#     vpu: Annotated[VPUS, Field(description="VPU id")] = "VPU_6",
# ) -> Dict[str, Any]:
#     end_date = _parse_date_or_today(date, "date")
#     params: Dict[str, Any] = {
#         "model": model,
#         "date": end_date,
#         "forecast": "medium_range",
#         "cycle": cycle,
#         "vpu": _as_id(vpu),
#     }
#     return _get_json_raw("list_available_outputs_files", params=params)


# @mcp.tool(
#     name="list_available_outputs_files_analysis_assim_extend",
#     description="List available output files for analysis_assim_extend forecast. cycle is always 16.",
# )
# def list_available_outputs_files_analysis_assim_extend_tool(
#     model: Annotated[MODELS, Field(description="Model id")] = "cfe_nom",
#     date: Annotated[
#         Optional[str],
#         Field(
#             description="YYYY-MM-DD or YYYY/MM/DD",
#             pattern=r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$",
#         ),
#     ] = None,
#     cycle: Annotated[
#         ANALYSIS_ASSIM_EXTEND_CYCLES, Field(description="Only valid cycle for analysis_assim_extend is 16")
#     ] = "16",
#     vpu: Annotated[VPUS, Field(description="VPU id")] = "VPU_6",
# ) -> Dict[str, Any]:
#     end_date = _parse_date_or_today(date, "date")
#     params: Dict[str, Any] = {
#         "model": model,
#         "date": end_date,
#         "forecast": "analysis_assim_extend",
#         "cycle": cycle,
#         "vpu": _as_id(vpu),
#     }
#     return _get_json_raw("list_available_outputs_files", params=params)

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


if __name__ == "__main__":
    mcp.run(transport="sse", port=9000)