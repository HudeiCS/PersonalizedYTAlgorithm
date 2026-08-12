// Stores user feedback (liked / dismissed) on individual recommendations.
// This is where "y" gets created: each row pairs the exact feature vector
// rankCandidates() computed for a video (X) with what the user actually did
// about it (y = 1 liked, 0 dismissed) — the labeled dataset a future
// training step will learn from. Same plain-JSON-file approach as store.js,
// for the same reason (zero build tools, fine for local dev).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEEDBACK_PATH = path.join(__dirname, "feedback.json");

function load() {
  if (!fs.existsSync(FEEDBACK_PATH)) return { events: [] };
  try {
    return JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf-8"));
  } catch {
    return { events: [] };
  }
}

function save(data) { // Not safe need to redo for "real production"
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
}

/**
 * Records one feedback event.
 * @param userId    signed-in user's id, or null if anonymous
 * @param videoId   which video this feedback is about (for debugging/audit)
 * @param channelId which channel it belongs to (same)
 * @param features  the exact { topicMatch, engagement, freshness, discover }
 *                  breakdown the ranking model computed for this video —
 *                  this is X, and it has to be the same vector the model
 *                  actually saw, not recomputed later from possibly-changed data
 * @param label     1 = user liked/clicked it, 0 = user dismissed it — this is y
 */
export function recordFeedback({ userId, videoId, channelId, features, label }) {
  const data = load();
  data.events.push({
    userId: userId ?? null,
    videoId,
    channelId,
    features,
    label,
    recordedAt: Date.now(),
  });
  save(data);
  return data.events.length;
}

/** Returns every stored feedback event — this is the training set. */
export function getAllFeedback() {
  return load().events;
}
