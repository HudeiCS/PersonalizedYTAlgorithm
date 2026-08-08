import { google } from "googleapis";

// The ONLY scopes this app ever asks for. Both are read-only — this app
// never uploads, edits, deletes, or posts on the user's behalf, and the
// consent screen will say so explicitly to the user before they click Allow.
export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly", // subscriptions, playlists
  "openid",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function buildConsentUrl(client, state) {
  return client.generateAuthUrl({
    access_type: "offline", // request a refresh_token
    scope: SCOPES,
    prompt: "consent",      // force the consent screen every time so the
                             // scope grant is always explicit, not silently reused
    state,
    include_granted_scopes: false,
  });
}
