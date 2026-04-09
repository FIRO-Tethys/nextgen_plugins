import { MapPanel as GenericMapPanel } from "panels";

export default function MapPanel(props) {
  return <GenericMapPanel dataKey="chatbox_map" {...props} />;
}
