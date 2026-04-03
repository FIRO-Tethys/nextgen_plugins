import FlowpathsPmtilesMap from "../components/FlowpathsPmtilesMap";
import { panelStyle, panelEmptyStyle } from "./panelStyles";

export default function MapPanel({ variableInputValues, chatbox_map: initialMap }) {
  const mapConfig = variableInputValues?.chatbox_map ?? initialMap ?? null;

  if (!mapConfig) {
    return (
      <div style={panelEmptyStyle}>
        <p>Maps will appear here</p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <FlowpathsPmtilesMap mapConfig={mapConfig} height="100%" />
    </div>
  );
}
