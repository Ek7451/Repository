# Phase 1 Export Extraction Plan

## Purpose

Phase 1 covers export extraction only. The goal is to remove Rhino 3DM and DXF responsibilities from `app.js` without changing solver math, introducing AppState early, or restructuring pages/UI ahead of the approved roadmap.

This plan is based on:

- `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- the current `app.js` export surface at lines `2203-3680`
- the repo guardrails in `AGENTS.md`

## Architecture Verdict

The smallest compliant Phase 1 move is:

- create a top-level `export/` folder
- move Rhino and DXF generation out of `app.js`
- keep `app.js` as the caller, DOM reader, and download initiator for now

This phase must not:

- move calculation logic out of the existing core modules
- introduce `state/`, `services/`, or page-level restructuring
- move `app.js` into `ui/` yet
- create a second state cache or exporter-specific parameter store

Because `app.js` currently contains more than 1,000 lines of Rhino helpers, Phase 1 should avoid transplanting that block into a new monolith unchanged. The Rhino export should stay within Phase 1 scope, but split into one orchestrator file and one helper file.

## Scope Lock

In scope:

- extract Rhino 3DM export logic from `app.js`
- extract DXF profile and DXF plan export logic from `app.js`
- introduce export-layer modules that accept explicit arguments
- replace large `app.js` method bodies with thin delegations
- preserve current behavior, filenames, and user-facing flows

Out of scope:

- `AppState`
- stats panel extraction
- camera bookmarks extraction
- backend/auth/dashboard/persistence work
- page relocation or full directory migration
- rewriting `scene3d.js`, `field-renderer.js`, or any `core/` module
- moving JSON, OBJ, CSV, or config export in this phase

## Current Responsibility Map

Current export-related responsibilities in `app.js`:

- button wiring: lines `374-390`
- JSON export: lines `1837-2164` and remains out of scope for Phase 1
- OBJ export: lines `2166-2201` and remains out of scope for Phase 1
- Rhino entry point: `_export3DM()` at lines `2203-2282`
- Rhino helper cluster: lines `2284-3340`
- DXF profile export: `_exportDXF()` at lines `3343-3469`
- DXF field-shape helper: `_addDXFShape()` at lines `3471-3521`
- DXF plan export: `_exportPlanDXF()` at lines `3523-3680`
- CSV/config export: lines `3682+` and remain out of scope for Phase 1

Phase 1 is successful when `app.js` no longer owns Rhino geometry conversion or DXF string construction.

## Proposed File Split Map

Introduce these files only:

- `export/rhino-exporter.js`
- `export/rhino-geometry.js`
- `export/dxf-exporter.js`

Responsibility map:

- `app.js`
  - keeps button event handlers
  - gathers current runtime arguments from DOM and in-memory fields
  - keeps Rhino library loading via `_loadRhino3dm()` and `_loadScriptOnce()`
  - triggers downloads and user-facing alerts
- `export/rhino-exporter.js`
  - owns Rhino export orchestration
  - owns tier/layer assignment and export flow decisions
  - calls helper functions from `rhino-geometry.js`
  - returns export bytes plus metadata; does not touch DOM
- `export/rhino-geometry.js`
  - owns geometry/path conversion helpers, mesh helpers, coordinate transforms, and degenerate-surface checks
  - contains no DOM reads and no app-level state access
- `export/dxf-exporter.js`
  - owns DXF section and plan string generation
  - contains `_addDXFShape()` as a local helper
  - returns DXF strings; does not touch DOM

## Boundary Rules For Phase 1

Required boundaries:

- `app.js -> export/*` is allowed
- `export/* -> app.js` is not allowed
- `export/*` must not import from `ui/` now or later
- `export/*` must not import from `scene3d.js` or `field-renderer.js`
- `export/*` must receive collaborators and data as arguments
- no exporter may call `document.getElementById()`, `document.createElement()`, or read live form values directly

Temporary adapter rule for Phase 1:

- it is acceptable for `app.js` to pass narrow adapter objects backed by `scene3D` and `fieldRenderer`
- it is not acceptable to pass the full `App` instance into an exporter

## Proposed Exporter Contracts

### Rhino

`app.js` should load Rhino, collect current inputs, then call a narrow export contract:

```js
const result = await rhinoExporter.export({
  rhino,
  solvers,
  bowlConfig,
  sportName,
  scene3DAdapter: {
    bowlMeshes: this.scene3D?.bowlGroup?.children ?? [],
    aisleMeshes: this.scene3D?.aisleGroup?.children ?? [],
    seatMeshes: this.scene3D?.seatGroup?.children ?? [],
    THREE: this.scene3D?.THREE,
    getBowlGeometrySegments: (config, offset) => this.scene3D._getBowlGeometrySegments(config, offset),
    buildClosedStructuralProfile: (solver, depthFt, tierIndex) =>
      this.scene3D._buildClosedStructuralProfile(solver, depthFt, tierIndex)
  }
});
```

Expected return shape:

```js
{
  bytes,
  exportedCount,
  fileExtension: '3dm'
}
```

Methods that move into the Rhino export layer:

- `_getRhinoExportOffsetCorrection`
- `_ensureRhinoTierCategoryRhinoLayers`
- `_ensureRhinoTierRhinoLayers`
- `_exportRhinoBrepBowl`
- `_exportRhinoTierSeatBreps`
- `_exportRhinoTierStructuralBreps`
- `_addRhinoRuledBrepsBetweenOffsets`
- `_addRhinoRuledSurfaceBrep`
- `_addRhinoModelObject`
- `_createRhinoCurveFromPlanSegment`
- `_parseBowlGeometrySubpaths`
- `_getRhinoTierIndexFromObject`
- `_getRhinoTierLabel`
- `_getRhinoTierLayerIndex`
- `_getThreeObjectWorldMatrixElements`
- `_transformThreePointByMatrixElements`
- `_toRhinoPointFromThree`
- `_rhinoPointDistance`
- `_rhinoTriangleArea`
- `_isRhinoRuledQuadDegenerate`
- `_addRhinoRuledSurfaceBrepFromPointPairs`
- `_exportRhinoAisleBreps`
- `_getRhinoNativeSpectatorBlockLimit`
- `_countRhinoSpectatorBlocksForExport`
- `_exportRhinoSpectatorsAdaptive`
- `_exportRhinoQuadPatchBrepsFromMesh`
- `_exportRhinoSpectatorBreps`
- `_exportRhinoSpectatorMeshes`
- `_exportRhinoSpectatorBlocksFromInstancedMesh`
- `_createRhinoMeshFromThreeInstancedMeshInstance`
- `_createRhinoMeshFromThreeInstancedMesh`
- `_createRhinoMeshFromThreeMesh`

Methods that stay in `app.js` for Phase 1:

- `_export3DM()` as a thin delegator
- `_loadRhino3dm()`
- `_loadScriptOnce()`

### DXF

`app.js` should gather the live arguments and pass explicit values into DXF builders:

```js
const profileDxf = dxfExporter.buildProfile({
  solvers,
  sportName,
  structuralDepthFt,
  focalPointFt: { x: focalX, z: focalZ }
});

const planDxf = dxfExporter.buildPlan({
  solvers,
  sportName,
  bowlConfig,
  template: this._currentTemplate,
  runoffFt,
  visualFocalXFt,
  enabledTiers,
  tierAisleLayouts: this._tierAisleLayouts,
  fieldAdapter: {
    getBowlGeometry: (config, offset) => this.fieldRenderer._getBowlGeometry(config, offset),
    getTierAisleBandPolygons: (...args) => this.fieldRenderer.getTierAisleBandPolygons(...args),
    getTierSectionMetricsOverlayData: (...args) => this.fieldRenderer.getTierSectionMetricsOverlayData(...args)
  }
});
```

Methods that move into the DXF export layer:

- `_exportDXF`
- `_addDXFShape`
- `_exportPlanDXF`

Methods that stay in `app.js` for Phase 1:

- click handlers
- filename generation if we want that logic to stay UI-side
- blob creation and anchor-click download

## Extraction Sequence

1. Add `export/dxf-exporter.js` first.
2. Replace `_exportDXF()` and `_exportPlanDXF()` bodies with delegation plus download glue.
3. Verify DXF output before touching Rhino export.
4. Add `export/rhino-geometry.js` and move geometry-only helpers first.
5. Add `export/rhino-exporter.js` and move Rhino orchestration/layer methods into it.
6. Replace `_export3DM()` with a thin delegator that loads Rhino, calls the exporter, and downloads the returned bytes.
7. Remove moved helper methods from `app.js`.

Reason for this order:

- DXF is smaller and gives us the export-layer calling pattern first.
- Rhino is higher value but also riskier because it touches async library loading, scene mesh conversion, and fallback behavior.
- moving Rhino helpers in two steps avoids recreating `app.js` inside `export/`.

## Circular Import Risks

Avoid these failure modes:

- `export/*` importing `app.js`
- `export/dxf-exporter.js` importing `field-renderer.js`
- `export/rhino-exporter.js` importing `scene3d.js`
- `export/rhino-geometry.js` importing `rhino-exporter.js`

The intended dependency direction is:

- `app.js -> export/dxf-exporter.js`
- `app.js -> export/rhino-exporter.js`
- `export/rhino-exporter.js -> export/rhino-geometry.js`

## Known Risks And Guardrails

- `scene3D` currently exposes underscore-prefixed helpers used by Rhino export. Treat them as temporary adapter seams in Phase 1; do not redesign `scene3d.js` in this phase.
- `fieldRenderer._getBowlGeometry()` is also underscore-prefixed and currently used by plan DXF export. Wrap it through an adapter rather than moving plan geometry logic into export or duplicating it.
- `sportName`, tier enablement, focal values, and runoff still come from DOM in Phase 1. `app.js` may read them, but export modules may not.
- OBJ, CSV, JSON, and config export staying in `app.js` means export responsibility is reduced, not fully eliminated, after Phase 1. That is acceptable because the roadmap explicitly stages this work.

## Definition Of Done

Phase 1 is complete when all of the following are true:

- `app.js` delegates Rhino export instead of owning Rhino helper methods
- `app.js` delegates DXF string generation instead of building DXF inline
- new export modules do not read DOM state directly
- no solver math is duplicated outside the existing calculation modules
- no exporter imports `app.js`, `scene3d.js`, or `field-renderer.js`
- no second application state snapshot is introduced

Expected file-count impact for the implementation:

- new JS files: `3`
- touched existing JS files: `1` (`app.js`)

## Verification Gate

Required checks for the implementation turn:

- verify Rhino export for one edge sport and one center-field sport
- verify profile DXF export with `structuralDepth = 0` and `structuralDepth > 0`
- verify plan DXF export with multi-tier seating enabled
- verify aisle and section labels still appear in plan DXF when layouts exist
- confirm `app.js` still handles download and user notifications
- confirm `export/` modules consume arguments only and do not read live DOM values
- confirm no forbidden imports were introduced

Suggested manual test matrix:

- Football Rhino export
- Baseball or softball Rhino export
- Profile DXF with one tier
- Plan DXF with at least two enabled tiers and aisle overlays

## Phase 1 Non-Goals Reminder

Do not combine this phase with:

- stats-panel extraction
- AppState introduction
- page shell changes
- dashboard/auth/services work
- cleanup refactors outside the export path
