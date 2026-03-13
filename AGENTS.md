# AGENTS.md

This repo is being refactored in phases. Follow the audit roadmap, not the final architecture diagram.

## Phase order

1. Phase 1: extract export pipeline
2. Phase 2: extract stats panel
3. Phase 3: introduce AppState
4. Phase 4: extract camera bookmarks
5. Phase 5: backend, auth, dashboard, and persistence productization

Do not start services, dashboard, or page restructuring before AppState is complete and verified.

## Protected modules

Do not rewrite or duplicate logic from:
- core/profile-solver.js
- core/sightline-calc.js
- core/aisle-layout.js
- core/sports-templates.js
- core/default-starting-profile.js

Do not move calculation logic out of core/.

## Hard architecture rules

- core/ is pure calculation only
- state/ is the single source of truth for application parameters
- ui/ orchestrates behavior and may call core/, state/, viz/, and export/
- viz/ consumes precomputed data only
- export/ consumes arguments only
- services/ must use plain JSON DTOs only
- never read form values directly in calculation or export code
- never create a second AppState, snapshot, or parallel state cache

## File discipline

- target total is roughly 17 to 22 JavaScript files
- if more than 5 new JS files are created in one session, stop and reassess
- do not create barrel files
- do not create tiny utility files unless reused by 3 or more modules

## Anti-patterns to reject

- React-style hooks or context patterns
- EventBus, PubSub, or message queues
- service locator or dependency container patterns
- base/derived class splits without a proven need
- duplicated solver math outside core/

## Required skill usage

- use $structure-guardian for architecture and file placement work
- use $import-boundary-audit before or after cross-layer edits
- use $monolith-split-planner before splitting large files
- use $appstate-migration-planner for any state or persistence prep work
- use $dto-boundary-check for services, auth, or API payload work
- use $verification-gate before marking work complete