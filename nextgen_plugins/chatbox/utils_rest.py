from datetime import datetime
import pandas as pd
import duckdb
import xarray as xr


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

