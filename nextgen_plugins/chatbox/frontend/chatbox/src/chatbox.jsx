/**
 * chatbox.jsx — NRDS chatbox wrapper.
 *
 * Thin wrapper around @chatbox/core's <Chatbox> component.
 * Injects NRDS-specific behavior via props:
 *   - engineExtensions: tool categories, early returns, S3 validation, system prompt
 *   - onResult: panel variable publishing + dynamic panel creation
 *   - MessageRenderer: PlotlyChart / FlowpathsPmtilesMap / query table rendering
 */

import { Chatbox } from "@chatbox/core/components";
import {
  NRDS_TOOL_CATEGORIES,
  checkNrdsEarlyReturn,
  beforeNrdsToolExecution,
  nrdsToolErrorCheck,
} from "./lib/nrdsToolCategories";
import {
  buildNrdsSystemMessage,
  buildNrdsRepairMessage,
  buildNrdsBeforeFirstMessage,
} from "./lib/nrdsMessages";
import { publishResultToVariables, requestPanelCreation } from "./lib/chatboxPanelBridge";
import NrdsMessageContent from "./components/NrdsMessageContent";

function getCsrfToken() {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

const NRDS_ENGINE_EXTENSIONS = {
  systemPromptBuilder: buildNrdsSystemMessage,
  toolCategories: NRDS_TOOL_CATEGORIES,
  earlyReturnCheck: checkNrdsEarlyReturn,
  beforeToolExecution: beforeNrdsToolExecution,
  toolErrorCheck: nrdsToolErrorCheck,
  repairMessageBuilder: buildNrdsRepairMessage,
  beforeFirstMessage: buildNrdsBeforeFirstMessage,
};

function handleResult(result, { isEmbedded, updateVariableInputValues }) {
  if (isEmbedded) {
    publishResultToVariables(result, updateVariableInputValues);
    requestPanelCreation(result);
  }
}

export default function ChatBox(props) {
  return (
    <Chatbox
      {...props}
      csrfToken={props.csrfToken || getCsrfToken()}
      engineExtensions={NRDS_ENGINE_EXTENSIONS}
      onResult={handleResult}
      MessageRenderer={NrdsMessageContent}
    />
  );
}
