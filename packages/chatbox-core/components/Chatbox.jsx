/**
 * Chatbox — Generic chatbox component.
 *
 * A complete, self-contained chat interface that works with any MCP server.
 * Consumers render this with minimal config. Domain-specific behavior
 * (NRDS tools, panel creation) is injected via `engineExtensions` and `onResult` props.
 *
 * Usage (generic sidebar):
 *   <Chatbox />
 *
 * Usage (NRDS MFE with extensions):
 *   <Chatbox
 *     engineExtensions={{ systemPromptBuilder, toolCategories, ... }}
 *     onResult={(result) => publishToVariables(result)}
 *   />
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { ThemeProvider } from "styled-components";
import chatTheme from "../theme/index.js";
import { runChatSession } from "../engine/index.js";
import { listModels } from "../helpers/index.js";
import { estimateTokens } from "../conversation/index.js";
import { CONTEXT_BUDGET_RATIO } from "../config/index.js";
import { getMcpServers, addMcpServer, removeMcpServer, toggleMcpServer } from "../storage/mcpStorage.js";
import { getProviderConfig } from "../storage/llmProviderStorage.js";
import ChatLog from "./ChatLog";
import ChatInputBar from "./ChatInputBar";
import ChatErrorPanel from "./ChatErrorPanel";
import MCPServerPanel from "./MCPServerPanel";
import LLMProviderPanel from "./LLMProviderPanel.jsx";

const REQUIRED_MODEL_CAPABILITIES = ["tools"];

const ADD_VISUALIZATION_EVENT = "tethysdash:add-visualization";

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

export default function Chatbox({
  thinkingEnabled = false,
  model = "qwen3",
  modelOptions,
  prompt = "",
  csrfToken,
  mcpServerUrl,
  mcpServers: propMcpServers,
  variableInputValues,
  updateVariableInputValues,
  engineExtensions = {},
  onResult,
  resolveVisualizationUrl,
  MessageRenderer,
}) {
  const isEmbedded = typeof updateVariableInputValues === "function";
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState(prompt);
  const [thinkingBuffer, setThinkingBuffer] = useState("");
  const [contentBuffer, setContentBuffer] = useState("");
  const [selectedModel, setSelectedModel] = useState(model);
  const [isThinkingEnabled, setIsThinkingEnabled] = useState(Boolean(thinkingEnabled));
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState([]);
  const [error, setError] = useState("");
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  const [providerConfig, setProviderConfig] = useState(() => getProviderConfig());
  const [showProviderPanel, setShowProviderPanel] = useState(false);
  const [userMcpServers, setUserMcpServers] = useState(() => getMcpServers());
  const engineMessagesRef = useRef([]);
  const [contextUsage, setContextUsage] = useState({ used: 0, total: 0 });

  const configuredModels = useMemo(
    () => {
      const opts = Array.isArray(modelOptions) && modelOptions.length ? modelOptions : [model];
      return opts;
    },
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

  // Merge prop-provided MCP servers with user-configured from localStorage
  const defaultMcpServers = useMemo(() => {
    if (Array.isArray(propMcpServers) && propMcpServers.length > 0) return propMcpServers;
    if (mcpServerUrl) return [{ url: mcpServerUrl, name: "Default" }];
    return [];
  }, [propMcpServers, mcpServerUrl]);

  const allMcpServers = useMemo(() => {
    const defaults = defaultMcpServers.map((s) => ({ ...s, isDefault: true, enabled: true }));
    const userEnabled = userMcpServers.filter((s) => s.enabled !== false);
    return [...defaults, ...userEnabled];
  }, [defaultMcpServers, userMcpServers]);

  const handleAddMcpServer = useCallback((server) => setUserMcpServers(addMcpServer(server)), []);
  const handleRemoveMcpServer = useCallback((url) => setUserMcpServers(removeMcpServer(url)), []);
  const handleToggleMcpServer = useCallback((url) => setUserMcpServers(toggleMcpServer(url)), []);

  const handleProviderSave = useCallback((newConfig) => {
    setProviderConfig(newConfig);
    setShowProviderPanel(false);
  }, []);

  const chatLogRef = useRef(null);
  const abortRef = useRef(null);

  const stopGeneration = useCallback(() => { abortRef.current?.abort(); }, []);

  // Auto-scroll
  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinkingBuffer, contentBuffer]);

  // Sync props
  useEffect(() => { setInput(prompt ?? ""); }, [prompt]);
  useEffect(() => { setSelectedModel(model); }, [model]);
  useEffect(() => { setIsThinkingEnabled(Boolean(thinkingEnabled)); }, [thinkingEnabled]);
  useEffect(() => { if (!isThinkingEnabled) setThinkingBuffer(""); }, [isThinkingEnabled]);

  // Load models
  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    listModels(providerConfig, { csrfToken })
      .then((models) => { if (!cancelled) setDiscoveredModels(models); })
      .catch((err) => { console.warn("Unable to load model list:", err); })
      .finally(() => { if (!cancelled) setLoadingModels(false); });
    return () => { cancelled = true; };
  }, [providerConfig, csrfToken]);

  // Auto-select model
  useEffect(() => {
    if (!availableModels.length) return;
    if (!selectedModel || !availableModels.some((m) => m.name === selectedModel)) {
      setSelectedModel(availableModels[0].name);
    }
  }, [availableModels, selectedModel]);

  // Context total
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
        providerConfig,
        ...(csrfToken ? { csrfToken } : {}),
        mcpServers: allMcpServers,
        // Inject domain-specific extensions (empty for generic sidebar)
        ...engineExtensions,
        onToolStatus: setToolStatus,
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

      // Domain-specific result handling (panel creation, variable publishing)
      if (onResult) {
        onResult(result, { isEmbedded, updateVariableInputValues });
      }

      // Dispatch visualization specs from TethysDash MCP as a single batch
      // event. Individual events in a loop cause duplicate grid item keys
      // and lost items because handleAddVisualization reads a stale ref
      // between dispatches (no re-render between synchronous events).
      if (result.visualizations?.length > 0) {
        const panels = result.visualizations.map((viz) => {
          // Resolve MFE URL for client_custom_remote plugins
          if (viz.vizType === "custom" && viz.scope && !viz.url && resolveVisualizationUrl) {
            viz.url = resolveVisualizationUrl(viz);
          }
          let args;
          if (viz.inlineData) {
            args = { vizType: viz.vizType, inlineData: viz.inlineData };
          } else if (viz.vizType === "custom" && viz.scope) {
            // client_custom_remote: Module Federation coordinates
            // Dual-format initialData: generic `data` prop + keyed for backward compat
            const initialData = { data: viz.args || {} };
            if (viz.dataKey) {
              initialData[viz.dataKey] = viz.args || {};
            }
            args = {
              url: viz.url,
              scope: viz.scope,
              module: viz.module,
              remoteType: viz.remoteType || "vite-esm",
              initialData,
            };
          } else {
            args = viz.args;
          }
          return { source: viz.source, args, w: viz.w, h: viz.h, uuid: viz.uuid };
        });

        window.dispatchEvent(
          new CustomEvent(ADD_VISUALIZATION_EVENT, {
            detail: { batch: true, panels },
          }),
        );
      }

      // Dispatch layer updates (from add_map_service_layer) as update events.
      // Uses requestAnimationFrame to ensure the add-visualization batch above
      // has been committed to React state before the update handler reads it.
      if (result.layerUpdates?.length > 0) {
        const updates = result.layerUpdates;
        requestAnimationFrame(() => {
          for (const update of updates) {
            window.dispatchEvent(
              new CustomEvent("tethysdash:update-visualization", {
                detail: {
                  uuid: update.map_uuid,
                  operation: "append_layer",
                  layer: update.layer,
                },
              }),
            );
          }
        });
      }

      // Extract plotlyFigure from visualization specs for inline rendering
      // (standalone) and text indicators (sidebar/MFE embedded modes)
      const plotlyViz = result.visualizations?.find((v) => v.vizType === "plotly");
      const inlinePlotly = plotlyViz?.inlineData ?? null;

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content,
          thinking: accumulatedThinking || "",
          plotlyFigure: result.plotlyFigure ?? inlinePlotly,
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
      setToolStatus(null);
      setLoading(false);
    }
  }, [input, loading, selectedModel, isThinkingEnabled, contextUsage.total, providerConfig, csrfToken, allMcpServers, isEmbedded, updateVariableInputValues, engineExtensions, onResult, resolveVisualizationUrl]);

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
      showProviderPanel={showProviderPanel}
      onToggleProviderPanel={() => setShowProviderPanel((p) => !p)}
      providerConfig={providerConfig}
    />
  );

  if (showProviderPanel) {
    return (
      <ThemeProvider theme={chatTheme}>
        <Shell $hasMessages>
          <LLMProviderPanel onSave={handleProviderSave} />
        </Shell>
      </ThemeProvider>
    );
  }

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
          toolStatus={toolStatus}
          MessageRenderer={MessageRenderer}
        />
        <ChatErrorPanel error={error} />
        {inputBar}
      </Shell>
    </ThemeProvider>
  );
}
