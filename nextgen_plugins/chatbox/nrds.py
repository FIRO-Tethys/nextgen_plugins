from intake.source import base
import json
import os
import logging
import ollama
import asyncio
import time
from fastmcp import Client as MCPClient
from fastmcp.client.transports import SSETransport
from typing import Dict, Any, Optional
from .client_utils import (
    extract_file_url,
    file_kind,
    extract_inline_tool_calls,
    _normalize_query_tool_args,
    generate_auto_fix_tool_msg,
    generate_file_msg,
    _rewrite_from_to_output,
    _maybe_join_dir_and_filename,
    _is_plausible_outputs_file,
    _last_tool_file_url,
    _get_message,
    _tool_error_text,
    _tool_call_signature,
    _as_dict,
    _bump_failed_signature_counts
)
from .context import _print_context_usage, _compact_tool_result_for_context
from .messages import SYSTEM_MSG

from .logger import LOGGER
from tethysapp.tethysdash.exceptions import VisualizationError
from tethysapp.tethysdash.plugin_helpers import send_websocket_message

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BUCKET = "ciroh-community-ngen-datastream"
OUTPUTS_DIR = "outputs"
PREFIX_HYDROFABRIC = "v2.2_hydrofabric"
NGEN_RUN_PREFIX = "ngen-run/outputs/troute"

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3")
MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://127.0.0.1:9000/sse")
MAX_TOOL_REPAIR_ATTEMPTS = int(os.getenv("MCP_TOOL_REPAIR_ATTEMPTS", "0"))
OLLAMA_STREAM_THINKING = os.getenv("OLLAMA_STREAM_THINKING", "1").lower() in {"1", "true", "yes", "on"}
OLLAMA_SHOW_THINKING = os.getenv("OLLAMA_SHOW_THINKING", "1").lower() in {"1", "true", "yes", "on"}

class NRDSChart(base.DataSource):
    container = "python"
    version = "0.0.1"
    name = "nrds_chart"
    visualization_tags = [
        "national",
        "water",
        "model",
        "nextgen",
        "nrds",
        "time series",
        "ensemble",
    ]
    visualization_description = "Time series visualization for the NRDS s3 bucket"
    visualization_args = {
        "usr_msg": "text",
    }
    visualization_group = "NextGen"
    visualization_label = "NextGen Chart"
    visualization_type = "plotly"

    def __init__(self, usr_msg, metadata=None):
        self.bucket = BUCKET
        self.outputs_dir = OUTPUTS_DIR
        self.prefix_hydrofabric = PREFIX_HYDROFABRIC
        self.ngen_run_prefix = NGEN_RUN_PREFIX
        self.mcp_server_url = MCP_SERVER_URL
        self.stream_thinking = OLLAMA_STREAM_THINKING
        self.show_thinking = OLLAMA_SHOW_THINKING
        self.ollama_model = OLLAMA_MODEL
        self.mcp_client = self.get_mcp_client()
        self.usr_msg = usr_msg
        super(NRDSChart, self).__init__(metadata=metadata)

    def read(self, request_id=None):
        self.metadata = {"bucket": self.bucket}
        fig = self.main(request_id)
        return fig

    async def _ws_send(self, request_id, *args):
        if request_id is None:
            return        
        await asyncio.to_thread(send_websocket_message, request_id, *args)
        if args and isinstance(args[0], str):
            self.usr_msg += "\n" + args[0]

    def get_mcp_client(self) -> MCPClient:
        url = self.mcp_server_url.rstrip("/")
        if not url.endswith("/sse"):
            url += "/sse"
        return MCPClient(SSETransport(url=url))

    async def load_mcp_tools(self) -> list[dict]:
        async with self.mcp_client as mcp:
            tools_list = await mcp.list_tools()
            ollama_tools = []
            for tool in tools_list:
                schema = tool.inputSchema
                if hasattr(schema, "model_dump"):
                    schema = schema.model_dump()
                ollama_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": schema,
                        },
                    }
                )
            return ollama_tools

    async def execute_tool(self, tool_name: str, arguments: dict) -> Dict[str, Any]:
        try:
            async with self.mcp_client as mcp:
                result = await mcp.call_tool(tool_name, arguments, raise_on_error=False)
                data = getattr(result, "data", None)
                if data is not None:
                    return data
                try:
                    return result.content[0].text
                except Exception:
                    return result
        except Exception as e:
            return {"error": str(e)}

    async def _chat_with_optional_thinking_stream(self, messages, tools, request_id=None):
        if not self.stream_thinking:
            return ollama.chat(
                model=self.ollama_model,
                messages=messages,
                think=True,
                tools=tools,
                stream=False,
                options={"temperature": 0},
            )

        response_stream = ollama.chat(
            model=self.ollama_model,
            messages=messages,
            think=True,
            tools=tools,
            stream=True,
            options={"temperature": 0},
        )

        merged = {}
        merged_message = {
            "role": "assistant",
            "content": "",
            "thinking": "",
            "tool_calls": None,
        }

        printed_thinking_header = False
        thinking_buffer = ""
        last_flush = time.monotonic()

        async def flush_thinking(force=False):
            nonlocal thinking_buffer, last_flush
            if not thinking_buffer:
                return

            should_flush = (
                force
                or len(thinking_buffer) >= 80
                or thinking_buffer.endswith((".", "!", "?", "\n", ":"))
                or (time.monotonic() - last_flush) >= 0.4
            )

            if should_flush:
                await self._ws_send(request_id, thinking_buffer)
                thinking_buffer = ""
                last_flush = time.monotonic()

        for chunk in response_stream:
            chunk_dict = _as_dict(chunk)
            msg = _as_dict(chunk_dict.get("message"))

            thought = msg.get("thinking")
            if isinstance(thought, str) and thought:
                merged_message["thinking"] += thought
                if self.show_thinking:
                    if not printed_thinking_header:
                        await self._ws_send(request_id, "\n🧠 Thinking:")
                        printed_thinking_header = True
                    thinking_buffer += thought
                    await flush_thinking()

            content = msg.get("content")
            if isinstance(content, str) and content:
                merged_message["content"] += content

            tool_calls = msg.get("tool_calls")
            if tool_calls:
                merged_message["tool_calls"] = tool_calls

            for key in (
                "model",
                "created_at",
                "done",
                "done_reason",
                "total_duration",
                "load_duration",
                "prompt_eval_count",
                "prompt_eval_duration",
                "eval_count",
                "eval_duration",
            ):
                if key in chunk_dict:
                    merged[key] = chunk_dict[key]

        if self.show_thinking:
            await flush_thinking(force=True)

        if printed_thinking_header and self.show_thinking:
            await self._ws_send(request_id, "")

        if merged_message["tool_calls"] is None:
            merged_message.pop("tool_calls")

        merged["message"] = merged_message
        return merged

    def _extract_plotly_figure(self, payload: Any) -> Optional[Dict[str, Any]]:
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                return None

        if isinstance(payload, list):
            for item in payload:
                figure = self._extract_plotly_figure(item)
                if figure:
                    return figure
            return None

        if not isinstance(payload, dict):
            payload = _as_dict(payload)
            if not isinstance(payload, dict):
                return None

        figure = payload.get("figure")
        if isinstance(figure, str):
            try:
                figure = json.loads(figure)
            except Exception:
                figure = None
        if isinstance(figure, dict):
            if isinstance(figure.get("data"), list):
                return figure

        if isinstance(payload.get("data"), list) and isinstance(payload.get("layout"), dict):
            return payload

        return None

    async def process_tool_calls(self, tool_calls, messages):
        had_error = False
        last_err = None
        failed_signatures: list[str] = []
        plotly_figure: Optional[Dict[str, Any]] = None

        for tool_call in tool_calls:
            tool_name = tool_call["function"]["name"]
            args = tool_call["function"]["arguments"]

            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {"_raw": args}

            args = _normalize_query_tool_args(tool_name, args)

            s3_url = args.get("s3_url")
            if isinstance(s3_url, str):
                if s3_url.lower().endswith(".parquet") and tool_name == "query_netcdf_output_file":
                    tool_name = "query_parquet_output_file"
                if s3_url.lower().endswith((".nc", ".nc4")) and tool_name == "query_parquet_output_file":
                    tool_name = "query_netcdf_output_file"

            if tool_name in {"query_parquet_output_file", "query_netcdf_output_file"}:
                current_s3 = args.get("s3_url", "")
                if not _is_plausible_outputs_file(current_s3):
                    fallback = None
                    if tool_name == "query_parquet_output_file":
                        fallback = _last_tool_file_url(messages, exts=(".parquet",))
                    else:
                        fallback = _last_tool_file_url(messages, exts=(".nc", ".nc4"))
                    if fallback:
                        args["s3_url"] = fallback

            if tool_name in {"query_parquet_output_file", "query_netcdf_output_file"}:
                q = args.get("query")
                if isinstance(q, str):
                    args["query"] = _rewrite_from_to_output(q)

            if tool_name == "query_parquet_output_file":
                s3_url = args.get("s3_url")
                q = args.get("query")
                if isinstance(s3_url, str) and isinstance(q, str):
                    args["s3_url"] = _maybe_join_dir_and_filename(s3_url, q)
                    args["query"] = _rewrite_from_to_output(q)

            call_signature = _tool_call_signature(
                tool_name, args if isinstance(args, dict) else {"_raw": args}
            )

            tool_result = await self.execute_tool(tool_name, args)
            if plotly_figure is None:
                plotly_figure = self._extract_plotly_figure(tool_result)
            tool_result_for_context = _compact_tool_result_for_context(tool_result)

            messages.append(
                {
                    "role": "tool",
                    "tool_name": tool_name,
                    "content": json.dumps(tool_result_for_context)
                    if isinstance(tool_result_for_context, (dict, list))
                    else str(tool_result_for_context),
                }
            )

            err_text = _tool_error_text(tool_result)
            if err_text:
                had_error = True
                last_err = err_text
                failed_signatures.append(call_signature)

        return had_error, last_err, failed_signatures, plotly_figure

    async def get_chart(self, request_id=None):
        try:
            tools = await self.load_mcp_tools()
        except Exception as e:
            LOGGER.error("Error connecting to MCP server: %s", e)
            return

        messages = [SYSTEM_MSG]

        if not self.usr_msg or self.usr_msg in (":q", ":quit", "quit", "exit"):
            LOGGER.info("Bye!")
            return

        messages.append({"role": "user", "content": self.usr_msg})
        failed_sig_counts: dict[str, int] = {}

        file_url = extract_file_url(self.usr_msg)
        kind = file_kind(file_url or "")
        if file_url:
            messages.append(generate_file_msg(file_url, kind))

        while True:
            try:
                response = await self._chat_with_optional_thinking_stream(messages, tools, request_id)
                _print_context_usage(response, OLLAMA_MODEL)
            except Exception as e:
                LOGGER.error("Error calling Ollama: %s", e)
                break

            msg = _get_message(response)
            tool_calls = msg.get("tool_calls") or []

            if not tool_calls:
                assistant_content = msg.get("content", "") or ""
                tool_calls = extract_inline_tool_calls(assistant_content) or []

            if not tool_calls:
                assistant_text = msg.get("content", "")
                messages.append({"role": "assistant", "content": assistant_text})
                await self._ws_send(request_id, assistant_text)
                break

            if "tool_calls" not in msg:
                msg["tool_calls"] = tool_calls
            messages.append(msg)

            had_error, last_err, failed_signatures, plotly_figure = await self.process_tool_calls(
                tool_calls, messages
            )
            if plotly_figure is not None:
                return plotly_figure

            if had_error and last_err:
                repeated_signature = _bump_failed_signature_counts(
                    failed_sig_counts, failed_signatures
                )

                if MAX_TOOL_REPAIR_ATTEMPTS <= 0 and repeated_signature:
                    messages.append(
                        generate_auto_fix_tool_msg(
                            last_err,
                            prior_user_text=self.usr_msg,
                            repeated_signature=repeated_signature,
                        )
                    )
                    continue

                for attempt in range(1, MAX_TOOL_REPAIR_ATTEMPTS + 1):
                    LOGGER.warning("Tool call had error: %s", last_err)
                    LOGGER.warning("Attempting auto-repair %s/%s", attempt, MAX_TOOL_REPAIR_ATTEMPTS)

                    messages.append(
                        generate_auto_fix_tool_msg(
                            last_err,
                            prior_user_text=self.usr_msg,
                            repeated_signature=repeated_signature,
                        )
                    )

                    try:
                        repair_resp = await self._chat_with_optional_thinking_stream(
                            messages, tools, request_id
                        )
                        _print_context_usage(repair_resp, OLLAMA_MODEL)
                    except Exception as e:
                        last_err = f"Ollama error during repair: {e}"
                        LOGGER.error(last_err)
                        continue

                    repair_msg = repair_resp.get("message", {})
                    repair_calls = repair_msg.get("tool_calls") or []

                    if not repair_calls:
                        repair_calls = extract_inline_tool_calls(
                            repair_msg.get("content", "")
                        ) or []

                    if not repair_calls:
                        last_err = "Model did not return tool_calls; it responded with text instead."
                        continue

                    if "tool_calls" not in repair_msg:
                        repair_msg["tool_calls"] = repair_calls
                    messages.append(repair_msg)

                    had_error, last_err, failed_signatures, plotly_figure = await self.process_tool_calls(
                        repair_calls, messages
                    )
                    if plotly_figure is not None:
                        return plotly_figure
                    repeated_signature = _bump_failed_signature_counts(
                        failed_sig_counts, failed_signatures
                    )

                    if not had_error:
                        break

                continue

            continue

        LOGGER.info("Bye!")
        return None

    def main(self, request_id=None):
        try:
            chart = asyncio.run(self.get_chart(request_id))
            return chart
        except Exception as e:
            logger.error(e)
            return None
