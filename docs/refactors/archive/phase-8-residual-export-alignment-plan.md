# Phase 8 Residual Export Alignment Plan

## Status

- Status: Planned
- Planned on: 2026-03-14
- Depends on: Phase 7 completion

## Purpose

Archived Phase 1 extracted Rhino and DXF because they were the largest and safest export seams. That left the smaller export paths in the editor controller.

Phase 8 finishes the remaining export-layer alignment so that the editor controller no longer owns builder logic for:

- JSON results export
- OBJ export
- CSV export

The goal is to remove the last non-trivial export-building logic from the editor controller without reopening Rhino or DXF work.

## Architecture Verdict

The smallest compliant move is:

- add `export/obj-csv-exporter.js`
- move JSON, OBJ, and CSV builder logic there
- keep download initiation and user-facing button wiring in the UI layer

This phase must not:

- move AppState serialization into `export/`
- let exporters read DOM state
- let exporters import renderers directly
- recreate a new export monolith

## Current Residual Export Map

Still in the editor controller today:

- `_exportJSON()`
- `_exportOBJ()`
- `_exportCSV()`

Already correctly delegated today:

- Rhino 3DM export
- DXF profile export
- DXF plan export

Config save/load is intentionally different:

- AppState config export/load is part of state transfer, not derived geometry export
- it may remain in the editor controller or a state-adjacent seam

## Structure Guardian Verdict

Compliance verdict: partial compliance today.

Correct destination:

- `export/obj-csv-exporter.js`

Correct responsibilities:

- exporter module builds strings or bytes from explicit arguments only
- editor controller still owns button clicks, filename choice, blobs, and downloads

## Import Boundary Audit

Forbidden imports found now:

- none

Boundary rules after Phase 8:

- `export/obj-csv-exporter.js` must not import from `ui/`, `viz/`, or `state/`
- the editor controller may pass narrow adapters for scene geometry if OBJ export needs them
- no export path may read live form values directly

## Scope Lock

In scope:

- create `export/obj-csv-exporter.js`
- move JSON, OBJ, and CSV builder logic into that module
- keep current filenames and download flows if practical
- reuse existing solved/layout data from the editor controller

Out of scope:

- config save/load redesign
- Rhino or DXF refactors
- dashboard/auth/backend work

## Proposed Exporter Contract

Preferred surface:

```js
const jsonPayload = buildStudyResultsJson({
  solvers,
  bowlConfig,
  egressParams,
  sportName,
  tierAisleLayouts,
  fieldMetricsAdapter
});

const objText = buildObjExport({
  scene3DAdapter: {
    bowlMeshes,
    aisleMeshes,
    seatMeshes
  }
});

const csvText = buildTierMetricsCsv({
  solvers,
  bowlConfig,
  egressParams,
  sportName,
  offsetCorrection,
  tierMetrics
});
```

Contract rules:

- the module returns strings or plain JSON-compatible data only
- the module receives solved/runtime arguments only
- the module does not create blobs or anchors

## Extraction Sequence

1. Add `export/obj-csv-exporter.js`.
2. Move CSV builder logic first.
3. Move JSON results export builder second.
4. Move OBJ text generation last because it touches scene-derived mesh data.
5. Replace editor-controller method bodies with thin delegation plus download glue.
6. Remove obsolete builder helpers from the editor controller.

Reason for this order:

- CSV and JSON are easier to verify
- OBJ depends on scene-derived geometry and is slightly riskier

## Circular Import Risks

Avoid:

- `export/obj-csv-exporter.js` importing the editor controller
- `export/obj-csv-exporter.js` importing `scene3d.js`
- route-shell code depending on export builders directly

Intended dependency direction:

- editor controller -> `export/obj-csv-exporter.js`

## Known Risks

- JSON export currently reconstructs missing aisle layouts on demand. If that logic stays ad hoc inside the editor controller, the phase is only half complete.
- OBJ export may tempt passing the whole scene instance. Prefer a narrow adapter instead.
- Config export uses AppState JSON and should stay distinct from derived-results export.

## Definition Of Done

Phase 8 is complete when all of the following are true:

- JSON, OBJ, and CSV export builders live outside the editor controller
- the editor controller only delegates and downloads for those paths
- no exporter reads DOM state directly
- no exporter imports `state/`, `ui/`, or visualization modules
- exporter file count remains within the repo target after the move

## Verification Gate

Required checks:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm the new exporter imports no `ui/`, `viz/`, or `state/`
- confirm AppState config export/load still stays outside the derived export module
- confirm no duplicate runtime-state cache was introduced for exports

Required manual checks:

- verify JSON results export still matches the current study
- verify OBJ export still opens in a viewer
- verify CSV export still matches on-screen row data
- verify export buttons and download filenames still behave as expected

## Non-Goals

Do not combine this phase with:

- MSAL/auth/backend migration
- dashboard redesign
- stats panel work
