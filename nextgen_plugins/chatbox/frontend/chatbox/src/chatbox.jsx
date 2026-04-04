// chatbox.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { runChatSession } from "./lib/chatboxEngine";
import { listOllamaModels } from "./lib/chatboxHelpers";
import { estimateTokens } from "./lib/chatboxConversation";
import MarkdownContent from "./components/markdownContent";
import PlotlyChart from "./components/PlotlyChart";
import FlowpathsPmtilesMap from "./components/FlowpathsPmtilesMap";
import ContextUsageIndicator from "./components/ContextUsageIndicator";
import "./chatbox.css";

const OLLAMA_API_KEY = (import.meta.env.VITE_OLLAMA_API_KEY ?? "").trim();
const CONFIGURED_HOST = (import.meta.env.VITE_OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
const IS_CLOUD = Boolean(OLLAMA_API_KEY) && !/^https?:\/\/(localhost|127\.\d)/.test(CONFIGURED_HOST);
const REQUIRED_MODEL_CAPABILITIES = IS_CLOUD ? ["tools"] : ["tools"];

function ChatBox({ thinkingEnabled = false, model = "qwen3", modelOptions = [model], prompt = "", ollamaHost, mcpServerUrl, updateVariableInputValues, variableInputValues }) {
  const isEmbedded = typeof updateVariableInputValues === "function";
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
  const engineMessagesRef = useRef([]);
  const [contextUsage, setContextUsage] = useState({ used: 0, total: 0 });
  const configuredModels = useMemo(
    () => (Array.isArray(modelOptions) && modelOptions.length ? modelOptions : [model]),
    [modelOptions, model]
  );
  const availableModels = useMemo(
    () => {
      const seen = new Set();
      return discoveredModels.filter((m) => {
        if (!m?.name || seen.has(m.name)) return false;
        seen.add(m.name);
        return true;
      });
    },
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

    // When embedded, use the ollamaHost prop (points to the Vite preview
    // server which proxies /api to Ollama, avoiding CORS).
    listOllamaModels(isEmbedded ? ollamaHost : undefined, {
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
  }, [configuredModels, isEmbedded, ollamaHost]);

  useEffect(() => {
    if (!availableModels.length) {
      return;
    }
    if (!selectedModel || !availableModels.some((m) => m.name === selectedModel)) {
      setSelectedModel(availableModels[0].name);
    }
  }, [availableModels, selectedModel]);

  // Update context total when model changes; preserve conversation history
  useEffect(() => {
    const modelInfo = discoveredModels.find((m) => m.name === selectedModel);
    const total = modelInfo?.contextLength ?? 8192;
    setContextUsage((prev) => ({ ...prev, total }));
  }, [selectedModel, discoveredModels]);

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
        history: engineMessagesRef.current,
        maxContextTokens: Math.floor(contextUsage.total * 0.8),
        ...(ollamaHost ? { ollamaHost } : {}),
        ...(mcpServerUrl ? { mcpServerUrl } : {}),
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
          // Stream content to external panels in real-time
          if (isEmbedded) {
            updateVariableInputValues({ chatbox_markdown: accumulatedContent });
          }
        },
      });

      console.log("Chat session completed with result:", result);

      // Persist conversation for next turn and update token usage
      if (result.messages) {
        engineMessagesRef.current = result.messages;
        setContextUsage((prev) => ({
          ...prev,
          used: estimateTokens(result.messages),
        }));
      }

      const content = result.aborted
        ? (accumulatedContent || "(Stopped)")
        : (result.assistantText || "");

      // Publish results to tethysdash panels via variableInputValues
      if (isEmbedded) {
        const updates = {};
        if (result.plotlyFigure) updates.chatbox_chart = result.plotlyFigure;
        if (result.mapConfig) updates.chatbox_map = result.mapConfig;
        if (result.queryResult) updates.chatbox_query = result.queryResult;
        // Only publish text to markdown panel when it accompanies a data result.
        // Text-only responses (discovery, explanations) stay in the chat bubble.
        if (result.assistantText && (result.plotlyFigure || result.mapConfig || result.queryResult)) {
          updates.chatbox_markdown = result.assistantText;
        }
        if (Object.keys(updates).length > 0) {
          updateVariableInputValues(updates);
        }

        // Request dynamic panel creation (Option C)
        // Panels are created only if they don't already exist on the dashboard.
        // Initial data is passed via args so it's available at mount time
        // before the variableInputValues context propagates.
        // Size hints (w, h) and priority are sent so the dashboard layout
        // utility can arrange panels without knowing chatbox-specific types.
        const PANEL_HINTS = {
          "./MapPanel":      { w: 50, h: 35, priority: 0 },
          "./ChartPanel":    { w: 50, h: 30, priority: 1 },
          "./QueryPanel":    { w: 50, h: 25, priority: 2 },
          "./MarkdownPanel": { w: 50, h: 20, priority: 3 },
        };

        const mfeUrl =
          window.__CHATBOX_MFE_URL__ ||
          new URL("remoteEntry.js", import.meta.url).href;
        const mfeArgs = {
          url: mfeUrl,
          scope: "mfe_nrds_chatbox",
          remoteType: "vite-esm",
        };

        const panelsToCreate = [];
        if (result.plotlyFigure) {
          panelsToCreate.push({ module: "./ChartPanel", initialData: { chatbox_chart: result.plotlyFigure } });
        }
        if (result.mapConfig) {
          panelsToCreate.push({ module: "./MapPanel", initialData: { chatbox_map: result.mapConfig } });
        }
        if (result.queryResult) {
          panelsToCreate.push({ module: "./QueryPanel", initialData: { chatbox_query: result.queryResult } });
        }
        // Text-only responses (discovery, explanations) stay in the chat —
        // no MarkdownPanel created for them.

        if (panelsToCreate.length > 0) {
          // Sort by priority so visual panels (map, chart) get prominent positions
          panelsToCreate.sort(
            (a, b) => (PANEL_HINTS[a.module]?.priority ?? 99) - (PANEL_HINTS[b.module]?.priority ?? 99),
          );

          window.dispatchEvent(
            new CustomEvent("tethysdash:add-visualization", {
              detail: {
                source: "Client Custom",
                batch: true,
                panels: panelsToCreate.map((p) => {
                  const hints = PANEL_HINTS[p.module] || {};
                  return {
                    args: { ...mfeArgs, module: p.module, initialData: p.initialData },
                    w: hints.w,
                    h: hints.h,
                  };
                }),
              },
            }),
          );
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content,
          thinking: accumulatedThinking || "",
          plotlyFigure: result.plotlyFigure ?? null,
          mapConfig: result.mapConfig ?? null,
          queryResult: result.queryResult ?? null,
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
        onChange={(event) => {
          setInput(event.target.value);
          const el = event.target;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }}
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
              availableModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.capabilities.includes("thinking") ? "\uD83D\uDCA1 " : ""}{m.name}
                </option>
              ))
            ) : (
              <option value="">{loadingModels ? "Loading..." : "No models"}</option>
            )}
          </select>
          <ContextUsageIndicator used={contextUsage.used} total={contextUsage.total} />
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
                {isUser ? (
                  message.content && <MarkdownContent content={message.content} />
                ) : message.mapConfig ? (
                  isEmbedded ? (
                    <p className="chat-panel-indicator">Map updated in Map panel</p>
                  ) : (
                    <div className="chat-map-wrapper" style={{ width: "100%", minHeight: "500px", marginTop: "12px" }}>
                      <FlowpathsPmtilesMap mapConfig={message.mapConfig} />
                    </div>
                  )
                ) : message.plotlyFigure ? (
                  isEmbedded ? (
                    <p className="chat-panel-indicator">Chart updated in Chart panel</p>
                  ) : (
                    <div className="chat-plot-wrapper" style={{ width: "100%", minHeight: "360px", marginTop: "12px" }}>
                      <PlotlyChart figure={message.plotlyFigure} />
                    </div>
                  )
                ) : message.queryResult ? (
                  isEmbedded ? (
                    <p className="chat-panel-indicator">Query results sent to Query panel</p>
                  ) : (
                    <MarkdownContent content={message.content || JSON.stringify(message.queryResult.data, null, 2)} />
                  )
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
              {isEmbedded ? (
                <p className="chat-status">
                  {contentBuffer ? "Streaming to panels..." : thinkingBuffer ? "" : "Running..."}
                </p>
              ) : contentBuffer ? (
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
