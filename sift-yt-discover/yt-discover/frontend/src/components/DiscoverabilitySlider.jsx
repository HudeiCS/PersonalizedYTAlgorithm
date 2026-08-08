export default function DiscoverabilitySlider({ value, onChange }) {
  return (
    <div className="slider-row-wrap">
      <div className="slider-row">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
          discoverability
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gold)" }}>
          {Math.round(value * 100)}%
        </span>
      </div>
      <div className="slider-labels">
        <span>popular creators are fine</span>
        <span>surface small/new creators only</span>
      </div>
    </div>
  );
}
