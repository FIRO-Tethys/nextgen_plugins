/**
 * MapPanel
 *
 * Renders a PMTiles map. Accepts config directly via `data` prop
 * or reactively via `variableInputValues[dataKey]`.
 */
import FlowpathsPmtilesMap from "../components/FlowpathsPmtilesMap";
import { panelStyle, panelEmptyStyle } from "./panelStyles";

export default function MapPanel({
  data,
  dataKey = "chatbox_map",
  variableInputValues,
  chatbox_map: initialMap,
}) {
  const mapConfig = data || variableInputValues?.[dataKey] || initialMap || null;

  return (
    <div style={panelStyle}>
      <FlowpathsPmtilesMap mapConfig={mapConfig} height="100%" />
    </div>
  );
}
