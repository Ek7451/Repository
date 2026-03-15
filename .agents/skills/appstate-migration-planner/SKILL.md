---
name: appstate-migration-planner
description: Use for AppState design, DOM-to-state migration, state-derived DTO extraction, save/load preparation, or any task that changes where canonical application state lives.
---

Convert the prototype from DOM-as-state to one explicit AppState model without turning AppState into a dumping ground.

Before doing anything:
1. Read all applicable AGENTS.md files for the files in scope.
2. Follow the deepest scoped AGENTS.md if instructions conflict.
3. For multi-file or structural work, start in Ask mode and produce:
   - target files
   - exact responsibilities to move
   - imports to change
   - verification commands
4. Prefer existing modules over new files unless no compliant home exists.
5. Do not place logic in ui/app.js unless it is strictly composition, lifecycle wiring, or top level orchestration.

Core rules:
- there is exactly one AppState object
- AppState is the source of truth for configurable parameters
- calculation, rendering, export, and persistence code must not read form values directly
- do not create snapshot, runtimeState, currentConfig, or other competing caches
- do not move solver construction or solver-row interpretation into AppState
- do not move field geometry, bowl bounds, or render-space helpers into AppState
- do not move pure project DTO helpers into AppState when state/project.js is the cleaner home

AppState is the correct home for:
- canonical serializable state
- state merging and normalization
- template-aware defaults when template input is passed explicitly
- state-derived selectors
- state-derived plain DTO builders

AppState is not the correct home for:
- DOM querying
- solver instantiation
- solver result interpretation
- renderer geometry
- UI shell behavior
- project callback emission or app lifecycle behavior

Audit tasks:
1. find all direct DOM reads that affect behavior
2. find all controller properties acting as state
3. identify which values are canonical versus derived
4. define the minimum complete AppState shape
5. identify state-derived DTO builders that should move from ui/ into state/
6. identify logic that looks state-related but actually belongs in core/, viz/, or state/project.js
7. plan the smallest safe migration order

Migration order:
1. define or confirm AppState shape
2. wire inputs to update AppState
3. move state-derived selectors and DTO builders into state/
4. change orchestration to read from AppState APIs instead of nested state paths
5. remove direct DOM reads from calculation, render, export, and persistence paths
6. add or confirm toJSON() and fromJSON()
7. verify save/load round-trip
8. confirm no duplicate state source remains

Required checks:
- lint
- tests
- build if runtime wiring changed
- architecture or import-boundary checks if present
- confirm no duplicated helper remains in ui/app.js after extraction

Output:
1. state inventory
2. proposed AppState shape
3. canonical vs derived split
4. state-derived DTOs to move into state/
5. logic that must stay out of state/
6. migration sequence
7. risk register
8. verification checklist

Completion criteria:
- AppState becomes the only canonical source of configurable state
- ui/app.js gets smaller or simpler
- moved selectors and DTO builders are deleted from their old home
- no reverse imports are introduced
- no new state mirror or cache appears