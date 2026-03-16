# App.js Full Decoupling Execution Plan

## Status

- Status: Active implementation plan
- Planned on: 2026-03-15
- Scope: current codebase as of the `ui/app.js` audit and follow-up gap review
- Goal: reduce `ui/app.js` to composition, lifecycle, scheduling, public app facade methods, and top-level orchestration only

## Baseline

Current baseline before edits:

- `npm test`
- `npm run lint`
- `npm run build`

Known current lint warnings are limited to existing `viz/*` files and are not part of this refactor target.

## Files In Scope

- `ui/app.js`
- `ui/render-runtime.js`
- `ui/editor-controls.js`
- `ui/editor-shell.js`
- `ui/scene3d-controller.js`
- `ui/stats-panel.js`
- `viz/field-renderer.js`
- `state/app-state.js`
- `core/profile-solver.js`
- `tests/ui/app-shell-callbacks.test.js`
- `tests/ui/seating-bowl-app-runtime.test.js`
- `tests/ui/render-runtime.test.js`
- `tests/ui/editor-controls.test.js`
- `tests/ui/scene3d-controller.test.js`
- `tests/ui/stats-panel.test.js`

## Architecture Risks To Eliminate

- `ui/app.js` hand-builds a field geometry adapter for export
- `ui/app.js` owns feature DOM lookup for Scene3D and stats
- `ui/app.js` still passes getter soup into `EditorControls`
- `ui/app.js` still reads nested state to shape render options
- `RenderRuntime` still owns state mutation side effects that belong in the state layer
- tests still pin private `app.js` seams that should disappear

## Phase Order

### Phase 1: Plan And Narrow Ports

Smallest compliant moves:

- add `FieldRenderer.getGeometryPort()`
- switch `RenderRuntime` to consume a field geometry port instead of the concrete renderer
- switch `EditorExportController` wiring in `ui/app.js` to consume renderer/controller-provided ports only

Primary files:

- `viz/field-renderer.js`
- `ui/render-runtime.js`
- `ui/app.js`

### Phase 2: Move Feature DOM Ownership Out Of app.js

Smallest compliant moves:

- let `Scene3DController` resolve its own default DOM elements when explicit refs are omitted
- let `StatsPanel` resolve its own default DOM elements when explicit refs are omitted
- move view-canvas hookup ownership behind one `EditorShell` helper

Primary files:

- `ui/scene3d-controller.js`
- `ui/stats-panel.js`
- `ui/editor-shell.js`
- `ui/app.js`

### Phase 3: Collapse EditorControls Callback Soup

Smallest compliant moves:

- remove the dead `getTemplate` dependency
- replace `getRunoffDistance` with local state/core-derived computation in `EditorControls`
- replace runtime-tier-default getters with a core/state helper path
- replace dual app callbacks with one structured change callback
- hide imported-tier initialization behind a controls-owned API

Primary files:

- `ui/editor-controls.js`
- `core/profile-solver.js`
- `state/app-state.js`
- `ui/app.js`

### Phase 4: Move Remaining Render DTO Shaping Out Of app.js

Smallest compliant moves:

- add state-owned pure helpers for profile render options and sport/template resolution
- extend `RenderRuntime` snapshot output with pre-shaped field/profile render inputs
- delete direct nested-state DTO shaping from `ui/app.js.update()`

Primary files:

- `state/app-state.js`
- `ui/render-runtime.js`
- `ui/app.js`

### Phase 5: Final app.js Simplification And Test Seam Cleanup

Smallest compliant moves:

- remove obsolete app-local helpers and dead constructor wiring
- keep project load and view/theme lifecycle in `ui/app.js`
- rewrite tests away from private `app.js` internals where those internals no longer exist
- confirm no duplicate logic remains in `ui/app.js`

Primary files:

- `ui/app.js`
- focused `tests/ui/*`

## Explicit Non-Goals

- no new EventBus, PubSub, DI container, or service locator
- no second canonical app state object or hidden snapshot mirror
- no new app-level coordinator file that just renames `ui/app.js`
- no moving project load orchestration into `state/project.js` or `ui/project-shell-controller.js`

## Verification Commands

Run after each phase as applicable:

- `npm run lint`
- `npx vitest run tests/architecture/layer-boundaries.test.js`
- `npm run build` when runtime wiring changes

Targeted tests during execution:

- `npx vitest run tests/ui/render-runtime.test.js tests/ui/editor-export-controller.test.js tests/ui/app-shell-callbacks.test.js`
- `npx vitest run tests/ui/scene3d-controller.test.js tests/ui/stats-panel.test.js tests/ui/seating-bowl-app-runtime.test.js`
- `npx vitest run tests/ui/editor-controls.test.js tests/ui/app-shell-callbacks.test.js tests/ui/seating-bowl-app-runtime.test.js`

## Completion Gate

This refactor is complete only if all of the following are true:

- `ui/app.js` is smaller or simpler by responsibility, not only by line count
- `ui/app.js` no longer builds geometry ports by hand
- `ui/app.js` no longer owns feature DOM lookup for Scene3D or stats
- `ui/app.js` no longer reads nested state to build renderer option objects
- `RenderRuntime` no longer mutates sport/template state from a UI-owned private helper
- no reverse imports were introduced
- tests, lint, build, and architecture checks pass
