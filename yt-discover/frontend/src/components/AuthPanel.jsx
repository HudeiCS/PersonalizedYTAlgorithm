import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/** Account control that lives in the top-right of the header. Signed out it's
 *  a compact "Sign in" pill; signed in it's a circular avatar button. Both open
 *  the same small dropdown — disclosure + Google button when signed out,
 *  account actions when signed in — so the header stays uncluttered. */
export default function AuthPanel({ user, onLoggedOut }) {
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

  async function handleRevoke() {
    await api.revoke();
    setOpen(false);
    onLoggedOut();
  }
  async function handleLogout() {
    await api.logout();
    setOpen(false);
    onLoggedOut();
  }

  return (
    <div className="account" ref={wrapRef}>
      <button
        type="button"
        className={`account-trigger${user ? " is-signed-in" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user ? `Account menu for ${user.name}` : "Sign in"}
        onClick={() => setOpen((v) => !v)}
      >
        {user ? (
          <Avatar url={user.avatarUrl} name={user.name} />
        ) : (
          <>
            <PersonIcon />
            <span className="account-trigger-label">Sign in</span>
          </>
        )}
      </button>

      {open && (
        <div className="account-menu" role="menu" aria-label="Account">
          {user ? (
            <>
              <div className="account-menu-head">
                <div className="name">{user.name}</div>
                {user.email && <div className="email">{user.email}</div>}
              </div>
              <button type="button" role="menuitem" className="account-menu-item" onClick={handleLogout}>
                Sign out
              </button>
              {/* "Revoke" and "Sign out" read almost alike; spelling out the
                  consequence keeps the destructive one from being picked by
                  mistake from a screen reader's menu-item list. */}
              <button
                type="button"
                role="menuitem"
                className="account-menu-item danger"
                onClick={handleRevoke}
                aria-label="Revoke access — permanently disconnect this app from your Google account"
              >
                Revoke access
              </button>
            </>
          ) : (
            <>
              <p className="account-menu-note">
                Optional. Sign in and we'll blend your existing subscriptions
                into the taste profile so recommendations aren't just keyword
                matches. Google's own consent screen requests only{" "}
                <code>youtube.readonly</code> and basic profile info — we never
                post, upload, or modify anything, and you can revoke access
                anytime from here.
              </p>
              <a className="btn-google" href={api.loginUrl()} role="menuitem">
                <GoogleMark /> Continue with Google
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function initialsOf(name) {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Google serves profile photos from lh3.googleusercontent.com, which returns
 *  HTTP 429 for hotlinked requests that carry a Referer header. referrerPolicy
 *  strips that; onError falls back to an initials bubble so a throttled or
 *  missing photo degrades gracefully instead of rendering blank. */
function Avatar({ url, name }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <span className="avatar-fallback" aria-hidden="true">
        {initialsOf(name)}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.5 19c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
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
