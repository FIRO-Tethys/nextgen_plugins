# nextgen_plugins/chatbox/rest.py
import fsspec
import os
import json
import logging
import pandas as pd
import plotly.express as px
from plotly.utils import PlotlyJSONEncoder

from datetime import datetime
from typing import Dict, List, Any, Optional
from .validators import OutputsFilesQuery
from pydantic import ValidationError
from .utils_rest import (
    _extract_yyyymmdd_from_date_folder,
    _label_from_id,
    _normalize_date_folder,
    _duckdb_query_parquet,
    _duckdb_query_netcdf,
    _get_troute_df,
    _auto_pick_axes,
    _duckdb_query_hydrofabric_parquet,
    _duckdb_lookup_hydrofabric_feature,
    _normalize_record,
    _get_feature_center,
    _pick_filter_value,
    HYDROFABRIC_LAYER_CONFIG,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

BUCKET = os.getenv("BUCKET","ciroh-community-ngen-datastream")
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"
HYDROFABRIC_INDEX_URL = (
    "https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/hydrofabric_index.parquet"
)

def _ensure_full_s3_url(path: str) -> str:
    p = str(path or "").strip()
    if p.startswith(("s3://", "https://")):
        return p
    return f"s3://{p.lstrip('/')}"

def list_available_output_files(data) -> Dict:
    """List outputs for a given model, date, forecast, cycle, and vpu."""
    logger.info(f"Received request to list available output files with data: {data}")
    try:
        q = OutputsFilesQuery.model_validate(data)
    except ValidationError as e:
        return {"errors": e.errors()}
    except ValueError as e:
        return {"errors": [{"msg": str(e)}]}

    model = q.model
    date_folder = _normalize_date_folder(q.date)
    forecast = q.forecast
    cycle = q.cycle
    vpu = q.vpu

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date_folder}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/{q.ensemble}/{vpu}/{NGEN_RUN_PREFIX}"
    else:
        s3_url += f"/{vpu}/{NGEN_RUN_PREFIX}"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        outputs = fs.ls(s3_url, detail=False)
        outputs = sorted(outputs)

        files = []
        for f in outputs:
            name = f.split("/troute/")[-1]
            path = _ensure_full_s3_url(f)
            files.append(
                {
                    "id": name,
                    "label": name,
                    "name": name,
                    "path": path,
                }
            )

        logger.info(f"Found {len(files)} files at {s3_url}")
        return {
            "path": s3_url,
            "files": files,
        }

    except FileNotFoundError:
        logger.info(f"No files found at {s3_url}")
        return {"path": s3_url, "files": []}

def get_output_file(model, date, forecast, cycle, vpu, file_name=None, index=None, ensemble=None) -> Dict:
    # build directory like your other endpoints
    logger.info(f"Received request to get output file with model={model}, date={date}, forecast={forecast}, cycle={cycle}, vpu={vpu}, file_name={file_name}, index={index}, ensemble={ensemble}")
    date = _normalize_date_folder(date)
    s3_dir = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        ens = ensemble or "1"
        s3_dir += f"/{ens}/{vpu}/{NGEN_RUN_PREFIX}"
    else:
        s3_dir += f"/{vpu}/{NGEN_RUN_PREFIX}"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        files = fs.ls(s3_dir, detail=False)
        
        files = [f for f in files if f.lower().endswith(".parquet") | f.lower().endswith((".nc"))]
        
        files = sorted(files)

        items = [{"name": f.split("/")[-1], "path": _ensure_full_s3_url(f)} for f in files]

        if file_name:
            sel = next((it for it in items if it["name"] == file_name), None)
            if not sel:
                logger.error(f"file_name '{file_name}' not found in {s3_dir}")
                return {"dir": s3_dir, "count": len(items), "error": f"file_name not found: {file_name}"}
        else:
            # index selection
            if index is None:
                logger.error(f"Neither file_name nor index provided to select output file in {s3_dir}")
                return {"dir": s3_dir, "count": len(items), "error": "Provide file_name or index"}    
                
            try:
                idx = int(index)
            except Exception:
                logger.error(f"Invalid index value: {index}. Must be an integer.")
                return {"error": "index must be an integer"}

            if idx < 0 or idx >= len(items):
                logger.error(f"Index out of range: {index}. Must be between 0 and {len(items)-1}.")
                return {"dir": s3_dir, "count": len(items), "error": f"index out of range: {idx}"}
            sel = items[idx]
        logger.info(f"Selected file for retrieval: {sel['name']} at {sel['path']}")
        return {"dir": s3_dir, "count": len(items), "selected": sel}

    except FileNotFoundError:
        logger.info(f"No files found at {s3_dir}")
        return {"dir": s3_dir, "count": 0, "selected": None}

def list_available_vpus(model, date, forecast, cycle) -> Dict:
    """List VPUs for a given model, date, forecast, and cycle."""
    logger.info(f"Listing VPUs for model={model}, date={date}, forecast={forecast}, cycle={cycle}")
    date = _normalize_date_folder(date)
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += "/1"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        vpu_ids = sorted(d.split("/")[-1] for d in dirs)
        vpus = [{"id": vpu_id, "label": _label_from_id(vpu_id)} for vpu_id in vpu_ids]

        logger.info(f"Found VPUs at {s3_url}: {[v['label'] for v in vpus]}")
        return {
            "path": s3_url,
            "vpus": vpus,
        }
    except FileNotFoundError:
        logger.info(f"No VPUs found at {s3_url}")
        return {
            "path": s3_url,
            "vpus": [],
        }

def list_available_cycles(model, date, forecast) -> Dict:
    """List available cycles for a given model, date, and forecast"""
    logger.info(f"Listing cycles for model={model}, date={date}, forecast={forecast}")
    date = _normalize_date_folder(date)
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        cycle_ids = [d.split("/")[-1] for d in dirs]
        cycles = [{"id": c, "label": c} for c in cycle_ids]
        logger.info(f"Found cycles at {s3_url}: {cycle_ids}")
        return {
                "path": s3_url,
                "cycles": cycles,
            }
            
        
    except FileNotFoundError:
            logger.info(f"No cycles found at {s3_url}")
            return {
                "path": s3_url,
                "cycles": [],
            }

def list_available_dates(model) -> Dict:
    """List available dates for a given model."""
    logger.info(f"Listing dates for model={model}")
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        date_ids = [d.split("/")[-1].rstrip("/") for d in dirs]  # e.g. ngen.20260218
        dates = []
        for folder in date_ids:
            yyyymmdd = _extract_yyyymmdd_from_date_folder(folder)
            if yyyymmdd:
                label = datetime.strptime(yyyymmdd, "%Y%m%d").date().isoformat()
            else:
                label = folder

            dates.append({
                "id": folder,
                "label": label,
            })

        dates = sorted(dates, key=lambda x: x["label"], reverse=True)

        logger.info(f"Found dates at {s3_url}: {[d['label'] for d in dates]}")
        return {
            "path": s3_url,
            "dates": dates,
        }
    except FileNotFoundError:
        logger.info(f"No dates found at {s3_url}")
        return {
            "path": s3_url,
            "dates": [],
        }

def list_available_forecasts(model, date) -> Dict:
    """List available forecasts for a given model, date"""
    logger.info(f"Listing forecasts for model={model}, date={date}")
    date = _normalize_date_folder(date)
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        forecast_ids = [d.split("/")[-1] for d in dirs]
        forecast_labels = [_label_from_id(f) for f in forecast_ids]

        forecasts = [{"id": fid, "label": lbl} for fid, lbl in zip(forecast_ids, forecast_labels)]
        logger.info(f"Found forecasts at {s3_url}: {forecast_labels}")
        return {
                "path": s3_url,
                "forecasts": forecasts,
            }
    except FileNotFoundError:
        logger.info(f"No forecasts found at {s3_url}")
        return {
                "path": s3_url,
                "forecasts": [],
            }

def list_available_models() -> Dict:
    logger.info(f"Listing available models in bucket={BUCKET} under {OUTPUTS_DIR}")
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}"
    fs = fsspec.filesystem("s3", anon=True)
    try:
        dirs = fs.ls(s3_url, detail=False)
        model_ids = [d.split("/")[-1] for d in dirs]
        logger.info(f"Found models at {s3_url}: {model_ids}")
        return {"path": s3_url, "models": [{"id": mid, "label": mid} for mid in model_ids]}
    except FileNotFoundError:
        logger.info(f"No models found at {s3_url}")
        return {"path": s3_url, "models": []}
    
def query_netcdf_output_file(s3_url, query) -> Dict:
    """Run a query against a netcdf output file on S3. Query params depend on the desired query."""
    logger.info(f"Received request to query NetCDF file at {s3_url} with query: {query}")    
    file_url = s3_url
    if file_url.startswith("s3://ciroh-community-ngen-datastream"):
        file_url = file_url.replace("s3://ciroh-community-ngen-datastream", "https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com")
 
    if not file_url:
        logger.error("Missing required query param: s3_url")
        return {"error": "Missing required query param: s3_url"}
    if not query:
        logger.error("Missing required query param: query")
        return {"error": "Missing required query param: query"}

    try:
        initial_df = _get_troute_df(file_url)
        logger.info(f"Initial DataFrame loaded with {len(initial_df)} rows and columns: {initial_df.columns.tolist()}")
        df = _duckdb_query_netcdf(initial_df, query)
        # Make timestamps JSON-friendly
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        logger.info(f"Query returned {len(df)} rows and columns: {df.columns.tolist()}")
        return{
                "file": file_url,
                "query": query,
                "columns": list(df.columns),
                "rows": int(len(df)),
                "data": df.to_dict(orient="records"),
            }
    except FileNotFoundError:
        logger.error(f"File not found: {file_url}")
        return {"file": file_url, "query": query, "columns": [], "rows": 0, "data": []}
    except Exception as e:
        logger.error(f"Error querying NetCDF file: {e}")
        return {"file": file_url, "query": query, "error": str(e)}

def query_parquet_output_file(s3_url, query) -> Dict:
    """Run any DuckDB SQL query against a Parquet file on S3 (view name: `output`)."""
    file_url = s3_url
    logger.info(f"Received query request for file: {file_url} with query: {query}")
    if file_url.startswith("s3://ciroh-community-ngen-datastream"):
        file_url = file_url.replace("s3://ciroh-community-ngen-datastream", "https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com")

    if not file_url:
        logger.error("Missing required query param: s3_url")
        return {"error": "Missing required query param: s3_url"}
    if not query:
        logger.error("Missing required query param: query")
        return {"error": "Missing required query param: query"}

    try:
        df = _duckdb_query_parquet(file_url, query)

        # Make timestamps JSON-friendly
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        logger.info(f"Query returned {len(df)} rows and columns: {df.columns.tolist()}")
        return{
                "file": file_url,
                "query": query,
                "columns": list(df.columns),
                "rows": int(len(df)),
                "data": df.to_dict(orient="records"),
            }
    except FileNotFoundError:
        logger.error(f"File not found: {file_url}")
        return {"file": file_url, "query": query, "columns": [], "rows": 0, "data": []}
    except Exception as e:
        logger.error(f"Error querying Parquet file: {e}")
        return {"file": file_url, "query": query, "error": str(e)}

def create_plotly_chart_from_parquet_output_file(s3_url, query, title: str) -> Dict:
    """Run a query against an output file on S3 and return a Plotly chart JSON based on the results."""
    logger.info(f"Received request to create Plotly chart from file: {s3_url} with query: {query}")
    file_url = s3_url
    logger.info(f"Received query request for file: {file_url} with query: {query}")
    if file_url.startswith("s3://ciroh-community-ngen-datastream"):
        file_url = file_url.replace("s3://ciroh-community-ngen-datastream", "https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com")

    if not file_url:
        logger.error("Missing required query param: s3_url")
        return {"error": "Missing required query param: s3_url"}
    if not query:
        logger.error("Missing required query param: query")
        return {"error": "Missing required query param: query"}

    try:
        df = _duckdb_query_parquet(file_url, query)

        # Make timestamps JSON-friendly
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        logger.info(f"Chart returned {len(df)} rows and columns: {df.columns.tolist()}")
        fig = _create_plotly_chart(
            df=df,
            title=title,
        )
        return {
                "figure": fig,
            }
        
    except FileNotFoundError:
        logger.error(f"File not found: {file_url}")
        return {"file": file_url, "query": query, "columns": [], "rows": 0, "data": []}
    except Exception as e:
        logger.error(f"Error querying Parquet file: {e}")
        return {"file": file_url, "query": query, "error": str(e)}

def _create_plotly_chart(
    df: pd.DataFrame,
    title: str,
) -> Dict[str, Any]:
    logger.info(
        f"Creating Plotly chart from data"
    )
    logger.info(f"DataFrame has {len(df)} rows and columns: {df.columns.tolist()}")
    columns = df.columns.tolist()
    if len(columns) < 2:
        logger.error("Not enough columns in query result to create a chart. Need at least 2.")
        return {"error": "Not enough columns in query result to create a chart. Need at least 2."}
    x, y = _auto_pick_axes(columns)
    fig = px.line(
        df,
        x=x,
        y=y,
        title=title,
    )

    fig.update_layout(template="plotly_white")
    return json.loads(json.dumps(fig.to_plotly_json(), cls=PlotlyJSONEncoder))

def query_hydrofabric_parquet_file(hydrofabric_id: str, limit: int = 50) -> Dict:
    """Run a hydrofabric id lookup against the hydrofabric parquet file on S3."""
    logger.info(
        "Received request to query hydrofabric with hydrofabric_id=%s limit=%s",
        hydrofabric_id,
        limit,
    )

    hydrofabric_id = (hydrofabric_id or "").strip()
    if not hydrofabric_id:
        return {
            "file": HYDROFABRIC_INDEX_URL,
            "hydrofabric_id": hydrofabric_id,
            "columns": [],
            "rows": 0,
            "data": [],
            "error": "hydrofabric_id is required",
        }

    try:
        df = _duckdb_query_hydrofabric_parquet(hydrofabric_id=hydrofabric_id, limit=limit)
        logger.info(
            "Hydrofabric query returned %s rows and columns: %s",
            len(df),
            df.columns.tolist(),
        )
        return {
            "file": HYDROFABRIC_INDEX_URL,
            "hydrofabric_id": hydrofabric_id,
            "columns": list(df.columns),
            "rows": int(len(df)),
            "data": df.to_dict(orient="records"),
        }
    except FileNotFoundError:
        logger.error("File not found: %s", HYDROFABRIC_INDEX_URL)
        return {
            "file": HYDROFABRIC_INDEX_URL,
            "hydrofabric_id": hydrofabric_id,
            "columns": [],
            "rows": 0,
            "data": [],
        }
    except Exception as e:
        logger.error("Error querying hydrofabric parquet file: %s", e)
        return {
            "file": HYDROFABRIC_INDEX_URL,
            "hydrofabric_id": hydrofabric_id,
            "error": str(e),
        }

def build_hydrofabric_feature_map_config(hydrofabric_id: str) -> Dict[str, Any]:
    hydrofabric_id = (hydrofabric_id or "").strip()
    if not hydrofabric_id:
        return {
            "type": "hydrofabric_feature_map_config",
            "error": "hydrofabric_id is required",
        }

    try:
        df = _duckdb_lookup_hydrofabric_feature(hydrofabric_id)
        if df.empty:
            return {
                "type": "hydrofabric_feature_map_config",
                "query": hydrofabric_id,
                "found": False,
                "error": f"No hydrofabric feature found for '{hydrofabric_id}'",
            }

        row = _normalize_record(df.iloc[0].to_dict())
        layer_key = str(row.get("layer") or "").strip().lower()

        layer_cfg = HYDROFABRIC_LAYER_CONFIG.get(layer_key)
        if not layer_cfg:
            return {
                "type": "hydrofabric_feature_map_config",
                "query": hydrofabric_id,
                "found": True,
                "feature": row,
                "error": f"Unsupported hydrofabric layer '{layer_key}'",
            }

        center = _get_feature_center(row)
        id_property = layer_cfg["id_property"]
        filter_value = _pick_filter_value(row, id_property, hydrofabric_id)

        return {
            "type": "hydrofabric_feature_map_config",
            "query": hydrofabric_id,
            "found": True,
            "feature": row,
            "match": {
                "matched_column": row.get("matched_column"),
                "match_type": row.get("match_type"),
            },
            "highlight": {
                "pmtiles_url": layer_cfg["pmtiles_url"],
                "map_layer_id": layer_cfg["map_layer_id"],
                "id_property": id_property,
                "value": filter_value,
                "layer_key": layer_key,
            },
            "camera": {
                "mode": "rendered-feature-bounds-with-fallback",
                "center": center,
                "zoom": layer_cfg["default_zoom"],
                "padding": 40,
                "maxZoom": 13,
            },
        }

    except Exception as e:
        logger.exception("Error building hydrofabric map config")
        return {
            "type": "hydrofabric_feature_map_config",
            "query": hydrofabric_id,
            "error": str(e),
        }
