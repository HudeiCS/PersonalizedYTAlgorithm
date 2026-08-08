# PersonalizedYTAlgorithm

# Unnamed

A personalized YouTube feed you can actually steer. Builds a taste profile from your subscriptions, likes, and your own feedback, then ranks videos around it — and tells you why each one showed up.

Status: early MVP.

## Why

YouTube optimizes for watch time. UNNAMED optimizes for you: every pick is explainable, you can hide channels and rate videos, and your profile is yours to delete anytime.

## How it works

Two signals feed one profile:
- Subscriptions, likes, and playlists, pulled from the YouTube Data API (read-only)
- Topics you confirm at signup, plus ongoing thumbs up/down and hides

Flow: connect → pull signals → build profile → generate candidates → rank → feed → feedback loops back in.

Ranking is a plain weighted score (channel + topic + keyword overlap, recency boost, penalties for seen/disliked). No ML yet — the transparent scorer is the point.

Note: YouTube's API doesn't expose watch history (gone for third parties since 2016), so subs + likes give the warm start and your feedback does the tuning.

## Stack

- YouTube Data API v3 (OAuth)
- Backend: TBD
- Postgres — per-user profiles/feedback + shared channel/video caches
- Frontend: TBD

Quota matters: 10k units/day, shared across users. So no search calls in the core loop (candidates come from cheap channel reads), shared caches, batched lookups, a scheduled refresh, and a self-tracked unit counter.

## Roadmap

- [x] Phase 0 — spike: OAuth + print an account's subs/likes
- [ ] Phase 1 — API client, token refresh, quota counter
- [ ] Phase 2 — ingestion + data model
- [ ] Phase 3 — Postgres schema, encrypted tokens
- [ ] Phase 4 — ranking engine
- [ ] Phase 5 — onboarding, feed, feedback UI
- [ ] Phase 6 — deploy, Google OAuth verification, privacy policy

## Setup

Needs a Google Cloud project with YouTube Data API v3 enabled and OAuth credentials.

While in testing mode, add your Google account as a test user or sign-in won't work.

## Privacy

Read-only access — UNNAMED can't post or change anything on your account. Tokens stored encrypted, profile deletable on request, nothing sold or shared.

---

Not affiliated with YouTube or Google. Built on the YouTube Data API v3.
