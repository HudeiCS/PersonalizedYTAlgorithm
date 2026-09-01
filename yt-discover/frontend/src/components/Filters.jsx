const DURATION_OPTIONS = [
  { value: "any", label: "Any length" },
  { value: "under1", label: "< 1 min" },
  { value: "under5", label: "< 5 min" },
  { value: "under10", label: "< 10 min" },
  { value: "over10", label: "> 10 min" },
];

const AGE_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "today", label: "Past 24 hours" },
  { value: "week", label: "Past week" },
  { value: "month", label: "Past month" },
  { value: "year", label: "Past year" },
];

/** A <select> sized to the option it is currently showing, rather than to its
 *  widest option the way a native select is. The visible label is rendered a
 *  second time as a hidden sizer stacked in the same grid cell; the cell takes
 *  that width, and the select (appearance stripped, min-width released) fills
 *  it. Without this the box stays as wide as "Past 24 hours" forever and the
 *  arrow sits marooned against the far border. */
function Select({ id, options, value, onChange }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <span className="select-wrap">
      <select id={id} value={value} onChange={onChange}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <span className="select-sizer" aria-hidden="true">{current.label}</span>
    </span>
  );
}

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
        <Select
          id="filter-duration"
          options={DURATION_OPTIONS}
          value={value.duration}
          onChange={(e) => set("duration", e.target.value)}
        />
      </div>

      <div className="filter-field">
        <label htmlFor="filter-age">Uploaded</label>
        <Select
          id="filter-age"
          options={AGE_OPTIONS}
          value={value.age}
          onChange={(e) => set("age", e.target.value)}
        />
      </div>

      <div className="filter-toggle">
        <input
          id="filter-shorts"
          type="checkbox"
          checked={value.includeShorts}
          onChange={(e) => set("includeShorts", e.target.checked)}
        />
        <label htmlFor="filter-shorts">Shorts</label>
      </div>

      {showSubscriptionsToggle && (
        <div className="filter-toggle">
          <input
            id="filter-subscriptions"
            type="checkbox"
            checked={value.useSubscriptions}
            onChange={(e) => set("useSubscriptions", e.target.checked)}
          />
          <label htmlFor="filter-subscriptions">Factor in Subscriptions</label>
        </div>
      )}
    </fieldset>
  );
}
