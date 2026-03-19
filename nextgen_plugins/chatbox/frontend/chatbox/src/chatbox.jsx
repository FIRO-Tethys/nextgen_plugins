// chatbox.jsx
import { useEffect, useMemo, useState } from "react";
import { runChatSession } from "./chatboxEngine";
import { listOllamaModels } from "./chatboxHelpers";
import MarkdownContent from "./markdownContent";
import PlotlyChart from "./PlotlyChart";
import FlowpathsPmtilesMap from "./FlowpathsPmtilesMap";
import ModelSelector from "./components/ModelSelector";
import ThinkingSwitch from "./components/ThinkingSwitch";
import "./chatbox.css";

const REQUIRED_MODEL_CAPABILITIES = ["tools"];

function ChatBox({ thinkingEnabled = true, model = "qwen3", modelOptions = [model], prompt = "" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(prompt);
  const [thinkingBuffer, setThinkingBuffer] = useState("");
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
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");

    let accumulatedThinking = "";

    try {
      console.log(selectedModel)
      const result = await runChatSession({
        prompt: userText,
        model: selectedModel,
        thinkingEnabled: isThinkingEnabled,
        onThinkingChunk: (chunk) => {
          if (!isThinkingEnabled || !chunk) {
            return;
          }
          accumulatedThinking += chunk;
          setThinkingBuffer(accumulatedThinking);
        },
      });

      console.log("Chat session completed with result:", result);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.assistantText || "",
          thinking: accumulatedThinking || "",
          plotlyFigure: result.plotlyFigure ?? null,
          mapConfig: result.mapConfig ?? null,
        },
      ]);
      setThinkingBuffer("");
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
      </header>

      <section className="chat-controls">
        <ModelSelector
          value={selectedModel}
          options={availableModels}
          onChange={setSelectedModel}
          isLoading={loadingModels}
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

              {message.role === "assistant" && message.thinking && (
                <details className="thinking-dropdown">
                  <summary>Thinking</summary>
                  <pre>{message.thinking}</pre>
                </details>
              )}

              {message.mapConfig ? (
                <div
                  className="chat-map-wrapper"
                  style={{ width: "100%", minHeight: "500px", marginTop: "12px" }}
                >
                <FlowpathsPmtilesMap mapConfig={message.mapConfig} />
                </div>
              ) : message.plotlyFigure ? (
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

        {loading && (
          <article className="chat-bubble chat-assistant">
            <strong>Assistant</strong>
            {isThinkingEnabled && thinkingBuffer && (
              <details className="thinking-dropdown" open>
                <summary>Thinking...</summary>
                <pre>{thinkingBuffer}</pre>
              </details>
            )}
            {!thinkingBuffer && <p className="chat-status">Running...</p>}
          </article>
        )}
      </section>

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
