import ChatBox from "./chatbox";
import "./App.css";

function App() {
  return (
    <ChatBox
      thinkingEnabled={true}
      model="qwen3"
      prompt=""
    />
  );
}

export default App;
