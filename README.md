# Sift
<img width="1648" height="659" alt="sift" src="https://github.com/user-attachments/assets/933a9318-7e01-4a20-9e35-a241a67e5027" />

**A YouTube discovery engine that recommends creators, not videos.**

Tell it what you like to watch and it ranks channels on two things at once: how
well they match your taste, and how unlikely you are to have already found them.
It deliberately favours smaller and newer creators over the same handful of
mega-channels every algorithm pushes.

Optionally sign in with Google and it blends in your real subscriptions.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Google Cloud setup](#google-cloud-setup)
- [Environment variables](#environment-variables)
- [Project layout](#project-layout)
- [How the ranking works](#how-the-ranking-works)
- [Finding creators that search can't](#finding-creators-that-search-cant)
- [Learning from your feedback](#learning-from-your-feedback)
- [API reference](#api-reference)
- [Tuning](#tuning)
- [API quota](#api-quota)
- [Accessibility](#accessibility)

---

## What it does

**Search by topic.** Type `cozy cooking` or `valorant edits`. Add several topics
and they merge into one search, so `video essays` + `video games` becomes
"video essays on video games" and returns one combined set of results rather
than a separate block per topic.

**Search by creator.** Type `@handle` and Sift finds creators like that one.
This works for niches ordinary search can't reach. See
[below](#finding-creators-that-search-cant).

**Control how niche the results are.** A discoverability slider trades topic
relevance against creator size. It doesn't just re-rank; at high settings it
changes what gets searched in the first place.

**Filter** by duration, upload age, and Shorts. These are never relaxed, even
when the page would otherwise come up short.

**Teach it.** Like / Not for me on any card is stored as training data. Run one
command and the ranking weights are retrained on your own taste.

Also: light and dark themes, your form state persists across refreshes, and the
whole UI targets WCAG 2.2 AA.

---

## Quick start

Requires **Node 18+** and a Google API key (see the [next
section](#google-cloud-setup)).

```bash
# Backend
cd yt-discover/backend
cp .env.example .env        # then fill in the three Google values
npm install
npm run dev                 # http://localhost:8080

# Frontend, in a second terminal
cd yt-discover/frontend
npm install
npm run dev                 # http://localhost:5173
```

Open <http://localhost:5173>. Signing in is optional. Topic search works
without it.

> **Note:** `npm run dev` runs the backend under nodemon. It does not watch
> `.env`, so restart by hand after changing a credential.

---

## Google Cloud setup

You need your own credentials. The app reads real subscription data, so there's
no shared key to hand out.

**1. Create a project** at [console.cloud.google.com](https://console.cloud.google.com).

**2. Enable the API.** APIs & Services → Library → **YouTube Data API v3**.

**3. Create an API key.** APIs & Services → Credentials → Create Credentials →
API key. This covers the unauthenticated topic searches.

**4. Configure the consent screen.** Google now splits this across several
pages under **Google Auth Platform**. Pick **External**, then:

| Page | What to do |
|---|---|
| **Audience** | Add your own Google account under **Test users**. Required while unverified. Leave status as **Testing**. |
| **Data Access** | Add scopes `youtube.readonly`, `openid`, `userinfo.profile`, `userinfo.email`. Use "Manually add scopes" if the filter doesn't find them. |
| **Branding** | App name and support email. |

**5. Create an OAuth client.** Clients → Create client → **Web application**.
Under **Authorized redirect URIs** (not JavaScript origins) add exactly:

```
http://localhost:8080/auth/google/callback
```

`http` not `https`, no trailing slash. Any mismatch gives a
`redirect_uri_mismatch` error at sign-in.

> Each developer needs their **own** project. The client secret is a secret,
> unverified apps only admit accounts added as test users, and the daily quota
> is per-project, so sharing one means throttling each other.

---

## Environment variables

Create `yt-discover/backend/.env` from the template. Only the first three need
filling in.

| Variable | Value |
|---|---|
| `GOOGLE_API_KEY` | From step 3 above. |
| `GOOGLE_CLIENT_ID` | From step 5. |
| `GOOGLE_CLIENT_SECRET` | From step 5. **Never commit this.** |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8080/auth/google/callback` |
| `FRONTEND_URL` | `http://localhost:5173` |
| `PORT` | `8080` |
| `SESSION_SECRET` | Any long random string. Generate one with:<br>`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

`.env` and the runtime data files are gitignored. Keep it that way. Once you
sign in, `db/data.json` holds live Google access and refresh tokens.

---

## Project layout

```
yt-discover/
├── backend/                    Express API
│   ├── config/googleOAuth.js   OAuth client setup
│   ├── routes/
│   │   ├── auth.js             Sign in, session, revoke
│   │   └── recommendations.js  Search orchestration, the backfill ladder
│   ├── services/
│   │   ├── youtubeService.js   Every YouTube Data API call
│   │   ├── recommendationEngine.js   Scoring and ranking
│   │   └── creatorGraph.js     "Creators like @handle"
│   ├── ml/                     Logistic regression, feature order
│   ├── scripts/trainWeights.js Retrain from your feedback
│   └── db/                     Plain JSON files
└── frontend/                   React + Vite
    └── src/components/         Search form, cards, theme toggle, hero
```

**There is no database.** Storage is plain JSON files, so `npm install` needs no
native modules on any OS. Three files are written at runtime and all are
gitignored: `data.json` (tokens and preferences), `feedback.json` (training
data), `learnedWeights.json` (trained model).

---

## How the ranking works

All in `services/recommendationEngine.js`. No black box.

### 1. Build a taste profile

Your typed topics and your subscribed channels become one bag-of-terms vector.
Typed topics take **70%** of the total weight.

That split is per *source*, not per term, and that is deliberate. One typed topic is a
few terms while a subscription list is easily 100+, so weighting per term would
leave subscriptions at ~98% of the profile and drown out what you actually
asked for.

### 2. Gather candidates

One YouTube search per topic. Subscriptions deliberately do **not** seed
searches: searching a channel's own name returns that channel and its
lookalikes, not similar-but-new creators. They shape ranking instead.

### 3. Score each candidate on four signals

| Signal | What it measures |
|---|---|
| `topicMatch` | Cosine similarity against your taste vector |
| `engagement` | Log-scaled views and like ratio, so niche videos aren't punished for low raw counts |
| `freshness` | Recency decay, 45-day half-life |
| `discoverability` | Inverse-log of subscriber count, plus a bonus for channels you don't follow |

`topicMatch` reads more than the video's own words. It also uses the channel's
topic categories and creator-set keywords, and lets a channel's best-matching
video lift its siblings, so a Valorant clip titled "INSANE 1v5 CLUTCH" still
scores even though its title never says Valorant.

### 4. Blend and roll up

Default blend: `0.45·topic + 0.15·engagement + 0.10·freshness + 0.30·discover`.
Topic and discoverability trade against each other as you move the slider.

Results are grouped per channel so one prolific channel can't flood the grid.
Each channel's best video ranks before any channel's second, so taking the top
10 gives as many distinct creators as exist before it repeats anyone.

### 5. Fill the page

Every topic aims for a full 10 results. If it falls short, a ladder relaxes one
thing at a time:

| Rung | Relaxes | Cost |
|---|---|---|
| 1 | nothing | 1 search |
| 2 | fetch more result pages | up to 2 more searches |
| 3 | allow more than one video per channel | free |
| 4 | re-admit videos already shown this session | free |

**Your filters are never relaxed.** Returning something you explicitly filtered
out is worse than a short page. The response reports which rungs were needed and
the UI says so, rather than passing a padded page off as a clean one.

### Why the slider changes what gets searched

Re-ranking alone can't surface small creators that were never in the candidate
set. Measured against the live API for `hiking`:

| Search order | Distinct channels | Under 10k subs | Over 100k subs |
|---|---|---|---|
| relevance, page 1 | 37 | **1** | 23 |
| relevance, pages 1–3 | 80 | 8 | 46 |
| date, page 1 | 50 | **44** | 2 |

A relevance-ordered pool is ~62% channels over 100k subscribers. So above
slider **0.75**, a date-ordered search is blended in alongside the relevance
one, and repeat searches rotate the date window so each click draws from a
genuinely different pool.

Above **0.55** the slider also implies a subscriber ceiling (1M at 0.6, down to
100k at 1.0). Channels above it aren't dropped. They're ranked to the tail and
labelled "larger than your filter", so the page still fills honestly.

---

## Finding creators that search can't

Some communities are effectively invisible to keyword search. The motivating
case was high-effort Valorant edit channels:

- Their videos are titled after the **song** they edited to: "WHITE FERRARI",
  "Headlock", "trance"
- Their channel descriptions are one-liners like "im so locked in"
- Their channel keywords are **empty**
- Their topic categories are the same generic buckets every gaming channel has

Verified against the live API: no query finds them, including jargon-expanded
ones. But they credit each other constantly in video descriptions, and those
credits are `@handles`. Four seed channels yielded thirty other editors.

So typing `@handle` triggers a different strategy in `services/creatorGraph.js`:

1. **Walk the graph.** Mine the seed's video descriptions for `@mentions`, plus
   the channels it features on its page. Resolve those, then repeat one hop out.
   Handles credited by several creators rank first, because a handle mentioned
   by one channel is usually its own boilerplate.
2. **Fall back to genre** if the graph is thin. Works out what the creator makes
   from their channel keywords, video tags, and recurring title words, then
   searches for that.

The second step matters because channels differ wildly in what they fill in.
`@dishy` has no channel keywords at all but 193 video tags led by "valorant
edit"; `@bonappetit` has rich keywords but no graph. Both work.

**Quota note:** this is cheap. Resolving a handle and reading a channel's
uploads cost **1 unit each**, versus 100 for a search. A full two-hop walk is
~70 units.

---

## Learning from your feedback

Every Like / Not for me is stored in `db/feedback.json` with the exact feature
vector the model used for that video. Once you've rated some results:

```bash
cd yt-discover/backend
npm run train
```

This trains logistic regression on your feedback and writes
`db/learnedWeights.json`. The engine picks it up automatically on the next
request and falls back to the hand-picked blend if the file isn't there.

Restart the backend afterwards to load the new weights.

---

## API reference

**Auth** (`/auth`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/google` | Start the OAuth flow |
| `GET` | `/google/callback` | Google redirects here |
| `GET` | `/me` | Current session |
| `POST` | `/logout` | Clear the session |
| `POST` | `/revoke` | Revoke at Google **and** delete stored tokens |

**Data** (`/api`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/recommendations` | The main call. Takes topics, slider, filters. |
| `POST` | `/feedback` | Record a like or dismiss |
| `GET` | `/subscriptions` | The signed-in user's subscriptions |
| `POST` | `/preferences` | Save topics and slider position |

### OAuth details

- The scope is exactly `youtube.readonly` plus basic profile. Nothing that can
  post, upload, edit, or delete is ever requested.
- `prompt: "consent"` forces the consent screen every time, so you always see
  what you're approving.
- The callback handles approval, cancellation, and CSRF-mismatched state
  distinctly, redirecting back with a status flag rather than erroring.
- `POST /auth/revoke` is a real disconnect, not a client-side logout.
- No video or subscription content is cached server-side.

---

## Tuning

Constants worth knowing, all near the top of their files.

**`routes/recommendations.js`**

| Constant | Default | Effect |
|---|---|---|
| `RESULTS_PER_GENRE` | `10` | Results per topic |
| `MAX_EXTRA_SEARCH_PAGES` | `2` | Fuller pages on niche queries, at 100 units each |
| `DATE_BLEND_THRESHOLD` | `0.75` | When the small-creator search kicks in. Lower to ~0.55 to make niche discovery the default, at double the quota. |
| `SIZE_PREFERENCE_THRESHOLD` | `0.55` | When the subscriber ceiling starts applying |

**`services/recommendationEngine.js`**

| Constant | Default | Effect |
|---|---|---|
| `GENRE_PROFILE_SHARE` | `0.7` | Typed topics vs subscriptions |
| `USE_CHANNEL_TOPIC_SIGNALS` | `true` | Score against channel keywords and topic categories |
| `USE_CHANNEL_TOPIC_PROPAGATION` | `true` | Let a channel's best video lift its siblings |

**`services/creatorGraph.js`**

| Constant | Default | Effect |
|---|---|---|
| `USE_CREATOR_GRAPH` | `true` | Master switch for `@handle` search |
| `LIMITS.depth` | `2` | How many hops outward |
| `LIMITS.maxCreators` | `40` | Caps fan-out and quota |
| `LIMITS.minCreators` | `6` | Below this, top up with a genre search |

---

## API quota

The free tier is **10,000 units/day**. `search.list` costs **100 units**;
`videos.list`, `channels.list`, and `playlistItems.list` cost **1**. Search
calls are ~99% of the bill.

Measured per topic, per click:

| | slider < 0.75 | slider ≥ 0.75 |
|---|---|---|
| broad topic (`hiking`) | ~100 | ~200 |
| narrow topic | ~100–300 | ~200 |
| `@handle` search | ~70 | ~70 |
| ceiling | 300 | 400 |

Two searches are issued **together**, and the date page counts toward the "do we
have enough?" test before extra relevance pages are bought. Running them in
sequence instead measured 300–400 units where the parallel version costs a flat
200. Same results, double the quota. Don't reorder them.

**Not implemented, if you want a saving:** on a repeat click the relevance
search is byte-identical to the previous one. Caching just that response for a
few minutes would halve repeat clicks.

---

## Accessibility

The UI targets **WCAG 2.2 AA** with no runtime dependencies added for it.

- **Landmarks and a skip link** that jumps past the search form to the results.
- **Visible focus everywhere**, owned by one `:focus-visible` rule. The genre
  field is the sole exception: it's a container styled to look like an input, so
  focus is drawn on the container. That's the only sanctioned `outline: none`,
  so don't add others.
- **Every control has a name.** The slider carries `aria-valuetext` so it
  announces "60 percent, balanced" rather than "0.6".
- **Repeated controls are distinguishable.** With 30 cards there are 60 feedback
  buttons, each named for its own video.
- **Status is announced** through live regions: searching, result counts,
  errors, and chip changes. Errors use `role="alert"`.
- **Motion and targets.** `prefers-reduced-motion` disables the hero animation
  and transitions; pointer targets meet the 24px minimum.
- **Colour is measured, not eyeballed.** Both themes were verified by computing
  contrast ratios across every foreground/background pair. Body text clears
  4.5:1 and control borders clear 3:1 in light and dark.

The two things most easily broken by accident are the live regions (they must
stay mounted and only change their text) and the `:focus-visible` rule.

---

## Design notes

A few decisions that aren't obvious from the code:

**Content-based, not collaborative filtering.** There's no cross-user data.
Day-one users and small creators with few existing viewers still get ranked
sensibly, which is the actual discoverability problem this is trying to solve.

**JSON files instead of a database.** Zero setup, no native modules. Fine for
local use; `db/store.js` and `db/feedback.js` are the seam to replace if this
ever needs to be multi-user.

**Text from the YouTube API is HTML-escaped.** A channel called "Don't Panic"
arrives as `Don&#39;t Panic`. It's decoded at the API boundary in
`youtubeService.js`, so nothing downstream has to think about it.
