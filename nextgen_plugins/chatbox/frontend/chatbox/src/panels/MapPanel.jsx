import FlowpathsPmtilesMap from "../components/FlowpathsPmtilesMap";

export default function MapPanel({ variableInputValues }) {
  const mapConfig = variableInputValues?.chatbox_map ?? null;

  if (!mapConfig) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
        <p>Maps will appear here</p>
      </div>
    );
  }

  return <FlowpathsPmtilesMap mapConfig={mapConfig} height="100%" />;
}
