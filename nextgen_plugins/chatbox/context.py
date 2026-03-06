import urllib.request
import urllib.error
import os
import json
import logging

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
MAX_TOOL_ITEMS_IN_CONTEXT = int(os.getenv("MCP_TOOL_CONTEXT_MAX_ITEMS", "50"))
LOGGER = logging.getLogger("nrds.client")

def _get_context_length_from_ps(model_name: str) -> int | None:
    """Returns current context_length for the running model from /api/ps."""
    url = f"{OLLAMA_HOST}/api/ps"
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            payload = json.load(resp)
    except Exception:
        return None

    models = payload.get("models") or []
    if not isinstance(models, list):
        return None

    # match exact first
    for m in models:
        if not isinstance(m, dict):
            continue
        if m.get("name") == model_name or m.get("model") == model_name:
            cl = m.get("context_length")
            return int(cl) if isinstance(cl, (int, float)) else None

    # fallback match by base name (before :)
    base = model_name.split(":", 1)[0]
    for m in models:
        if not isinstance(m, dict):
            continue
        n = str(m.get("name") or "")
        mo = str(m.get("model") or "")
        if n.split(":", 1)[0] == base or mo.split(":", 1)[0] == base:
            cl = m.get("context_length")
            return int(cl) if isinstance(cl, (int, float)) else None

    return None


def _print_context_usage(resp: dict, model_name: str):
    """Log token/context usage after each Ollama response."""
    prompt_tokens = resp.get("prompt_eval_count")
    out_tokens = resp.get("eval_count")

    # These fields are present on non-streaming /api/chat responses
    prompt_tokens = int(prompt_tokens) if isinstance(prompt_tokens, (int, float)) else None
    out_tokens = int(out_tokens) if isinstance(out_tokens, (int, float)) else 0

    total_ctx = _get_context_length_from_ps(model_name)

    if total_ctx and prompt_tokens is not None:
        left_after_prompt = max(total_ctx - prompt_tokens, 0)
        used_now = prompt_tokens + out_tokens
        left_now = max(total_ctx - used_now, 0)
        LOGGER.debug(
            f"🧠 Context: prompt {prompt_tokens}/{total_ctx} (left {left_after_prompt}); "
            f"output {out_tokens}; total {used_now}/{total_ctx} (left {left_now})"
        )
    elif prompt_tokens is not None:
        LOGGER.debug("🧠 Tokens: prompt %s; output %s", prompt_tokens, out_tokens)


def _compact_tool_result_for_context(tool_result, max_items: int = MAX_TOOL_ITEMS_IN_CONTEXT):
    def _first_path(payload) -> str | None:
        if not isinstance(payload, dict):
            return None

        selected = payload.get("selected")
        if isinstance(selected, dict):
            p = selected.get("path")
            if isinstance(p, str) and p:
                return p

        for key in ("file", "path"):
            p = payload.get(key)
            if isinstance(p, str) and p:
                return p

        for list_key in ("files", "items"):
            values = payload.get(list_key)
            if isinstance(values, list):
                for item in values:
                    if isinstance(item, dict):
                        p = item.get("path")
                        if isinstance(p, str) and p:
                            return p
        return None

    if isinstance(tool_result, dict):
        compact = dict(tool_result)

        # Keep errors untouched.
        if compact.get("error"):
            return compact

        # Trim large array fields commonly returned by list/query tools.
        for key in ("data", "files", "models", "dates", "forecasts", "cycles", "vpus"):
            value = compact.get(key)
            if isinstance(value, list) and len(value) > max_items:
                compact[key] = value[:max_items]
                compact[f"{key}_truncated"] = True
                compact[f"{key}_total"] = len(value)

        # Preserve path signals that are important for multi-step chaining.
        selected_path = _first_path(compact)
        if selected_path:
            compact["selected_path"] = selected_path
            if "selected" not in compact:
                compact["selected"] = {"path": selected_path}

        files = compact.get("files")
        if isinstance(files, list):
            compact.setdefault("files_total", len(files))
        return compact

    if isinstance(tool_result, list) and len(tool_result) > max_items:
        compact_list = {
            "items": tool_result[:max_items],
            "items_truncated": True,
            "items_total": len(tool_result),
        }
        if compact_list["items"] and isinstance(compact_list["items"][0], dict):
            p = compact_list["items"][0].get("path")
            if isinstance(p, str) and p:
                compact_list["selected_path"] = p
                compact_list["selected"] = {"path": p}
        return compact_list

    return tool_result
