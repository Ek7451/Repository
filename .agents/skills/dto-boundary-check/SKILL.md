---
name: dto-boundary-check
description: Use when touching services, auth, API payloads, persistence flows, save/load transport, or backend integration. Do not use for pure frontend rendering changes.
---

Enforce DTO purity at the service boundary.

Rules:
- services/ accepts and returns plain JSON-compatible objects
- services/ must not import state/
- transport code must not depend on AppState instances
- serialization belongs at the edge, not inside transport wiring

Tasks:
1. review touched service and persistence code
2. flag any AppState leakage into services
3. propose DTO shapes where needed
4. keep backend contracts stable even if frontend state evolves

Output:
1. violations
2. DTO candidates
3. serialization boundary
4. minimal refactor plan