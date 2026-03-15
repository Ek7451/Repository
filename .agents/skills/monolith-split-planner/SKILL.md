---
name: monolith-split-planner
description: Use when a large file mixes responsibilities and must be split without changing behavior. Especially relevant for app.js and other orchestration-heavy files.
---

Plan a behavior-preserving split with strict preference for existing modules and strict protection against re-centralizing logic in ui/app.js.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. Start in Ask mode for any split spanning more than one file.
4. Produce a short plan before edits:
   - target file
   - current responsibility groups
   - exact destination files
   - import changes
   - verification commands
5. Prefer moving logic into existing modules before proposing new files.

Method:
1. identify current responsibilities
2. group code by responsibility
3. map each group to the correct destination folder
4. define the extraction order with the lowest breakage risk
5. identify shared helpers that should stay local or move to core/
6. identify what must remain in the original file after the split

Special handling for ui/app.js:
Classify code into:
- composition and dependency wiring
- startup and shutdown lifecycle
- state-derived DTO shaping
- project helper logic
- solver construction and solver-result interpretation
- renderer geometry and bounds logic
- feature-specific DOM plumbing
- render/update orchestration

For ui/app.js, only these are allowed to remain:
- composition and dependency wiring
- startup and shutdown lifecycle
- top level orchestration

Everything else must be proposed for extraction into the best existing module.

Destination rules:
- state-derived selectors and DTO builders -> state/
- solver construction and solver-row interpretation -> core/profile-solver.js or other core module
- pure project/session normalization helpers -> state/project.js
- renderer geometry and bounds helpers -> viz/field-renderer.js or other viz module
- feature-specific DOM ownership -> the owning ui feature module, not app.js

Rules:
- split by responsibility, not line count alone
- prefer minimal churn
- prefer existing modules over new files
- do not redesign stable core modules without a clear need
- do not hide app.js bloat by spreading callback soup into neighboring files
- do not leave duplicate helpers behind in the old file

Required checks:
- lint
- tests
- build if runtime wiring changed
- import-boundary audit if dependency flow changed
- confirm the source file became smaller or simpler

Output:
1. current responsibility map
2. proposed file split map
3. destination paths
4. extraction sequence
5. what remains in the original file
6. circular import risks
7. verification checklist

Completion criteria:
- the original file has less responsibility, not just fewer lines
- extracted logic lands in the correct existing layer
- no new reverse imports or callback reach-through appear
- behavior is preserved