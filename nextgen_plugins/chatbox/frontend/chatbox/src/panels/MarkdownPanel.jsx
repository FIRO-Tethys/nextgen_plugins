import MarkdownContent from "../components/markdownContent";

export default function MarkdownPanel({ variableInputValues, chatbox_markdown: initialMarkdown }) {
  const content = variableInputValues?.chatbox_markdown || initialMarkdown;

  if (!content) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
        <p>Results will appear here</p>
      </div>
    );
  }

  return <MarkdownContent content={content} />;
}
