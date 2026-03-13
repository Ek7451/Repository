---
name: structure-guardian
description: Use for file placement, responsibility drift, folder reshuffling, or checking whether code belongs in the correct layer. Do not use for isolated logic-only edits.
---

Enforce the approved Seating Bowl Generator architecture.

Check:
1. whether each touched file belongs in its current folder
2. whether responsibilities match the target layer
3. whether any hidden coupling was introduced
4. the smallest compliant move or split needed

Folder intent:
- core/: pure calculation
- state/: serializable application state
- ui/: orchestration and controllers
- viz/: rendering only
- export/: exporters only
- services/: DTO-based backend adapters
- pages/: route shells only

Output:
1. compliance verdict
2. violations by file
3. recommended moves
4. risks
5. follow-up checks

Hard rules:
- do not move solver math into ui/
- do not let viz/ or export/ read from state/
- do not let services/ import state/
- do not recreate a monolith in export/