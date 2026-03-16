import "./ModelSelector.css";

function ModelSelector({ value, options, onChange, disabled = false, isLoading = false }) {
  const modelOptions = Array.isArray(options) ? options : [];
  const hasOptions = modelOptions.length > 0;
  const selectValue = hasOptions ? value : "";

  return (
    <label className="model-selector">
      <span>{isLoading ? "Model (loading...)" : "Model"}</span>
      <select
        value={selectValue}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || isLoading || !hasOptions}
      >
        {hasOptions ? (
          modelOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))
        ) : (
          <option value="">No models available</option>
        )}
      </select>
    </label>
  );
}

export default ModelSelector;
