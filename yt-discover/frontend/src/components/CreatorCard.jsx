function formatSubs(n) {
  if (n == null) return "— subs";
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M subs`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K subs`;
  return `${num} subs`;
}

export default function CreatorCard({ result, feedbackState, onFeedback }) {
  const { video, channelId, channelTitle, channelThumbnail, subscriberCount, score, reason, alreadySubscribed, features } = result;

  return (
    <div className="creator-card">
      <a className="card-link" href={video.url} target="_blank" rel="noreferrer">
        <div className="thumb-wrap">
          {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" />}
          <span className="score-badge">{score.toFixed(2)}</span>
        </div>
        <div className="card-body">
          {!alreadySubscribed && <span className="badge-new">new to you</span>}
          <div className="video-title">{video.title}</div>
          <div className="channel-row">
            {channelThumbnail && <img src={channelThumbnail} alt="" />}
            <span className="channel-name">{channelTitle}</span>
            <span className="subs">{formatSubs(subscriberCount)}</span>
          </div>
          <div className="reason">{reason}</div>
        </div>
      </a>
      <div className="feedback-row">
        <button
          className={`feedback-btn like${feedbackState === "liked" ? " active" : ""}`}
          disabled={feedbackState != null}
          onClick={() => onFeedback(video.id, channelId, features, 1)}
        >
          Like
        </button>
        <button
          className={`feedback-btn dismiss${feedbackState === "dismissed" ? " active" : ""}`}
          disabled={feedbackState != null}
          onClick={() => onFeedback(video.id, channelId, features, 0)}
        >
          Not for me
        </button>
      </div>
    </div>
  );
}
