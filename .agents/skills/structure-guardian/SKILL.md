---
name: structure-guardian
description: Use for file placement, responsibility drift, folder reshuffling, or checking whether code belongs in the correct layer. Do not use for isolated logic-only edits.
---

Enforce the approved architecture and stop responsibility drift before it turns into another monolith.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. For multi-file or structural work, start in Ask mode and produce:
   - touched files
   - compliance risks
   - smallest compliant moves
   - verification commands
4. Prefer the smallest compliant move into an existing module.

Check:
1. whether each touched file belongs in its current folder
2. whether responsibilities match the target layer
3. whether any hidden coupling was introduced
4. whether ui/app.js absorbed logic that should live elsewhere
5. the smallest compliant move or split needed

Folder intent:
- core/: pure calculation and domain logic
- state/: serializable application state, selectors, DTO builders
- ui/: orchestration and controllers
- viz/: rendering and rendering-adjacent geometry only
- export/: exporters only
- services/: DTO-based backend adapters
- pages/: route shells only

Hard rules:
- do not move solver math into ui/
- do not let viz/ or export/ read from live state or DOM
- do not let services/ import state/
- do not recreate a monolith in export/
- do not place state-derived DTO builders in ui/
- do not place solver-row interpretation outside core/
- do not place bowl-bound or render-space geometry helpers outside viz/
- do not place pure project name, status, or save helper logic outside state/project.js when that file already owns adjacent helpers
- do not add new helper methods to ui/app.js unless they are strictly composition or top level orchestration

Tasks:
1. assess each touched file for folder compliance
2. identify responsibility drift by file
3. identify the best existing home for misplaced logic
4. recommend the smallest compliant move
5. call out risks if a move is postponed

Required checks:
- lint
- tests if behavior changed
- import-boundary audit if files moved across layers
- verify no duplicate helper remains in the old home

Output:
1. compliance verdict
2. violations by file
3. responsibility drift into app.js
4. best existing home
5. smallest compliant move
6. risks
7. follow-up checks

Completion criteria:
- each touched file matches its layer intent
- app.js does not gain new non-orchestration helpers
- misplaced logic has a named compliant destination
- no duplicate or orphaned helper remains