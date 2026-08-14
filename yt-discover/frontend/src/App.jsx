import { useEffect, useState } from "react";
import { api } from "./api";
import GenrePicker from "./components/GenrePicker.jsx";
import DiscoverabilitySlider from "./components/DiscoverabilitySlider.jsx";
import Filters from "./components/Filters.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import CreatorCard from "./components/CreatorCard.jsx";

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
  const [error, setError] = useState(null);
  const [authNotice, setAuthNotice] = useState(null);
  const [poolMeta, setPoolMeta] = useState(null);
  const [feedbackGiven, setFeedbackGiven] = useState({}); // videoId -> "liked" | "dismissed"
  // Mirrors the last feedback action into a live region. Without this the
  // only confirmation a click landed is a colour change, which a screen
  // reader user never perceives.
  const [feedbackAnnouncement, setFeedbackAnnouncement] = useState("");

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
      } else {
        setUser(null);
      }
    } finally {
      setCheckingAuth(false);
    }
  }

  async function handleFind() {
    if (genres.length === 0) return;
    setLoading(true);
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
      </header>

      <main className="shell" id="main-content">
        <div className="hero">
          <h1>Find the creators the algorithm buries.</h1>
          <p>
            Type the kind of videos you're after — a genre, a game, an edit
            style — and Sift builds a taste profile from that plus your real
            subscriptions, then ranks creators on topic fit, engagement, and
            how likely you are to have already seen them.
          </p>
        </div>

        <div className="mesh" aria-hidden="true" />

        {authNotice === "declined" && (
          <Notice tone="muted">You declined the Google consent screen — no problem, genre-only discovery still works below.</Notice>
        )}
        {authNotice === "error" && <Notice tone="error">Something went wrong finishing sign-in. Try again.</Notice>}
        {authNotice === "insufficient_scope" && (
          <Notice tone="error">Google didn't grant the YouTube read scope, so we can't read subscriptions. Try signing in again and approving that permission.</Notice>
        )}

        {!checkingAuth && <AuthPanel user={user} onLoggedOut={() => { setUser(null); }} />}

        <section className="panel" aria-labelledby="search-heading">
          <h2 id="search-heading">What are you in the mood for?</h2>
          <GenrePicker genres={genres} onChange={setGenres} />
          <DiscoverabilitySlider value={discoverability} onChange={setDiscoverability} />
          <Filters value={filters} onChange={setFilters} showSubscriptionsToggle={!!user} />
          <div className="search-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleFind}
              disabled={genres.length === 0 || loading}
              aria-busy={loading}
              aria-describedby="find-hint"
            >
              {loading ? "Sifting..." : "Find creators"}
            </button>
            <span id="find-hint" className="search-hint">
              {genres.length === 0
                ? "Add at least one topic above to search."
                : user
                  ? `Blending ${genres.length} topic${genres.length === 1 ? "" : "s"} with your subscriptions.`
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
                <h2>Ranked results</h2>
                {poolMeta && (
                  <span className="pool-note">
                    scored {poolMeta.size} candidates
                    {poolMeta.usedSubscriptions ? " · using your subscriptions" : " · genre-only (not signed in)"}
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

        <footer className="footer-note">
          {poolMeta?.usingLearnedWeights ? (
            <>scoring uses weights learned from your like/dismiss feedback, blending the same four
            signals below in proportions the model found rather than ones set by hand.<br /></>
          ) : (
            <>scoring = 0.45 × topic-match + 0.15 × engagement + 0.10 × freshness + 0.30 × discoverability<br /></>
          )}
          topic-match is cosine similarity between your typed genres/subscriptions and each candidate's
          title, description, tags and channel bio. discoverability weights small/unsubscribed
          channels higher as you move the slider right.
        </footer>
      </main>
    </>
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
