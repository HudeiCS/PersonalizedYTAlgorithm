import { useEffect, useState } from "react";
import { api } from "./api";
import GenrePicker from "./components/GenrePicker.jsx";
import DiscoverabilitySlider from "./components/DiscoverabilitySlider.jsx";
import Filters from "./components/Filters.jsx";
import AuthPanel from "./components/AuthPanel.jsx";
import CreatorCard from "./components/CreatorCard.jsx";

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

  async function handleFeedback(videoId, channelId, features, label) {
    // Optimistic update: mark it given right away so the buttons disable
    // instantly, then roll back only if the request actually fails.
    setFeedbackGiven((prev) => ({ ...prev, [videoId]: label === 1 ? "liked" : "dismissed" }));
    try {
      await api.feedback(videoId, channelId, features, label);
    } catch (err) {
      setFeedbackGiven((prev) => {
        const next = { ...prev };
        delete next[videoId];
        return next;
      });
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="mark" />
          Sift
          <span className="tagline">creator discoverability engine</span>
        </div>
      </div>

      <div className="shell">
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

        <div className="panel">
          <h2>What are you in the mood for?</h2>
          <GenrePicker genres={genres} onChange={setGenres} />
          <DiscoverabilitySlider value={discoverability} onChange={setDiscoverability} />
          <Filters value={filters} onChange={setFilters} showSubscriptionsToggle={!!user} />
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 14 }}>
            <button className="btn-primary" onClick={handleFind} disabled={genres.length === 0 || loading}>
              {loading ? "Sifting..." : "Find creators"}
            </button>
            {user && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                blending {genres.length} genre{genres.length === 1 ? "" : "s"} with your subscriptions
              </span>
            )}
          </div>
        </div>

        {error && <div className="status-text error">{error}</div>}

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
              <div className="status-text">No strong matches — try a broader or different genre, or loosen your filters.</div>
            ) : (
              (poolMeta?.genreCoverage ?? []).map(({ genre, found, requested }) => {
                const items = results.filter((r) => r.matchedGenre === genre);
                return (
                  <div className="genre-section" key={genre}>
                    <div className="genre-section-header">
                      <h3>{genre}</h3>
                      <span className="genre-count">
                        {found} of {requested} matches
                        {found < requested && " · try loosening your filters"}
                      </span>
                    </div>
                    {items.length === 0 ? (
                      <div className="genre-empty">No matches for this topic with the current filters.</div>
                    ) : (
                      <div className="grid">
                        {items.map((r) => (
                          <CreatorCard
                            key={r.video.id}
                            result={r}
                            feedbackState={feedbackGiven[r.video.id]}
                            onFeedback={handleFeedback}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        <div className="footer-note">
          {poolMeta?.usingLearnedWeights ? (
            <>scoring uses weights learned from your like/dismiss feedback, blending the same four
            signals below in proportions the model found rather than ones set by hand.<br /></>
          ) : (
            <>scoring = 0.45 × topic-match + 0.15 × engagement + 0.10 × freshness + 0.30 × discoverability<br /></>
          )}
          topic-match is cosine similarity between your typed genres/subscriptions and each candidate's
          title, description, tags and channel bio. discoverability weights small/unsubscribed
          channels higher as you move the slider right.
        </div>
      </div>
    </>
  );
}

function Notice({ tone, children }) {
  return (
    <div
      className="panel"
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
