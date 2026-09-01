import { useState } from "react";

/** Describes the slider position in words. A range input announces only its
 *  raw number ("0.6"), which is meaningless here — aria-valuetext replaces
 *  that with what the number actually does to the results. */
function valueText(value) {
  const pct = Math.round(value * 100);
  if (value <= 0.15) return `${pct} percent — popular creators are fine`;
  if (value <= 0.45) return `${pct} percent — leaning towards popular creators`;
  if (value <= 0.65) return `${pct} percent — balanced`;
  if (value <= 0.85) return `${pct} percent — leaning towards small and new creators`;
  return `${pct} percent — surface small and new creators only`;
}

export default function DiscoverabilitySlider({ value, onChange }) {
  // While the percentage is being typed into, the field holds the raw
  // keystrokes; null means "not editing, show the slider's own value".
  const [draft, setDraft] = useState(null);
  const pct = Math.round(value * 100);
  const shown = draft ?? String(pct);

  function commit() {
    const n = parseInt(shown, 10);
    if (!Number.isNaN(n)) onChange(Math.min(100, Math.max(0, n)) / 100);
    setDraft(null);
  }

  return (
    <div className="slider-row-wrap">
      <div className="slider-row">
        {/* Was an unlabelled <span>, so the control had no accessible name
            (WCAG 4.1.2). A real <label> also makes the text a click target. */}
        <span className="slider-heading">
          <label className="slider-label" htmlFor="discoverability">
            discoverability
          </label>
          {/* Typable shortcut for the slider. Styled to be indistinguishable
              from the plain text it replaced, and held at a fixed three-digit
              width: sizing it to the current value made the whole heading
              change width as the number went 5 -> 60 -> 100, which shoved the
              track and the labels under it sideways while dragging. */}
          <span className="slider-value">
            <input
              type="text"
              inputMode="numeric"
              value={shown}
              aria-label="Discoverability percentage"
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 3))}
              onFocus={(e) => e.target.select()}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setDraft(null);
              }}
            />
            %
          </span>
        </span>
        <div className="slider-track">
          <input
            id="discoverability"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={value}
            aria-valuetext={valueText(value)}
            aria-describedby="discoverability-hint"
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <div className="slider-labels" id="discoverability-hint">
            <span>popular creators</span>
            <span>small creators</span>
          </div>
        </div>
      </div>
    </div>
  );
}
