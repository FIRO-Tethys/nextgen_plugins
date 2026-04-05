// chatbox.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { ThemeProvider } from "styled-components";
import chatTheme from "./components/chatTheme";
import { runChatSession } from "./lib/chatboxEngine";
import { listOllamaModels } from "./lib/chatboxHelpers";
import { estimateTokens } from "./lib/chatboxConversation";
import { CONTEXT_BUDGET_RATIO } from "./lib/chatboxConfig";
import { publishResultToVariables, requestPanelCreation } from "./lib/chatboxPanelBridge";
import { getMcpServers, addMcpServer, removeMcpServer, toggleMcpServer } from "./lib/chatboxMcpStorage";
import ChatLog from "./components/ChatLog";
import ChatInputBar from "./components/ChatInputBar";
import ChatErrorPanel from "./components/ChatErrorPanel";
import MCPServerPanel from "./components/MCPServerPanel";

const REQUIRED_MODEL_CAPABILITIES = ["tools"];

const Shell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
  padding: 0.75rem;
  box-sizing: border-box;
  overflow: hidden;
  justify-content: ${(props) => (props.$hasMessages ? "flex-start" : "flex-end")};
  align-items: ${(props) => (props.$hasMessages ? "stretch" : "center")};
`;

const WelcomeInputWrapper = styled.div`
  width: 100%;
  max-width: 700px;
`;

function ChatBox({
  thinkingEnabled = false,
  model = "qwen3",
  modelOptions = [model],
  prompt = "",
  ollamaHost,
  mcpServerUrl,
  mcpServers,
  updateVariableInputValues,
  variableInputValues,
}) {
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
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  const [userMcpServers, setUserMcpServers] = useState(() => getMcpServers());
  const engineMessagesRef = useRef([]);
  const [contextUsage, setContextUsage] = useState({ used: 0, total: 0 });
  const configuredModels = useMemo(
    () => (Array.isArray(modelOptions) && modelOptions.length ? modelOptions : [model]),
    [modelOptions, model],
  );
  const availableModels = useMemo(() => {
    const seen = new Set();
    return discoveredModels.filter((m) => {
      if (!m?.name || seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
  }, [discoveredModels]);
  // Merge prop-provided MCP servers with user-configured servers from localStorage
  const defaultMcpServers = useMemo(() => {
    if (Array.isArray(mcpServers) && mcpServers.length > 0) return mcpServers;
    if (mcpServerUrl) return [{ url: mcpServerUrl, name: "Default" }];
    return [];
  }, [mcpServers, mcpServerUrl]);

  const allMcpServers = useMemo(() => {
    const defaults = defaultMcpServers.map((s) => ({ ...s, isDefault: true, enabled: true }));
    const userEnabled = userMcpServers.filter((s) => s.enabled !== false);
    return [...defaults, ...userEnabled];
  }, [defaultMcpServers, userMcpServers]);

  const handleAddMcpServer = useCallback((server) => {
    setUserMcpServers(addMcpServer(server));
  }, []);

  const handleRemoveMcpServer = useCallback((url) => {
    setUserMcpServers(removeMcpServer(url));
  }, []);

  const handleToggleMcpServer = useCallback((url) => {
    setUserMcpServers(toggleMcpServer(url));
  }, []);

  const chatLogRef = useRef(null);
  const abortRef = useRef(null);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Auto-scroll chat log
  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinkingBuffer, contentBuffer]);

  // Sync props to state
  useEffect(() => { setInput(prompt ?? ""); }, [prompt]);
  useEffect(() => { setSelectedModel(model); }, [model]);
  useEffect(() => { setIsThinkingEnabled(Boolean(thinkingEnabled)); }, [thinkingEnabled]);
  useEffect(() => { if (!isThinkingEnabled) setThinkingBuffer(""); }, [isThinkingEnabled]);

  // Load models from Ollama API
  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    listOllamaModels(isEmbedded ? ollamaHost : undefined, {
      extraModels: configuredModels,
      requiredCapabilities: REQUIRED_MODEL_CAPABILITIES,
    })
      .then((models) => { if (!cancelled) setDiscoveredModels(models); })
      .catch((err) => { console.warn("Unable to load Ollama model list:", err); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [configuredModels, isEmbedded, ollamaHost]);

  // Auto-select first model if current is unavailable
  useEffect(() => {
    if (!availableModels.length) return;
    if (!selectedModel || !availableModels.some((m) => m.name === selectedModel)) {
      setSelectedModel(availableModels[0].name);
    }
  }, [availableModels, selectedModel]);

  // Update context total when model changes
  useEffect(() => {
    const modelInfo = discoveredModels.find((m) => m.name === selectedModel);
    setContextUsage((prev) => ({ ...prev, total: modelInfo?.contextLength ?? 8192 }));
  }, [selectedModel, discoveredModels]);

  const sendMessage = useCallback(async () => {
    const userText = input.trim();
    if (!userText || loading) return;

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
      const result = await runChatSession({
        prompt: userText,
        model: selectedModel,
        thinkingEnabled: isThinkingEnabled,
        signal: controller.signal,
        history: engineMessagesRef.current,
        maxContextTokens: Math.floor(contextUsage.total * CONTEXT_BUDGET_RATIO),
        ...(ollamaHost ? { ollamaHost } : {}),
        mcpServers: allMcpServers,
        onThinkingChunk: (chunk) => {
          if (!isThinkingEnabled || !chunk) return;
          accumulatedThinking += chunk;
          setThinkingBuffer(accumulatedThinking);
        },
        onContentChunk: (chunk) => {
          if (!chunk) return;
          accumulatedContent += chunk;
          setContentBuffer(accumulatedContent);
          if (isEmbedded) {
            updateVariableInputValues({ chatbox_markdown: accumulatedContent });
          }
        },
      });

      if (result.messages) {
        engineMessagesRef.current = result.messages;
        setContextUsage((prev) => ({ ...prev, used: estimateTokens(result.messages) }));
      }

      const content = result.aborted
        ? (accumulatedContent || "(Stopped)")
        : (result.assistantText || "");

      if (isEmbedded) {
        publishResultToVariables(result, updateVariableInputValues);
        requestPanelCreation(result);
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
      setError(String(err?.message ?? err));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }, [input, loading, selectedModel, isThinkingEnabled, contextUsage.total, ollamaHost, mcpServerUrl, isEmbedded, updateVariableInputValues]);

  const hasMessages = messages.length > 0 || loading;

  const inputBar = (
    <ChatInputBar
      input={input}
      setInput={setInput}
      onSend={sendMessage}
      onStop={stopGeneration}
      loading={loading}
      loadingModels={loadingModels}
      selectedModel={selectedModel}
      onModelChange={setSelectedModel}
      availableModels={availableModels}
      isThinkingEnabled={isThinkingEnabled}
      onThinkingToggle={() => setIsThinkingEnabled((v) => !v)}
      contextUsage={contextUsage}
      onOpenMcpPanel={() => setShowMcpPanel(true)}
      mcpServerCount={allMcpServers.length}
    />
  );

  if (showMcpPanel) {
    return (
      <ThemeProvider theme={chatTheme}>
        <Shell $hasMessages>
          <MCPServerPanel
            defaultServers={defaultMcpServers}
            userServers={userMcpServers}
            onAdd={handleAddMcpServer}
            onRemove={handleRemoveMcpServer}
            onToggle={handleToggleMcpServer}
            onClose={() => setShowMcpPanel(false)}
          />
        </Shell>
      </ThemeProvider>
    );
  }

  if (!hasMessages) {
    return (
      <ThemeProvider theme={chatTheme}>
        <Shell $hasMessages={false}>
          <div />
          <WelcomeInputWrapper>{inputBar}</WelcomeInputWrapper>
        </Shell>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={chatTheme}>
      <Shell $hasMessages>
        <ChatLog
          ref={chatLogRef}
          messages={messages}
          isEmbedded={isEmbedded}
          loading={loading}
          isThinkingEnabled={isThinkingEnabled}
          thinkingBuffer={thinkingBuffer}
          contentBuffer={contentBuffer}
        />
        <ChatErrorPanel error={error} />
        {inputBar}
      </Shell>
    </ThemeProvider>
  );
}

export default ChatBox;
