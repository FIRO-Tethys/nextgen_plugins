/**
 * chatboxPanelBridge.js
 *
 * Handles all communication from the chatbox to tethysdash dashboard panels:
 * - Publishing result data to variableInputValues
 * - Dispatching DOM events to create dynamic panels
 */

import {
  MFE_SCOPE,
  MFE_REMOTE_TYPE,
  ADD_VISUALIZATION_EVENT,
  PANEL_SOURCE,
} from "./chatboxConfig";

const PANEL_HINTS = {
  "./MapPanel": { w: 50, h: 35, priority: 0 },
  "./QueryPanel": { w: 50, h: 25, priority: 1 },
  "./MarkdownPanel": { w: 50, h: 20, priority: 2 },
};

/**
 * Publish chat result data to tethysdash variableInputValues.
 * Text-only responses are not published (they stay in the chat bubble).
 */
export function publishResultToVariables(result, updateVariableInputValues) {
  const updates = {};
  if (result.mapConfig) updates.chatbox_map = result.mapConfig;
  if (result.queryResult) updates.chatbox_query = result.queryResult;
  if (
    result.assistantText &&
    (result.mapConfig || result.queryResult)
  ) {
    updates.chatbox_markdown = result.assistantText;
  }
  if (Object.keys(updates).length > 0) {
    updateVariableInputValues(updates);
  }
}

/**
 * Dispatch a batch DOM event requesting dynamic panel creation.
 * Panels are deduplicated by module name on the tethysdash side.
 * Size hints and priority are included so the layout utility can
 * arrange panels without knowing chatbox-specific types.
 */
export function requestPanelCreation(result) {
  const mfeUrl =
    window.__CHATBOX_MFE_URL__ ||
    new URL("remoteEntry.js", import.meta.url).href;
  const mfeArgs = {
    url: mfeUrl,
    scope: MFE_SCOPE,
    remoteType: MFE_REMOTE_TYPE,
  };

  const panelsToCreate = [];
  if (result.mapConfig) {
    panelsToCreate.push({
      module: "./MapPanel",
      initialData: { chatbox_map: result.mapConfig },
    });
  }
  if (result.queryResult) {
    panelsToCreate.push({
      module: "./QueryPanel",
      initialData: { chatbox_query: result.queryResult },
    });
  }

  if (panelsToCreate.length === 0) return;

  panelsToCreate.sort(
    (a, b) =>
      (PANEL_HINTS[a.module]?.priority ?? 99) -
      (PANEL_HINTS[b.module]?.priority ?? 99),
  );

  window.dispatchEvent(
    new CustomEvent(ADD_VISUALIZATION_EVENT, {
      detail: {
        source: PANEL_SOURCE,
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
