from typing import Optional, List, Dict, Any
import ast
import re
import json
from .messages_chat import AUTO_FIX_SYSTEM_MSG, FILE_MSG

URL_RE = re.compile(r"(https?://\S+|s3://\S+)", re.IGNORECASE)

# matches filenames like troute_output_YYYYMMDDHHMM.parquet
_PARQUET_NAME_RE = re.compile(r"\b([A-Za-z0-9._-]+\.parquet)\b", re.IGNORECASE)

# capture the first FROM target token (simple queries)
_FROM_TARGET_RE = re.compile(r"(?is)\bfrom\s+([^\s;]+)")

def _bump_failed_signature_counts(counts: dict[str, int], signatures: list[str]) -> str | None:
    repeated = None
    for sig in signatures:
        counts[sig] = counts.get(sig, 0) + 1
        if counts[sig] >= 2:
            repeated = sig
    return repeated

def _as_dict(obj):
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()
        except Exception:
            pass
    if hasattr(obj, "dict"):
        try:
            return obj.dict()
        except Exception:
            pass
    return {}

def _is_plausible_outputs_file(u: str) -> bool:
    if not isinstance(u, str):
        return False
    ul = u.lower()
    return (
        ul.startswith(("s3://", "https://"))
        and "/outputs/" in ul
        and ul.endswith((".parquet", ".nc", ".nc4"))
    )

def _last_tool_file_url(messages, exts=(".parquet", ".nc", ".nc4")) -> str | None:
    def _valid_url(url: str) -> bool:
        if not isinstance(url, str):
            return False
        ul = url.lower()
        return ul.startswith(("s3://", "https://")) and ul.endswith(exts)

    def _from_payload(payload) -> str | None:
        if isinstance(payload, dict):
            for key in ("file", "path"):
                v = payload.get(key)
                if isinstance(v, str) and _valid_url(v):
                    return v
            selected = payload.get("selected")
            if isinstance(selected, dict):
                v = selected.get("path")
                if isinstance(v, str) and _valid_url(v):
                    return v
            for list_key in ("files", "items"):
                values = payload.get(list_key)
                if isinstance(values, list):
                    for item in values:
                        if isinstance(item, dict):
                            v = item.get("path")
                            if isinstance(v, str) and _valid_url(v):
                                return v
        return None

    for m in reversed(messages):
        if not isinstance(m, dict) or m.get("role") != "tool":
            continue
        content = m.get("content")
        payload = content
        if isinstance(content, str):
            try:
                payload = json.loads(content)
            except Exception:
                payload = None
        found = _from_payload(payload)
        if found:
            return found
    return None


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


def _coerce_json_object(value: Any) -> Dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if not isinstance(value, str):
        return None

    s = _strip_markdown_code_fence(value)
    if not s:
        return None

    try:
        parsed = json.loads(s)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    parsed = _extract_first_json_object(s)
    if isinstance(parsed, dict):
        return parsed

    try:
        parsed = ast.literal_eval(s)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    return None


def _last_query_tool_payload(messages) -> Dict[str, Any] | None:
    query_tools = {"query_parquet_output_file", "query_netcdf_output_file"}
    for m in reversed(messages):
        if not isinstance(m, dict) or m.get("role") != "tool":
            continue
        if m.get("tool_name") not in query_tools:
            continue
        payload = _coerce_json_object(m.get("content"))
        if isinstance(payload, dict):
            return payload
    return None


def _normalize_plotly_chart_tool_args(
    args: Any,
    messages,
    fallback_query_result: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    if isinstance(args, str):
        parsed = _coerce_json_object(args)
        args = parsed if isinstance(parsed, dict) else {"query_result": args}
    elif not isinstance(args, dict):
        args = {}

    cleaned: Dict[str, Any] = {}
    for key in ("chart_type", "x", "y", "color", "title", "max_points"):
        value = args.get(key)
        if value is None or value == "":
            continue
        cleaned[key] = value

    max_points = cleaned.get("max_points")
    if isinstance(max_points, str):
        try:
            cleaned["max_points"] = int(max_points.strip())
        except Exception:
            cleaned.pop("max_points", None)

    query_result_candidate = args.get("query_result")
    if query_result_candidate is None:
        for alt in ("result", "payload", "query_payload", "query_response", "query_data", "data"):
            if alt in args and args.get(alt) is not None:
                query_result_candidate = args.get(alt)
                break

    coerced_query_result = _coerce_json_object(query_result_candidate)
    if coerced_query_result is None and isinstance(fallback_query_result, dict):
        coerced_query_result = fallback_query_result
    if coerced_query_result is None:
        coerced_query_result = _last_query_tool_payload(messages)

    if isinstance(coerced_query_result, dict):
        cleaned["query_result"] = coerced_query_result
    elif query_result_candidate is not None:
        cleaned["query_result"] = query_result_candidate

    return cleaned


def _maybe_join_dir_and_filename(s3_url: str, query: str) -> str:
    """
    If the model put a directory in s3_url and a filename in the SQL,
    join them to produce a full file path.
    """
    if not isinstance(s3_url, str) or not isinstance(query, str):
        return s3_url
    if s3_url.lower().endswith(".parquet"):
        return s3_url
    if s3_url.endswith("/"):
        m = _PARQUET_NAME_RE.search(query)
        if m:
            return s3_url.rstrip("/") + "/" + m.group(1)
    return s3_url

def _rewrite_from_to_output(query: str) -> str:
    """
    Rewrite SQL that points FROM a file path back to FROM output.
    The backend creates a temp view named output for file queries.
    """
    if not isinstance(query, str) or not query.strip():
        return query

    m = _FROM_TARGET_RE.search(query)
    if not m:
        return query

    target = m.group(1).strip().rstrip(",")
    target_unquoted = target.strip("'\"`")

    # Don't touch function calls like read_parquet(...)
    if target.lower().startswith(("read_parquet", "parquet_scan", "read_csv", "read_json")):
        return query

    if target_unquoted.lower() == "output":
        return query

    if "://" in target_unquoted or target_unquoted.lower().endswith((".parquet", ".nc", ".nc4")):
        return _FROM_TARGET_RE.sub("FROM output", query, count=1)

    return query


def extract_file_url(text: str) -> Optional[str]:
    m = URL_RE.search(text or "")
    if not m:
        return None
    return m.group(1).rstrip(").,;]}>\"'")


def file_kind(url: str) -> Optional[str]:
    if not url:
        return None
    u = url.lower()
    if u.endswith(".parquet"):
        return "parquet"
    if u.endswith(".nc"):
        return "netcdf"
    return None


def extract_inline_tool_calls(text: str) -> List[Dict[str, Any]]:
    """
    Fallback: some models return tool calls in plain text like:
      {"name": "...", "parameters": {...}} or {"name": "...", "args": {...}}
    Convert to Ollama-like tool_calls structure:
      [{"function":{"name": "...", "arguments": {...}}}]
    """
    if not text:
        return []

    decoder = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[i:])
        except Exception:
            continue

        if not isinstance(obj, dict):
            continue

        name = obj.get("name") or obj.get("tool") or obj.get("tool_name")
        args = obj.get("parameters") or obj.get("arguments") or obj.get("params") or obj.get("args")

        if isinstance(name, str) and name and (isinstance(args, dict) or isinstance(args, str)):
            return [{"function": {"name": name, "arguments": args}}]

    return []


def _normalize_query_tool_args(tool_name: str, args: Any) -> Any:
    if not isinstance(args, dict):
        return args

    # Tools we want to strictly sanitize
    query_tools = {"query_parquet_output_file", "query_netcdf_output_file"}

    # ---- query tools: keep ONLY (s3_url, query), and try to repair folder+filename ----
    if tool_name in query_tools:
        # If model passed folder path + files_names, combine to full file URL
        s3_url = args.get("s3_url")
        fname = args.get("files_names") or args.get("file_name") or args.get("filename")
        if isinstance(s3_url, str) and fname and not s3_url.lower().endswith((".parquet", ".nc", ".nc4")):
            args["s3_url"] = s3_url.rstrip("/") + "/" + str(fname).lstrip("/")

        # Drop everything except schema keys
        args = {k: args[k] for k in ("s3_url", "query") if k in args}
        return args

    return args

def generate_auto_fix_tool_msg(
    last_err: str,
    prior_user_text: str = "",
    repeated_signature: Optional[str] = None,
) -> Dict[str, Any]:
    err_low = (last_err or "").lower()
    chain_hints: List[str] = []

    if (
        "s3_url" in err_low
        and ("pattern" in err_low or "validation error" in err_low or ".parquet" in err_low or ".nc" in err_low)
    ) or "provide one parquet s3_url" in err_low:
        chain_hints.append(
            "Your previous query tool call used an invalid file URL. "
            "If you do not already have a full file URL, call a prerequisite tool first: "
            "resolve_output_file (preferred for ordinal output-file requests) "
            "or list_available_outputs_files. "
            "Then call query_* with one full file URL ending in .parquet or .nc/.nc4 "
            "(not a directory)."
        )

    if repeated_signature:
        chain_hints.append(
            "You repeated the same failing tool call arguments. "
            "Do not repeat them. Call a prerequisite tool first, then issue a corrected query tool call."
        )

    user_focus = ""
    if prior_user_text:
        user_focus = f"Original user request:\n{prior_user_text}\n\n"

    chain_hint_block = ""
    if chain_hints:
        chain_hint_block = "Chain guidance:\n" + "\n".join(f"- {h}" for h in chain_hints) + "\n\n"

    return {
        "role": "user",
        "content": (
            "Previous tool call failed with:\n"
            f"{last_err}\n\n"
            f"{user_focus}"
            f"{chain_hint_block}"
            f"{AUTO_FIX_SYSTEM_MSG}"
            )
    }

def generate_file_msg(file_url: str, file_type: str) -> Dict[str, Any]:
    mcp_tool_command = "Detected file URL, but could not determine file type. Please check the URL and try again. \n"
    if file_type == "netcdf":
        mcp_tool_command = "Call query_netcdf_output_file with args exactly: \n"
    elif file_type == "parquet":
        mcp_tool_command = "Call query_parquet_output_file with args exactly: \n"
    else:
        mcp_tool_command = "Detected file URL, but could not determine file type. Please check the URL and try again.\n"
    return {
        "role": "user",
        "content": (
            f"Detected file URL: {file_url} ({file_type}). \n"
            f"{mcp_tool_command}"
            f"{FILE_MSG}"
        )
    }

def _get_message(resp):
    if isinstance(resp, dict):
        return resp.get("message", {}) or {}
    m = getattr(resp, "message", None)
    if m is None:
        return {}
    if isinstance(m, dict):
        return m
    if hasattr(m, "model_dump"):
        return m.model_dump()
    if hasattr(m, "dict"):
        return m.dict()
    return {
        "content": getattr(m, "content", ""),
        "tool_calls": getattr(m, "tool_calls", None),
        "thinking": getattr(m, "thinking", None),
    }
def _tool_call_signature(tool_name: str, args: dict) -> str:
    try:
        args_blob = json.dumps(args, sort_keys=True, ensure_ascii=False)
    except Exception:
        args_blob = str(args)
    return f"{tool_name}|{args_blob}"


def _tool_error_text(tool_result) -> str | None:
    if isinstance(tool_result, dict):
        err = tool_result.get("error")
        if err:
            return str(err)

    if isinstance(tool_result, str):
        low = tool_result.lower()
        if any(
            token in low
            for token in (
                "validation error",
                "error calling tool",
                "unknown tool",
                "httperror",
                "traceback",
                "server error",
                "failed",
            )
        ):
            return tool_result

    return None
