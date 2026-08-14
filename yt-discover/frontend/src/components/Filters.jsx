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
    // fieldset/legend groups these four unrelated-looking controls into one
    // named set, so a screen reader announces "Filters" as context when
    // landing on any of them rather than four loose inputs.
    <fieldset className="filter-row">
      <legend className="sr-only">Filters</legend>

      <div className="filter-field">
        <label htmlFor="filter-duration">Duration</label>
        <select
          id="filter-duration"
          value={value.duration}
          onChange={(e) => set("duration", e.target.value)}
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="filter-field">
        <label htmlFor="filter-age">Uploaded</label>
        <select
          id="filter-age"
          value={value.age}
          onChange={(e) => set("age", e.target.value)}
        >
          {AGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="filter-toggle">
        <input
          id="filter-shorts"
          type="checkbox"
          checked={value.includeShorts}
          onChange={(e) => set("includeShorts", e.target.checked)}
        />
        <label htmlFor="filter-shorts">Include Shorts</label>
      </div>

      {showSubscriptionsToggle && (
        <div className="filter-toggle">
          <input
            id="filter-subscriptions"
            type="checkbox"
            checked={value.useSubscriptions}
            onChange={(e) => set("useSubscriptions", e.target.checked)}
          />
          <label htmlFor="filter-subscriptions">Factor in my subscriptions</label>
        </div>
      )}
    </fieldset>
  );
}
