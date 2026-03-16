import ChatBox from "./chatbox";
import "./App.css";

function App() {
  const fallbackModels = String(import.meta.env.VITE_CHATBOX_MODELS ?? "qwen3")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const defaultModel = fallbackModels[0] ?? "qwen3";

  return (
    <ChatBox
      thinkingEnabled={true}
      model={defaultModel}
      modelOptions={fallbackModels}
      prompt=""
    />
  );
}

export default App;
