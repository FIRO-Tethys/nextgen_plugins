import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";

const Plot = createPlotlyComponent(Plotly);

function normalizeFigure(input) {
  if (!input) {
    return null;
  }

  let figure = input;

  // Allow JSON string payloads
  if (typeof figure === "string") {
    try {
      figure = JSON.parse(figure);
    } catch {
      return null;
    }
  }

  // Allow either:
  // 1) raw plotly figure: { data: [...], layout: {...} }
  // 2) wrapped response:   { figure: { data: [...], layout: {...} } }
  if (figure && typeof figure === "object" && !Array.isArray(figure) && figure.figure) {
    figure = figure.figure;
  }

  if (!figure || typeof figure !== "object" || Array.isArray(figure)) {
    return null;
  }

  const data = Array.isArray(figure.data) ? figure.data : [];
  if (!data.length) {
    return null;
  }

  const layout =
    figure.layout && typeof figure.layout === "object" ? figure.layout : {};

  return { data, layout };
}

function PlotlyChart({ figure }) {
  const normalized = normalizeFigure(figure);

  if (!normalized) {
    return null;
  }

  const layout = {
    ...normalized.layout,
    autosize: true,
    margin: {
      l: 48,
      r: 24,
      t: 48,
      b: 48,
      ...(normalized.layout.margin &&
      typeof normalized.layout.margin === "object"
        ? normalized.layout.margin
        : {}),
    },
  };

  return (
    <div className="chart-panel">
      <Plot
        className="chart-plot"
        data={normalized.data}
        layout={layout}
        config={{ responsive: true, displaylogo: false }}
        useResizeHandler={true}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

export default PlotlyChart;