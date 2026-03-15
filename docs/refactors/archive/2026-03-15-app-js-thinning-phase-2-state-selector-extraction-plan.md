# App.js Thinning Phase 2 State Selector Extraction Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: Phase 1 completion
- Primary goal: remove state-derived DTO shaping from `ui/app.js`

## Purpose

Phase 2 removes the plain config and DTO builders that still live in `ui/app.js`.

These helpers read nested AppState and template data to produce plain render/export inputs. That belongs in `state/`, not the editor controller.

This phase keeps behavior stable by moving only pure selectors and DTO builders into `state/app-state.js`, then updating `ui/app.js` to consume them.

## Architecture Verdict

The smallest compliant move is:

- add pure selector exports to `state/app-state.js`
- rewire `ui/app.js` to call those selectors
- keep orchestration and timing in `ui/app.js`
- keep renderer and exporter APIs stable unless a small call-site adjustment is required

This matches the layer rules:

- `state/` owns state-derived selectors and DTO builders
- `ui/app.js` should not read multiple nested state branches to assemble config objects

## Scope Lock

In scope:

- `ui/app.js`
- `state/app-state.js`
- tests for pure selector outputs and editor-controller delegation

Out of scope:

- solver construction and solver-result interpretation
- bowl-bounds and clip-range geometry
- project-name/status helpers already handled in Phase 1
- renderer API redesign

## Current Responsibility Slice

`ui/app.js` currently owns these state-derived helpers:

- `_getCustomRunoff()`
- `_getRunoffDistance()`
- `_getFocalPointFt()`
- `_getEgressParams()`
- `_buildPrimaryTierParameters()`
- `_getBowlConfig()`

It also assembles additional plain objects inline:

- field visibility flags inside `_renderFieldView(...)`
- 3D seat-preview options inside `_update3D()`

Those are pure DTOs built from existing state and template inputs. They should not remain in `ui/app.js`.

## Exact Logic To Move

Source logic to move from `ui/app.js`:

- `_getCustomRunoff()`
- `_getRunoffDistance()`
- `_getFocalPointFt()`
- `_getEgressParams()`
- `_buildPrimaryTierParameters()`
- `_getBowlConfig()`
- inline field-visibility DTO assembly
- inline scene seat-preview DTO assembly

Destination file:

- `state/app-state.js`

New or expanded `state/app-state.js` exports:

- `getCustomRunoff(state)`
- `getRunoffDistance(state, template)`
- `buildFocalPointFt(state)`
- `buildEgressParams(state)`
- `buildPrimaryTierParameters(state)`
- `buildBowlConfig(state, template)`
- `buildFieldVisibility(state)`
- `buildSceneSeatPreviewOptions(state)`

Rules for those helpers:

- accept plain inputs only
- return plain objects only
- tolerate `null` or partially initialized templates
- never touch DOM or renderer instances

## Imports To Change

`ui/app.js`

- add named imports from `state/app-state.js`
- delete the local selector/private helper methods after call sites are converted

Likely call sites to update:

- `EditorControls` constructor getters
- `EditorExportController` constructor getters
- `update()`
- `_update3D()`

No new imports should be added to `state/app-state.js` beyond already-allowed pure helpers.

## Extraction Sequence

1. Add the new selector exports to `state/app-state.js`.
2. Add focused tests for selector outputs and fallback behavior.
3. Update `ui/app.js` to use the new selectors in constructor callback wiring.
4. Update `update()` and `_update3D()` to consume selector outputs instead of local helpers.
5. Delete the moved helper methods from `ui/app.js`.
6. Verify exporter and editor-control callbacks still receive the same values they received before the move.

## Compliance Risks

- `buildBowlConfig(state, template)` must preserve the existing clip object shape exactly.
- Template fallback handling must stay safe during early init before the current template is resolved.
- `buildFieldVisibility(state)` must preserve `showSeating`, `t1`, `t2`, `t3`, `colorByCValue`, and `showSectionMetrics` exactly.
- `buildSceneSeatPreviewOptions(state)` must preserve the current `showSeatCubes` and `seatWidthIn` names expected by `Scene3D.updateBowl(...)`.

## Definition Of Done

Phase 2 is complete when all of the following are true:

- `ui/app.js` no longer contains state-derived DTO builder helpers
- `state/app-state.js` owns those selectors instead
- exporter and renderer call sites still receive the same plain data
- no new reverse imports are introduced
- `ui/app.js` becomes smaller by responsibility, not only by line count

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/state/app-state.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- bowl config output matches current shape
- runoff and focal-point outputs preserve initialization defaults
- editor export/controller wiring still consumes explicit DTOs only

