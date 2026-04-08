import { MarkdownContent } from "@chatbox/core/components";
import { panelStyle, panelEmptyStyle } from "./panelStyles";

export default function MarkdownPanel({ variableInputValues, chatbox_markdown: initialMarkdown }) {
  const content = variableInputValues?.chatbox_markdown || initialMarkdown;

  if (!content) {
    return (
      <div style={panelEmptyStyle}>
        <p>Results will appear here</p>
      </div>
    );
  }

  return (
    <div style={{ ...panelStyle, overflow: "auto" }}>
      <MarkdownContent content={content} />
    </div>
  );
}
