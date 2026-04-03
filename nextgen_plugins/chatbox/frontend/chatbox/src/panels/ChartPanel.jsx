import PlotlyChart from "../components/PlotlyChart";
import { panelStyle, panelEmptyStyle } from "./panelStyles";

export default function ChartPanel({ variableInputValues, chatbox_chart: initialChart }) {
  const figure = variableInputValues?.chatbox_chart || initialChart;

  if (!figure) {
    return (
      <div style={panelEmptyStyle}>
        <p>Charts will appear here</p>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <PlotlyChart figure={figure} />
    </div>
  );
}
