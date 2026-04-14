import ChatBox from "./chatbox";

const mcpServerUrl = import.meta.env.VITE_MCP_SERVER_URL?.trim() || undefined;

function App() {
  const fallbackModels = String(import.meta.env.VITE_CHATBOX_MODELS ?? "qwen3")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const defaultModel = fallbackModels[0] ?? "qwen3";

  return (
    <ChatBox
      thinkingEnabled={false}
      model={defaultModel}
      modelOptions={fallbackModels}
      prompt=""
      mcpServerUrl={mcpServerUrl}
    />
  );
}

export default App;
