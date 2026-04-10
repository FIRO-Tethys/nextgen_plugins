/**
 * MarkdownPanel (generic)
 *
 * Renders markdown/JSON content. Accepts data directly via `data` prop
 * or reactively via `variableInputValues[dataKey]`.
 */
import MarkdownContent from "./components/MarkdownContent.jsx";
import { panelStyle, panelEmptyStyle } from "./panelStyles.js";

export default function MarkdownPanel({
  data,
  dataKey = "chatbox_markdown",
  variableInputValues,
}) {
  const content = data || variableInputValues?.[dataKey];

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
