import "./ModelSelector.css";

function ModelSelector({ value, options, onChange, disabled = false }) {
  return (
    <label className="model-selector">
      <span>Model</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default ModelSelector;
