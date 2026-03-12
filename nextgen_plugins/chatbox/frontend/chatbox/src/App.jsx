import ChatBox from "./chatbox";
import "./App.css";

function App() {
  const modelOptions = String(import.meta.env.VITE_CHATBOX_MODELS ?? "qwen3")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const defaultModel = modelOptions[0] ?? "qwen3";

  return (
    <ChatBox
      thinkingEnabled={true}
      model={defaultModel}
      modelOptions={modelOptions}
      prompt=""
    />
  );
}

export default App;
