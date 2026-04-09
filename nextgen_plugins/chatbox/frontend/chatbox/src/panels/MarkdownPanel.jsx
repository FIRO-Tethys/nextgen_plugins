import { MarkdownPanel as GenericMarkdownPanel } from "panels";

export default function MarkdownPanel(props) {
  return <GenericMarkdownPanel dataKey="chatbox_markdown" {...props} />;
}
