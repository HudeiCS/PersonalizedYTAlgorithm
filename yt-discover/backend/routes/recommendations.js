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
const RESULTS_PER_GENRE = 10;
const SEARCH_POOL_SIZE = 50;

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
    const videoBatches = await Promise.all(
      seedQueries.map((q) => searchByTopic(q, searchOptions))
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

      const PROBE_CONCURRENCY = 8;
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

    function passesFilters(video) {
      if (!includeShorts && isShort(video)) return false;
      const seconds = durationSecondsById.get(video.videoId);
      return matchesDurationFilter(seconds, duration) && matchesAgeFilter(video.publishedAt, age);
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
      const pool = dedupeBy(videoBatches[i], (v) => v.videoId).filter(
        (v) => passesFilters(v) && !claimedVideoIds.has(v.videoId)
      );

      const ranked = rankCandidates({
        profile,
        candidateVideos: pool,
        videoDetailsById,
        channelDetailsById,
        discoverability,
      });

      const top = ranked.slice(0, RESULTS_PER_GENRE);
      top.forEach((entry) => claimedVideoIds.add(entry.video.videoId));
      scoredEntries.push(...top.map((entry) => ({ ...entry, matchedGenre: genre })));
      genreCoverage.push({ genre, found: top.length, requested: RESULTS_PER_GENRE });
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
      // The exact feature vector the model used for this video. The frontend
      // sends this straight back on /feedback so the stored training example
      // matches what the model actually saw — never recomputed after the fact.
      features: entry.breakdown,
    }));

    res.json({
      results,
      genreCoverage,
      usedSubscriptions: usingSubscriptions,
      candidatePoolSize: allCandidateVideos.filter(passesFilters).length,
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
