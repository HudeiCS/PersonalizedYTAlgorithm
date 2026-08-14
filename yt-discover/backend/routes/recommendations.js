import { Router } from "express";
import { getUser, setPreferences } from "../db/store.js";
import { recordFeedback } from "../db/feedback.js";
import {
  fetchSubscriptions,
  enrichChannels,
  searchByTopic,
  fetchVideoDetails,
  bestThumbnailUrl,
  parseDurationSeconds,
  isYouTubeShort,
} from "../services/youtubeService.js";
import { buildTasteProfile, rankCandidates, explain, hasLearnedWeights } from "../services/recommendationEngine.js";

const router = Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "sign in with Google first" });
  const user = getUser(req.session.userId);
  if (!user || !user.access_token) return res.status(401).json({ error: "session expired, sign in again" });
  req.user = user;
  next();
}

router.get("/subscriptions", requireAuth, async (req, res) => {
  try {
    const subs = await fetchSubscriptions(req.user);
    res.json({ subscriptions: subs });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "couldn't reach YouTube — try again shortly" });
  }
});

router.post("/preferences", requireAuth, (req, res) => {
  const { genres, discoverability } = req.body;
  const updated = setPreferences(req.user.id, { genres, discoverability });
  res.json({ genres: JSON.parse(updated.genres), discoverability: updated.discoverability });
});

// Upper bound in days for each "uploaded" filter option; "any" skips the
// check entirely, so it isn't listed here.
const AGE_FILTER_MAX_DAYS = { today: 1, week: 7, month: 31, year: 365 };

// How many results we try to surface per typed genre/topic, and how big a
// raw pool we pull per genre to make that achievable. 50 is YouTube's own
// per-call cap on search.list — asking for it costs the same 100 quota
// units as asking for 15 did, so there's no reason to sample a smaller pool.
//
// RESULTS_PER_GENRE is a *target*, not just a ceiling. The two constants
// below exist to actually hit it; see the backfill ladder in the handler.
const RESULTS_PER_GENRE = 10;
const SEARCH_POOL_SIZE = 50;

// Extra search.list pages a genre may fetch when one page doesn't contain
// RESULTS_PER_GENRE distinct channels. Capped at 2 (so 3 calls, 300 quota
// units, per thin genre) against the free tier's 10,000 units/day. Broad
// genre searches fill on page 1 and never spend this.
const MAX_EXTRA_SEARCH_PAGES = 2;

/**
 * How many videos one channel may contribute to a single genre's results.
 *
 * Derived from the pool rather than fixed, because the right answer depends
 * entirely on how many distinct channels the query actually found: it's the
 * smallest allowance that could still reach RESULTS_PER_GENRE.
 *
 *   38 channels ("cozy cooking")  -> 1   (unchanged from one-per-channel)
 *    3 channels ("caseoh")        -> 4
 *    1 channel  (very niche)      -> 10
 *
 * Safe to raise this way only because rankCandidates emits every distinct
 * channel's best video before any channel's second — the extra allowance
 * can only ever append to the tail, never displace a distinct channel from
 * the top of the page. A fixed cap instead left a one- or two-channel query
 * permanently short of a full page.
 */
function videosPerChannelFor(distinctChannelCount) {
  if (distinctChannelCount <= 0) return 1;
  return Math.min(RESULTS_PER_GENRE, Math.ceil(RESULTS_PER_GENRE / distinctChannelCount));
}

// How many recently-shown video IDs we remember per browser session to keep
// "Find creators" from just replaying the same deterministic search+rank
// output every time it's clicked with the same genres/filters. Stored in the
// session cookie itself (cookie-session has no server-side store), so this
// is capped well under the ~4KB cookie limit — 120 eleven-character IDs is
// roughly 2.2KB before the cookie's own base64/signing overhead.
const MAX_REMEMBERED_VIDEO_IDS = 120;

function matchesDurationFilter(seconds, filter) {
  if (seconds == null) return true; // unknown duration — don't punish it for missing data
  switch (filter) {
    case "under1": return seconds < 60;
    case "under5": return seconds < 300;
    case "under10": return seconds < 600;
    case "over10": return seconds >= 600;
    default: return true; // "any"
  }
}

function matchesAgeFilter(publishedAt, filter) {
  const maxDays = AGE_FILTER_MAX_DAYS[filter];
  if (!maxDays) return true; // "any" (or an unrecognized value)
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86400000;
  return ageDays <= maxDays;
}

// Anything longer than this definitely isn't a Short (YouTube's own cap is
// 180s), so there's no reason to spend a network probe on it. A little
// slack above 180 costs nothing and protects against that cap moving again.
const SHORT_PROBE_CEILING_SECONDS = 200;

// Fallback used only when the /shorts/<id> probe is skipped or inconclusive.
// Deliberately conservative (well under the real 180s cap) since guessing
// wrong here means silently hiding a video the user never asked to exclude.
function isShortByDurationFallback(seconds) {
  return seconds != null && seconds <= 60;
}

// Turns an age filter into search.list's `publishedAfter` param so the
// filter narrows what YouTube searches, not just what we keep afterward.
function publishedAfterFor(ageFilter) {
  const maxDays = AGE_FILTER_MAX_DAYS[ageFilter];
  return maxDays ? new Date(Date.now() - maxDays * 86400000).toISOString() : undefined;
}

// ---------------------------------------------------------------------------
// Surfacing genuinely small creators
//
// Measured on the real API: an order:"relevance" search for "hiking" returns
// 37 distinct channels, of which only 14 are under 100k subscribers and just
// ONE is under 10k. 23 of them are over 100k. No amount of re-weighting can
// surface small creators from a pool that doesn't contain any — and once the
// handful of small ones have been shown and excluded by the seen-filter, a
// repeat search has nothing small left and fills the page with 700k+
// channels. That's the "niche creators become fewer each click" effect.
//
// The same query ordered by date returns 50 channels of which 48 are under
// 100k and none are over 1M, because recent uploads are dominated by small
// creators. So as the discoverability slider rises we blend an order:"date"
// search into the candidate pool. This is the actual fix; the scoring
// weights only decide the order of what the pool contains.
// ---------------------------------------------------------------------------

// Above this slider position, add the date-ordered search — the only part
// of this that costs extra quota (100 units per topic per click). Below it
// we keep the single relevance search.
//
// Set deliberately ABOVE the default slider position (0.6) so a default
// search costs 100 units rather than 200, and only a user who explicitly
// drags toward "small creators only" pays for the wider pool. The tradeoff
// is real and worth knowing: at the default position the pool is
// relevance-only, which measured ~62% channels over 100k subs, so default
// results skew large. Lower this to ~0.55 to make niche discovery the
// default again at double the quota cost.
const DATE_BLEND_THRESHOLD = 0.75;

// Above this slider position we start treating "how big is this channel?"
// as something the user expressed a preference about.
//
// Deliberately NOT the same constant as DATE_BLEND_THRESHOLD even though
// the two started out equal. That one answers "when is it worth spending
// extra quota"; this one answers "when is a channel bigger than the user
// asked for". Tying the labelling to the quota decision meant that raising
// the blend threshold for cost reasons also silently stopped flagging
// oversized channels at the default slider position — an unrelated
// regression.
const SIZE_PREFERENCE_THRESHOLD = 0.55;

/** Subscriber ceiling implied by the slider, or null for "no preference".
 *  Log-interpolated: 1M at 0.6, ~316k at 0.8, 100k at 1.0. Used to mark
 *  results that exceed what the user asked for, not to drop them — they're
 *  sorted to the tail and labelled instead, so the page still fills. */
function subscriberCeilingFor(slider) {
  if (slider < SIZE_PREFERENCE_THRESHOLD) return null;
  const t = Math.min(Math.max((slider - 0.6) / 0.4, 0), 1);
  return Math.round(Math.pow(10, 6 - t));
}

/** True when this channel is bigger than the slider position implies. */
function exceedsSizePreference(channelDetails, ceiling) {
  if (ceiling == null) return false;
  const stats = channelDetails?.statistics;
  // Unknown size is not evidence of being too big — don't banish it to the
  // tail on a guess. Matches UNKNOWN_SUBSCRIBER_ASSUMPTION in the engine.
  if (stats?.hiddenSubscriberCount === true || stats?.subscriberCount == null) return false;
  const subs = Number(stats.subscriberCount);
  return Number.isFinite(subs) && subs > ceiling;
}

// Fractions of the allowed age span used as the date-ordered search's
// window, rotating one step per repeat search of the same topic. Repeat
// clicks otherwise re-run an identical query and can only show the
// leftovers the seen-filter hasn't already burned; shifting the window
// gives each click a genuinely different candidate set for one API call.
// Non-overlapping and newest-first, so click #1 still gets the freshest.
const DATE_WINDOW_SLICES = [
  [0, 0.1],
  [0.1, 0.3],
  [0.3, 0.6],
  [0.6, 1.0],
];

// Span the rotation covers when the user hasn't set an age filter.
const DEFAULT_ROTATION_SPAN_DAYS = 730;

/** publishedAfter/publishedBefore for one round of the rotation, clamped
 *  inside whatever age filter the user set (so rotating never smuggles in a
 *  video older than they asked for). */
function rotatingDateWindow(round, ageFilter) {
  const spanDays = AGE_FILTER_MAX_DAYS[ageFilter] ?? DEFAULT_ROTATION_SPAN_DAYS;
  const [fromFrac, toFrac] = DATE_WINDOW_SLICES[round % DATE_WINDOW_SLICES.length];
  const now = Date.now();
  return {
    publishedAfter: new Date(now - toFrac * spanDays * 86400000).toISOString(),
    publishedBefore: new Date(now - fromFrac * spanDays * 86400000).toISOString(),
  };
}

// Cap on how many topics' rotation counters we keep. These live in the
// session cookie (cookie-session has no server-side store), so the map has
// to stay small — see MAX_REMEMBERED_VIDEO_IDS for the same constraint.
const MAX_TRACKED_TOPICS = 20;

/**
 * Main discovery endpoint. Body:
 *   { genres: ["minecraft edits", "speedrunning"], discoverability: 0.7,
 *     filters: { duration: "any"|"under1"|"under5"|"under10"|"over10",
 *                age: "any"|"today"|"week"|"month"|"year",
 *                useSubscriptions: true,
 *                includeShorts: true } }
 * Works two ways:
 *   - signed in: blends genres with the user's real subscriptions
 *   - not signed in: genre-only discovery, no personal data touched
 * `useSubscriptions: false` opts a signed-in user out of that blend for this
 * request only, without touching their saved preferences.
 *
 * Each typed genre is searched, filtered, and ranked as its own pool, and
 * contributes up to RESULTS_PER_GENRE results of its own (see genreCoverage
 * in the response) — a single blended pool sorted once and sliced to a flat
 * top-N let one strongly-matching genre crowd out a second, less
 * "search-friendly" one entirely.
 *
 * Every genre tries to return a *full* RESULTS_PER_GENRE, via a backfill
 * ladder that relaxes one constraint at a time and stops the moment the
 * target is met:
 *
 *   1. one page of search results, distinct channels only, nothing this
 *      session has already been shown  — the ideal, and where broad genre
 *      searches stop
 *   2. up to MAX_EXTRA_SEARCH_PAGES more pages, looking for more distinct
 *      channels (the only rung that costs extra quota)
 *   3. up to MAX_VIDEOS_PER_CHANNEL videos from a channel already shown,
 *      appended only after every distinct channel is exhausted
 *   4. re-admit videos this session has already been shown
 *
 * Rungs 2-4 exist for creator-name queries. "caseoh" returns 50 videos
 * belonging to two or three channels, so rung 1 alone produced two results
 * — and produced zero on a second identical search, since rung 1 also
 * excludes everything already shown. User-chosen filters (duration, age,
 * Shorts) are never relaxed by any rung; returning something a user
 * explicitly filtered out would be worse than returning a short page.
 */
router.post("/recommendations", async (req, res) => {
  const { genres = [], discoverability = 0.6 } = req.body;
  const {
    duration = "any",
    age = "any",
    useSubscriptions = true,
    includeShorts = true,
  } = req.body.filters ?? {};
  if (genres.length === 0) {
    return res.status(400).json({ error: "give at least one genre or creator topic" });
  }

  try {
    const signedIn = req.session.userId && getUser(req.session.userId)?.access_token;
    const usingSubscriptions = Boolean(signedIn && useSubscriptions);
    let subscriptions = [];
    if (usingSubscriptions) {
      const user = getUser(req.session.userId);
      subscriptions = await fetchSubscriptions(user);
    }

    const profile = buildTasteProfile({ genres, subscriptions });

    // Pull a candidate pool: one search per typed genre.
    //
    // This deliberately does NOT seed searches from subscription titles.
    // It used to, to make results "less of a literal keyword match" — but
    // searching a channel's exact name returns that channel and its
    // lookalikes, not similar-but-new creators, so a search for "minecraft"
    // would pull in whole batches of unrelated videos from whichever three
    // channels happened to be first in the user's subscription list.
    // Subscriptions still shape ranking via the taste profile and the
    // "already subscribed" penalty — they just don't hijack the pool.
    const seedQueries = [...genres];
    const searchOptions = {
      maxResults: SEARCH_POOL_SIZE,
      publishedAfter: publishedAfterFor(age),
      // "short" (<4min) is the only YouTube-native duration bucket that lines
      // up cleanly with one of ours (under1 ⊂ short); the others are left
      // unrestricted here and filtered exactly below instead, so a request
      // for "under5" doesn't silently lose a real 4m30s match.
      videoDuration: duration === "under1" ? "short" : undefined,
    };

    // Videos this browser session has already been handed back. Needed here,
    // before the search, because "do we have enough?" means "enough that the
    // user hasn't already seen" — paging on the raw count would happily stop
    // on a page made entirely of repeats.
    const previouslyShown = new Set(req.session.seenVideoIds ?? []);

    // How many times this session has already searched each topic, so the
    // date-ordered search can rotate to a different window each click.
    const searchRounds = req.session.searchRounds ?? {};
    const roundFor = (genre) => searchRounds[genre] ?? 0;

    const blendDateOrdered = discoverability >= DATE_BLEND_THRESHOLD;
    const sizeCeiling = subscriberCeilingFor(discoverability);

    // Rung 2 of the ladder, and the single biggest quota decision in the
    // request. `search.list` costs 100 units against a 10,000/day budget
    // and everything else here costs 1, so this loop *is* the bill.
    //
    // The two searches are issued together, and crucially the date page
    // counts toward the "do we have enough?" test before any extra
    // relevance page is bought. Fetching them in sequence instead — all the
    // relevance paging first, then the date page — meant a narrow topic
    // could pay for pages 2 and 3 (200 extra units) and only afterwards
    // receive a date page carrying ~44 more distinct channels that would
    // have satisfied the threshold immediately. That ordering was pure
    // waste: same results, up to double the quota.
    //
    // Distinct *channels* rather than videos is the right stopping test:
    // channel count is what the per-channel rollup downstream actually
    // limits results to, so a page adding 50 videos from one already-seen
    // channel hasn't moved us closer to a full page and shouldn't count.
    const videoBatches = await Promise.all(
      seedQueries.map(async (q) => {
        const [firstPage, dated] = await Promise.all([
          searchByTopic(q, searchOptions),
          // The small-creator source. One page only — its whole value is
          // that nearly every channel in it is small, so paging it would
          // buy more of what we already have.
          blendDateOrdered
            ? searchByTopic(q, {
                ...searchOptions,
                order: "date",
                ...rotatingDateWindow(roundFor(q), age),
              }).then((page) => page.videos)
            : Promise.resolve([]),
        ]);

        const relevance = [...firstPage.videos];
        let pageToken = firstPage.nextPageToken;

        for (let extra = 0; extra < MAX_EXTRA_SEARCH_PAGES; extra++) {
          if (!pageToken) break;
          if (
            distinctUnseenChannelCount([...relevance, ...dated], previouslyShown) >=
            RESULTS_PER_GENRE
          ) {
            break;
          }
          const next = await searchByTopic(q, { ...searchOptions, pageToken });
          relevance.push(...next.videos);
          pageToken = next.nextPageToken;
        }

        // Relevance first: dedupeBy keeps the first occurrence, so a video
        // found by both searches keeps its relevance-ordered position.
        return [...relevance, ...dated];
      })
    );

    const allCandidateVideos = dedupeBy(videoBatches.flat(), (v) => v.videoId);
    const videoIds = allCandidateVideos.map((v) => v.videoId);
    const channelIds = [...new Set(allCandidateVideos.map((v) => v.channelId))];

    const [videoDetails, channelDetails] = await Promise.all([
      fetchVideoDetails(videoIds),
      enrichChannels(channelIds),
    ]);

    const videoDetailsById = new Map(videoDetails.map((v) => [v.id, v]));
    const channelDetailsById = new Map(channelDetails.map((c) => [c.id, c]));

    // search.list (where candidateVideos came from) only ever returns up to
    // a 480x360 thumbnail. videos.list — already fetched above for stats —
    // frequently has `standard`/`maxres` for the same video, so prefer that
    // higher-res source now that we have it, rather than showing the
    // low-res one stretched to fill a card.
    for (const video of allCandidateVideos) {
      const upgraded = bestThumbnailUrl(videoDetailsById.get(video.videoId)?.snippet?.thumbnails);
      if (upgraded) video.thumbnail = upgraded;
    }

    const durationSecondsById = new Map(
      allCandidateVideos.map((v) => [
        v.videoId,
        parseDurationSeconds(videoDetailsById.get(v.videoId)?.contentDetails?.duration),
      ])
    );

    // Only worth asking YouTube's /shorts/ routing when the user actually
    // wants Shorts excluded, and only for videos short enough to plausibly
    // be one — anything already confirmed longer than the probe ceiling is
    // definitely not a Short, so skipping it there saves a network round
    // trip without any accuracy cost.
    const shortStatusById = new Map();
    if (!includeShorts) {
      const ambiguousVideoIds = allCandidateVideos
        .filter((v) => {
          const seconds = durationSecondsById.get(v.videoId);
          return seconds == null || seconds <= SHORT_PROBE_CEILING_SECONDS;
        })
        .map((v) => v.videoId);

      // Raised from 8 alongside backfill paging: a thin genre can now carry
      // 3 pages instead of 1, so the ambiguous set is up to 3x larger and a
      // lower concurrency showed up directly as request latency. These are
      // HEAD requests to youtube.com, not quota-bearing API calls.
      const PROBE_CONCURRENCY = 12;
      for (let i = 0; i < ambiguousVideoIds.length; i += PROBE_CONCURRENCY) {
        const batch = ambiguousVideoIds.slice(i, i + PROBE_CONCURRENCY);
        const statuses = await Promise.all(batch.map((id) => isYouTubeShort(id)));
        batch.forEach((id, idx) => shortStatusById.set(id, statuses[idx]));
      }
    }

    function isShort(video) {
      const seconds = durationSecondsById.get(video.videoId);
      if (seconds != null && seconds > SHORT_PROBE_CEILING_SECONDS) return false;
      const probed = shortStatusById.get(video.videoId);
      if (probed != null) return probed; // authoritative — straight from YouTube's own routing
      return isShortByDurationFallback(seconds); // probe skipped/failed — conservative guess only
    }

    // The user's own filter choices. Never relaxed by the backfill ladder —
    // handing back a 20-minute video to someone who asked for "under 5 min"
    // is a worse failure than handing back a short page.
    function passesUserFilters(video) {
      if (!includeShorts && isShort(video)) return false;
      const seconds = durationSecondsById.get(video.videoId);
      return matchesDurationFilter(seconds, duration) && matchesAgeFilter(video.publishedAt, age);
    }

    // Same genres + same filters is a fully deterministic search+rank
    // pipeline, so without this, clicking "Find creators" again just
    // replays the identical list. Excluding whatever this browser session
    // has already been shown — regardless of which search surfaced it —
    // makes repeat sifting actually turn up something new.
    //
    // Separate from passesUserFilters because it IS relaxable: it's our
    // nicety, not the user's instruction, so rung 4 of the ladder drops it
    // rather than return a near-empty page.
    function isUnseen(video) {
      return !previouslyShown.has(video.videoId);
    }

    // Rank each genre's own search results independently so every typed
    // topic gets its own shot at RESULTS_PER_GENRE, rather than being sorted
    // into one shared pool. A video already claimed by an earlier genre is
    // skipped for a later one even if it would also rank highly there, so
    // overlapping topics don't just show the same videos twice.
    const claimedVideoIds = new Set();
    const genreCoverage = [];
    const scoredEntries = [];

    seedQueries.forEach((genre, i) => {
      const eligible = dedupeBy(videoBatches[i], (v) => v.videoId).filter(
        (v) => passesUserFilters(v) && !claimedVideoIds.has(v.videoId)
      );

      const rank = (candidateVideos) =>
        rankCandidates({
          profile,
          candidateVideos,
          videoDetailsById,
          channelDetailsById,
          discoverability,
          maxPerChannel: videosPerChannelFor(
            new Set(candidateVideos.map((v) => v.channelId)).size
          ),
        });

      // Split by the slider's implied size ceiling and rank each side on its
      // own, so the small-creator side's per-channel allowance is computed
      // from the channels it actually has. Ranking the combined pool first
      // and filtering after would let a pool full of big channels set the
      // allowance to 1 and leave the small side unable to fill the page.
      //
      // With no ceiling (slider below the threshold) `above` is empty and
      // `within` is the whole pool, so this is exactly the previous path.
      const unseen = eligible.filter(isUnseen);
      const tooBig = (v) => exceedsSizePreference(channelDetailsById.get(v.channelId), sizeCeiling);
      const within = unseen.filter((v) => !tooBig(v));
      const above = unseen.filter(tooBig);

      // Rungs 1-3 in one pass: rankCandidates emits every distinct channel's
      // best video before any channel's second, so slicing the top N takes
      // repeats only once the distinct channels are genuinely used up.
      let top = rank(within).slice(0, RESULTS_PER_GENRE);
      const smallCreatorCount = top.length;

      // Page still short of a full 10, so admit channels bigger than the
      // slider implies — flagged, and only ever after every small creator
      // has been placed. The alternative is a half-empty page; this keeps
      // the "always 10" guarantee without quietly pretending these results
      // match the size preference.
      if (top.length < RESULTS_PER_GENRE && above.length) {
        const filler = rank(above)
          .slice(0, RESULTS_PER_GENRE - top.length)
          .map((entry) => ({ ...entry, beyondSizePreference: true }));
        top = [...top, ...filler];
      }

      // Rung 4: still short, so let previously-shown videos back in —
      // appended after the fresh ones, never displacing them, so a repeat
      // search still leads with whatever is actually new.
      const freshCount = top.length;
      if (top.length < RESULTS_PER_GENRE) {
        const alreadyTaken = new Set(top.map((entry) => entry.video.videoId));
        const replayed = rank(eligible.filter((v) => !isUnseen(v)))
          .filter((entry) => !alreadyTaken.has(entry.video.videoId))
          .slice(0, RESULTS_PER_GENRE - top.length)
          .map((entry) => ({
            ...entry,
            beyondSizePreference: exceedsSizePreference(entry.channel, sizeCeiling),
          }));
        top = [...top, ...replayed];
      }

      top.forEach((entry) => claimedVideoIds.add(entry.video.videoId));
      scoredEntries.push(...top.map((entry) => ({ ...entry, matchedGenre: genre })));
      genreCoverage.push({
        genre,
        found: top.length,
        requested: RESULTS_PER_GENRE,
        // What it took to get there, so the UI can be honest about it
        // instead of silently presenting a padded page as a clean result.
        repeatedChannels: top.some((entry) => entry.channelRank > 0),
        replayedSeen: top.length > freshCount,
        distinctChannels: new Set(top.map((entry) => entry.video.channelId)).size,
        // How much of the page actually met the size preference, so the UI
        // can say "6 of 10 are small creators" rather than implying all 10.
        smallCreatorCount: sizeCeiling == null ? null : smallCreatorCount,
        sizeCeiling,
      });
    });

    const results = scoredEntries.map((entry) => ({
      channelId: entry.video.channelId,
      channelTitle: entry.channel?.snippet?.title ?? entry.video.channelTitle,
      channelThumbnail: bestThumbnailUrl(entry.channel?.snippet?.thumbnails),
      subscriberCount: entry.channel?.statistics?.subscriberCount ?? null,
      matchedGenre: entry.matchedGenre,
      video: {
        id: entry.video.videoId,
        title: entry.video.title,
        thumbnail: entry.video.thumbnail,
        publishedAt: entry.video.publishedAt,
        url: `https://www.youtube.com/watch?v=${entry.video.videoId}`,
      },
      channelUrl: `https://www.youtube.com/channel/${entry.video.channelId}`,
      score: Math.round(entry.score * 1000) / 1000,
      reason: explain(entry),
      alreadySubscribed: profile.subscribedChannelIds.has(entry.video.channelId),
      // Bigger than the discoverability slider implies. Included only to
      // fill the page after every small creator was placed — the UI labels
      // these rather than passing them off as matching the preference.
      beyondSizePreference: Boolean(entry.beyondSizePreference),
      // The exact feature vector the model used for this video. The frontend
      // sends this straight back on /feedback so the stored training example
      // matches what the model actually saw — never recomputed after the fact.
      features: entry.breakdown,
    }));

    // Remember what we just showed so the next search (same criteria or
    // not) doesn't hand back the same videos. FIFO-trimmed to the cap above
    // rather than left to grow forever.
    const seenSoFar = [...(req.session.seenVideoIds ?? []), ...results.map((r) => r.video.id)];
    req.session.seenVideoIds = seenSoFar.slice(-MAX_REMEMBERED_VIDEO_IDS);

    // Advance each topic's rotation so the next click on the same topic
    // searches a different date window. Trimmed to the most recently used
    // topics — this rides in the session cookie, which has a ~4KB budget
    // already largely spent on seenVideoIds.
    const nextRounds = { ...searchRounds };
    for (const genre of seedQueries) nextRounds[genre] = roundFor(genre) + 1;
    req.session.searchRounds = Object.fromEntries(
      Object.entries(nextRounds).slice(-MAX_TRACKED_TOPICS)
    );

    res.json({
      results,
      genreCoverage,
      usedSubscriptions: usingSubscriptions,
      candidatePoolSize: allCandidateVideos.filter(passesUserFilters).length,
      usingLearnedWeights: hasLearnedWeights(),
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "recommendation pipeline failed — check API quota / key" });
  }
});

/**
 * Records feedback on one recommendation — the labeled training data.
 * Body: { videoId, channelId, features: {topicMatch, engagement, freshness, discover}, label: 1|0 }
 * `features` must be the exact object /recommendations returned for that
 * video; `label` is 1 for liked/clicked, 0 for dismissed.
 */
router.post("/feedback", (req, res) => {
  const { videoId, channelId, features, label } = req.body;

  if (!videoId || !features || (label !== 0 && label !== 1)) {
    return res.status(400).json({ error: "need videoId, features, and label (0 or 1)" });
  }

  const userId = req.session.userId ?? null;
  const totalEvents = recordFeedback({ userId, videoId, channelId, features, label });
  res.json({ recorded: true, totalEvents });
});

/** How many distinct channels a batch of search results covers, ignoring
 *  videos the session has already been shown. This is the quantity the
 *  per-channel rollup downstream actually limits results to, so it's the
 *  honest measure of "is this pool big enough yet" when deciding whether to
 *  spend another search.list page on a query. */
function distinctUnseenChannelCount(videos, previouslyShown) {
  const channelIds = new Set();
  for (const video of videos) {
    if (!previouslyShown.has(video.videoId)) channelIds.add(video.channelId);
  }
  return channelIds.size;
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default router;
