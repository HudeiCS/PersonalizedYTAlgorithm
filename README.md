# Sift — a personalized creator-discoverability engine for YouTube

A fullstack app that recommends *creators*, not just videos: type in genres
("minecraft edits", "cozy cooking", "speedrunning") and optionally connect
your YouTube account, and it ranks channels on how well they match your
taste **and** how likely you are to have already found them — actively
biasing toward smaller/newer creators instead of the same five mega-channels
every algorithm pushes.

```
PersonalizedYTAlgorithm/          <- repo root (this README lives here)
└── yt-discover/
    ├── backend/     Express API: OAuth consent flow, YouTube Data API v3
    │                calls, the recommendation algorithm
    └── frontend/    React (Vite) UI
```

All paths below are written relative to the repo root.

## 1. How the pieces map to your requirements

| Requirement | Where |
|---|---|
| Front-end | `yt-discover/frontend/` — React app, genre picker, discoverability slider, results grid |
| Back-end | `yt-discover/backend/` — Express server; token/preference storage is a plain JSON file (`backend/db/store.js`, written to `backend/db/data.json`) |
| The algorithm | `yt-discover/backend/services/recommendationEngine.js` — content-based scoring (topic-match cosine similarity + engagement + freshness + a discoverability curve), see §5 below |
| Data OAuth Consent API | `yt-discover/backend/config/googleOAuth.js` + `yt-discover/backend/routes/auth.js` — real Google OAuth2 consent screen requesting the minimal `youtube.readonly` scope, with explicit accept/decline handling and a revoke endpoint |

Note on storage: there is **no SQLite and no database server**. Persistence is
deliberately a single JSON file so `npm install` needs no native modules or
build toolchain on any OS. See the header comment in `backend/db/store.js`.

## 2. One-time Google Cloud setup

You need your own Google API credentials — there's no way around this, since
the app reads real subscription data on your behalf.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → Credentials → Create Credentials → API key**.
   This is used for the *unauthenticated* genre-search calls (`GOOGLE_API_KEY`).
4. **APIs & Services → OAuth consent screen**. Google has replaced the old
   single-page wizard with **Google Auth Platform**, so this is now several
   separate pages in the left nav rather than one numbered flow. After you
   pick **External** and click Create you land on an **Overview** page with no
   mention of scopes or test users — that is expected. Do these three:
   - **Audience** → under **Test users**, click **+ Add users** and enter the
     Google account you'll actually sign in with. Required while the app is
     unverified; Google caps unverified apps at 100 test users and shows an
     "unverified app" warning, which is normal for local development. Leave
     the publishing status as **Testing** — do not click "Publish app".
   - **Data Access** → **Add or remove scopes** → select
     `.../auth/youtube.readonly` plus `openid`, `.../auth/userinfo.profile`,
     and `.../auth/userinfo.email`. Use the "Manually add scopes" box if the
     filter doesn't surface `youtube.readonly`. Click **Update**, then **Save**.
   - **Branding** → app name and support email, if you weren't prompted for
     them during creation.
5. **Clients → Create client** (the old **Credentials → Create Credentials →
   OAuth client ID** path still works too) → type **Web application**:
   - Under **Authorized redirect URIs** (not "Authorized JavaScript origins"),
     add exactly `http://localhost:8080/auth/google/callback` — `http` not
     `https`, no trailing slash. Any mismatch produces a `redirect_uri_mismatch`
     error at sign-in, and it must match `GOOGLE_REDIRECT_URI` in `.env`
     character for character.
   - Copy the generated Client ID and Client Secret

Each developer needs their **own** Google Cloud project. Credentials are not
shared between teammates: the Client Secret is a secret, an unverified app
only admits Google accounts explicitly added as Test users, and the 10,000
unit/day quota is per-project so a shared project means throttling each other.

## 3. Configuring `.env`

The backend reads its configuration from `yt-discover/backend/.env`, which is
gitignored and therefore is *not* in a fresh clone — you have to create it:

```bash
cd yt-discover/backend
cp .env.example .env        # then edit .env and fill in the three Google values
```

| Variable | Value |
|---|---|
| `GOOGLE_API_KEY` | From §2 step 3. Used for unauthenticated genre-search calls. |
| `GOOGLE_CLIENT_ID` | From §2 step 5. |
| `GOOGLE_CLIENT_SECRET` | From §2 step 5. **Never commit this.** |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8080/auth/google/callback` — must match the console exactly. |
| `FRONTEND_URL` | `http://localhost:5173` — used for CORS and for post-consent redirects. |
| `PORT` | `8080`. Changing it means updating the redirect URI in both places and the Vite proxy. |
| `SESSION_SECRET` | Any long random string; signs the session cookie. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |

Only the first three need filling in; the rest are already correct for local
development. The root `.gitignore` excludes `.env` and `backend/db/data.json`
(which holds live Google access/refresh tokens once you sign in) — keep it
that way.

## 4. Running it

Requires Node 18+, and `.env` filled in per §3.

```bash
# Backend (from the repo root)
cd yt-discover/backend
npm install
npm run dev                 # http://localhost:8080

# Frontend (separate terminal, from the repo root)
cd yt-discover/frontend
npm install
npm run dev                 # http://localhost:5173
```

`npm run dev` runs the backend under nodemon, which restarts on `.js` changes.
`nodemon.json` excludes `db/data.json` — without that, signing in writes the
token file, nodemon reads it as a code change, and the server restarts out from
under the request you're making. It does not watch `.env` either, so restart by
hand after changing a credential.

Open `http://localhost:5173`. You can use the "Find creators" flow with zero
sign-in (genre-only discovery), or click "Sign in with Google" to see the
real OAuth consent screen and get subscription-blended results.

## 5. The algorithm, in plain terms

`yt-discover/backend/services/recommendationEngine.js` is the whole thing — no
black box:

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

## 6. OAuth consent details worth knowing

- Scope requested is exactly `youtube.readonly` + basic profile/email —
  nothing that can post, upload, edit, or delete is ever requested.
- `prompt: "consent"` forces Google's consent screen on every login rather
  than silently reusing a prior grant, so the user always explicitly sees
  what they're approving.
- The callback route (`yt-discover/backend/routes/auth.js`) handles three
  outcomes distinctly: user approves, user clicks **Cancel**
  (`error=access_denied`), and CSRF-mismatched state — each redirects back to
  the frontend with a status flag instead of erroring out.
- `POST /auth/revoke` calls Google's token-revocation endpoint *and* clears the
  stored tokens locally — a real "disconnect," not just a client-side logout.
  (`revokeUser` nulls the token/scope/consent fields but keeps the user entry,
  so re-consenting later doesn't collide with stale state.)
- No subscription or video content is ever cached server-side; it's fetched
  live per-request and only held in memory for the scoring pass.

## 7. Extending it

- Swap the in-memory lexical candidate scoring for a proper vector store
  (e.g. embeddings via an LLM + pgvector) if you want semantic rather than
  lexical topic matching — the `termVector`/`cosineSimilarity` functions in
  the engine are an intentionally simple, swappable seam.
- Add a per-user `feedback` collection (`thumbs up/down` per recommendation)
  alongside the existing entries in `store.js`, and fold it
  into `discoverabilityScore`/`topicMatch` as a per-user re-ranking signal —
  that's the natural next step toward true personalization over time.
- The YouTube Data API's free quota is 10,000 units/day; `search.list` costs
  100 units/call, so each "Find creators" click costs roughly
  `100 × (genres + 3)` units — worth caching candidate pools per genre if you
  productionize this.
