import { useState } from "react";

// Generic starter chips for signed-out visitors. When signed in, App passes
// `suggestedTopics` derived from the user's own subscriptions and those take
// the three starter slots instead. "Surprise me" always draws from this
// generic list (minus what's already added and its own last pick), so
// repeated presses keep turning up something different.
const SUGGESTIONS = [
  "minecraft edits",
  "valorant highlights",
  "cozy cooking",
  "lo-fi study mixes",
  "indie game devlogs",
  "video essays",
  "speedrunning",
  "retro tech teardown",
  "bouldering",
  "film photography",
  "synth patching",
  "urban sketching",
  "trail running",
  "home barista",
  "keyboard builds",
  "tabletop rpg actual play",
];

const STARTER_COUNT = 3;

export default function GenrePicker({ genres, onChange, suggestedTopics = [] }) {
  const [draft, setDraft] = useState("");
  // Chips appearing and disappearing is a purely visual event otherwise —
  // this is what makes add/remove perceivable without sight.
  const [announcement, setAnnouncement] = useState("");
  // Remembered so "Surprise me" never hands back the same topic twice in a row.
  const [lastSurprise, setLastSurprise] = useState(null);

  function surpriseMe() {
    const pool = SUGGESTIONS.filter(
      (s) => !genres.includes(s) && s !== lastSurprise
    );
    if (pool.length === 0) {
      setAnnouncement("No more suggestions to try.");
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setLastSurprise(pick);
    addGenre(pick);
  }

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

  const starterPool = suggestedTopics.length ? suggestedTopics : SUGGESTIONS;
  const starters = starterPool
    .filter((s) => !genres.includes(s))
    .slice(0, STARTER_COUNT);

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
          onBlur={() => addGenre(draft)}
          placeholder={genres.length ? "add another..." : "e.g. minecraft edits, cozy cooking..."}
        />
      </div>

      <div className="suggestions" role="group" aria-label="Suggested topics">
        <button
          type="button"
          className="suggestion-btn surprise"
          aria-label="Surprise me: add a random topic"
          onClick={surpriseMe}
        >
          <span aria-hidden="true">✦ </span>surprise me
        </button>
        {starters.map((s) => (
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
