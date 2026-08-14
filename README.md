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
| Accessibility | WCAG 2.2 AA — landmarks, skip link, visible focus, labelled controls, live regions; see §8 |
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

1. **Taste profile**: turns your typed genres and your subscribed channels'
   titles/descriptions into a single bag-of-terms vector, with typed genres
   taking 70% of the total weight and subscriptions splitting the rest.
   Typed intent dominates inferred history on purpose — if you type "I want
   horror content" it shouldn't get drowned out by 200 cooking-channel
   subscriptions. Note this is a split of *total weight per source*, not a
   per-term multiplier: one typed genre is a handful of terms while a
   subscription list is easily 100+, so multiplying per term would still
   leave subscriptions as ~98% of the profile.
2. **Candidate pool**: one YouTube topic search per genre you typed, deduped.
   Subscriptions deliberately do **not** seed searches — searching a
   channel's own name returns that channel and its lookalikes, not
   similar-but-new creators. Subscriptions shape ranking instead, via the
   taste profile and the "already subscribed" penalty.
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
   rolled up per channel so a single prolific channel can't flood the grid,
   then sorted.
5. **Backfill to a full page** (see §5a) — every topic aims to return 10
   results, not merely "up to 10".
6. Each card ships a plain-English "why this" line generated from the same
   score breakdown, so the ranking isn't opaque.

### 5a. Why the per-channel rollup isn't a hard cap

The rollup in step 4 used to keep exactly **one** video per channel. That is
right for a broad genre — "cozy cooking" returns 50 videos across ~38
channels, so one-per-channel still fills a page — but it collapses on a
**creator-name** query. Searching `caseoh` returns 50 videos that nearly all
belong to the same two or three channels, so one-per-channel left literally
two results on screen, and zero on a second identical search (the
already-shown filter had burned both).

So `rankCandidates` now assigns each entry a `channelRank` (0 for its
channel's best video, 1 for its second, …) and sorts by that *before* score.
The returned list comes out in bands: every channel's best video, then every
channel's second-best, and so on. Taking the top 10 therefore yields as many
distinct channels as exist before it ever shows a repeat — so raising the
per-channel allowance can only ever append to the tail, never let one
channel take the top slots.

`routes/recommendations.js` then walks a ladder per topic, stopping at the
first rung that fills the page:

| Rung | Relaxes | Costs |
|---|---|---|
| 1 | nothing — distinct channels, nothing seen this session | 1 search call |
| 2 | fetch up to 2 more result pages, hunting more distinct channels | up to 2 more search calls |
| 3 | allow a channel to contribute more than one video | free (local) |
| 4 | re-admit videos already shown this session, appended after fresh ones | free (local) |

The per-channel allowance in rung 3 is derived from the pool
(`ceil(10 / distinctChannels)`), not fixed: 38 channels → 1 each (identical
to the old behaviour), 3 channels → 4 each, 1 channel → 10. A broad genre
search never leaves rung 1 and is byte-for-byte unchanged by any of this.

The user's own filters (duration, upload age, Shorts) are **never** relaxed
by any rung — returning something explicitly filtered out is a worse failure
than a short page. `genreCoverage` in the response reports which rungs were
needed (`repeatedChannels`, `replayedSeen`, `distinctChannels`) and the UI
says so on the topic header rather than passing a padded page off as a clean
one.

This is a content-based / hybrid recommender by design, not collaborative
filtering — there's no cross-user data here, and that's deliberate: it means
day-one users (and small creators with few existing viewers to "collaborate"
around) still get sensibly ranked, which is the actual discoverability
problem this project is trying to solve.

### 5b. Why the discoverability slider changes what gets *searched*

The slider used to only re-weight results. That can't work, and the numbers
say why — measured against the live API for the query `hiking`:

| pool source | distinct channels | under 10k subs | over 100k subs |
|---|---|---|---|
| `order: "relevance"`, page 1 | 37 | **1** | 23 |
| `order: "relevance"`, pages 1–3 | 80 | 8 | 46 |
| `order: "date"`, page 1 | 50 | **44** | 2 |

A relevance-ordered pool is roughly 62% channels over 100k subscribers, so
"surface small/new creators only" was asking the ranker to find small
creators that were never in the candidate set. It compounded on repeat
searches: the dozen-odd small channels got shown, the already-seen filter
excluded them, and the next click had nothing small left — so the page
filled with 700k+ channels. Results appearing to get *less* niche the more
you searched was this, not chance.

Date-ordered search inverts the distribution, because recent uploads are
dominated by small creators. So:

- **Above slider 0.75** (`DATE_BLEND_THRESHOLD`), an `order: "date"` search
  is blended into the pool alongside the relevance one (+100 quota units per
  topic). This sits deliberately *above* the default slider position of 0.6,
  so an out-of-the-box search costs 100 units rather than 200 and only a
  user who explicitly asks for small creators pays for the wider pool. The
  cost of that choice: at the default position the pool is relevance-only
  and skews large (~62% over 100k subs). Drop the constant to ~0.55 to make
  niche discovery the default again at double the quota.
- **Repeat searches rotate the date window** (`publishedAfter` /
  `publishedBefore`, newest slice first) so each click draws from a
  genuinely different candidate set for one API call, instead of re-ranking
  the leftovers of the same page. The rotation is always clamped inside the
  user's own age filter.
- **The slider implies a subscriber ceiling** above 0.55
  (`SIZE_PREFERENCE_THRESHOLD`): 1M at 0.6 → 100k at 1.0. Channels above it
  are *not* dropped — they're ranked to the tail, flagged
  `beyondSizePreference`, and labelled "larger than your filter" in the UI,
  so the page still fills to 10 without pretending the size preference was
  met. This is a separate constant from `DATE_BLEND_THRESHOLD` on purpose:
  one answers "when is it worth extra quota", the other "when is a channel
  bigger than the user asked for". Tying them together meant raising the
  blend threshold for cost reasons also silently stopped flagging oversized
  channels at the default slider position.

Measured after the change — `hiking` at slider 1.0, three consecutive
clicks: median subscriber counts of 162, 14k, and 10k, with **no channel
above 100k in any of them**, and all 10 slots meeting the size preference
every time.

Because the pool now does the work, `discoverWeight` at slider 1.0 was
reduced from 0.70 back to 0.50. At 0.70 the topic weight collapsed to
**0.05**, meaning "small creators only" had nearly stopped caring what the
video was actually about — that was a workaround for the pool problem, and
it's actively unsafe now that date-ordered (less relevance-filtered) results
are in the mix. Topic relevance keeps a 0.25 floor.

One knob worth knowing: at slider 1.0 the first click legitimately returns
channels in the 20–250 subscriber range. That is what the setting asks for,
but such channels can be very raw. If you want a floor, add a minimum
subscriber count to `exceedsSizePreference` in
`routes/recommendations.js`.

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
- The YouTube Data API's free quota is 10,000 units/day. `search.list` costs
  **100 units**; `videos.list` and `channels.list` cost **1** each — so the
  search calls are ~99% of the bill and nothing else is worth optimising.

  Measured against the live API, per topic per click:

  | | slider < 0.75 (incl. the 0.6 default) | slider ≥ 0.75 |
  |---|---|---|
  | broad topic (`hiking`) | ~100 | ~200 |
  | narrow topic (`caseoh`) | ~100–300 | ~200 |
  | absolute ceiling | 300 | 400 |

  The ceiling is reachable but rare: it needs the relevance search to
  exhaust all 3 pages *and* the date page to still not supply 10 distinct
  unseen channels.

  The ordering of those two searches matters more than it looks. They're
  issued together and the date page counts toward the "do we have enough
  distinct channels?" test **before** any extra relevance page is bought.
  Running them in sequence instead — all the relevance paging first, then
  the date page — measured 300–400 units per click on `caseoh` versus a flat
  200, because it paid for pages 2 and 3 and only then received a date page
  carrying ~44 more distinct channels that would have stopped the paging
  immediately. Same results, up to double the quota. Don't reorder them.

  The dials are `MAX_EXTRA_SEARCH_PAGES` (fuller pages on niche queries) and
  `DATE_BLEND_THRESHOLD` (how early the small-creator search kicks in), both
  in `routes/recommendations.js`.

  The obvious next saving, not implemented: on a repeat click the relevance
  search is byte-identical to the previous one (same query, same filters, no
  page token) — only the date window rotates. Caching just that response for
  a few minutes would take repeat clicks from ~200 units to ~100.


## 8. Accessibility

The UI targets **WCAG 2.2 level AA**, with no runtime dependencies added for
it. What that means concretely, and what to preserve when editing:

- **Landmarks and a skip link.** `<header>` / `<main>` / `<footer>`, plus a
  "Skip to results" link that is the first thing in the tab order and jumps
  past the whole search form to `#results`.
- **Visible focus everywhere.** A single `:focus-visible` rule in the
  accessibility block at the top of `styles.css` owns this. The genre field
  is the one special case: it's a container styled to look like an input, so
  focus is drawn on the container via `:focus-within` and suppressed on the
  inner `<input>`. That is the *only* sanctioned `outline: none` in the
  codebase — don't add others.
- **Every control has a name.** The genre input and the discoverability
  slider previously had none at all. The slider also carries
  `aria-valuetext`, so it announces "60 percent — balanced" rather than the
  meaningless "0.6".
- **Repeated controls are distinguishable.** With 30 cards on screen there
  are 60 feedback buttons; each is named for its own video
  ("Like <title> from <channel>") so a screen reader's control list is
  navigable, and carries `aria-pressed`.
- **Status is announced.** Searching, result counts, errors, chip
  add/remove, and feedback confirmations all route through live regions —
  otherwise they are colour changes and DOM swaps that a non-sighted user
  never perceives. Errors use `role="alert"`; everything else is polite.
- **Motion and targets.** `prefers-reduced-motion` disables the card lift
  and transitions; checkboxes and the chip "×" were enlarged to the 24px
  minimum pointer target.

Contrast was measured against the existing palette rather than adjusted:
muted text is 5.67:1 and the cyan "why this" line 9.9:1 on the card surface,
both clearing the 4.5:1 AA threshold, so the design is unchanged.

When touching the frontend, the things most easily broken by accident are
the live regions (they must stay mounted and only change their text) and the
`:focus-visible` rule.
