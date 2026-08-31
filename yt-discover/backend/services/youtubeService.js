import { google } from "googleapis";
import { createOAuthClient } from "../config/googleOAuth.js";
import { updateTokens } from "../db/store.js";

// Builds an authed googleapis client for one user, refreshing the access
// token transparently (and persisting the new one) when it's expired.
function clientFor(user) {
  const auth = createOAuthClient();
  auth.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expiry_date: user.token_expiry,
  });

  auth.on("tokens", (tokens) => {
    updateTokens(user.id, {
      access_token: tokens.access_token ?? user.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? user.token_expiry,
    });
  });

  return google.youtube({ version: "v3", auth });
}

// Public, unauthenticated client for topic/genre search that doesn't need
// the user's own data (used as a fallback / for genre-only discovery).
function publicClient() {
  return google.youtube({ version: "v3", auth: process.env.GOOGLE_API_KEY });
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Turns HTML entities in YouTube's text fields back into the characters
 *  they stand for. The Data API returns titles and descriptions HTML-escaped
 *  — a channel called "Don't Panic" comes back as "Don&#39;t Panic" — and
 *  since we render that text as text, not HTML, the escape leaks through to
 *  the page verbatim.
 *
 *  Decoding repeats until the string stops changing (capped, so a crafted
 *  "&amp;amp;amp;…" can't spin here) because YouTube sometimes double-encodes:
 *  "&amp;#39;" needs two passes to reach an apostrophe. Re-running it on
 *  already-clean text is a no-op, so it's safe to apply more than once along
 *  a path. */
export function decodeEntities(text) {
  if (typeof text !== "string" || !text.includes("&")) return text;

  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        // Reject anything outside the assignable range rather than throwing.
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Applies decodeEntities to the human-readable fields of a raw API item,
 *  leaving ids, stats, and thumbnails untouched. Used where we hand the
 *  API's own object shape downstream instead of mapping it to our own. */
function decodeSnippet(item) {
  if (!item?.snippet) return item;
  return {
    ...item,
    snippet: {
      ...item.snippet,
      title: decodeEntities(item.snippet.title),
      description: decodeEntities(item.snippet.description),
      ...(item.snippet.channelTitle
        ? { channelTitle: decodeEntities(item.snippet.channelTitle) }
        : {}),
      ...(item.snippet.tags
        ? { tags: item.snippet.tags.map((t) => decodeEntities(t)) }
        : {}),
    },
  };
}

/** Picks the highest-resolution thumbnail YouTube gave us for a given
 *  snippet.thumbnails object. `search.list` only ever returns up to `high`
 *  (~480x360); `videos.list` and `channels.list` often go up to `standard`
 *  or `maxres`. Falling back down the chain keeps this safe to call on
 *  either shape without ever ending up with no thumbnail at all. */
export function bestThumbnailUrl(thumbnails) {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url
  );
}

/** Parses a YouTube `contentDetails.duration` ISO 8601 string (e.g. "PT4M13S")
 *  into whole seconds. Returns null for anything that doesn't match, so
 *  callers can treat "unknown duration" as "don't filter it out". */
export function parseDurationSeconds(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return Number(hours || 0) * 3600 + Number(minutes || 0) * 60 + Number(seconds || 0);
}

/** Whether a video is an actual YouTube Short — determined by asking
 *  YouTube itself rather than guessing from duration. The Data API has no
 *  "isShort" field at all, and duration alone is an unreliable proxy: most
 *  Shorts are under 60s, but YouTube raised the Shorts length cap to 180s,
 *  so plenty of real Shorts run 60-180s — while plenty of ordinary,
 *  intentionally short videos are also under 60s without being Shorts.
 *
 *  This instead relies on the same routing YouTube's own clients use:
 *  visiting /shorts/<id> serves the Short directly (200) for a real Short,
 *  but 30x-redirects to /watch?v=<id> for anything else. Returns null
 *  (unknown) on any network hiccup so callers can fall back gracefully
 *  instead of wrongly excluding a legitimate video. */
export async function isYouTubeShort(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    if (res.status >= 300 && res.status < 400) return false;
    if (res.status === 200) return true;
    return null;
  } catch {
    return null;
  }
}

/** All channels the user is subscribed to (paginated). Capped at 200 to keep
 *  the algorithm responsive; that's plenty of signal for a taste profile. */
export async function fetchSubscriptions(user) {
  const yt = clientFor(user);
  let channels = [];
  let pageToken;

  do {
    const { data } = await yt.subscriptions.list({
      part: ["snippet"],
      mine: true,
      maxResults: 50,
      pageToken,
    });
    channels.push(
      ...(data.items ?? []).map((item) => ({
        channelId: item.snippet.resourceId.channelId,
        title: decodeEntities(item.snippet.title),
        description: decodeEntities(item.snippet.description),
        thumbnail: item.snippet.thumbnails?.default?.url,
        subscribedAt: item.snippet.publishedAt,
      }))
    );
    pageToken = data.nextPageToken;
  } while (pageToken && channels.length < 200);

  return channels;
}

/** Enrich a batch of channel IDs with topic categories, stats, and tags —
 *  this is the raw material the recommendation engine scores against.
 *  YouTube caps `channels.list` at 50 ids per call, so we chunk. */
export async function enrichChannels(channelIds, useAuthedClient = null) {
  const yt = useAuthedClient ?? publicClient();
  const chunks = [];
  for (let i = 0; i < channelIds.length; i += 50) chunks.push(channelIds.slice(i, i + 50));

  const results = [];
  for (const chunk of chunks) {
    const { data } = await yt.channels.list({
      part: ["snippet", "statistics", "topicDetails", "brandingSettings"],
      id: chunk,
    });
    results.push(...(data.items ?? []).map(decodeSnippet));
  }
  return results;
}

/** Genre/topic-driven channel discovery. Searches videos matching the
 *  query, then rolls the results up to their parent channels — this is how
 *  we go from "Minecraft edit videos" to a list of candidate creators.
 *
 *  `publishedAfter`/`videoDuration` push the user's age/duration filters
 *  into the search itself rather than sampling `maxResults` videos and
 *  discarding most of them locally afterward — with `order: "relevance"`,
 *  the top of an unfiltered pool skews toward old evergreen uploads, so a
 *  local-only "past year" filter on a small sample routinely left almost
 *  nothing standing.
 *
 *  Returns `{ videos, nextPageToken }` rather than a bare array so callers
 *  can page for more when one page doesn't yield enough distinct channels.
 *  Paging is the caller's decision because it's the main quota cost — see
 *  the search loop in routes/recommendations.js. */
export async function searchByTopic(
  query,
  {
    order = "relevance",
    maxResults = 25,
    publishedAfter,
    publishedBefore,
    videoDuration,
    pageToken,
  } = {}
) {
  const yt = publicClient();
  const { data } = await yt.search.list({
    part: ["snippet"],
    q: query,
    type: ["video"],
    order,
    maxResults,
    relevanceLanguage: "en",
    safeSearch: "none",
    ...(publishedAfter ? { publishedAfter } : {}),
    // Pairs with publishedAfter to bound a search to a specific window,
    // which is how repeat searches of the same topic draw from different
    // candidates instead of re-ranking the same page.
    ...(publishedBefore ? { publishedBefore } : {}),
    ...(videoDuration ? { videoDuration } : {}),
    ...(pageToken ? { pageToken } : {}),
  });

  const videos = (data.items ?? []).map((item) => ({
    videoId: item.id.videoId,
    channelId: item.snippet.channelId,
    channelTitle: decodeEntities(item.snippet.channelTitle),
    title: decodeEntities(item.snippet.title),
    description: decodeEntities(item.snippet.description),
    publishedAt: item.snippet.publishedAt,
    thumbnail: bestThumbnailUrl(item.snippet.thumbnails),
  }));

  return { videos, nextPageToken: data.nextPageToken ?? null };
}

/** Video-level stats (views, likes, tags) for scoring engagement + recency.
 *  `videos.list` caps at 50 ids per call, so we chunk — same as
 *  enrichChannels. Previously this sliced to the first 50 and dropped the
 *  rest, which silently gave every video past #50 no statistics: they
 *  scored engagement 0 and lost their tags for topic matching, purely
 *  because of where they landed in the array. */
export async function fetchVideoDetails(videoIds) {
  if (videoIds.length === 0) return [];
  const yt = publicClient();
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 50) chunks.push(videoIds.slice(i, i + 50));

  const results = [];
  for (const chunk of chunks) {
    const { data } = await yt.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: chunk,
    });
    results.push(...(data.items ?? []).map(decodeSnippet));
  }
  return results;
}
