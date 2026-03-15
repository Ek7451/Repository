# App.js Thinning Phase 6 Export Context Narrowing Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: Phase 5 completion
- Primary goal: replace `EditorExportController` getter soup with a structured export context and explicit geometry ports

## Executor Handoff Summary

- Source logic to rewrite:
  - `EditorExportController` constructor contract in `ui/app.js`
  - broad getter bundle currently passed from `ui/app.js`:
    - `getActiveSolvers`
    - `getBowlConfig`
    - `getCurrentTemplate`
    - `getEgressParams`
    - `getFieldRenderer`
    - `getFocalPointFt`
    - `getOffsetCorrection`
    - `getPrimaryTierParameters`
    - `getRunoffDistance`
    - `getScene3D`
    - `getSceneExportData`
    - `getSportName`
    - `getState`
    - `getTierAisleLayouts`
  - export descriptor assembly in `ui/editor-export-controller.js`
- Destination files:
  - `ui/editor-export-controller.js`
  - `ui/app.js`
  - `ui/render-runtime.js`
  - `ui/scene3d-controller.js`
- Imports to change:
  - no new cross-layer imports expected; this phase is primarily contract narrowing
- Verification commands:
  - `npm run lint`
  - `npx vitest run tests/ui/editor-export-controller.test.js tests/ui/app-shell-callbacks.test.js tests/export/*.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Purpose

`EditorExportController` is the remaining broad coupling hotspot.

It currently receives fourteen separate app reach-through getters, including:

- raw state access
- raw renderer access
- raw scene access
- raw runtime cache access

That shape recreates a service-locator pattern around `ui/app.js`, even after the other responsibilities are moved out.

## Architecture Verdict

The smallest compliant move is:

- replace the getter soup with:
  - one structured export-context getter
  - one field-geometry port
  - one scene-geometry port
- keep `EditorExportController` focused on export descriptor assembly
- keep `ui/app.js` as the composition root that wires those three inputs together

Do not pass the entire app instance, and do not pass the entire `AppState` object directly anymore.

## Scope Lock

In scope:

- `ui/editor-export-controller.js`
- `ui/app.js`
- `ui/render-runtime.js`
- `ui/scene3d-controller.js`
- focused export tests

Out of scope:

- exporter implementation changes in `export/` unless a test reveals a current mismatch
- new export formats
- render-runtime redesign beyond the data needed for export

## Current Responsibility Slice

In `ui/app.js`, the `EditorExportController` wiring currently depends on:

- raw `AppState`
- raw `FieldRenderer`
- raw `Scene3D`
- app-owned caches such as `_solvers` and `_tierAisleLayouts`

That means export behavior is coupled to app internals instead of stable interfaces.

## Exact Logic To Rewrite

### New `EditorExportController` constructor contract

Replace the broad getter bundle with:

- `getExportContext()`
- `getFieldGeometryPort()`
- `getSceneGeometryPort()`

### `getExportContext()` shape

Returned data should be plain and sufficient for all current export kinds:

- `stateJson`
- `sportName`
- `template`
- `runoffDistance`
- `focalPointFt`
- `bowlConfig`
- `egressParams`
- `primaryTierParameters`
- `solvers`
- `activeSolvers`
- `tierAisleLayouts`
- `structuralDepthFt`

Preferred source:

- `RenderRuntime.getExportContext(state)` for derived runtime data
- `state.toJSON()` supplied from `ui/app.js` if `RenderRuntime` does not already carry it

### `getFieldGeometryPort()` shape

Return only the field-geometry methods currently used by export logic:

- `calculateRowLength`
- `generateTierAisleLayout`
- `getTierSectionMetricsOverlayData`
- `getTierAisleBandPolygons`
- `getBowlGeometrySegments`
- `getOffsetCorrection`

This can be a plain object assembled in `ui/app.js` from `FieldRenderer` methods. Do not pass the whole renderer instance if a narrower port is easy to build.

### `getSceneGeometryPort()` shape

Return only the scene methods currently used by export logic:

- `getExportSceneData`
- `buildClosedStructuralProfile`
- `getBowlGeometrySegments`

Preferred source:

- `Scene3DController.getGeometryPort()`

### `ui/app.js` after the move

`ui/app.js` should no longer expose export-related private wrappers such as `_buildExportDescriptor()` or `_getSceneExportData()`.

It should only:

- construct `EditorExportController`
- provide the export context getter
- provide the two explicit geometry ports
- pass `exportController.buildDescriptor(kind)` into `EditorShell`

## Imports To Change

No new cross-layer imports should be needed.

Keep import directions compliant:

- `ui/editor-export-controller.js` may continue importing from `core/` and `export/`
- no `state/` import should be added to `export/`
- no `viz/` module should import from `ui/`

## Extraction Sequence

1. Add `getExportContext(state)` to `ui/render-runtime.js`.
2. Add `getGeometryPort()` to `ui/scene3d-controller.js`.
3. Rewrite `EditorExportController` to consume the new three-part contract.
4. Rewrite the `ui/app.js` constructor wiring to provide the export context and the two geometry ports.
5. Remove obsolete export-related private wrappers from `ui/app.js`.

## Compliance Risks

- Preserve current export behavior for:
  - `json`
  - `config`
  - `profile-dxf`
  - `plan-dxf`
  - `csv`
  - `obj`
  - `rhino`
- Preserve the current no-geometry rhino short-circuit behavior.
- Do not turn `EditorExportController` into a second app controller by pushing unrelated state logic into it.
- Do not replace getter soup with a generic `appContext` bag.

## Definition Of Done

- `EditorExportController` no longer depends on raw app internals through many getters
- `ui/app.js` no longer exposes export wrappers or raw scene-export access
- export data enters the controller through one structured context and two narrow ports
- export behavior remains unchanged

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/editor-export-controller.test.js tests/ui/app-shell-callbacks.test.js tests/export/*.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- config export uses `stateJson` only and no longer depends on raw state access
- plan-dxf and rhino paths still build the same geometry-derived artifacts
- rhino export still avoids heavy init work when scene export data is missing
