// chatbox.jsx
import { useEffect, useState } from "react";
import { runChatSession } from "./chatboxEngine";
import MarkdownContent from "./markdownContent";
import PlotlyChart from "./PlotlyChart";
import ModelSelector from "./components/ModelSelector";
import ThinkingSwitch from "./components/ThinkingSwitch";
import "./chatbox.css";

function ChatBox({ thinkingEnabled = true, model = "qwen3", modelOptions = [model], prompt = "" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(prompt);
  const [thinking, setThinking] = useState("");
  const [selectedModel, setSelectedModel] = useState(model);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(Boolean(thinkingEnabled));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const configuredModels = Array.isArray(modelOptions) && modelOptions.length ? modelOptions : [model];
  const availableModels = Array.from(new Set([...configuredModels, selectedModel].filter(Boolean)));

  useEffect(() => {
    setInput(prompt ?? "");
  }, [prompt]);

  useEffect(() => {
    setSelectedModel(model);
  }, [model]);

  useEffect(() => {
    setIsThinkingEnabled(Boolean(thinkingEnabled));
  }, [thinkingEnabled]);

  useEffect(() => {
    if (!isThinkingEnabled) {
      setThinking("");
    }
  }, [isThinkingEnabled]);

  const sendMessage = async () => {
    const userText = input.trim();
    if (!userText || loading) {
      return;
    }

    setError("");
    setThinking("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");

    try {
      const result = await runChatSession({
        prompt: userText,
        model: selectedModel,
        thinkingEnabled: isThinkingEnabled,
        onThinkingChunk: (chunk) => {
          if (!isThinkingEnabled || !chunk) {
            return;
          }
          setThinking((prev) => prev + chunk);
        },
      });

      console.log("Chat session completed with result:", result);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.assistantText || "",
          plotlyFigure: result.plotlyFigure ?? null,
        },
      ]);
    } catch (err) {
      console.log("Chat session error:", err);
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <h1>NextGen Chatbox</h1>
        <p>
          model=<code>{selectedModel}</code> | thinking=<code>{String(Boolean(isThinkingEnabled))}</code>
        </p>
      </header>

      <section className="chat-controls">
        <ModelSelector
          value={selectedModel}
          options={availableModels}
          onChange={setSelectedModel}
          disabled={loading}
        />
        <ThinkingSwitch
          checked={isThinkingEnabled}
          onChange={setIsThinkingEnabled}
          disabled={loading}
        />
      </section>

      <section className="chat-log">
        {messages.map((message, index) => {

          return (
            <article
              key={`${message.role}-${index}`}
              className={`chat-bubble ${message.role === "user" ? "chat-user" : "chat-assistant"}`}
            >
              <strong>{message.role === "user" ? "You" : "Assistant"}</strong>

              {message.plotlyFigure ? (
                <div
                  className="chat-plot-wrapper"
                  style={{ width: "100%", minHeight: "360px", marginTop: "12px" }}
                >
                  <PlotlyChart figure={message.plotlyFigure} />
                </div>
              ) : message.content ? (
                <MarkdownContent content={message.content} />
              ) : null}
            </article>
          );
        })}

        {loading && <p className="chat-status">Running...</p>}
      </section>

      {isThinkingEnabled && thinking && (
        <section className="thinking-panel">
          <h2>Thinking Stream</h2>
          <pre>{thinking}</pre>
        </section>
      )}

      {error && (
        <section className="error-panel">
          <strong>Error:</strong> {error}
        </section>
      )}

      <section className="chat-input">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type your prompt..."
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          rows={4}
        />
        <button type="button" onClick={() => void sendMessage()} disabled={loading}>
          Send
        </button>
      </section>
    </div>
  );
}

export default ChatBox;
