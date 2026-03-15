# App.js Thinning Phase 5 Render Runtime Extraction Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: Phase 4 completion
- Primary goal: remove derived runtime cache ownership and render-input assembly from `ui/app.js`

## Executor Handoff Summary

- Source logic to move:
  - fields in `ui/app.js`:
    - `_currentTemplate`
    - `_solvers`
    - `_tierAisleLayouts`
  - methods in `ui/app.js`:
    - `_syncTemplateFromState()`
    - `_renderFieldView(...)`
    - `_renderProfileView(...)`
    - `_getActiveSolvers()`
    - `_updateClipSliderRange(...)`
  - runtime-assembly logic inside `update()`
- Destination files:
  - new `ui/render-runtime.js`
  - `ui/app.js` as a thin update orchestrator
- Imports to change:
  - `ui/app.js` imports `RenderRuntime`
  - `ui/render-runtime.js` imports existing helpers from:
    - `core/sports-templates.js`
    - `core/profile-solver.js`
    - `state/app-state.js`
- Verification commands:
  - `npm run lint`
  - `npx vitest run tests/ui/render-runtime.test.js tests/ui/app-shell-callbacks.test.js tests/ui/stats-panel.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Purpose

`ui/app.js` still owns the full render-runtime assembly pipeline.

It stores and updates:

- the active template cache
- solved tiers
- tier aisle layouts

And it assembles the render snapshot for:

- `FieldRenderer`
- `ProfileRenderer`
- `StatsPanel`
- Scene3D updates
- tier-default callbacks in `EditorControls`
- export-controller getters

That is too much knowledge for the composition root.

## Architecture Verdict

The smallest compliant move is:

- create `ui/render-runtime.js` as a dedicated runtime-cache owner in the `ui/` layer
- keep pure selectors in `state/`
- keep solver logic in `core/`
- keep geometry helpers in `viz/`
- let `ui/app.js` call one runtime API and then delegate to renderers

This avoids pushing mutable runtime cache state into `state/` or `viz/`, both of which would be worse homes.

## Scope Lock

In scope:

- `ui/app.js`
- new `ui/render-runtime.js`
- narrow test additions for runtime snapshot behavior

Out of scope:

- export contract rewrite beyond what is needed to prepare for Phase 6
- project-shell state
- Scene3D host lifecycle

## Current Responsibility Slice

`ui/app.js` currently owns:

- template normalization and template caching
- solver caching
- tier-layout caching
- clip-range clamping behavior
- the field-render snapshot assembly
- the profile-render snapshot assembly
- stats-panel input assembly

Even though the pure math lives elsewhere now, `ui/app.js` still knows too much about how those pieces are combined.

## Exact Logic To Move

### New runtime responsibilities

Create `ui/render-runtime.js` to own:

- template resolution and caching
- solver caching
- tier layout caching
- clip-range calculation and clip-position clamping
- render-runtime snapshot assembly
- active-solver filtering
- next-tier default derivation from the most recent solved tiers

### Proposed API

`RenderRuntime` should expose:

- `reset()`
- `recompute({ state, fieldRenderer })`
- `getSnapshot()`
- `getActiveSolvers()`
- `getTierDefaults(tierNum)`
- `getExportContext(state)`

`recompute({ state, fieldRenderer })` should return a snapshot containing the current runtime inputs needed by the app orchestration layer:

- `template`
- `customRunoff`
- `focalPointFt`
- `structuralDepth`
- `solvers`
- `activeSolvers`
- `bowlConfig`
- `egressParams`
- `visibility`
- `visualFocalY`
- `tierMetricsByIndex`
- `tierAisleLayouts`
- `seatPreviewOptions`
- `clipRange`

Behavior notes:

- it may normalize an invalid sport name to a valid template choice, preserving current `_syncTemplateFromState()` behavior
- it may clamp `state.bowl.clipPosition` to the current clip range, preserving `_updateClipSliderRange(...)` behavior
- it must not create a second canonical application state object

### `ui/app.js` after the move

`update()` should become orchestration only:

1. call `renderRuntime.recompute({ state: this.state, fieldRenderer: this.fieldRenderer })`
2. sync the clip-position controls through `EditorControls`
3. call `fieldRenderer.render(...)`
4. call `profileRenderer.renderMulti(...)`
5. call `scene3DController.update(snapshot, { isActive })`
6. update `StatsPanel`

Delete `_renderFieldView(...)` and `_renderProfileView(...)` after the snapshot API is in place. Do not replace them with new app-private shaping helpers.

## Imports To Change

### `ui/app.js`

- remove direct imports used only for runtime assembly if they move fully into `ui/render-runtime.js`
- import `RenderRuntime`

### `ui/render-runtime.js`

- import:
  - `getTemplate` from `core/sports-templates.js`
  - `buildActiveTierSolvers`, `buildNextTierDefaultsFromSolvers`, `buildTierMetricsByIndex` from `core/profile-solver.js`
  - selector builders from `state/app-state.js`

No imports from `ui/` into `state/`, `core/`, or `viz/` are allowed.

## Extraction Sequence

1. Add `ui/render-runtime.js`.
2. Move template, solver, and layout cache ownership into the new runtime module.
3. Move clip-range calculation and clamping into the runtime module.
4. Rewrite `EditorControls.getTierDefaults` wiring in `ui/app.js` to use `renderRuntime.getTierDefaults(...)`.
5. Rewrite `update()` in `ui/app.js` to consume a runtime snapshot and delegate to renderers.
6. Delete the old runtime-cache fields and helper methods from `ui/app.js`.

## Compliance Risks

- Preserve current sport-template fallback behavior exactly.
- Preserve clip-range clamping and clip-control sync behavior exactly.
- Preserve tier-default behavior for tiers 2 and 3 based on the latest solved rows.
- Do not let `ui/render-runtime.js` become a second app controller; it should own cache and snapshot assembly only.

## Definition Of Done

- `ui/app.js` no longer stores template, solver, or layout runtime caches
- `ui/app.js` no longer assembles field/profile/stats runtime inputs inline
- `EditorControls` tier-default callback reads from `RenderRuntime`, not app caches
- `update()` in `ui/app.js` reads like top-level orchestration only

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/render-runtime.test.js tests/ui/app-shell-callbacks.test.js tests/ui/stats-panel.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- `recompute(...)` returns stable snapshot values for a multi-tier solve
- clip-position clamping still updates the shared `AppState`
- field render, profile render, and stats update still receive the same data as before
