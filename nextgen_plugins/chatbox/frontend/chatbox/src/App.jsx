import ChatBox from "./chatbox";

const ollamaHost = 'http://localhost:5173';
const ollamaApiKey = import.meta.env.VITE_OLLAMA_API_KEY?.trim() || undefined;
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
      ollamaHost={ollamaHost}
      ollamaApiKey={ollamaApiKey}
      mcpServerUrl={mcpServerUrl}
    />
  );
}

export default App;
