/**
 * Creator graph ("more creators like this one")
 * ---------------------------------------------
 * A second way to gather candidates, for niches that text search cannot
 * reach at all.
 *
 * The motivating case: high-effort Valorant edit channels. Their videos are
 * titled after the song they edited to ("WHITE FERRARI", "Headlock",
 * "trance"), their channel descriptions are one-liners ("im so locked in"),
 * their channel keywords are empty, and their topic categories are the same
 * generic Action_game / Video_game_culture every gaming channel carries.
 * There is essentially no text to match, so no query finds them — verified
 * against the live API, including with VFX-jargon query expansion.
 *
 * What these creators DO have is each other. They credit collaborators in
 * their video descriptions constantly, and those credits are @handles that
 * resolve straight to channels. Four seed channels yielded thirty other
 * editors, with two of the seeds appearing in the others' credits — a real
 * network, invisible to a keyword index.
 *
 * So: the user names one creator they already like, and this walks outward
 * from it. Nothing about any particular niche is encoded here; the seed
 * comes from the user and the graph supplies the rest.
 *
 * Quota: ~1 unit per channel touched (channels.list?forHandle and
 * playlistItems.list are 1 each), versus 100 for a single search.list. That
 * is the only reason walking dozens of channels is affordable.
 */

import {
  resolveChannelByHandle,
  resolveChannelsByIds,
  fetchChannelUploads,
  fetchVideoDetails,
  fetchFeaturedChannels,
  enrichChannels,
  searchByTopic,
} from "./youtubeService.js";

// Master switch. false => seeds are treated as ordinary text topics again,
// which is exactly the behaviour before this file existed.
export const USE_CREATOR_GRAPH = true;

const LIMITS = {
  // videos read from each channel, i.e. how much description text is mined
  // for collaborator credits
  seedVideos: 15,
  hopVideos: 10,
  // How far to walk. One hop reaches only who the seed itself credits, which
  // for a sparse seed is a handful of channels — and the page then pads with
  // several videos from each. A second hop reached 34 creators from @dishy
  // where one reached 9, which is also what drops the per-channel allowance
  // back to one video each.
  depth: 2,
  // creators resolved per hop, and overall. Both cap quota; the overall cap
  // is what stops a well-connected seed from fanning out indefinitely.
  maxPerHop: 18,
  maxCreators: 40,
  // videos contributed to the candidate pool, by distance from the seed
  seedOwnVideos: 4,
  perRelatedVideos: 6,
  perDistantVideos: 4,
  // below this many creators from the graph, top up with a genre search
  minCreators: 6,
  // results pulled by that genre search
  fallbackResults: 25,
};

/** Whether a typed topic is naming a creator rather than describing a
 *  subject. Requiring the "@" keeps this unambiguous — "@dishy" is a
 *  creator, "dishy" is a search term — so a normal topic can never be
 *  mistaken for a handle. */
export function isCreatorSeed(topic) {
  return typeof topic === "string" && /^@[A-Za-z0-9._-]{2,}$/.test(topic.trim());
}

/** Handles credited in a block of description text. YouTube renders channel
 *  credits as plain "@handle" mentions, so this is just a scrape of those,
 *  minus the seed itself. */
export function extractHandles(text, exclude = new Set()) {
  const found = new Map();
  // The leading boundary matters: without it "foo@bar.com" in a business
  // e-mail address scrapes as the handle "bar.com".
  const pattern = /(?:^|[^\w@.])@([A-Za-z0-9._-]{3,})/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    // trailing punctuation sometimes rides along with the match
    const clean = match[1].toLowerCase().replace(/[._-]+$/, "");
    if (clean.length < 3 || exclude.has(clean)) continue;
    found.set(clean, (found.get(clean) ?? 0) + 1);
  }
  return found;
}

/**
 * Candidate videos gathered by walking outward from one creator.
 * Returns the same video shape searchByTopic does, so everything downstream
 * — enrichment, ranking, the per-channel rollup — is unchanged.
 *
 * Resolves to an empty list rather than throwing if the handle is unknown,
 * so one bad seed can't take down a request that also has real topics in it.
 */
export async function videosFromCreatorGraph(seedHandle, limits = {}) {
  const cfg = { ...LIMITS, ...limits };
  const handle = seedHandle.trim().replace(/^@/, "").toLowerCase();

  const seed = await resolveChannelByHandle(handle);
  if (!seed?.uploadsPlaylistId) return { videos: [], seed: null, related: [] };

  const seedUploads = await fetchChannelUploads(seed.uploadsPlaylistId, cfg.seedVideos);

  // Breadth-first walk outward. `frontier` is the channels whose credits are
  // mined next; `found` accumulates everyone reached, tagged with how many
  // hops out they are so nearer creators can contribute more videos.
  const visitedHandles = new Set([handle]);
  const visitedIds = new Set([seed.channelId]);
  const found = [];
  // how many distinct channels credited each handle — a handle credited by
  // several different creators is a far better bet than a one-off mention,
  // which is usually a channel's own boilerplate rather than a peer
  const creditedBy = new Map();

  let frontier = [
    {
      text: seedUploads.map((v) => `${v.title} ${v.description}`).join("\n"),
      channelId: seed.channelId,
    },
  ];

  for (let hop = 1; hop <= cfg.depth && found.length < cfg.maxCreators; hop++) {
    const handleCounts = new Map();
    for (const { text, channelId } of frontier) {
      for (const h of extractHandles(text, visitedHandles).keys()) {
        if (!creditedBy.has(h)) creditedBy.set(h, new Set());
        creditedBy.get(h).add(channelId);
        handleCounts.set(h, creditedBy.get(h).size);
      }
    }

    const next = [...handleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => h)
      .filter((h) => !visitedHandles.has(h))
      .slice(0, Math.min(cfg.maxPerHop, cfg.maxCreators - found.length));
    next.forEach((h) => visitedHandles.add(h));

    // Second edge source: the channels each frontier creator features on
    // their own page. Description credits and featured lists barely overlap —
    // small creators credit collaborators in descriptions and feature nobody,
    // established ones keep clean descriptions but curate a featured list. A
    // seed with neither used to fall through to showing only its own videos.
    const featuredIds = [...new Set(
      (await Promise.all(frontier.map((f) => fetchFeaturedChannels(f.channelId)))).flat()
    )].filter((id) => !visitedIds.has(id));

    if (next.length === 0 && featuredIds.length === 0) break;

    const byHandle = (await Promise.all(next.map((h) => resolveChannelByHandle(h)))).filter(Boolean);
    const byId = await resolveChannelsByIds(
      featuredIds.slice(0, Math.max(0, cfg.maxPerHop - byHandle.length))
    );

    const resolved = [...byHandle, ...byId].filter(
      (c) => c?.uploadsPlaylistId && !visitedIds.has(c.channelId)
    );
    resolved.forEach((c) => visitedIds.add(c.channelId));

    // Read each new channel's uploads once: they are both this hop's
    // candidate videos and the next hop's source of credits.
    const uploads = await Promise.all(
      resolved.map((c) =>
        fetchChannelUploads(c.uploadsPlaylistId, hop < cfg.depth ? cfg.hopVideos : cfg.perDistantVideos)
      )
    );

    resolved.forEach((c, i) => found.push({ channel: c, hop, uploads: uploads[i] }));
    frontier = resolved.map((c, i) => ({
      text: uploads[i].map((v) => `${v.title} ${v.description}`).join("\n"),
      channelId: c.channelId,
    }));
  }

  // Second strategy: what the creator makes, rather than who they know.
  // Plenty of creators credit nobody and feature nobody, and the walk finds
  // little or nothing for them. Rather than hand back a page of the seed's
  // own videos, work out the genre from the seed's own uploads and search for
  // it. This runs whenever the graph came back thin, not only when it came
  // back empty, so a sparse seed gets topped up instead of under-filling.
  let genreVideos = [];
  let genreQuery = null;
  if (found.length < cfg.minCreators) {
    genreQuery = await genreQueryForChannel(seed, seedUploads);
    if (genreQuery) {
      const { videos } = await searchByTopic(genreQuery, { maxResults: cfg.fallbackResults });
      genreVideos = videos.filter(
        (v) => v.channelId !== seed.channelId && !visitedIds.has(v.channelId)
      );
    }
  }

  const videos = [
    // Only lead with the seed's own work when there is other work to sit
    // beside it; when the genre search is carrying the page, the seed is not
    // the answer.
    ...(found.length ? seedUploads.slice(0, cfg.seedOwnVideos) : seedUploads.slice(0, 1)),
    ...found.flatMap(({ hop, uploads }) =>
      uploads.slice(0, hop === 1 ? cfg.perRelatedVideos : cfg.perDistantVideos)
    ),
    ...genreVideos,
  ];

  return {
    videos,
    seed,
    related: found.map((f) => ({ ...f.channel, hop: f.hop })),
    genreQuery,
    usedGenreSearch: genreVideos.length > 0,
  };
}

/** Strips accents and punctuation so "Bon Appétit" and "bon appetit" compare
 *  equal. */
function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const TITLE_STOPWORDS = new Set([
  "the","and","for","with","from","this","that","you","your","our","are","was",
  "但是","что","new","out","get","how","its","one","can","all","but","not","has",
  "video","videos","full","part","official","feat","ft","prod","edit","edits",
  "clips","clip","best","top","vol","ep","live","short","shorts","subscribe",
]);

/**
 * A search query describing what a creator actually makes, assembled from
 * whichever signals that particular channel happens to carry. Channels differ
 * enormously in what they fill in, so this walks a priority order rather than
 * trusting any single field:
 *
 *   1. channel keywords, single words only
 *   2. video tags, most frequent first
 *   3. words from video titles, most frequent first
 *   4. YouTube's topic categories
 *
 * Measured on real seeds: @dishy has NO channel keywords at all but 193 video
 * tags led by "valorant edit" and "valorant montage", so tags carry it, while
 * keywords alone would have produced the useless "Action game Video game
 * culture". @hudsunVFX has neither keywords nor tags and is carried by title
 * words. Topic categories are last because they are the same three generic
 * buckets for every gaming channel.
 *
 * Terms echoing the channel's own name or handle are dropped throughout: they
 * turn the search back toward the seed, which is the one creator the user
 * already has.
 */
async function genreQueryForChannel(seed, seedUploads) {
  const [channel] = await enrichChannels([seed.channelId]);

  const selfWords = new Set(
    `${channel?.snippet?.title ?? ""} ${seed.title ?? ""}`
      .split(/\s+/)
      .map(normalizeWord)
      .filter((w) => w.length > 2)
  );
  const isSelfReferential = (term) =>
    term.split(/\s+/).some((w) => selfWords.has(normalizeWord(w)));

  // 1. keywords the creator set. Single words describe the subject;
  // multi-word ones are nearly always show or presenter names, which are as
  // self-referential as the channel name (Bon Appétit: keeping them returned
  // 2 other channels, dropping them returned 23).
  const keywords = ((channel?.brandingSettings?.channel?.keywords ?? "")
    .match(/"[^"]*"|\S+/g) ?? [])
    .map((k) => k.replace(/"/g, "").trim())
    .filter((k) => k && !/\s/.test(k) && !isSelfReferential(k));

  // 2. video tags, which multi-word or not are genuinely topical
  let tags = [];
  const videoIds = seedUploads.map((v) => v.videoId).filter(Boolean);
  if (videoIds.length) {
    const details = await fetchVideoDetails(videoIds);
    const counts = new Map();
    for (const d of details) {
      for (const tag of d.snippet?.tags ?? []) {
        const clean = tag.trim().toLowerCase();
        if (clean && !isSelfReferential(clean)) counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }
    tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }

  // 3. recurring words in the titles themselves
  const titleCounts = new Map();
  for (const v of seedUploads) {
    for (const raw of (v.title ?? "").toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []) {
      if (TITLE_STOPWORDS.has(raw) || selfWords.has(raw)) continue;
      titleCounts.set(raw, (titleCounts.get(raw) ?? 0) + 1);
    }
  }
  const titleWords = [...titleCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  // 4. YouTube's own buckets, generic enough to be a last resort only
  const topics = (channel?.topicDetails?.topicCategories ?? []).map((url) =>
    decodeURIComponent(url.split("/").pop() ?? "").replace(/[_-]+/g, " ")
  );

  const terms = [];
  for (const source of [keywords, tags, titleWords, topics]) {
    for (const term of source) {
      if (terms.length >= 4) break;
      if (!terms.some((t) => t.includes(term) || term.includes(t))) terms.push(term);
    }
    if (terms.length >= 3) break;
  }

  return terms.length ? terms.join(" ") : null;
}
