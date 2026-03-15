# App.js Thinning Phase 1 Characterization And Seam Hardening Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: current `ui/app.js` audit only
- Primary goal: harden the weak seams before moving stateful responsibilities out of `ui/app.js`

## Executor Handoff Summary

- Source logic to protect:
  - `SeatingBowlApp.loadProject(...)`
  - `SeatingBowlApp._loadStateFromConfig(...)`
  - `SeatingBowlApp.update()`
  - `SeatingBowlApp._handleViewTabChanged(...)`
  - `SeatingBowlApp._init3DAsync()`
  - `SeatingBowlApp._buildExportDescriptor(...)`
- Destination files:
  - focused tests under `tests/ui/`
- Imports to change:
  - none required beyond new test imports
- Verification commands:
  - `npm run lint`
  - `npx vitest run tests/ui/app-shell-callbacks.test.js tests/ui/editor-controls.test.js tests/ui/seating-bowl-app-runtime.test.js tests/ui/editor-export-controller.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Purpose

Later phases will move real behavior out of `ui/app.js`.

Today, the current test coverage is strong around shell callbacks and basic control sync, but still thin around the exact runtime and lifecycle seams that will be changed:

- config import and config hydration flow
- update-pipeline assembly
- scene3D lazy-load behavior
- export-controller behavior outside the current app-shell smoke tests

Phase 1 adds characterization tests so later phases can move logic safely without hand-checking behavior from memory.

## Architecture Verdict

The smallest compliant move is:

- add tests only
- do not change architecture boundaries yet
- do not start extracting logic before the existing behavior is locked

This phase exists to make the following phases safe and reviewable.

## Scope Lock

In scope:

- `tests/ui/app-shell-callbacks.test.js`
- new focused `tests/ui/` characterization files
- tiny testability-only adjustments if a test seam cannot be reached without a behavior-neutral export or helper

Out of scope:

- new runtime modules
- state ownership changes
- Scene3D extraction
- export contract redesign

## Current Weak Seams

The current codebase has little or no direct coverage for these behaviors in `ui/app.js`:

- `loadProject(project)` updates metadata, hydrates config, refreshes chrome, and sets success status in one flow
- `_loadStateFromConfig(config, options)` rehydrates state, initializes tier state, syncs DOM, rerenders bookmarks, refreshes chrome, and schedules an update
- `update()` assembles a full render snapshot from `state/`, `core/`, and `viz/` helpers
- `_init3DAsync()` owns lazy import, loading markup, ready-state transitions, and failure markup
- `_buildExportDescriptor(kind)` is only indirectly covered through a rhino no-data branch in `tests/ui/app-shell-callbacks.test.js`

Those behaviors are exactly where the later refactors will land.

## Exact Work To Implement

### Test additions

- Add `tests/ui/seating-bowl-app-runtime.test.js` covering:
  - `_loadStateFromConfig(...)` updates state and calls `editorControls.hydrateTierInitialization`, `editorControls.syncFromState`, `cameraBookmarks.render`, and `_scheduleUpdate`
  - `loadProject(...)` applies metadata before state load and emits the expected success status
  - `update()` passes the expected runtime values into `FieldRenderer`, `ProfileRenderer`, `StatsPanel`, and the scene-update path
  - `_handleViewTabChanged('scene3d')` lazy-loads Scene3D when not ready and rerenders when already ready

- Add `tests/ui/editor-export-controller.test.js` covering current `EditorExportController` behavior before the later contract rewrite:
  - `json`
  - `config`
  - `profile-dxf`
  - `plan-dxf`
  - rhino no-geometry short-circuit

### Existing test expansion

- Extend `tests/ui/app-shell-callbacks.test.js` only where a new assertion naturally belongs there already
- Keep the older tests readable; do not turn that file into the only test home for all new runtime coverage

## Implementation Notes

- Prefer spies over broad DOM stubs where possible.
- Avoid adding test-only behavior flags to production code.
- If a small seam is needed, prefer a tiny extractable helper over exposing private internals broadly.
- Preserve the current public `SeatingBowlApp` surface exactly.

## Risks

- If this phase is skipped, later moves will rely on manual reasoning around config load and scene lifecycle.
- Over-mocking will make the later phases look safe while missing real coupling.
- Do not rewrite current tests to match the desired future architecture; they should describe current behavior.

## Definition Of Done

- the current runtime and lifecycle seams are directly covered by targeted tests
- later phases can move project-shell, Scene3D, runtime-cache, and export wiring with stable regression signals
- no production behavior changed

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/app-shell-callbacks.test.js tests/ui/editor-controls.test.js tests/ui/seating-bowl-app-runtime.test.js tests/ui/editor-export-controller.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- config load still syncs tier initialization before the next scheduled update
- restored `scene3d` state still triggers the same activation path
- export descriptor kinds still match current outputs and short-circuit conditions
