import { Router } from "express";
import crypto from "crypto";
import { google } from "googleapis";
import { createOAuthClient, buildConsentUrl } from "../config/googleOAuth.js";
import { upsertUser, revokeUser, getUser } from "../db/store.js";

const router = Router();

// STEP 1 — kick off consent. We generate a random `state` token and stash it
// in the (signed) session cookie so the callback can confirm the redirect
// wasn't forged (CSRF protection on the OAuth handshake).
router.get("/google", (req, res) => {
  const client = createOAuthClient();
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  res.redirect(buildConsentUrl(client, state));
});

// STEP 2 — Google redirects back here with either `code` (user clicked
// Allow) or `error=access_denied` (user clicked Cancel on the consent
// screen). We handle both explicitly rather than assuming success.
router.get("/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const frontend = process.env.FRONTEND_URL;

  if (error) {
    // User declined consent. This is a normal, valid outcome — send them
    // home with a flag, don't treat it as a server error.
    return res.redirect(`${frontend}/?auth=declined`);
  }

  if (!state || state !== req.session.oauthState) {
    return res.redirect(`${frontend}/?auth=state_mismatch`);
  }
  delete req.session.oauthState;

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Confirm identity + exact scopes actually granted (Google lets users
    // partially deny scopes in some consent flows, so we check what we
    // actually got rather than assuming the full list).
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    const grantedScopes = tokens.scope || "";
    if (!grantedScopes.includes("youtube.readonly")) {
      return res.redirect(`${frontend}/?auth=insufficient_scope`);
    }

    const user = upsertUser(profile, tokens);
    req.session.userId = user.id;

    res.redirect(`${frontend}/?auth=success`);
  } catch (err) {
    console.error("OAuth callback failed:", err.message);
    res.redirect(`${frontend}/?auth=error`);
  }
});

router.get("/me", (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  const user = getUser(req.session.userId);
  if (!user || !user.access_token) return res.json({ authenticated: false });

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      grantedScopes: user.granted_scopes,
      consentedAt: user.consented_at,
      genres: JSON.parse(user.genres || "[]"),
      discoverability: user.discoverability,
    },
  });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// Revoke: pulls the token back from Google AND wipes it locally. This is
// the real "undo consent" button, distinct from just logging out.
router.post("/revoke", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "not signed in" });
  const user = getUser(req.session.userId);
  if (!user) return res.status(404).json({ error: "no such user" });

  try {
    if (user.access_token) {
      const client = createOAuthClient();
      await client.revokeToken(user.access_token).catch(() => {
        // token may already be expired/invalid on Google's side — that's fine,
        // we still wipe it locally below.
      });
    }
  } finally {
    revokeUser(user.id);
    req.session = null;
  }

  res.json({ ok: true });
});

export default router;
