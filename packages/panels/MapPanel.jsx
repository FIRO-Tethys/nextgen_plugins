/**
 * MapPanel (generic)
 *
 * Renders a PMTiles map. Accepts config directly via `data` prop
 * or reactively via `variableInputValues[dataKey]`.
 */
import FlowpathsPmtilesMap from "./components/FlowpathsPmtilesMap.jsx";
import { panelStyle, panelEmptyStyle } from "./panelStyles.js";

export default function MapPanel({
  data,
  dataKey = "chatbox_map",
  variableInputValues,
}) {
  const mapConfig = data || variableInputValues?.[dataKey] || null;

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
