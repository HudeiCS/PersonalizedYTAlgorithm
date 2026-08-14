import { useState } from "react";

const SUGGESTIONS = [
  "minecraft edits",
  "valorant highlights",
  "cozy cooking",
  "lo-fi study mixes",
  "indie game devlogs",
  "video essays",
  "speedrunning",
  "retro tech teardown",
];

export default function GenrePicker({ genres, onChange }) {
  const [draft, setDraft] = useState("");
  // Chips appearing and disappearing is a purely visual event otherwise —
  // this is what makes add/remove perceivable without sight.
  const [announcement, setAnnouncement] = useState("");

  function addGenre(value) {
    const clean = value.trim().toLowerCase();
    if (!clean) return;
    if (genres.includes(clean)) {
      setAnnouncement(`${clean} is already added.`);
      return;
    }
    onChange([...genres, clean]);
    setDraft("");
    setAnnouncement(`Added topic ${clean}. ${genres.length + 1} total.`);
  }

  function removeGenre(value) {
    onChange(genres.filter((g) => g !== value));
    setAnnouncement(`Removed topic ${value}. ${genres.length - 1} remaining.`);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addGenre(draft);
    } else if (e.key === "Backspace" && draft === "" && genres.length) {
      removeGenre(genres[genres.length - 1]);
    }
  }

  return (
    <div>
      {/* The field had no label at all before — only a placeholder, which
          disappears on typing and is not a substitute for a label
          (WCAG 3.3.2). */}
      <label className="field-label" htmlFor="genre-input">
        Topics, genres or creators to search for
      </label>

      <div className="chip-input">
        {genres.length > 0 && (
          <ul className="chip-list" aria-label="Selected topics">
            {genres.map((g) => (
              <li className="chip" key={g}>
                <span>{g}</span>
                <button type="button" aria-label={`Remove topic ${g}`} onClick={() => removeGenre(g)}>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          id="genre-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby="genre-input-hint"
          placeholder={genres.length ? "add another..." : "e.g. minecraft edits, cozy cooking..."}
        />
      </div>

      <p id="genre-input-hint" className="field-hint">
        Type a topic and press Enter to add it. Press Backspace in an empty
        field to remove the last one.
      </p>

      <div className="suggestions" role="group" aria-label="Suggested topics">
        {SUGGESTIONS.filter((s) => !genres.includes(s)).map((s) => (
          <button
            key={s}
            type="button"
            className="suggestion-btn"
            aria-label={`Add suggested topic ${s}`}
            onClick={() => addGenre(s)}
          >
            <span aria-hidden="true">+ </span>{s}
          </button>
        ))}
      </div>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  );
}
