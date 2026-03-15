---
name: dto-boundary-check
description: Use when touching services, auth, API payloads, persistence flows, save/load transport, or backend integration. Do not use for pure frontend rendering changes.
---

Enforce DTO purity at the service and persistence boundary.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. For multi-file or structural work, start in Ask mode and produce:
   - target files
   - DTO edges affected
   - imports to change
   - verification commands
4. Prefer existing DTO helpers over adding new transport-layer abstractions.
5. Do not place service DTO shaping in ui/app.js.

Rules:
- services/ accepts and returns plain JSON-compatible objects
- services/ must not import state/
- transport code must not depend on AppState instances
- serialization belongs at the edge, not inside transport wiring
- state/project.js is the preferred home for pure project/session normalization helpers
- service boundaries must not accept controller-owned models, class instances, DOM elements, or live state references
- backend contracts should remain stable even if frontend state evolves

Tasks:
1. review touched service and persistence code
2. flag any AppState leakage into services
3. flag any controller or ui leakage into persistence or transport
4. identify the exact serialization edge
5. propose DTO shapes where needed
6. keep backend contracts stable even if frontend state evolves
7. identify whether state/project.js should own any new helper introduced by the change

Required checks:
- lint
- tests touching persistence or transport
- build if save/load or service wiring changed
- import-boundary audit if present

Output:
1. violations
2. DTO candidates
3. serialization boundary
4. stable contract notes
5. minimal refactor plan
6. verification checklist

Completion criteria:
- no AppState or ui/controller object crosses the service boundary
- DTO shaping is explicit
- serialization is owned at the edge
- no duplicate transport logic is left behind