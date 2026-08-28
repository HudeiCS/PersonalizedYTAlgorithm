import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "./api";
import GenrePicker from "./components/GenrePicker.jsx";
import DiscoverabilitySlider from "./components/DiscoverabilitySlider.jsx";
import Filters from "./components/Filters.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import CreatorCard from "./components/CreatorCard.jsx";

// Lazy so three.js stays out of the main bundle. The hero section's height
// is reserved in CSS, so nothing shifts while the chunk loads.
const HeroRibbon = lazy(() => import("./components/HeroRibbon.jsx"));

/** Turns one genre's coverage stats into an honest plain-English summary.
 *  The backend's backfill ladder can pad a thin topic out to a full page by
 *  showing more than one video from the same channel, or by re-showing
 *  something from earlier in the session — so say so rather than presenting
 *  a padded page as a clean result. */
function formatCeiling(n) {
  if (n == null) return "";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

function coverageNote({
  found,
  requested,
  distinctChannels,
  repeatedChannels,
  replayedSeen,
  smallCreatorCount,
  sizeCeiling,
}) {
  const parts = [`${found} of ${requested} matches`];
  if (repeatedChannels && distinctChannels != null) {
    parts.push(`from ${distinctChannels} channel${distinctChannels === 1 ? "" : "s"}`);
  }
  // Only worth saying when some results *didn't* meet the size preference —
  // otherwise it's noise on a page that's already entirely small creators.
  if (smallCreatorCount != null && smallCreatorCount < found) {
    parts.push(`${smallCreatorCount} under ${formatCeiling(sizeCeiling)} subs`);
  }
  if (replayedSeen) parts.push("includes videos shown earlier");
  if (found < requested) parts.push("try loosening your filters");
  return parts.join(" · ");
}

/** Three starter chips drawn from the user's subscribed channel names, spaced
 *  out across the list so they're not all near-duplicates. Overlong names are
 *  skipped so a chip stays chip-sized. Returns [] if there isn't enough to
 *  work with, which signals GenrePicker to use its generic list. */
function topicsFromSubs(subs) {
  const titles = (subs ?? [])
    .map((s) => (s.title || "").trim().toLowerCase())
    .filter((t) => t.length >= 2 && t.length <= 28);
  const unique = [...new Set(titles)];
  if (unique.length < 3) return [];
  const step = Math.floor(unique.length / 3);
  return [unique[0], unique[step], unique[step * 2]];
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [genres, setGenres] = useState([]);
  const [discoverability, setDiscoverability] = useState(0.6);
  const [filters, setFilters] = useState({
    duration: "any",
    age: "any",
    useSubscriptions: true,
    includeShorts: true,
  });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  // Which control kicked off the current search: "find" or "refresh". Drives
  // where the spinner shows and which of the two buttons greys out.
  const [loadingSource, setLoadingSource] = useState(null);
  const [error, setError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);
  const [poolMeta, setPoolMeta] = useState(null);
  const [feedbackGiven, setFeedbackGiven] = useState({}); // videoId -> "liked" | "dismissed"
  // Mirrors the last feedback action into a live region. Without this the
  // only confirmation a click landed is a colour change, which a screen
  // reader user never perceives.
  const [feedbackAnnouncement, setFeedbackAnnouncement] = useState("");
  // Starter suggestion chips drawn from the signed-in user's own subscriptions
  // (empty when signed out, which makes GenrePicker fall back to its generic
  // list). Fetched once per session; a failure just leaves it generic.
  const [suggestedTopics, setSuggestedTopics] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("auth");
    if (authResult) {
      setAuthNotice(authResult);
      window.history.replaceState({}, "", window.location.pathname);
    }
    refreshAuth();
  }, []);

  async function refreshAuth() {
    setCheckingAuth(true);
    try {
      const { authenticated, user } = await api.me();
      if (authenticated) {
        setUser(user);
        if (user.genres?.length) setGenres(user.genres);
        if (user.discoverability != null) setDiscoverability(user.discoverability);
        api
          .subscriptions()
          .then(({ subscriptions }) => setSuggestedTopics(topicsFromSubs(subscriptions)))
          .catch(() => {});
      } else {
        setUser(null);
        setSuggestedTopics([]);
      }
    } finally {
      setCheckingAuth(false);
    }
  }

  async function handleFind(source = "find") {
    if (genres.length === 0) return;
    setLoading(true);
    setLoadingSource(source);
    setError(null);
    try {
      if (user) api.savePreferences(genres, discoverability).catch(() => {});
      const data = await api.recommendations(genres, discoverability, filters);
      setResults(data.results);
      setPoolMeta({
        usedSubscriptions: data.usedSubscriptions,
        size: data.candidatePoolSize,
        usingLearnedWeights: data.usingLearnedWeights,
        genreCoverage: data.genreCoverage ?? [],
      });
    } catch (err) {
      setError(err.message);
      setResults(null);
    } finally {
      setLoading(false);
      setLoadingSource(null);
    }
  }

  async function handleFeedback(videoId, channelId, features, label, videoTitle) {
    // Optimistic update: mark it given right away so the buttons disable
    // instantly, then roll back only if the request actually fails.
    setFeedbackGiven((prev) => ({ ...prev, [videoId]: label === 1 ? "liked" : "dismissed" }));
    setFeedbackAnnouncement(
      label === 1 ? `Liked ${videoTitle}.` : `Dismissed ${videoTitle}. You won't be shown this again.`
    );
    try {
      await api.feedback(videoId, channelId, features, label);
    } catch (err) {
      setFeedbackGiven((prev) => {
        const next = { ...prev };
        delete next[videoId];
        return next;
      });
      setFeedbackAnnouncement(`Couldn't save your feedback on ${videoTitle}. Please try again.`);
    }
  }

  // 4.1.3 Status Messages — results arrive by replacing DOM well below the
  // button that triggered them, which a screen reader announces not at all.
  // This sentence is what a non-sighted user actually hears happen.
  const searchStatus = loading
    ? "Searching YouTube for creators…"
    : results
      ? results.length === 0
        ? "No matches found."
        : `Found ${results.length} recommendation${results.length === 1 ? "" : "s"} across ${
            poolMeta?.genreCoverage?.length ?? 0
          } topic${(poolMeta?.genreCoverage?.length ?? 0) === 1 ? "" : "s"}.`
      : "";

  return (
    <>
      <a className="skip-link" href="#results">Skip to results</a>

      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          Sift
          <span className="tagline">creator discoverability engine</span>
        </div>
        {!checkingAuth && <AuthPanel user={user} onLoggedOut={() => { setUser(null); }} />}
      </header>

      <main id="main-content">
        {/* Decorative shader ribbon: a see-through mesh of favicon diamonds
            sweeping from the left edge up toward the top right, behind the
            hero copy and the top of the UI. Hidden from assistive tech;
            frozen to one frame under reduced-motion; paused offscreen and
            on hidden tabs; static gradient fallback without WebGL. All
            tunables live in the config object at the top of HeroRibbon.jsx. */}
        <Suspense fallback={null}>
          <HeroRibbon />
        </Suspense>

        <section className="hero-viewport">
          <div className="hero-copy">
            <h1>Find the creators the algorithm buries.</h1>
            <p>
              Tell Sift a few things you like to watch, such as a genre, a game,
              or an editing style. It uses that along with the channels you
              already follow to find videos from creators you'd probably enjoy
              but haven't come across yet.
            </p>
          </div>
        </section>

        <div className="shell">
        {authNotice === "declined" && (
          <Notice tone="muted">You declined the Google consent screen — no problem, genre-only discovery still works below.</Notice>
        )}
        {authNotice === "error" && <Notice tone="error">Something went wrong finishing sign-in. Try again.</Notice>}
        {authNotice === "insufficient_scope" && (
          <Notice tone="error">Google didn't grant the YouTube read scope, so we can't read subscriptions. Try signing in again and approving that permission.</Notice>
        )}

        <section className="panel" aria-labelledby="search-heading">
          <h2 id="search-heading">What are you in the mood for?</h2>
          <GenrePicker genres={genres} onChange={setGenres} suggestedTopics={suggestedTopics} />
          <DiscoverabilitySlider value={discoverability} onChange={setDiscoverability} />
          <Filters value={filters} onChange={setFilters} showSubscriptionsToggle={!!user} />
          <div className="search-actions">
            <button
              type="button"
              className={`btn-primary${loadingSource === "refresh" ? " is-muted" : ""}`}
              onClick={() => handleFind("find")}
              disabled={genres.length === 0 || loading}
              aria-busy={loadingSource === "find"}
              aria-describedby="find-hint"
            >
              {loadingSource === "find" && <RefreshIcon />}
              {loadingSource === "find" ? "Sifting..." : "Find creators"}
            </button>
            <span id="find-hint" className="search-hint">
              {genres.length === 0
                ? "Add at least one topic above to search."
                : `Searching ${genres.length} topic${genres.length === 1 ? "" : "s"}.`}
            </span>
          </div>
        </section>

        {/* Politely announced; visually rendered elsewhere. */}
        <div className="sr-only" role="status" aria-live="polite">{searchStatus}</div>
        <div className="sr-only" role="status" aria-live="polite">{feedbackAnnouncement}</div>

        {error && (
          <div className="status-text error" role="alert">{error}</div>
        )}

        <section id="results" aria-label="Results" tabIndex={-1}>
          {results && (
            <>
              <div className="results-header">
                <div className="results-header-title">
                  <h2>Ranked results</h2>
                  <button
                    type="button"
                    className={`btn-refresh${loading && loadingSource !== "refresh" ? " is-muted" : ""}`}
                    onClick={() => handleFind("refresh")}
                    disabled={loading || genres.length === 0}
                    aria-busy={loadingSource === "refresh"}
                    aria-label="Refresh results — run the search again for a new set of creators"
                  >
                    <RefreshIcon />
                    {loadingSource === "refresh" ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                {poolMeta && (
                  <span className="pool-note">
                    scored {poolMeta.size} candidates
                    {poolMeta.usedSubscriptions ? " · using your subscriptions" : " · genre-only"}
                  </span>
                )}
              </div>
              {results.length === 0 ? (
                <p className="status-text">No strong matches — try a broader or different genre, or loosen your filters.</p>
              ) : (
                (poolMeta?.genreCoverage ?? []).map((coverage) => {
                  const { genre } = coverage;
                  const items = results.filter((r) => r.matchedGenre === genre);
                  const headingId = `genre-${genre.replace(/\W+/g, "-")}`;
                  return (
                    <section className="genre-section" key={genre} aria-labelledby={headingId}>
                      <div className="genre-section-header">
                        <h3 id={headingId}>{genre}</h3>
                        <span className="genre-count">{coverageNote(coverage)}</span>
                      </div>
                      {items.length === 0 ? (
                        <p className="genre-empty">No matches for this topic with the current filters.</p>
                      ) : (
                        <ul className="grid">
                          {items.map((r) => (
                            <li key={r.video.id}>
                              <CreatorCard
                                result={r}
                                feedbackState={feedbackGiven[r.video.id]}
                                onFeedback={handleFeedback}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })
              )}
            </>
          )}
        </section>
        </div>
      </main>
    </>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M20 11a8 8 0 1 0-.6 3M20 5v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Notice({ tone, children }) {
  return (
    <div
      className="panel"
      role={tone === "error" ? "alert" : "status"}
      style={{
        borderColor: tone === "error" ? "var(--danger)" : "var(--border)",
        color: tone === "error" ? "var(--danger)" : "var(--text-muted)",
        fontSize: 13.5,
      }}
    >
      {children}
    </div>
  );
}
