import { useEffect } from "react";
import PlotlyChart from "../components/PlotlyChart";
import { panelStyle, panelEmptyStyle } from "./panelStyles";

export default function ChartPanel({ variableInputValues, chatbox_chart: initialChart }) {
  useEffect(() => {
    console.warn(
      "[ChartPanel] DEPRECATED: Chart rendering has migrated to native BasePlot. " +
      "This panel will be removed in a future release."
    );
  }, []);
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
