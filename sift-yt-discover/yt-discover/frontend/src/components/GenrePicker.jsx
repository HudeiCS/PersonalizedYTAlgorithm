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

  function addGenre(value) {
    const clean = value.trim().toLowerCase();
    if (!clean || genres.includes(clean)) return;
    onChange([...genres, clean]);
    setDraft("");
  }

  function removeGenre(value) {
    onChange(genres.filter((g) => g !== value));
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
      <div className="chip-input">
        {genres.map((g) => (
          <span className="chip" key={g}>
            {g}
            <button aria-label={`remove ${g}`} onClick={() => removeGenre(g)}>×</button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={genres.length ? "add another..." : "e.g. minecraft edits, cozy cooking..."}
        />
      </div>
      <div className="suggestions">
        {SUGGESTIONS.filter((s) => !genres.includes(s)).map((s) => (
          <button key={s} className="suggestion-btn" onClick={() => addGenre(s)}>
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}
