const DURATION_OPTIONS = [
  { value: "any", label: "Any length" },
  { value: "under1", label: "Under 1 min" },
  { value: "under5", label: "Under 5 min" },
  { value: "under10", label: "Under 10 min" },
  { value: "over10", label: "Over 10 min" },
];

const AGE_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Past 24 hours" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
];

export default function Filters({ value, onChange, showSubscriptionsToggle }) {
  function set(key, fieldValue) {
    onChange({ ...value, [key]: fieldValue });
  }

  return (
    <div className="filter-row">
      <label className="filter-field">
        <span>Duration</span>
        <select value={value.duration} onChange={(e) => set("duration", e.target.value)}>
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        <span>Uploaded</span>
        <select value={value.age} onChange={(e) => set("age", e.target.value)}>
          {AGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>

      {showSubscriptionsToggle && (
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={value.useSubscriptions}
            onChange={(e) => set("useSubscriptions", e.target.checked)}
          />
          <span>Factor in my subscriptions</span>
        </label>
      )}
    </div>
  );
}
