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

export default function CreatorCard({ result, feedbackState, onFeedback }) {
  const { video, channelId, channelTitle, channelThumbnail, subscriberCount, score, reason, alreadySubscribed, beyondSizePreference, features } = result;

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
        } Match score ${score.toFixed(2)} out of 1. ${reason}. Opens in a new tab.`}
      >
        <div className="thumb-wrap">
          {/* alt="" is correct: the thumbnail is decorative here, and the
              title sits right beside it as the real content. */}
          {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
          {/* Already spoken as "Match score …" in the link's accessible
              name above; left visible for sighted users, hidden from the
              accessibility tree so it isn't read as a bare "0.42". */}
          <span className="score-badge" aria-hidden="true">{score.toFixed(2)}</span>
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
            {channelThumbnail && <img src={channelThumbnail} alt="" />}
            <span className="channel-name">{channelTitle}</span>
            <span className="subs" aria-hidden="true">{formatSubs(subscriberCount)}</span>
          </div>
          <div className="reason">{reason}</div>
        </div>
      </a>
      <div className="feedback-row">
        <button
          type="button"
          className={`feedback-btn like${feedbackState === "liked" ? " active" : ""}`}
          disabled={feedbackState != null}
          aria-pressed={feedbackState === "liked"}
          aria-label={`Like ${describes}`}
          onClick={() => onFeedback(video.id, channelId, features, 1, video.title)}
        >
          Like
        </button>
        <button
          type="button"
          className={`feedback-btn dismiss${feedbackState === "dismissed" ? " active" : ""}`}
          disabled={feedbackState != null}
          aria-pressed={feedbackState === "dismissed"}
          aria-label={`Not for me: ${describes}`}
          onClick={() => onFeedback(video.id, channelId, features, 0, video.title)}
        >
          Not for me
        </button>
      </div>
    </article>
  );
}
