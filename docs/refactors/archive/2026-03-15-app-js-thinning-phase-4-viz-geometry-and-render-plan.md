# App.js Thinning Phase 4 Viz Geometry And Render Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: Phase 3 completion
- Primary goal: remove renderer geometry and field-plan shaping from `ui/app.js` so it becomes a thin coordinator

## Purpose

Phase 4 finishes the `ui/app.js` thinning effort by moving the remaining visualization-specific geometry and render-input shaping out of the editor controller.

After this phase, `ui/app.js` should be responsible only for:

- bootstrap already completed elsewhere
- dependency wiring
- startup and teardown
- top-level update orchestration
- delegation to `state/`, `core/`, and `viz/`

This phase is where `ui/app.js` stops owning bowl-bounds math, offset-correction rules, clip-range geometry, and field-plan aisle-layout shaping.

## Architecture Verdict

The smallest compliant move is:

- extend `viz/field-renderer.js` with the missing public geometry helpers
- keep `viz/profile-renderer.js` as a render endpoint only
- keep `viz/scene3d.js` as a render endpoint only
- collapse `ui/app.js` render helpers down to sequencing and delegation

This matches the layer rules:

- render-support geometry belongs in `viz/`
- `ui/app.js` should not compute bowl bounds or clip ranges

## Scope Lock

In scope:

- `ui/app.js`
- `viz/field-renderer.js`
- small alignment changes to `viz/scene3d.js` only if a narrow public helper name must be clarified
- small alignment changes to `viz/profile-renderer.js` only if call signatures need cleanup

Out of scope:

- AppState selector extraction already handled in Phase 2
- solver construction already handled in Phase 3
- export-layer redesign
- page-shell or service changes

## Current Responsibility Slice

`ui/app.js` still owns these visualization-specific pieces:

- `EDGE_SPORTS`
- `_getOffsetCorrection(bowlConfig, sportName)`
- inline `visualFocalY` calculation inside `_renderFieldView(...)`
- inline field-visibility assembly if not already moved in Phase 2
- tier aisle-layout generation loop inside `_renderFieldView(...)`
- `_updateClipSliderRange(...)`
- `_computeBowlBounds(...)`

Those are not orchestration. They are either viz geometry or viz-adjacent render input shaping.

## Exact Logic To Move

Source logic to move from `ui/app.js`:

- `EDGE_SPORTS`
- `_getOffsetCorrection(...)`
- inline field-plan visual focal adjustment
- tier aisle-layout generation inside `_renderFieldView(...)`
- `_updateClipSliderRange(...)` geometry portion
- `_computeBowlBounds(...)`

Primary destination file:

- `viz/field-renderer.js`

Preferred new public `FieldRenderer` surface:

- `getOffsetCorrection(bowlConfig, sportName)`
- `getVisualFocalY(template, focalPointFt, sportName)`
- `buildTierAisleLayouts(solvers, bowlConfig, tierMetricsByIndex, offsetCorrection, egressParams)`
- `getClipPositionRange(solvers, bowlConfig, axis, offsetCorrection)`

Expected helper behavior:

- `getClipPositionRange(...)` returns only the computed geometry range, for example `{ min, max }`
- `ui/app.js` may still clamp the live state value and delegate UI sync to `EditorControls`
- no bowl-bounds math should remain in `ui/app.js`

Internal `FieldRenderer` additions are allowed if needed:

- a private bowl-bounds helper built on top of existing bowl-geometry segment generation

## Role Of The Other Included Viz Files

`viz/profile-renderer.js`

- should remain a pure render endpoint
- should not absorb AppState selectors or project helpers
- only small signature or comment cleanups are justified here

`viz/scene3d.js`

- should remain a 3D render/geometry consumer
- should not receive direct AppState or DOM ownership
- only small public API alignment is justified here if it reduces `ui/app.js` call-site noise without moving state shaping into `viz/scene3d.js`

## Imports To Change

`ui/app.js`

- remove the local `EDGE_SPORTS` constant
- stop defining `_getOffsetCorrection(...)`
- stop defining `_computeBowlBounds(...)`
- reduce or delete `_renderFieldView(...)` once the viz helper calls are in place

`viz/field-renderer.js`

- no imports from `state/` or `ui/`
- no DOM reads beyond its existing canvas ownership

No reverse imports are allowed.

## Extraction Sequence

1. Add `getOffsetCorrection(...)` to `viz/field-renderer.js`.
2. Add `getVisualFocalY(...)` to `viz/field-renderer.js`.
3. Add `buildTierAisleLayouts(...)` to `viz/field-renderer.js`.
4. Add a bowl-bounds helper and expose `getClipPositionRange(...)` from `viz/field-renderer.js`.
5. Update `ui/app.js` `update()` flow to request offset correction, visual focal Y, aisle layouts, and clip range from `FieldRenderer`.
6. Keep `ui/app.js` responsible only for sequencing:
   - read state selectors
   - call core solver helpers
   - ask `FieldRenderer` for viz-derived inputs
   - call `fieldRenderer.render(...)`
   - call `profileRenderer.renderMulti(...)`
   - call `scene3D.updateField(...)` and `scene3D.updateBowl(...)`
   - update `StatsPanel`
7. Delete the old geometry helpers from `ui/app.js`.

## Target Shape For `ui/app.js`

After Phase 4, these pieces are allowed to remain:

- constructor wiring
- `init()` and `destroy()`
- shell/theme/tab callbacks
- config load/apply flow
- `update()` as a top-level orchestrator only
- thin render delegation helpers only if they no longer shape data

These pieces must be gone:

- bowl-bounds geometry math
- clip-range geometry math
- sport-based offset-correction rules
- field-plan aisle-layout construction logic

## Compliance Risks

- `getOffsetCorrection(...)` must preserve the current non-edge-sport half-width behavior exactly.
- `getVisualFocalY(...)` must preserve the current edge-sport handling of template `focal_y`.
- `getClipPositionRange(...)` must preserve the same range semantics used by the current clip slider sync.
- `ui/app.js` must not replace deleted geometry helpers with new orchestration wrappers that still contain the same math.

## Definition Of Done

Phase 4 is complete when all of the following are true:

- `ui/app.js` no longer contains bowl-bounds or clip-range geometry math
- `ui/app.js` no longer contains offset-correction rules
- `ui/app.js` no longer constructs tier aisle layouts directly
- `viz/field-renderer.js` owns the moved geometry helpers
- `viz/profile-renderer.js` and `viz/scene3d.js` remain render endpoints rather than new controller layers
- `ui/app.js` is reduced to thin coordination and delegation

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- add and run focused `viz/field-renderer` helper tests
- `npm run build`

Recommended focused assertions:

- clip slider min/max behavior matches current geometry
- field render still receives the same visibility, focal, bowl, and aisle-layout inputs
- scene 3D update still uses the same bowl config, offset correction, and seat-preview options as before

