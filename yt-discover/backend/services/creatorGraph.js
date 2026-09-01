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

import { resolveChannelByHandle, fetchChannelUploads } from "./youtubeService.js";

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
    { text: seedUploads.map((v) => `${v.title} ${v.description}`).join("\n"), from: seed.channelId },
  ];

  for (let hop = 1; hop <= cfg.depth && found.length < cfg.maxCreators; hop++) {
    const handleCounts = new Map();
    for (const { text, from } of frontier) {
      for (const h of extractHandles(text, visitedHandles).keys()) {
        if (!creditedBy.has(h)) creditedBy.set(h, new Set());
        creditedBy.get(h).add(from);
        handleCounts.set(h, creditedBy.get(h).size);
      }
    }

    const next = [...handleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([h]) => h)
      .filter((h) => !visitedHandles.has(h))
      .slice(0, Math.min(cfg.maxPerHop, cfg.maxCreators - found.length));
    if (next.length === 0) break;
    next.forEach((h) => visitedHandles.add(h));

    const resolved = (await Promise.all(next.map((h) => resolveChannelByHandle(h))))
      .filter((c) => c?.uploadsPlaylistId && !visitedIds.has(c.channelId));
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
      from: c.channelId,
    }));
  }

  const videos = [
    ...seedUploads.slice(0, cfg.seedOwnVideos),
    ...found.flatMap(({ hop, uploads }) =>
      uploads.slice(0, hop === 1 ? cfg.perRelatedVideos : cfg.perDistantVideos)
    ),
  ];

  return { videos, seed, related: found.map((f) => ({ ...f.channel, hop: f.hop })) };
}
