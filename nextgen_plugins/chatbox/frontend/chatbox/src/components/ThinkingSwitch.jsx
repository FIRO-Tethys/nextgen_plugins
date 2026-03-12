import "./ThinkingSwitch.css";

function ThinkingSwitch({ checked, onChange, disabled = false }) {
  return (
    <label className="thinking-switch" aria-label="Toggle thinking stream">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="thinking-switch-track" aria-hidden="true">
        <span className="thinking-switch-thumb" />
      </span>
      <span className="thinking-switch-label">Thinking</span>
    </label>
  );
}

export default ThinkingSwitch;
