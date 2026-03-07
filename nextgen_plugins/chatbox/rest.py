import fsspec
import os
import pandas as pd
from datetime import datetime
from typing import Dict
from .validators import OutputsFilesQuery
from pydantic import ValidationError
from .utils_rest import (
    _extract_yyyymmdd_from_date_folder,
    _label_from_id,
    _normalize_date_folder,
    _duckdb_query_parquet,
    _duckdb_query_netcdf,
    _get_troute_df
)

BUCKET = os.getenv("BUCKET","ciroh-community-ngen-datastream")
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"
 
def _ensure_full_s3_url(path: str) -> str:
    p = str(path or "").strip()
    if p.startswith(("s3://", "https://")):
        return p
    return f"s3://{p.lstrip('/')}"

def list_available_outputs_files(data) -> Dict:
    """List Outputs for a given model, date, forecast, cycle, and vpu."""
    try:
        q = OutputsFilesQuery.model_validate(data)
    except ValidationError as e:
        return {"errors": e.errors()}
    except ValueError as e:
        return {"errors": [{"msg": str(e)}]}

    model = q.model
    date_folder = _normalize_date_folder(q.date)  # uses normalized YYYY-MM-DD
    forecast = q.forecast
    cycle = q.cycle
    vpu = q.vpu

    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date_folder}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += f"/{q.ensemble}/{vpu}/{NGEN_RUN_PREFIX}"
    else:
        s3_url += f"/{vpu}/{NGEN_RUN_PREFIX}"

    try:
        print(f"🔍 Listing files at {s3_url} ...")
        fs = fsspec.filesystem("s3", anon=True)
        outputs = fs.ls(s3_url, detail=False)
        file_names = [f.split("/troute/")[-1] for f in outputs]
        file_paths = [os.path.join(s3_url, f) for f in file_names]
        files = [{"name": fname, "path": fpath} for fname, fpath in zip(file_names, file_paths)]
        return {"files": files}

    except FileNotFoundError:
        # valid request, just no outputs at that path
        return {"path": s3_url, "files": []}

def get_output_file(model, date, forecast, cycle, vpu, file_name=None, index=None, ensemble=None) -> Dict:
    # build directory like your other endpoints
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
                return {"dir": s3_dir, "count": len(items), "error": f"file_name not found: {file_name}"}
        else:
            # index selection
            if index is None:
                return {"dir": s3_dir, "count": len(items), "error": "Provide file_name or index"}    
                
            try:
                idx = int(index)
            except Exception:
                return {"error": "index must be an integer"}

            if idx < 0 or idx >= len(items):
                return {"dir": s3_dir, "count": len(items), "error": f"index out of range: {idx}"}
            sel = items[idx]

        return {"dir": s3_dir, "count": len(items), "selected": sel}

    except FileNotFoundError:
        return {"dir": s3_dir, "count": 0, "selected": None}

def list_available_vpus(model, date, forecast, cycle) -> Dict:
    """List VPUs for a given model, date, forecast, and cycle."""
    date = _normalize_date_folder(date)
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/{cycle}"
    if forecast == "medium_range":
        s3_url += "/1"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)
        vpu_ids = [d.split("/")[-1] for d in dirs]
        vpu_labels = [_label_from_id(v) for v in vpu_ids]
        # vpus = [{"id": vid, "label": lbl} for vid, lbl in zip(vpu_ids, vpu_labels)]

        return {
                "path": s3_url,
                "vpus": vpu_labels
            }
    except FileNotFoundError:
        return {
                "path": s3_url,
                "vpus": [],
            }

def list_available_cycles(model, date, forecast) -> Dict:
    """List available cycles for a given model, date, and forecast"""
    date = _normalize_date_folder(date)
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/{forecast}/"

    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        cycle_ids = [d.split("/")[-1] for d in dirs]
        cycles = [{"id": c, "label": c} for c in cycle_ids]

        return {
                "path": s3_url,
                "cycles": cycles,
            }
            
        
    except FileNotFoundError:
            return {
                "path": s3_url,
                "cycles": [],
            }

def list_available_forecasts(model, date) -> Dict:
    """List available forecasts for a given model, date"""
    date = _normalize_date_folder(date)
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}/{date}/"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        forecast_ids = [d.split("/")[-1] for d in dirs]
        forecast_labels = [_label_from_id(f) for f in forecast_ids]

        forecasts = [{"id": fid, "label": lbl} for fid, lbl in zip(forecast_ids, forecast_labels)]

        return {
                "path": s3_url,
                "forecasts": forecasts,
            }
    except FileNotFoundError:
        return {
                "path": s3_url,
                "forecasts": [],
            }

def list_available_dates(model) -> Dict:
    """List available dates for a given model"""
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}/{model}/{PREFIX_HYDROFABRIC}"
    try:
        fs = fsspec.filesystem("s3", anon=True)
        dirs = fs.ls(s3_url, detail=False)

        date_ids = [d.split("/")[-1].rstrip("/") for d in dirs]  # e.g. ngen.20260218
        labels = []
        for folder in date_ids:
            yyyymmdd = _extract_yyyymmdd_from_date_folder(folder)
            if yyyymmdd:
                labels.append(datetime.strptime(yyyymmdd, "%Y%m%d").date().isoformat())
            else:
                labels.append(folder)

        sorted_dates = sorted(labels, reverse=True)
        return {
                "path": s3_url,
                "dates": sorted_dates,
            }
    except FileNotFoundError:
        return {
                "path": s3_url,
                "dates": [],
            }

def list_available_models() -> Dict:
    s3_url = f"s3://{BUCKET}/{OUTPUTS_DIR}"
    fs = fsspec.filesystem("s3", anon=True)
    try:
        dirs = fs.ls(s3_url, detail=False)
        model_ids = [d.split("/")[-1] for d in dirs]
        return {"path": s3_url, "models": [{"id": mid, "label": mid} for mid in model_ids]}
    except FileNotFoundError:
        return {"path": s3_url, "models": []}
    
def query_netcdf_output_file(s3_url, query) -> Dict:
    """Run a query against a netcdf output file on S3. Query params depend on the desired query."""
    # For simplicity, we'll just read the whole file and return it here, but this could be extended to support more specific queries if needed.
    file_url = s3_url
    if file_url.startswith("s3://ciroh-community-ngen-datastream"):
        file_url = file_url.replace("s3://ciroh-community-ngen-datastream", "https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com")
 
    if not file_url:
        return {"error": "Missing required query param: s3_url"}
    if not query:
        return {"error": "Missing required query param: query"}

    try:
        initial_df = _get_troute_df(file_url)
        print(f"Initial DataFrame loaded with {len(initial_df)} rows and columns: {initial_df.columns.tolist()}")
        df = _duckdb_query_netcdf(initial_df, query)
        print(f"Query returned {len(df)} rows and columns: {df.columns.tolist()}")
        # Make timestamps JSON-friendly
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        return{
                "file": file_url,
                "query": query,
                "columns": list(df.columns),
                "rows": int(len(df)),
                "data": df.to_dict(orient="records"),
            }
    except FileNotFoundError:
        return {"file": file_url, "query": query, "columns": [], "rows": 0, "data": []}
    except Exception as e:
        return {"file": file_url, "query": query, "error": str(e)}

def query_parquet_output_file(s3_url, query) -> Dict:
    """Run any DuckDB SQL query against a Parquet file on S3 (view name: `output`)."""
    file_url = s3_url
    print(f"Received query request for file: {file_url} with query: {query}")
    if file_url.startswith("s3://ciroh-community-ngen-datastream"):
        file_url = file_url.replace("s3://ciroh-community-ngen-datastream", "https://ciroh-community-ngen-datastream.s3.us-east-1.amazonaws.com")
    

    if not file_url:
        return {"error": "Missing required query param: s3_url"}
    if not query:
        return {"error": "Missing required query param: query"}

    try:
        df = _duckdb_query_parquet(file_url, query)

        # Make timestamps JSON-friendly
        if "time" in df.columns:
            df["time"] = pd.to_datetime(df["time"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        return{
                "file": file_url,
                "query": query,
                "columns": list(df.columns),
                "rows": int(len(df)),
                "data": df.to_dict(orient="records"),
            }
    except FileNotFoundError:
        return {"file": file_url, "query": query, "columns": [], "rows": 0, "data": []}
    except Exception as e:
        return {"file": file_url, "query": query, "error": str(e)}
