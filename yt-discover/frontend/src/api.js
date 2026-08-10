const BASE = ""; // same-origin via Vite proxy

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),
  revoke: () => request("/auth/revoke", { method: "POST" }),
  loginUrl: () => "/auth/google",
  subscriptions: () => request("/api/subscriptions"),
  savePreferences: (genres, discoverability) =>
    request("/api/preferences", {
      method: "POST",
      body: JSON.stringify({ genres, discoverability }),
    }),
  recommendations: (genres, discoverability) =>
    request("/api/recommendations", {
      method: "POST",
      body: JSON.stringify({ genres, discoverability }),
    }),
  feedback: (videoId, channelId, features, label) =>
    request("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ videoId, channelId, features, label }),
    }),
};
