import { useState } from "react";

function formatSubs(n) {
  if (n == null) return "— subs";
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M subs`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K subs`;
  return `${num} subs`;
}

/** Spoken form of the subscriber count. The visual "1.2M subs" is fine to
 *  read but is announced letter-by-letter ("M-S-U-B-S") by some screen
 *  readers, so the accessible name gets words instead. */
function spokenSubs(n) {
  if (n == null) return "subscriber count unknown";
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)} million subscribers`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)} thousand subscribers`;
  return `${num} subscribers`;
}

/** The channel avatar comes from yt3.ggpht.com, which 429s on hotlinked
 *  requests that carry a Referer header. referrerPolicy strips that; onError
 *  falls back to an initials bubble so a throttled or missing avatar doesn't
 *  leave a broken-image glyph next to the channel name. */
function ChannelThumb({ url, name }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
    return <span className="channel-thumb-fallback" aria-hidden="true">{initial}</span>;
  }

  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export default function CreatorCard({ result, feedbackState, onFeedback }) {
  const { video, channelId, channelTitle, channelThumbnail, subscriberCount, alreadySubscribed, beyondSizePreference, features } = result;

  // Every card previously exposed two buttons named just "Like" and "Not for
  // me". With 30 cards on screen that's 60 controls with 30 duplicate
  // names — useless in a screen reader's control list, where names are read
  // out of their visual context. Naming each one with its video makes the
  // list navigable.
  const describes = `${video.title} from ${channelTitle}`;

  return (
    <article className="creator-card" aria-label={describes}>
      <a
        className="card-link"
        href={video.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Watch ${describes}. ${spokenSubs(subscriberCount)}.${
          beyondSizePreference ? " Larger than your discoverability setting asked for." : ""
        } Opens in a new tab.`}
      >
        <div className="thumb-wrap">
          {/* alt="" is correct: the thumbnail is decorative here, and the
              title sits right beside it as the real content.
              referrerPolicy: YouTube's image CDNs (i.ytimg.com, yt3.ggpht.com)
              return HTTP 429 for hotlinked requests carrying a Referer header. */}
          {video.thumbnail && (
            <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
          )}
        </div>
        <div className="card-body">
          {/* Both badges are already spoken in the link's accessible name
              above, so they're hidden here to avoid saying it twice. */}
          {beyondSizePreference ? (
            <span className="badge-oversize" aria-hidden="true">larger than your filter</span>
          ) : (
            !alreadySubscribed && <span className="badge-new" aria-hidden="true">new to you</span>
          )}
          <div className="video-title">{video.title}</div>
          <div className="channel-row">
            <ChannelThumb url={channelThumbnail} name={channelTitle} />
            <span className="channel-name">{channelTitle}</span>
            <span className="subs" aria-hidden="true">{formatSubs(subscriberCount)}</span>
          </div>
        </div>
      </a>
      {feedbackState ? (
        <div className="feedback-row feedback-done" role="status">
          <ThumbsUpIcon />
          thanks for the feedback
        </div>
      ) : (
        <div className="feedback-row">
          <button
            type="button"
            className="feedback-btn like"
            aria-label={`Like ${describes}`}
            onClick={() => onFeedback(video.id, channelId, features, 1, video.title)}
          >
            Like
          </button>
          <button
            type="button"
            className="feedback-btn dismiss"
            aria-label={`Not for me: ${describes}`}
            onClick={() => onFeedback(video.id, channelId, features, 0, video.title)}
          >
            Not for me
          </button>
        </div>
      )}
    </article>
  );
}

function ThumbsUpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3Zm0 0 4.5-7a2 2 0 0 1 2 2v3h5.2a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 16.5 20H7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
