/**
 * MarkdownPanel
 *
 * Renders markdown/JSON content. Accepts data directly via `data` prop
 * or reactively via `variableInputValues[dataKey]`.
 */
import { MarkdownContent } from "@chatbox/core/components";
import { panelStyle, panelEmptyStyle } from "./panelStyles";

const DEFAULT_MARKDOWN =
  "## Markdown Panel\n\nThis panel renders **markdown** and `code`. Data will appear here when provided by the chatbox or MCP.";

export default function MarkdownPanel({
  data,
  dataKey = "chatbox_markdown",
  variableInputValues,
  chatbox_markdown: initialMarkdown,
}) {
  const content = data || variableInputValues?.[dataKey] || initialMarkdown || DEFAULT_MARKDOWN;

  return (
    <div style={{ ...panelStyle, overflow: "auto" }}>
      <MarkdownContent content={content} />
    </div>
  );
}
