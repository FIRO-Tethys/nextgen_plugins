import requests
import os
import re
from typing import Dict, Any, Optional
from datetime import datetime, date
from zoneinfo import ZoneInfo
from nextgen_plugins.chatbox.rest import (
    list_available_models,
    list_available_dates,
    list_available_forecasts,
    list_available_cycles,
    list_available_vpus,
    list_available_outputs_files,
    get_output_file,
    query_parquet_output_file,
    query_netcdf_output_file,
    create_plotly_chart_from_parquet_output_file,
    query_hydrofabric_parquet_file,
    build_hydrofabric_feature_map_config
)

NRDS_API_TOKEN = os.getenv("NRDS_API_TOKEN", "be5f936afa81436a43a116546f8c8f1ad2a86079")

REST_API_HOST = os.getenv("NRDS_API_HOST", "http://localhost:8000/apps/nrds/api").rstrip("/")



def _get_json_raw(endpoint_key: str, params: Optional[Dict[str, Any]] = None, **_) -> Dict[str, Any]:
    p = params or {}

    if endpoint_key == "list_available_models":
        return list_available_models()

    if endpoint_key == "list_available_dates":
        return list_available_dates(model=p["model"])

    if endpoint_key == "list_available_forecasts":
        return list_available_forecasts(model=p["model"], date=p["date"])

    if endpoint_key == "list_available_cycles":
        return list_available_cycles(model=p["model"], date=p["date"], forecast=p["forecast"])

    if endpoint_key == "list_available_vpus":
        return list_available_vpus(model=p["model"], date=p["date"], forecast=p["forecast"], cycle=p["cycle"])

    if endpoint_key == "list_available_outputs_files":
        return list_available_outputs_files(data=p)

    if endpoint_key == "get_output_file":
        return get_output_file(
            model=p["model"], date=p["date"], forecast=p["forecast"], cycle=p["cycle"], vpu=p["vpu"],
            file_name=p.get("file_name"), index=p.get("index"), ensemble=p.get("ensemble")
        )

    if endpoint_key == "query_parquet_output_file":
        return query_parquet_output_file(s3_url=p["s3_url"], query=p["query"])

    if endpoint_key == "query_netcdf_output_file":
        return query_netcdf_output_file(s3_url=p["s3_url"], query=p["query"])

    if endpoint_key == "query_hydrofabric_parquet_file":
        return query_hydrofabric_parquet_file(
            hydrofabric_id=p["hydrofabric_id"],
            limit=p["limit"]
        )
    
    if endpoint_key == "create_plotly_chart_from_parquet_output_file":
        return create_plotly_chart_from_parquet_output_file(
            s3_url=p["s3_url"],
            query=p["query"],
            title=p.get("title"),
        )
    if endpoint_key == "build_hydrofabric_feature_map_config":
        return build_hydrofabric_feature_map_config(
            hydrofabric_id=p["hydrofabric_id"], 
        )
    raise KeyError(f"Unknown endpoint_key: {endpoint_key}")


def _headers() -> Dict[str, str]:
    """
        Headers for REST API requests, including auth if token is set.
    """
    h = {"Accept": "application/json"}
    if NRDS_API_TOKEN:
        h["Authorization"] = f"Token {NRDS_API_TOKEN}"
    return h

def _is_html_response(resp: requests.Response) -> bool:
    """
        Heuristic to determine if a response is HTML (e.g., an error page) rather than JSON.
        Checks Content-Type header and also looks for HTML tags in the text.
    """
    ctype = (resp.headers.get("Content-Type") or "").lower()
    if "text/html" in ctype:
        return True
    # some servers mislabel html; quick heuristic
    text = (resp.text or "").lstrip()
    return text.startswith("<!DOCTYPE html") or text.startswith("<html")

def _as_id(value: str) -> str:
    """
    Convert labels to ids for known patterns:
      - forecasts: "short range" -> "short_range"
      - vpu: "VPU 14" -> "VPU_14"
    If already an id, returns unchanged.
    """
    if value is None:
        return value
    s = str(value).strip()
    
    return s.replace(" ", "_")


def _prefer_id_objects(payload: Dict[str, Any], key: str) -> None | Dict[str, Any]:
    """
    Ensure the payload always includes a list of {id,label} objects under `key`,
    plus *_ids and *_labels arrays for convenience, even if API returns legacy.
    """
    items = payload.get(key)

    if isinstance(items, list) and items and isinstance(items[0], dict) and "id" in items[0]:
        ids = [x.get("id") for x in items]
        labels = [x.get("label", x.get("id")) for x in items]
        payload[f"{key[:-1]}_ids" if key.endswith("s") else f"{key}_ids"] = ids
        payload[f"{key[:-1]}_labels" if key.endswith("s") else f"{key}_labels"] = labels
        return payload
    return None
            
DATE_PATTERN = r"^(?:\d{4}-\d{2}-\d{2}|\d{4}/\d{2}/\d{2})$"
DEFAULT_START = "2025-08-01"
DEFAULT_TZ = ZoneInfo("America/Denver")

def _parse_iso_date(s: str) -> date:
    s = s.strip().replace("/", "-")
    return datetime.strptime(s, "%Y-%m-%d").date()

def _date_from_item(d: dict) -> Optional[date]:
    """
    Accepts items shaped like:
      {id:"ngen.YYYYMMDD", label:"YYYY-MM-DD"} or similar.
    """
    label = str(d.get("label") or "")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", label):
        try:
            return _parse_iso_date(label)
        except Exception:
            return None

    did = str(d.get("id") or "")
    m = re.search(r"(\d{8})", did)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y%m%d").date()
        except Exception:
            return None

    return None
