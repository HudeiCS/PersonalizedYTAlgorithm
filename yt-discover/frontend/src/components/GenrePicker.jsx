import { useState } from "react";

// Generic topics, unrelated to anyone's account. Two separate jobs:
//   - starter chips: when signed in, App's `suggestedTopics` (drawn from the
//     user's subscriptions) go first and this list backfills behind them.
//   - "surprise me": draws from this list *only*. The point of the button is
//     to throw out something from outside your usual orbit, so pulling from
//     your own subscriptions would defeat it.
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
  // Suggestions the user has already been offered and taken. Once spent, a
  // suggestion is gone for the session: removing its chip frees a slot for a
  // *new* suggestion instead of handing the same one back.
  const [spent, setSpent] = useState(() => new Set());

  // Starter chips: subscription-derived topics first, generic ones behind
  // them as backfill, so the queue never runs dry once the personalised few
  // are spent.
  const queue = [...new Set([...suggestedTopics, ...SUGGESTIONS])];
  const available = queue.filter((s) => !spent.has(s) && !genres.includes(s));
  const starters = available.slice(0, STARTER_COUNT);

  // "Surprise me" ignores the subscription topics entirely and only ever
  // offers a generic one.
  const surprisePool = SUGGESTIONS.filter(
    (s) => !spent.has(s) && !genres.includes(s)
  );

  function takeSuggestion(value) {
    setSpent((prev) => new Set(prev).add(value));
    addGenre(value);
  }

  function surpriseMe() {
    // Prefer something not yet offered; once the generic list is used up,
    // fall back to any generic topic not currently selected rather than
    // dead-ending — still never a subscription topic.
    const pool = surprisePool.length
      ? surprisePool
      : SUGGESTIONS.filter((s) => !genres.includes(s));
    if (pool.length === 0) {
      setAnnouncement("No more suggestions to try.");
      return;
    }
    takeSuggestion(pool[Math.floor(Math.random() * pool.length)]);
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
            onClick={() => takeSuggestion(s)}
          >
            <span aria-hidden="true">+ </span>{s}
          </button>
        ))}
      </div>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    </div>
  );
}
