import { useEffect, useRef, useState } from "react";

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
      <div className="field-label-row">
        <label className="field-label" htmlFor="genre-input">
          Topics, genres or creators to search for
        </label>
        <SearchHelp />
      </div>

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
          placeholder={genres.length ? "add another..." : "e.g. cozy cooking, or @creator for more like them"}
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

/** The field accepts three different kinds of input and combines them in a
 *  way that isn't guessable from a placeholder, so the rules live behind an
 *  "i" rather than in permanent text that would crowd the form. */
function SearchHelp() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="search-help" ref={wrapRef}>
      <button
        type="button"
        className="search-help-trigger"
        aria-expanded={open}
        aria-label="How to use the search field"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">i</span>
      </button>

      {open && (
        <div className="search-help-panel" role="dialog" aria-label="How to use the search field">
          <dl>
            <dt>Search a topic</dt>
            <dd>
              Type something like <code>cozy cooking</code>. Press Enter or
              click away to add it.
            </dd>

            <dt>Find creators like one you know</dt>
            <dd>
              Type their YouTube handle, starting with <code>@</code>. Sift
              finds other creators like them, including small ones a normal
              search will not turn up.
            </dd>

            <dt>Add more than one topic</dt>
            <dd>
              Your topics get joined into a single search.{" "}
              <code>video essays</code> plus <code>video games</code> becomes
              &ldquo;video essays on video games&rdquo;. You get one set of
              results instead of a separate block for each topic.
            </dd>

            <dt>Use both at once</dt>
            <dd>
              <code>@creator</code> plus <code>film photography</code> runs the
              creator lookup and the topic search separately. Each one gets its
              own set of results.
            </dd>
          </dl>
          <p className="search-help-foot">
            Press Backspace in an empty box to remove the last topic.
          </p>
        </div>
      )}
    </span>
  );
}
