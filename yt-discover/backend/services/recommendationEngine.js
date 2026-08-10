/**
 * Recommendation engine
 * ----------------------
 * Goal: given (a) the genres/topics a user typed in and (b) the channels
 * they're already subscribed to, surface creators/videos that match that
 * taste but are NOT the same five mega-channels everyone already gets
 * pushed toward. "Discoverability" is a first-class scoring input, not an
 * afterthought — it actively down-weights channels the user already knows
 * about and up-weights smaller, high-engagement creators.
 *
 * Pipeline:
 *   1. Build a taste profile (bag-of-terms vector) from subscriptions +
 *      typed genres, with typed genres weighted higher (explicit intent
 *      beats inferred intent).
 *   2. Pull a candidate pool via YouTube topic search for each genre.
 *   3. Score every candidate on 4 independent signals, then blend:
 *        - topicMatch      cosine similarity vs. the taste profile
 *        - engagement      views/likes relative to the channel's own scale
 *        - freshness       recency decay so dead channels don't surface
 *        - discoverability inverse-log of subscriber count + "new to you"
 *          bonus, weighted by the user's discoverability slider
 *   4. Roll video-level scores up to channel-level, dedupe, sort, explain.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { predict } from "../ml/logisticRegression.js";
import { FEATURE_ORDER } from "../ml/features.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEARNED_WEIGHTS_PATH = path.join(__dirname, "..", "db", "learnedWeights.json");

/** Reads db/learnedWeights.json if trainWeights.js has produced one, else
 *  null — the signal rankCandidates() uses to decide whether to score with
 *  learned weights or fall back to the original hand-picked blend. */
function loadLearnedWeights() {
  try {
    if (!fs.existsSync(LEARNED_WEIGHTS_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(LEARNED_WEIGHTS_PATH, "utf-8"));
    if (!parsed?.weights || typeof parsed.bias !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Exposed so routes/recommendations.js can tell the frontend which
 *  scoring mode is actually in effect for this request. */
export function hasLearnedWeights() {
  return loadLearnedWeights() !== null;
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is",
  "this","that","it","its","as","at","by","be","are","was","were","from",
  "video","videos","channel","subscribe","official","new","full","best",
]);

function tokenize(text = "") {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function termVector(texts, weight = 1) {
  const vec = {};
  for (const text of texts) {
    for (const term of tokenize(text)) {
      vec[term] = (vec[term] || 0) + weight;
    }
  }
  return vec;
}

function mergeVectors(...vectors) {
  const merged = {};
  for (const v of vectors) {
    for (const [term, weight] of Object.entries(v)) {
      merged[term] = (merged[term] || 0) + weight;
    }
  }
  return merged;
}

function cosineSimilarity(a, b) {
  const terms = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, magA = 0, magB = 0;
  for (const t of terms) {
    const x = a[t] || 0, y = b[t] || 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Builds the user's taste profile. Explicit genres are weighted 3x a
 *  subscription's own title/description terms — typed intent should
 *  dominate over inferred history, especially for "I want something NEW". */
export function buildTasteProfile({ genres = [], subscriptions = [] }) {
  const genreVec = termVector(genres, 3);
  const subVec = termVector(
    subscriptions.flatMap((s) => [s.title, s.description]),
    1
  );
  return {
    vector: mergeVectors(genreVec, subVec),
    subscribedChannelIds: new Set(subscriptions.map((s) => s.channelId)),
  };
}

function freshnessScore(publishedAt) {
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86400000;
  // Half-life of ~45 days: recent uploads score near 1, year-old videos trail off
  // but never hit zero, since a great catalog video is still a great find.
  return Math.pow(0.5, ageDays / 45);
}

function engagementScore(stats) {
  const views = Number(stats?.viewCount || 0);
  const likes = Number(stats?.likeCount || 0);
  if (views === 0) return 0;
  const likeRatio = Math.min(likes / views, 0.15) / 0.15; // normalize, cap outliers
  const viewScore = Math.min(Math.log10(views + 1) / 7, 1); // log-scale views, cap ~10M
  return 0.6 * viewScore + 0.4 * likeRatio;
}

/** Core discoverability signal: an inverse-log curve on subscriber count so
 *  a 5k-subscriber creator scores much higher than a 5M one, plus a flat
 *  bonus for channels the user isn't already subscribed to. The slider
 *  (0 = "don't care about size", 1 = "small creators only") controls how
 *  hard this pulls against raw popularity. */
function discoverabilityScore(subscriberCount, channelId, subscribedIds, slider) {
  const subs = Number(subscriberCount || 0);
  const sizePenaltyFree = 1 - Math.min(Math.log10(subs + 10) / 8, 1); // ~0 at 100M, ~1 at <100 subs
  const newToUserBonus = subscribedIds.has(channelId) ? 0 : 0.25;
  return Math.min(sizePenaltyFree + newToUserBonus, 1) * slider + (1 - slider) * newToUserBonus;
}

/**
 * @param profile        output of buildTasteProfile()
 * @param candidateVideos  raw search.list results (video + channel snippet)
 * @param videoDetails   videos.list results keyed by videoId (stats)
 * @param channelDetails channels.list results keyed by channelId (stats/topics)
 * @param discoverability 0..1 slider from the user
 */
export function rankCandidates({
  profile,
  candidateVideos,
  videoDetailsById,
  channelDetailsById,
  discoverability = 0.6,
}) {
  // Loaded once per call, not once per candidate — this file only changes
  // when trainWeights.js reruns, so re-reading it 20+ times per request
  // would be pure waste.
  const learned = loadLearnedWeights();
  const learnedWeightsArray = learned ? FEATURE_ORDER.map((key) => learned.weights[key]) : null;

  const scored = candidateVideos.map((video) => {
    const vDetails = videoDetailsById.get(video.videoId);
    const cDetails = channelDetailsById.get(video.channelId);

    const videoText = termVector([
      video.title,
      video.description,
      ...(vDetails?.snippet?.tags ?? []),
    ]);
    const channelText = termVector([
      cDetails?.snippet?.title,
      cDetails?.snippet?.description,
    ], 1.5); // channel-level description is a stronger topic signal than one video

    const combinedVec = mergeVectors(videoText, channelText);
    const topicMatch = cosineSimilarity(profile.vector, combinedVec);
    const engagement = engagementScore(vDetails?.statistics);
    const freshness = freshnessScore(video.publishedAt);
    const discover = discoverabilityScore(
      cDetails?.statistics?.subscriberCount,
      video.channelId,
      profile.subscribedChannelIds,
      discoverability
    );

    const breakdown = { topicMatch, engagement, freshness, discover };

    // Learned weights (when available) replace the hand-picked blend
    // entirely, using the exact same four features — only where the
    // weights came from changes. predict() is sigmoid(w·x + b), and
    // sigmoid is monotonic, so ranking by its output produces the same
    // order as ranking by the raw weighted sum would; the fallback blend
    // below is that same shape without the sigmoid, weights chosen by
    // hand instead of trained on real feedback.
    const score = learned
      ? predict(learnedWeightsArray, learned.bias, FEATURE_ORDER.map((key) => breakdown[key]))
      : 0.45 * topicMatch + 0.15 * engagement + 0.1 * freshness + 0.3 * discover;

    return {
      video,
      channel: cDetails,
      score,
      breakdown,
    };
  });

  // Roll up to one best-scoring entry per channel so a single prolific
  // channel doesn't flood the results.
  const byChannel = new Map();
  for (const entry of scored) {
    const key = entry.video.channelId;
    if (!byChannel.has(key) || byChannel.get(key).score < entry.score) {
      byChannel.set(key, entry);
    }
  }

  return [...byChannel.values()].sort((a, b) => b.score - a.score);
}

/** Turns the score breakdown into a plain-English "why this" line. */
export function explain(entry) {
  const { topicMatch, discover, engagement, freshness } = entry.breakdown;
  const reasons = [];
  if (topicMatch > 0.25) reasons.push("closely matches your genres/subscriptions");
  else if (topicMatch > 0.08) reasons.push("touches on topics you're into");
  if (discover > 0.5) reasons.push("a smaller creator you're not subscribed to yet");
  if (engagement > 0.6) reasons.push("strong viewer engagement");
  if (freshness > 0.6) reasons.push("recently uploaded");
  return reasons.length ? reasons.join(" · ") : "loosely related to your taste profile";
}
