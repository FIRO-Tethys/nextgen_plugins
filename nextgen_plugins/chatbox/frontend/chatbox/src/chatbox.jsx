// chatbox.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { runChatSession } from "./lib/chatboxEngine";
import { listOllamaModels } from "./lib/chatboxHelpers";
import MarkdownContent from "./components/markdownContent";
import PlotlyChart from "./components/PlotlyChart";
import FlowpathsPmtilesMap from "./components/FlowpathsPmtilesMap";
import "./chatbox.css";

const REQUIRED_MODEL_CAPABILITIES = ["tools"];

function ChatBox({ thinkingEnabled = false, model = "qwen3", modelOptions = [model], prompt = "" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(prompt);
  const [thinkingBuffer, setThinkingBuffer] = useState("");
  const [contentBuffer, setContentBuffer] = useState("");
  const [selectedModel, setSelectedModel] = useState(model);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(Boolean(thinkingEnabled));
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState([]);
  const [error, setError] = useState("");
  const configuredModels = useMemo(
    () => (Array.isArray(modelOptions) && modelOptions.length ? modelOptions : [model]),
    [modelOptions, model]
  );
  const availableModels = useMemo(
    () => Array.from(new Set(discoveredModels.filter(Boolean))),
    [discoveredModels]
  );
  const chatLogRef = useRef(null);
  const abortRef = useRef(null);

  const stopGeneration = () => {
    abortRef.current?.abort();
  };

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinkingBuffer, contentBuffer]);

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
      setThinkingBuffer("");
    }
  }, [isThinkingEnabled]);

  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);

    listOllamaModels(undefined, {
      extraModels: configuredModels,
      requiredCapabilities: REQUIRED_MODEL_CAPABILITIES,
    })
      .then((models) => {
        if (!cancelled) {
          setDiscoveredModels(models);
        }
      })
      .catch((err) => {
        console.warn("Unable to load Ollama model list:", err);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingModels(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [configuredModels]);

  useEffect(() => {
    if (!availableModels.length) {
      return;
    }
    if (!selectedModel || !availableModels.includes(selectedModel)) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

  const sendMessage = async () => {
    const userText = input.trim();
    if (!userText || loading) {
      return;
    }

    setError("");
    setThinkingBuffer("");
    setContentBuffer("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");

    let accumulatedThinking = "";
    let accumulatedContent = "";
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      console.log(selectedModel)
      const result = await runChatSession({
        prompt: userText,
        model: selectedModel,
        thinkingEnabled: isThinkingEnabled,
        signal: controller.signal,
        onThinkingChunk: (chunk) => {
          if (!isThinkingEnabled || !chunk) {
            return;
          }
          accumulatedThinking += chunk;
          setThinkingBuffer(accumulatedThinking);
        },
        onContentChunk: (chunk) => {
          if (!chunk) return;
          accumulatedContent += chunk;
          setContentBuffer(accumulatedContent);
        },
      });

      console.log("Chat session completed with result:", result);

      const content = result.aborted
        ? (accumulatedContent || "(Stopped)")
        : (result.assistantText || "");

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content,
          thinking: accumulatedThinking || "",
          plotlyFigure: result.plotlyFigure ?? null,
          mapConfig: result.mapConfig ?? null,
        },
      ]);
      setThinkingBuffer("");
      setContentBuffer("");
    } catch (err) {
      console.log("Chat session error:", err);
      setError(String(err?.message ?? err));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const hasMessages = messages.length > 0 || loading;

  const inputBar = (
    <section className="chat-input-bar">
      <textarea
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder={`Message ${selectedModel || "assistant"}...`}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void sendMessage();
          }
        }}
        rows={1}
      />
      <div className="chat-input-toolbar">
        <div className="chat-input-toggles">
          <button
            type="button"
            className={`chat-pill-btn ${isThinkingEnabled ? "pill-active" : ""}`}
            onClick={() => setIsThinkingEnabled((v) => !v)}
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/>
              <line x1="10" y1="22" x2="14" y2="22"/>
            </svg>
            Thinking
          </button>
          <select
            className="chat-model-select"
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={loading || loadingModels || !availableModels.length}
          >
            {availableModels.length ? (
              availableModels.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))
            ) : (
              <option value="">{loadingModels ? "Loading..." : "No models"}</option>
            )}
          </select>
        </div>
        {loading ? (
          <button
            type="button"
            className="chat-send-btn chat-stop-btn"
            onClick={stopGeneration}
            aria-label="Stop generation"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <rect x="4" y="4" width="16" height="16" rx="2" fill="#ffffff" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="chat-send-btn"
            onClick={() => void sendMessage()}
            disabled={!input.trim()}
            aria-label="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3L4 11h5v8h6v-8h5L12 3z" fill="#ffffff" />
            </svg>
          </button>
        )}
      </div>
    </section>
  );

  if (!hasMessages) {
    return (
      <div className="chat-shell chat-shell-welcome">
        <div className="chat-welcome">
          <div className="chat-welcome-logo">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 18c1.5-1.5 3.5-2 5-2s3 1 4 2 2.5 2 4 2 3.5-.5 5-2" stroke="#1f7db8" strokeWidth="2" strokeLinecap="round"/>
              <path d="M1 14c1.5-1.5 3.5-2 5-2s3 1 4 2 2.5 2 4 2 3.5-.5 5-2" stroke="#1f7db8" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
              <path d="M12 3v7M9 6l3-3 3 3" stroke="#1f7db8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1>How can I help you?</h1>
        </div>
        {inputBar}
      </div>
    );
  }

  return (
    <div className="chat-shell chat-shell-conversation">
      <section className="chat-log" ref={chatLogRef}>
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          return (
            <div key={`${message.role}-${index}`} className={`chat-row ${isUser ? "chat-row-user" : "chat-row-assistant"}`}>
              <div className={`chat-avatar ${isUser ? "avatar-user" : "avatar-bot"}`}>
                {isUser ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.7-1.3-3-3-3S9 3.3 9 5H6c-1.1 0-2 .9-2 2v2c-1.7 0-3 1.3-3 3s1.3 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.7 0 3-1.3 3-3s-1.3-3-3-3zM9 14c-.8 0-1.5-.7-1.5-1.5S8.2 11 9 11s1.5.7 1.5 1.5S9.8 14 9 14zm6 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5S15.8 14 15 14z"/></svg>
                )}
              </div>
              <article className={`chat-bubble ${isUser ? "chat-user" : "chat-assistant"}`}>
                {!isUser && message.thinking && (
                  <details className="thinking-dropdown">
                    <summary>Thinking</summary>
                    <pre>{message.thinking}</pre>
                  </details>
                )}
                {message.mapConfig ? (
                  <div className="chat-map-wrapper" style={{ width: "100%", minHeight: "500px", marginTop: "12px" }}>
                    <FlowpathsPmtilesMap mapConfig={message.mapConfig} />
                  </div>
                ) : message.plotlyFigure ? (
                  <div className="chat-plot-wrapper" style={{ width: "100%", minHeight: "360px", marginTop: "12px" }}>
                    <PlotlyChart figure={message.plotlyFigure} />
                  </div>
                ) : message.content ? (
                  <MarkdownContent content={message.content} />
                ) : null}
              </article>
            </div>
          );
        })}

        {loading && (
          <div className="chat-row chat-row-assistant">
            <div className="chat-avatar avatar-bot">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.7-1.3-3-3-3S9 3.3 9 5H6c-1.1 0-2 .9-2 2v2c-1.7 0-3 1.3-3 3s1.3 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.7 0 3-1.3 3-3s-1.3-3-3-3zM9 14c-.8 0-1.5-.7-1.5-1.5S8.2 11 9 11s1.5.7 1.5 1.5S9.8 14 9 14zm6 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5S15.8 14 15 14z"/></svg>
            </div>
            <article className="chat-bubble chat-assistant">
              {isThinkingEnabled && thinkingBuffer && (
                <details className="thinking-dropdown" open={!contentBuffer}>
                  <summary>Thinking...</summary>
                  <pre>{thinkingBuffer}</pre>
                </details>
              )}
              {contentBuffer ? (
                <MarkdownContent content={contentBuffer} />
              ) : (
                !thinkingBuffer && <p className="chat-status">Running...</p>
              )}
            </article>
          </div>
        )}
      </section>

      {error && (
        <section className="error-panel">
          <strong>Error:</strong> {error}
        </section>
      )}

      {inputBar}
    </div>
  );
}

export default ChatBox;
