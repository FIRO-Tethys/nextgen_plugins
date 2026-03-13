from datetime import datetime
from typing import Any, Dict, List, Optional
import json
import ast
import pandas as pd
import duckdb
import xarray as xr
from shapely import wkb, wkt
from shapely.geometry import shape


HYDROFABRIC_INDEX_URL = (
    "https://communityhydrofabric.s3.us-east-1.amazonaws.com/map/hydrofabric_index.parquet"
)

def _load_geometry(value):
    if value is None:
        return None

    if isinstance(value, (bytes, bytearray, memoryview)):
        return wkb.loads(bytes(value))

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.startswith("{"):
            return shape(json.loads(text))
        return wkt.loads(text)

    return value


def _lookup_flowpath_view(feature_id: str) -> dict:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")

    row = con.execute(
        """
        SELECT *
        FROM read_parquet(?)
        WHERE id = ?
        LIMIT 1
        """,
        [HYDROFABRIC_INDEX_URL, feature_id],
    ).fetchone()

    if not row:
        return {"bbox": None, "center": None, "zoom": None}

    geom = _load_geometry(row[1])
    if geom is None:
        return {"bbox": None, "center": None, "zoom": None}

    minx, miny, maxx, maxy = geom.bounds
    center = [(minx + maxx) / 2.0, (miny + maxy) / 2.0]

    return {
        "bbox": [[minx, miny], [maxx, maxy]],
        "center": center,
        "zoom": 12,
    }

def _strip_markdown_code_fence(text: str) -> str:
    s = (text or "").strip()
    if not s.startswith("```"):
        return s

    lines = s.splitlines()
    if lines and lines[0].lstrip().startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _extract_first_json_object(text: str) -> Dict[str, Any] | None:
    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
        except Exception:
            continue
        if isinstance(obj, dict):
            return obj
    return None


def _parse_query_result_payload(query_result: Dict[str, Any] | str) -> Dict[str, Any]:
    if isinstance(query_result, dict):
        return query_result
    if isinstance(query_result, str):
        s = _strip_markdown_code_fence(query_result)
        if not s:
            raise ValueError("query_result string is empty.")

        try:
            payload = json.loads(s)
            if isinstance(payload, dict):
                return payload
        except Exception:
            payload = None

        payload = _extract_first_json_object(s)
        if isinstance(payload, dict):
            return payload

        try:
            payload = ast.literal_eval(s)
            if isinstance(payload, dict):
                return payload
        except Exception:
            pass

    raise ValueError("query_result must be a JSON object or JSON object string.")


def _is_numeric_value(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _coerce_rows_to_records(rows: List[Any], columns: Any) -> Optional[List[Dict[str, Any]]]:
    if not rows:
        return []
    if isinstance(rows[0], dict):
        return rows  # type: ignore[return-value]

    if all(isinstance(r, (list, tuple)) for r in rows):
        col_names = [str(c) for c in columns] if isinstance(columns, list) else []
        max_width = max(len(r) for r in rows)
        if len(col_names) < max_width:
            col_names.extend(f"col_{i+1}" for i in range(len(col_names), max_width))
        if not col_names:
            col_names = [f"col_{i+1}" for i in range(max_width)]

        return [
            {col_names[i]: (r[i] if i < len(r) else None) for i in range(len(col_names))}
            for r in rows
        ]

    if all(not isinstance(r, (dict, list, tuple)) for r in rows):
        col_name = str(columns[0]) if isinstance(columns, list) and columns else "value"
        return [{col_name: r} for r in rows]

    return None


def _auto_pick_axes(columns: List[str]) -> tuple[str, str]:
    if not columns:
        raise ValueError("No columns available to infer x/y axes.")

    picked_x = next((col for col in columns if "time" in col.lower()), None)
    picked_y = next((col for col in columns if col != picked_x and col != "feature_id"), None)
    if not picked_y:
        raise ValueError("Could not infer a y-axis column different from x-axis and 'feature_id'.")
    if not picked_x:
        raise ValueError("Could not infer an x-axis column.")
    return (picked_x, picked_y)


def _get_troute_df(s3_nc_url: str) -> pd.DataFrame:
    """Load the t-route crosswalk DataFrame."""

    nc_xarray = xr.open_dataset(
        s3_nc_url,
        engine="h5netcdf"
    )
    nc_df = nc_xarray.to_dataframe()
    nc_df = nc_df.reset_index()

    return nc_df


def _duckdb_query_parquet(file_url: str, query: str) -> pd.DataFrame:
    """Execute an arbitrary DuckDB query against a parquet file exposed as temp view `output`."""
    safe_file_url = file_url.replace("'", "''")

    con = duckdb.connect(database=":memory:")
    try:
        try:
            con.execute("LOAD httpfs")
        except Exception:
            con.execute("INSTALL httpfs")
            con.execute("LOAD httpfs")

        con.execute(f"CREATE OR REPLACE TEMP VIEW output AS SELECT * FROM read_parquet('{safe_file_url}')")
        return con.sql(query).df()
    finally:
        try:
            con.close()
        except Exception:
            pass

def _duckdb_query_netcdf(df: pd.DataFrame , query: str) -> pd.DataFrame:
    """Execute an arbitrary DuckDB query against a netcdf file exposed as temp view `output`."""
    
    con = duckdb.connect(database=":memory:")
    con.register('tmp_table_nc', df)
    try:
        con.execute(f"CREATE OR REPLACE TEMP VIEW output AS SELECT * FROM tmp_table_nc")
        return con.sql(query).df()
    finally:
        try:
            con.close()
        except Exception:
            pass

def _normalize_date_yyyymmdd(date_str: str | None) -> str | None:
    """Normalize a date string to YYYYMMDD.

    Accepts:
      - YYYYMMDD
      - YYYY-MM-DD
      - YYYY/MM/DD
    """
    if not date_str:
        return None

    s = str(date_str).strip()
    if len(s) == 8 and s.isdigit():
        return s

    s = s.replace("/", "-")
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%Y%m%d")
    except ValueError:
        return None


def _normalize_date_folder(date_str: str | None, *, default_prefix: str = "ngen") -> str | None:
    """Normalize a date folder name for the S3 layout.

    The datastream commonly uses folders like: ngen.YYYYMMDD

    Accepts:
      - ngen.YYYYMMDD
      - ngen.YYYY-MM-DD
      - ngen.YYYY/MM/DD
      - YYYYMMDD / YYYY-MM-DD / YYYY/MM/DD (prefix added)
    """
    if not date_str:
        return None

    s = str(date_str).strip()
    if "." in s:
        prefix, tail = s.split(".", 1)
        yyyymmdd = _normalize_date_yyyymmdd(tail)
        return f"{prefix}.{yyyymmdd}" if yyyymmdd else None

    yyyymmdd = _normalize_date_yyyymmdd(s)
    return f"{default_prefix}.{yyyymmdd}" if yyyymmdd else None


def _extract_yyyymmdd_from_date_folder(folder: str) -> str | None:
    """Extract YYYYMMDD from a folder like 'ngen.20260127'."""
    if not folder:
        return None
    base = folder.strip().rstrip("/")
    if "." in base:
        _, tail = base.split(".", 1)
        return _normalize_date_yyyymmdd(tail)
    return _normalize_date_yyyymmdd(base)


def _label_from_id(value: str) -> str:
    """Default label: replace underscores with spaces."""
    return value.replace("_", " ")

