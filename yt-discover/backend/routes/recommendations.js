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

/**
 * Main discovery endpoint. Body:
 *   { genres: ["minecraft edits", "speedrunning"], discoverability: 0.7,
 *     filters: { duration: "any"|"under1"|"under5"|"under10"|"over10",
 *                age: "any"|"today"|"week"|"month"|"year",
 *                useSubscriptions: true } }
 * Works two ways:
 *   - signed in: blends genres with the user's real subscriptions
 *   - not signed in: genre-only discovery, no personal data touched
 * `useSubscriptions: false` opts a signed-in user out of that blend for this
 * request only, without touching their saved preferences.
 */
router.post("/recommendations", async (req, res) => {
  const { genres = [], discoverability = 0.6 } = req.body;
  const { duration = "any", age = "any", useSubscriptions = true } = req.body.filters ?? {};
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
    const videoBatches = await Promise.all(
      seedQueries.map((q) => searchByTopic(q, { maxResults: 15 }))
    );
    const candidateVideos = dedupeBy(videoBatches.flat(), (v) => v.videoId);

    const videoIds = candidateVideos.map((v) => v.videoId);
    const channelIds = [...new Set(candidateVideos.map((v) => v.channelId))];

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
    for (const video of candidateVideos) {
      const upgraded = bestThumbnailUrl(videoDetailsById.get(video.videoId)?.snippet?.thumbnails);
      if (upgraded) video.thumbnail = upgraded;
    }

    // Duration needs contentDetails (only available now that videoDetails
    // has come back), so this filter has to happen here rather than
    // alongside the pool-building above. Age only needs the search snippet's
    // publishedAt, but it's filtered in the same pass for one clear cutoff
    // point before ranking sees the pool.
    const filteredVideos = candidateVideos.filter((video) => {
      const seconds = parseDurationSeconds(videoDetailsById.get(video.videoId)?.contentDetails?.duration);
      return matchesDurationFilter(seconds, duration) && matchesAgeFilter(video.publishedAt, age);
    });

    const ranked = rankCandidates({
      profile,
      candidateVideos: filteredVideos,
      videoDetailsById,
      channelDetailsById,
      discoverability,
    });

    const results = ranked.slice(0, 24).map((entry) => ({
      channelId: entry.video.channelId,
      channelTitle: entry.channel?.snippet?.title ?? entry.video.channelTitle,
      channelThumbnail: bestThumbnailUrl(entry.channel?.snippet?.thumbnails),
      subscriberCount: entry.channel?.statistics?.subscriberCount ?? null,
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
      usedSubscriptions: usingSubscriptions,
      candidatePoolSize: filteredVideos.length,
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
