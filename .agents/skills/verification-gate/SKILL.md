---
name: verification-gate
description: Use after any code, architecture, file placement, state, export, or service change. Do not use for discussion-only tasks.
---

Define what done means for this repo.

Always report:
1. files changed
2. responsibilities moved
3. checks run
4. checks skipped
5. remaining blockers

Required verification:
- lint
- tests
- type checks if present
- build if runtime wiring changed
- architecture check for forbidden imports
- confirm no duplicate state source was introduced
- confirm viz/ and export/ consume arguments, not live DOM state

Do not declare completion if a required check was skipped without explanation.