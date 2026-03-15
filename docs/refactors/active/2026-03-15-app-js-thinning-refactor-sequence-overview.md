# App.js Thinning Active Refactor Sequence

## Status

- Status: Active plan set
- Planned on: 2026-03-15
- Based on: the 2026-03-15 `ui/app.js` responsibility-reduction audit
- Primary goal: reduce `ui/app.js` to composition, lifecycle, scheduling, and top-level orchestration only

## Purpose

This active sequence supersedes the archived 2026-03-15 Phase 1-4 notes.

Those archived plans described extractions that are already reflected in the current codebase:

- pure project helpers now live in `state/project.js`
- state-derived DTO builders now live in `state/app-state.js`
- solver construction helpers now live in `core/profile-solver.js`
- field geometry helpers now live in `viz/field-renderer.js`

The remaining work is different. `ui/app.js` is still overextended because it owns:

- mutable project/session/status shell state
- control-to-shell callback reach-through
- raw Scene3D host lifecycle and bookmark feature wiring
- derived render-runtime caches and update-pipeline assembly
- export-controller wiring through a broad getter bundle

## Current Baseline

As of this audit, the following checks passed against the current repo:

- `npx vitest run tests/ui/app-shell-callbacks.test.js tests/ui/editor-controls.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

`npm run lint` also passed with existing warnings only in:

- `viz/field-renderer.js`
- `viz/profile-renderer.js`
- `viz/scene3d.js`

No new phase should be considered complete if it adds fresh warnings or leaves `ui/app.js` with the same responsibility count under a different shape.

## Phase Order

### Phase 1

- File: `docs/refactors/active/2026-03-15-app-js-thinning-phase-1-characterization-and-seam-hardening-plan.md`
- Goal: add missing characterization tests around the weak seams that later phases will move

### Phase 2

- File: `docs/refactors/active/2026-03-15-app-js-thinning-phase-2-project-shell-controller-plan.md`
- Goal: extract project/session/status shell state out of `ui/app.js`

### Phase 3

- File: `docs/refactors/active/2026-03-15-app-js-thinning-phase-3-editor-controls-shell-decoupling-plan.md`
- Goal: stop `EditorControls` from implicitly driving shell sync and Scene3D tab restoration

### Phase 4

- File: `docs/refactors/active/2026-03-15-app-js-thinning-phase-4-scene3d-controller-extraction-plan.md`
- Goal: extract Scene3D host lifecycle and bookmarks into a dedicated `ui/` controller

### Phase 5

- File: `docs/refactors/active/2026-03-15-app-js-thinning-phase-5-render-runtime-extraction-plan.md`
- Goal: extract template/solver/layout cache ownership and render-input assembly out of `ui/app.js`

### Phase 6

- File: `docs/refactors/active/2026-03-15-app-js-thinning-phase-6-export-context-narrowing-plan.md`
- Goal: replace `EditorExportController` getter soup with a structured export context and explicit geometry ports

## Global Constraints

- Preserve behavior unless the phase explicitly says otherwise.
- Keep `ui/app.js` as the public facade used by top-level `app.js`.
- Do not create a second canonical `AppState` object or snapshot mirror.
- Do not introduce EventBus, PubSub, DI container, or service locator patterns.
- Prefer existing modules first.
- Only create these new `ui/` modules because the current codebase has no compliant existing home for the moved stateful logic:
  - `ui/project-shell-controller.js`
  - `ui/scene3d-controller.js`
  - `ui/render-runtime.js`
- Keep `state/project.js` pure.
- Keep `viz/scene3d.js` renderer-focused.
- Keep `ui/editor-export-controller.js` export-focused and do not recreate another monolith there.

## Builder Workflow

Run one phase at a time with `behavior-preserving-refactor-executor`.

For each phase:

1. Read the phase doc and its dependency notes.
2. Restate the source logic to move, destination files, import changes, and verification commands.
3. Implement only that phase.
4. Delete old logic from `ui/app.js` once the replacement is in place.
5. Run the listed checks.
6. Confirm `ui/app.js` is smaller or simpler by responsibility, not only by line count.

## Required Verification After Every Phase

- `npm run lint`
- `npx vitest run tests/architecture/layer-boundaries.test.js`
- the phase-specific targeted tests
- `npm run build` whenever runtime wiring changed

## Completion Criteria For The Whole Sequence

- `ui/app.js` contains only composition, lifecycle, scheduling, public facade methods, and top-level orchestration
- `ui/app.js` no longer owns project/session/status state
- `ui/app.js` no longer owns Scene3D readiness/loading/bookmark lifecycle
- `ui/app.js` no longer owns template/solver/layout runtime caches
- `EditorControls` no longer drives shell lifecycle indirectly
- `EditorExportController` no longer depends on broad reach-through getters into app internals
- no reverse imports or layer violations are introduced
