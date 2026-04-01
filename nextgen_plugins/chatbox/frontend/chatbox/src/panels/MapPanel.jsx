import FlowpathsPmtilesMap from "../components/FlowpathsPmtilesMap";

export default function MapPanel({ variableInputValues, chatbox_map: initialMap }) {
  const mapConfig = variableInputValues?.chatbox_map ?? initialMap ?? null;

  if (!mapConfig) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
        <p>Maps will appear here</p>
      </div>
    );
  }

  return <FlowpathsPmtilesMap mapConfig={mapConfig} height="100%" />;
}
