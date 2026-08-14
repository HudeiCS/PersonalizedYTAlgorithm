import { api } from "../api";

export default function AuthPanel({ user, onLoggedOut }) {
  async function handleRevoke() {
    await api.revoke();
    onLoggedOut();
  }
  async function handleLogout() {
    await api.logout();
    onLoggedOut();
  }

  if (!user) {
    return (
      <section className="panel" aria-labelledby="auth-heading">
        <h2 id="auth-heading">Connect your YouTube account</h2>
        <div className="auth-row">
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14, maxWidth: 420 }}>
            Optional. Sign in and we'll blend your existing subscriptions into
            the taste profile so recommendations aren't just keyword matches.
          </p>
          <a className="btn-google" href={api.loginUrl()} aria-describedby="consent-notice">
            <GoogleMark /> Sign in with Google
          </a>
        </div>
        <p className="consent-notice" id="consent-notice">
          You'll see Google's own consent screen next, requesting only{" "}
          <code>youtube.readonly</code> (your subscriptions and public
          channel data) and basic profile info. We never post, upload, or
          modify anything on your account, and you can revoke access anytime
          from this page or from your Google Account settings.
        </p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Signed-in account">
      <div className="auth-row">
        <div className="user-chip">
          {user.avatarUrl && <img src={user.avatarUrl} alt="" />}
          <div>
            <div className="name">{user.name}</div>
            <div className="scope-note">granted: youtube.readonly · profile · email</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={handleLogout}>
            Sign out
          </button>
          {/* "Revoke" and "Sign out" sit side by side and read almost alike;
              spelling out the consequence keeps the destructive one from
              being picked by mistake from a screen reader's button list. */}
          <button
            type="button"
            className="btn-ghost"
            onClick={handleRevoke}
            style={{ color: "var(--danger)" }}
            aria-label="Revoke access — permanently disconnect this app from your Google account"
          >
            Revoke access
          </button>
        </div>
      </div>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4C29.6 35.4 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.4C41.4 35.9 44 30.4 44 24c0-1.3-.1-2.7-.4-3.5z"/>
    </svg>
  );
}
