# Full Alignment Implementation Plan

## Status

- Status: Proposed
- Planned on: 2026-03-14
- Inputs:
  - `docs/architecture/target-directory-structure.md`
  - `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
  - current repository layout and import graph

## Goal

Bring the repo into practical alignment with the target directory document and the March 12 roadmap, ordered from low-risk quick wins to heavier refactors.

This plan optimizes for the smallest compliant changes first. It does not reopen stable `core/` modules.

## Approved Exceptions

These are treated as allowed and should not block the alignment effort:

1. Root `app.js` remains as the thin bootstrap and route shell.
2. Full SSO/productized auth integration is deferred by design.

## Canonical Decisions To Lock First

These decisions remove the main remaining doc/code ambiguity before code refactors begin.

### 1. Keep the root bootstrap

The root `app.js` is already a thin page bootstrap and route shell. It is not the old monolith. Keep it and update architecture docs so it is an explicit exception rather than an accidental mismatch.

### 2. Make the single-study project envelope canonical

Current code and the March 12 roadmap both converge on one persisted `state` payload per project. The target directory doc still describes `project.js` as a wrapper around `studies: [...]`.

For alignment with the least churn, the canonical project DTO should remain:

```js
{
  id,
  name,
  sport,
  createdAt,
  updatedAt,
  state
}
```

Do not refactor the repo to a multi-study project wrapper as part of this alignment pass. If multi-study support is desired later, treat it as a new feature with its own state and service design.

## Sequence

## Phase 1 - Quick Wins: Lock The Docs And Guardrails

### Purpose

Remove the remaining paper mismatches before touching runtime code.

### Work

- Update `docs/architecture/target-directory-structure.md` to:
  - allow the root `app.js` bootstrap exception
  - replace the `studies: [...]` project wrapper with the single-study project envelope
  - refresh any file-count note that no longer matches the actual intended end state
- Add a short decision entry to `docs/architecture/decision-log.md` recording:
  - root bootstrap is allowed
  - single-study project DTO is the current architectural target
  - SSO/productized auth is intentionally deferred
- Add or extend architecture tests so the allowed boundaries are executable, not just documented:
  - layer import checks
  - `services/` must not import `state/`
  - `export/` and `viz/` must not read configurable state directly

### Files Likely Touched

- `docs/architecture/target-directory-structure.md`
- `docs/architecture/decision-log.md`
- `tests/services/services-boundary.test.js`
- a new or existing architecture-boundary test file under `tests/`

### Exit Criteria

- docs and code agree on the project envelope
- docs explicitly allow the root bootstrap
- boundary rules are covered by tests

### Effort

- Small

## Phase 2 - Quick Win: Remove Residual Theme Coupling From `viz/`

### Purpose

Tighten the renderer boundary so `viz/` stays focused on rendering rather than reaching into page state.

### Work

- Remove `document.documentElement` theme reads from:
  - `viz/field-renderer.js`
  - `viz/profile-renderer.js`
  - `viz/scene3d.js`
- Pass theme or palette information from `ui/` instead.
- Keep resize and canvas lifecycle behavior in `viz/`; the target is theme/state coupling, not browser APIs in general.

### Files Likely Touched

- `ui/app.js`
- `ui/editor-shell.js`
- `viz/field-renderer.js`
- `viz/profile-renderer.js`
- `viz/scene3d.js`
- related UI or renderer tests

### Exit Criteria

- `viz/` no longer reads theme state from the DOM
- renderers consume explicit theme inputs from `ui/`
- visual output is unchanged

### Effort

- Small

## Phase 3 - Medium Refactor: Finish The Stats Panel Boundary

### Purpose

Complete the unfinished part of the original stats extraction without adding unnecessary files.

### Work

- Make `StatsPanel.update(viewModel)` the only public rendering entry point.
- Move any remaining metric assembly that depends on app-owned collaborators out of render-time paths.
- Keep `ui/stats-panel.js` as the stats controller and markup builder.
- Prefer a single-file normalization over creating more small modules unless reuse becomes real.

### Desired Boundary

- `ui/app.js` owns orchestration and prepares a plain stats view model.
- `ui/stats-panel.js` renders that DTO and binds only stats-panel-local behavior.
- No stats rendering path should require the panel to reach back into the main controller for hidden data.

### Files Likely Touched

- `ui/app.js`
- `ui/stats-panel.js`
- `tests/ui/stats-panel.test.js`

### Exit Criteria

- stats rendering is driven by an explicit DTO
- stats panel no longer depends on hidden app collaborators
- `ui/app.js` no longer carries stats-specific DOM markup assembly

### Effort

- Medium

## Phase 4 - Medium To Heavy Refactor: Finish Residual Export Alignment

### Purpose

Remove the remaining export responsibility from `ui/app.js` without recreating a new export monolith.

### Work

- Move JSON, OBJ, and CSV export descriptor building out of `ui/app.js`.
- Keep exporter modules argument-driven and pure.
- Expand existing exporter files before creating new ones:
  - `export/obj-csv-exporter.js`
  - `export/dxf-exporter.js`
  - `export/rhino/rhino-exporter.js`
- Keep browser-only script loading such as `rhino3dm` initialization in `ui/app.js` unless it can be isolated cleanly without leaking DOM concerns into `export/`.

### Preferred Shape

- `ui/app.js` selects the requested export and gathers already-derived inputs.
- `export/*` returns export payloads or export-ready content from plain arguments.
- export filename/content rules live with the exporter, not the editor controller.

### Files Likely Touched

- `ui/app.js`
- `export/obj-csv-exporter.js`
- `export/dxf-exporter.js`
- `export/rhino/rhino-exporter.js`
- export tests under `tests/export/`

### Exit Criteria

- `ui/app.js` no longer contains JSON/OBJ/CSV export content builders
- export decisions live in `export/`
- no new export-layer monolith is introduced

### Effort

- Medium to heavy

## Phase 5 - Heavy Refactor: Slim `ui/app.js` To Pure Editor Orchestration

### Purpose

Reduce the editor controller to state orchestration, solver invocation, renderer coordination, and editor-specific UI wiring.

### Current Responsibilities Still Mixed

- state-to-DOM synchronization
- DOM event wiring
- solve/update orchestration
- 3D bootstrap and resize coordination
- project metadata/status integration
- export request dispatch

### Work

- Re-map the remaining `ui/app.js` sections by responsibility.
- Keep these responsibilities where they already belong:
  - `state/` stays the only configurable source of truth
  - `ui/editor-shell.js` owns shell-only UI behavior
  - `ui/camera-bookmarks.js` owns bookmark interactions
  - `export/` owns export formatting and payload construction
- Extract only if the split produces a clearer layer boundary.
- Prefer moving code into already-existing files over creating new single-purpose files.

### Guardrail

Do not split by line count alone. Split only where responsibility is actually crossing a boundary.

### Files Likely Touched

- `ui/app.js`
- possibly `ui/editor-shell.js`
- possibly existing `export/` modules
- related UI tests

### Exit Criteria

- `ui/app.js` reads as the editor orchestrator rather than a mixed controller
- remaining helpers inside `ui/app.js` are truly local orchestration helpers
- no duplicate state cache or duplicated solver math is introduced

### Effort

- Heavy

## Phase 6 - Deferred Productization Track: Auth And Backend Hardening

### Purpose

Keep a clear line between architecture alignment and productization.

### Current Recommendation

Because SSO is deferred by design, this phase should not block the structural alignment target above.

### Work When Productization Starts

- replace local auth fallback with the real auth contract
- replace local project storage fallback with the real backend contract
- preserve DTO purity in `services/`
- keep `state/` serialization at the edge and out of transport wiring

### Files Likely Touched Later

- `services/auth-service.js`
- `services/project-api.js`
- backend scripts and server implementation
- service boundary tests

### Exit Criteria

- no local-dev fallback in production path
- services remain DTO-only
- auth/persistence implementation matches the chosen backend contract

### Effort

- Heavy, but intentionally deferred

## Recommended Order Of Execution

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6 only when productization starts

## Verification Gate For Every Phase

Run all of the following after each completed phase:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Also perform one focused manual browser pass for the touched area:

- dashboard auth/project flow for service changes
- configurator solve/render/export flow for editor changes
- stats/details tabs for stats changes
- 2D and 3D theme/render checks for viz changes

## Risks

- The main risk is over-splitting `ui/app.js` and recreating complexity across more files.
- The second risk is accidentally turning derived runtime data into a second state system.
- The third risk is mixing browser-only wiring into `export/` while trying to move too much out of `ui/app.js`.

## Success Criteria

This alignment pass is complete when all of the following are true:

- docs and code agree on the allowed structure
- root `app.js` is explicitly documented as an allowed bootstrap exception
- the single-study project DTO is the documented target
- `viz/` consumes explicit theme/render inputs instead of reading page state
- stats rendering is DTO-driven
- residual export builders are out of `ui/app.js`
- `ui/app.js` is reduced to editor orchestration responsibility
- no forbidden imports are introduced
- no duplicate AppState or solver logic is introduced
