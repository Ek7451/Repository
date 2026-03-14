# Architecture Decision Log

## 2026-03-14: Full Alignment Phase 1 Canonical Decisions

- Root `app.js` remains an approved thin bootstrap and route shell exception. It is not the old editor monolith and does not need to move into `pages/`.
- The canonical persisted project DTO remains the single-study envelope:
  `{ id, name, sport, createdAt, updatedAt, state }`.
- Multi-study project wrapping is deferred unless it is introduced later as a new feature with its own state and service design.
- Productized SSO and backend auth hardening are intentionally deferred. Current architecture alignment must not block on that productization track.
