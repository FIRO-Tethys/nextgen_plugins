import { useEffect, useState } from "react";
import { runChatSession } from "./chatboxEngine";

function ChatBox({ thinkingEnabled = true, model = "qwen3", prompt = "" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(prompt);
  const [thinking, setThinking] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setInput(prompt ?? "");
  }, [prompt]);

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
        model,
        thinkingEnabled,
        onThinkingChunk: (chunk) => {
          if (!thinkingEnabled || !chunk) {
            return;
          }
          setThinking((prev) => prev + chunk);
        },
      });

      setMessages((prev) => [...prev, { role: "assistant", content: result.assistantText || "" }]);
    } catch (err) {
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
          model=<code>{model}</code> | thinking=<code>{String(Boolean(thinkingEnabled))}</code>
        </p>
      </header>

      <section className="chat-log">
        {messages.map((message, index) => (
          <article
            key={`${message.role}-${index}`}
            className={`chat-bubble ${message.role === "user" ? "chat-user" : "chat-assistant"}`}
          >
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            <p>{message.content}</p>
          </article>
        ))}
        {loading && <p className="chat-status">Running...</p>}
      </section>

      {thinkingEnabled && thinking && (
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
