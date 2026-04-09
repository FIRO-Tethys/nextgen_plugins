/**
 * QueryPanel (generic)
 *
 * Displays tabular data. Accepts data directly via `data` prop
 * or reactively via `variableInputValues[dataKey]`.
 */
import { panelStyle, panelEmptyStyle } from "./panelStyles.js";

function parseRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  const keys = Object.keys(data);
  if (keys.length === 0) return [];

  const firstVal = data[keys[0]];
  if (Array.isArray(firstVal)) {
    const len = firstVal.length;
    const rows = [];
    for (let i = 0; i < len; i++) {
      const row = {};
      for (const key of keys) {
        row[key] = Array.isArray(data[key]) ? data[key][i] : data[key];
      }
      rows.push(row);
    }
    return rows;
  }

  return [data];
}

function getColumns(rows) {
  if (rows.length === 0) return [];
  const colSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      colSet.add(key);
    }
  }
  return Array.from(colSet);
}

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function QueryPanel({
  data,
  dataKey = "chatbox_query",
  variableInputValues,
}) {
  const queryData = data || variableInputValues?.[dataKey];

  if (!queryData) {
    return (
      <div style={panelEmptyStyle}>
        <p>Query results will appear here</p>
      </div>
    );
  }

  const response = queryData.data ?? queryData;
  const rows = parseRows(response?.data ?? response);
  const columns = response?.columns ?? getColumns(rows);

  return (
    <div
      style={{
        ...panelStyle,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #eee",
          background: "#f8f9fa",
          fontSize: "0.75rem",
          color: "#666",
          flexShrink: 0,
        }}
      >
        {rows.length} row{rows.length !== 1 ? "s" : ""}
        {columns.length > 0
          ? ` \u00d7 ${columns.length} column${columns.length !== 1 ? "s" : ""}`
          : ""}
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {columns.length > 0 ? (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.82rem",
            }}
          >
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    style={{
                      position: "sticky",
                      top: 0,
                      padding: "6px 10px",
                      textAlign: "left",
                      borderBottom: "2px solid #ddd",
                      background: "#f0f2f5",
                      fontWeight: 600,
                      color: "#333",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      style={{
                        padding: "5px 10px",
                        borderBottom: "1px solid #eee",
                        color: "#444",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: "12px", color: "#888" }}>No data returned</div>
        )}
      </div>
    </div>
  );
}
