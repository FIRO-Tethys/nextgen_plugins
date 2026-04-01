import PlotlyChart from "../components/PlotlyChart";

export default function ChartPanel({ variableInputValues, chatbox_chart: initialChart }) {
  const figure = variableInputValues?.chatbox_chart || initialChart;

  if (!figure) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
        <p>Charts will appear here</p>
      </div>
    );
  }

  return <PlotlyChart figure={figure} />;
}
