---
name: behavior-preserving-refactor-executor
description: Use after planning is complete and destination modules are known. Implements small to medium refactors by moving logic into the correct existing modules while preserving behavior.
---

Implement the approved refactor without redesigning the architecture.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. If the task spans more than one file or changes architecture boundaries, start in Ask mode and restate:
   - source logic to move
   - destination file(s)
   - imports to change
   - verification commands
4. Prefer existing modules over creating new files.
5. Do not place logic in ui/app.js unless it is strictly composition, lifecycle wiring, or top level orchestration.

Execution rules:
- preserve behavior unless the prompt explicitly allows behavior changes
- make the smallest valid move
- move code to the best existing home
- update imports minimally
- delete the old logic after the move
- do not leave duplicate helpers behind
- do not add callback reach-through or hidden coupling just to make the move work
- do not create new abstractions unless the existing modules cannot cleanly own the logic

Placement rules:
- state-derived selectors and DTO builders -> state/
- solver construction and solver-result interpretation -> core/
- project/session normalization helpers -> state/project.js
- renderer geometry and bounds helpers -> viz/
- feature-specific DOM ownership -> the owning ui feature module
- ui/app.js -> composition, startup/shutdown, top level orchestration only

When editing ui/app.js:
- remove knowledge, do not relocate it sideways
- prefer calling a module API over re-implementing logic inline
- do not add new private helpers unless they are orchestration-only

Required output:
1. files changed
2. exact methods/functions moved
3. imports changed
4. old logic deleted from source
5. checks run
6. any remaining follow-up work

Required checks:
- run all programmatic checks required by applicable AGENTS.md files
- lint
- tests
- build if runtime wiring changed
- import-boundary checks if present

Completion criteria:
- behavior preserved
- moved logic lives in the correct layer
- old logic removed from the original file
- no new reverse imports
- ui/app.js is smaller or simpler if it was touched