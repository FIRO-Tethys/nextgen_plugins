import { useMemo } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";

const Plot = createPlotlyComponent(Plotly);

function decodeBase64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeTypedArray(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.bdata !== "string" ||
    typeof value.dtype !== "string"
  ) {
    return value;
  }

  const bytes = decodeBase64ToBytes(value.bdata);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );

  switch (value.dtype) {
    case "f4":
      return Array.from(new Float32Array(buffer));
    case "f8":
      return Array.from(new Float64Array(buffer));
    case "i1":
      return Array.from(new Int8Array(buffer));
    case "u1":
      return Array.from(new Uint8Array(buffer));
    case "i2":
      return Array.from(new Int16Array(buffer));
    case "u2":
      return Array.from(new Uint16Array(buffer));
    case "i4":
      return Array.from(new Int32Array(buffer));
    case "u4":
      return Array.from(new Uint32Array(buffer));
    default:
      return value;
  }
}

function deepNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(deepNormalize);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const decoded = decodeTypedArray(value);
  if (decoded !== value) {
    return decoded;
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = deepNormalize(val);
  }
  return out;
}

function normalizeFigure(input) {
  if (!input) {
    return null;
  }

  let figure = input;

  if (typeof figure === "string") {
    try {
      figure = JSON.parse(figure);
    } catch (error) {
      console.error("Failed to parse Plotly figure string:", error);
      return null;
    }
  }

  if (
    figure &&
    typeof figure === "object" &&
    !Array.isArray(figure) &&
    figure.figure
  ) {
    figure = figure.figure;
  }

  if (!figure || typeof figure !== "object" || Array.isArray(figure)) {
    return null;
  }

  const normalized = deepNormalize(figure);

  if (!Array.isArray(normalized.data) || normalized.data.length === 0) {
    return null;
  }

  return {
    data: normalized.data,
    layout: normalized.layout ?? {},
    config: normalized.config ?? {},
    frames: normalized.frames ?? [],
  };
}

function PlotlyChart({ figure }) {
  const normalized = useMemo(() => normalizeFigure(figure), [figure]);

  if (!normalized) {
    return null;
  }

  return (
    <div className="chart-panel" style={{ width: "100%", height: "100%" }}>
      <Plot
        className="chart-plot"
        data={normalized.data}
        layout={{
          autosize: true,
          margin: { l: 48, r: 24, t: 60, b: 48 },
          ...normalized.layout,
        }}
        config={{
          responsive: true,
          displaylogo: false,
          ...normalized.config,
        }}
        frames={normalized.frames}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

export default PlotlyChart;