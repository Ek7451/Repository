---
name: verification-gate
description: Use after any code, architecture, file placement, state, export, or service change. Do not use for discussion-only tasks.
---

Define what done means for this repo and refuse premature completion.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. Collect all required verification commands from the applicable AGENTS.md files.
4. If app.js was touched, include an explicit architecture check in the final report.

Always report:
1. files changed
2. responsibilities moved
3. checks run
4. checks skipped
5. remaining blockers
6. exact methods or helpers moved, if any

Required verification:
- lint
- tests
- type checks if present
- build if runtime wiring changed
- architecture check for forbidden imports
- confirm no duplicate state source was introduced
- confirm viz/ and export/ consume arguments, not live DOM state
- confirm moved logic was actually deleted from the old home
- if ui/app.js was touched, confirm whether it became smaller or simpler
- if ui/app.js was touched, confirm no new helper was added that violates AGENTS.md

Additional completion checks:
- verify no reverse imports were introduced
- verify no duplicate helper remains after extraction
- verify behavior-preserving refactors did not silently change public contracts unless the task explicitly required that

Rules:
- do not declare completion if a required check was skipped without explanation
- do not declare completion if logic was copied but not removed from the old file
- do not declare completion if ui/app.js still owns logic that the change was supposed to extract

Output:
1. files changed
2. responsibilities moved
3. checks run with results
4. checks skipped with reasons
5. blockers
6. post-change architecture notes
7. final completion verdict

Completion criteria:
- all required checks were run or explicitly justified
- moved logic is gone from the old location
- architecture boundaries still hold
- app.js did not regress into a broader control surface