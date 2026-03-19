from intake.source import base
import os
import logging

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

class NRDSChatJS(base.DataSource):
    container = "python"
    version = "0.0.1"
    name = "nrds_s3_chat_js"
    visualization_tags = [
        "national",
        "water",
        "model",
        "nextgen",
        "nrds",
        "time series",
        "ensemble",
    ]
    visualization_description = "Time series visualization for the NRDS s3 bucket JS based chatbox plugin."
    visualization_args = {
        "usr_msg": "text",
    }
    visualization_group = "NextGen"
    visualization_label = "NextGen Live Chat JS Based"
    visualization_type = "custom"

    def __init__(self, usr_msg, metadata=None):
        self.bucket = BUCKET
        self.outputs_dir = OUTPUTS_DIR
        self.prefix_hydrofabric = PREFIX_HYDROFABRIC
        self.ngen_run_prefix = NGEN_RUN_PREFIX
        self.mcp_server_url = MCP_SERVER_URL
        self.stream_thinking = OLLAMA_STREAM_THINKING
        self.show_thinking = OLLAMA_SHOW_THINKING
        self.ollama_model = OLLAMA_MODEL
        self.usr_msg = usr_msg
        self.thinking_msg = ""
        self.mfe_unpkg_url = "http://localhost:5001/assets/remoteEntry.js"
        # self.mfe_unpkg_url = (
        #     "https://unpkg.com/mfe_drought_table@0.0.2/dist/remoteEntry.js"
        # )
        self.mfe_scope = "mfe_nrds_chatbox"
        self.mfe_module = "./Chatbox"
        self.remoteType = "vite-esm"
        super(NRDSChatJS, self).__init__(metadata=metadata)

    def read(self):
        self.metadata = {"bucket": self.bucket}
        return {
            "url": self.mfe_unpkg_url,
            "scope": self.mfe_scope,
            "module": self.mfe_module,
            "remoteType": self.remoteType,
            "props": {
                "thinkingEnabled": False,
                "model": self.ollama_model,
                "prompt": self.usr_msg,
            },
        }

