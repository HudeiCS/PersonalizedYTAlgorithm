# Sift — a personalized creator-discoverability engine for YouTube

A fullstack app that recommends *creators*, not just videos: type in genres
("minecraft edits", "cozy cooking", "speedrunning") and optionally connect
your YouTube account, and it ranks channels on how well they match your
taste **and** how likely you are to have already found them — actively
biasing toward smaller/newer creators instead of the same five mega-channels
every algorithm pushes.

```
yt-discover/
├── backend/     Express API: OAuth consent flow, YouTube Data API v3 calls,
│                the recommendation algorithm
└── frontend/    React (Vite) UI
```

## 1. How the pieces map to your requirements

| Requirement | Where |
|---|---|
| Front-end | `frontend/` — React app, genre picker, discoverability slider, results grid |
| Back-end | `backend/` — Express server, SQLite for token/preference storage |
| The algorithm | `backend/services/recommendationEngine.js` — content-based scoring (topic-match cosine similarity + engagement + freshness + a discoverability curve), see §4 below |
| Data OAuth Consent API | `backend/config/googleOAuth.js` + `backend/routes/auth.js` — real Google OAuth2 consent screen requesting the minimal `youtube.readonly` scope, with explicit accept/decline handling and a revoke endpoint |

## 2. One-time Google Cloud setup

You need your own Google API credentials — there's no way around this, since
the app reads real subscription data on your behalf.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → Credentials → Create Credentials → API key**.
   This is used for the *unauthenticated* genre-search calls (`GOOGLE_API_KEY`).
4. **APIs & Services → OAuth consent screen**:
   - User type: External
   - Add scope `.../auth/youtube.readonly` (plus the default `openid`, `profile`, `email`)
   - Add yourself as a **Test user** (required while the app is unverified — Google
     caps unverified apps to 100 test users and shows an "unverified app" warning,
     which is expected for local development)
5. **Credentials → Create Credentials → OAuth client ID** → type **Web application**:
   - Authorized redirect URI: `http://localhost:8080/auth/google/callback`
   - Copy the generated Client ID and Client Secret

## 3. Running it

```bash
# Backend
cd backend
cp .env.example .env        # fill in GOOGLE_CLIENT_ID / SECRET / API key
npm install
npm run dev                 # http://localhost:8080

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Open `http://localhost:5173`. You can use the "Find creators" flow with zero
sign-in (genre-only discovery), or click "Sign in with Google" to see the
real OAuth consent screen and get subscription-blended results.

## 4. The algorithm, in plain terms

`backend/services/recommendationEngine.js` is the whole thing — no black box:

1. **Taste profile**: turns your typed genres (weighted 3x) and your
   subscribed channels' titles/descriptions (weighted 1x) into a single
   bag-of-terms vector. Typed intent dominates inferred history on purpose —
   if you type "I want horror content" it shouldn't get drowned out by 200
   cooking-channel subscriptions.
2. **Candidate pool**: one YouTube topic search per genre you typed, plus a
   few seeded from your most recent subscriptions, deduped.
3. **Four independent scores per candidate video/channel**:
   - `topicMatch` — cosine similarity between your taste vector and the
     candidate's title/description/tags/channel bio
   - `engagement` — log-scaled views + like ratio, so a well-loved niche
     video isn't punished for having fewer raw views than a mega-viral one
   - `freshness` — exponential recency decay (45-day half-life) so dead
     channels don't linger at the top
   - `discoverability` — an inverse-log curve on subscriber count (small
     channels score much higher) plus a flat bonus for anything you're not
     already subscribed to; the slider in the UI controls how hard this
     pulls against raw popularity
4. **Blend**: `0.45·topicMatch + 0.15·engagement + 0.10·freshness + 0.30·discoverability`,
   rolled up to one best result per channel so a single prolific channel
   can't flood the grid, then sorted.
5. Each card ships a plain-English "why this" line generated from the same
   score breakdown, so the ranking isn't opaque.

This is a content-based / hybrid recommender by design, not collaborative
filtering — there's no cross-user data here, and that's deliberate: it means
day-one users (and small creators with few existing viewers to "collaborate"
around) still get sensibly ranked, which is the actual discoverability
problem this project is trying to solve.

## 5. OAuth consent details worth knowing

- Scope requested is exactly `youtube.readonly` + basic profile/email —
  nothing that can post, upload, edit, or delete is ever requested.
- `prompt: "consent"` forces Google's consent screen on every login rather
  than silently reusing a prior grant, so the user always explicitly sees
  what they're approving.
- The callback route (`backend/routes/auth.js`) handles three outcomes
  distinctly: user approves, user clicks **Cancel** (`error=access_denied`),
  and CSRF-mismatched state — each redirects back to the frontend with a
  status flag instead of erroring out.
- `POST /auth/revoke` calls Google's token-revocation endpoint *and* wipes
  the local row — a real "disconnect," not just a client-side logout.
- No subscription or video content is ever cached server-side; it's fetched
  live per-request and only held in memory for the scoring pass.

## 6. Extending it

- Swap the in-memory/SQLite candidate scoring for a proper vector store
  (e.g. embeddings via an LLM + pgvector) if you want semantic rather than
  lexical topic matching — the `termVector`/`cosineSimilarity` functions in
  the engine are an intentionally simple, swappable seam.
- Add a `feedback` table (`thumbs up/down` per recommendation) and fold it
  into `discoverabilityScore`/`topicMatch` as a per-user re-ranking signal —
  that's the natural next step toward true personalization over time.
- The YouTube Data API's free quota is 10,000 units/day; `search.list` costs
  100 units/call, so each "Find creators" click costs roughly
  `100 × (genres + 3)` units — worth caching candidate pools per genre if you
  productionize this.
