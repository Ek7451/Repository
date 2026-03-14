# Remaining Roadmap Alignment Overview

## Status

- Status: Planned
- Planned on: 2026-03-14
- Source audit: `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- Prior completed plans: `docs/refactors/archive/phase-1-export-extraction-plan.md` through `docs/refactors/archive/phase-5-plan.md`

## Purpose

This document defines the remaining refactor work needed to bring the current codebase fully into alignment with the March 12 roadmap.

Archived Phases 1-5 established the main foundation:

- Rhino and DXF export are out of the original monolith.
- AppState exists and is the active configurable-state model.
- Camera bookmarks are no longer rendered from `app.js`.
- Dashboard, auth, and project persistence exist behind DTO-style service seams.

The codebase is therefore mostly aligned, but not fully aligned yet.

## Current Alignment Snapshot

Aligned now:

- `core/` remains protected and calculation-only.
- `state/app-state.js` is the single configurable-state model.
- `export/` consumes explicit arguments and does not import `ui/`.
- `services/` does not import `state/`.
- `ui/camera-bookmarks.js` and `pages/dashboard-page.js` are in the correct layers.

Remaining gaps:

1. `ui/stats-panel.js` is still only a partial extraction.
   - It is a function renderer rather than a controller object.
   - It still calculates tier metrics internally.
   - `app.js` still owns the stats wrapper and passes DOM nodes plus `fieldRenderer` through every update.

2. `app.js` is still too large and still mixes too many roles.
   - Current size is about `2348` lines.
   - It still mixes bootstrap, route/shell logic, theme, DOM binding, editor orchestration, and residual export handling.

3. Residual export responsibility still lives in `app.js`.
   - JSON results export
   - OBJ export
   - CSV export

4. Phase 5 shipped a lightweight prototype stack rather than the March 12 productized stack.
   - `services/auth-service.js` still falls back to local session storage.
   - `services/projects-service.js` still falls back to local project storage.
   - `scripts/project-api-server.mjs` is a lightweight JSON-file server rather than the roadmap's real auth + persistence implementation.

## Structure Guardian Verdict

Compliance verdict: the remaining work is mostly responsibility cleanup, not a fresh architecture redesign.

Required moves:

- finish the stats-panel boundary so `ui/stats-panel.js` becomes a real UI controller
- split the editor controller out of the root bootstrap path so the routing shell and the editor orchestrator stop sharing one file
- move the remaining export builders out of the editor controller
- harden the auth/project stack to the roadmap's real Phase 5 direction

Do not reopen:

- `core/` calculation boundaries
- Rhino and DXF extraction work that is already complete
- AppState as the single configurable source of truth

## Import Boundary Audit

Current forbidden imports detected in the alignment path:

- none

Current risk is not import direction. Current risk is hidden coupling:

- `ui/stats-panel.js` still depends on app-owned collaborators instead of a stable view-model
- the root `app.js` still blends route shell and editor concerns
- services still contain development fallbacks that blur the real transport boundary

## Active Phase Sequence

### Phase 6 - Stats Panel Normalization

Plan file:

- `docs/refactors/active/phase-6-stats-panel-normalization-plan.md`

Goal:

- finish the unfinished part of archived Phase 2
- make the stats panel a real UI controller
- move calculations and DTO assembly out of the stats renderer

### Phase 7 - App Bootstrap And Editor Controller Split

Plan file:

- `docs/refactors/active/phase-7-app-bootstrap-and-editor-controller-plan.md`

Goal:

- split the root bootstrap shell from the editor controller
- reduce `app.js` to route/bootstrap responsibility only
- create a slimmer editor controller module under `ui/`

### Phase 8 - Residual Export Alignment

Plan file:

- `docs/refactors/active/phase-8-residual-export-alignment-plan.md`

Goal:

- remove JSON, OBJ, and CSV builder logic from the editor controller
- finish the export-layer separation that Phase 1 intentionally deferred

### Phase 9 - Productization Hardening

Plan file:

- `docs/refactors/active/phase-9-productization-hardening-plan.md`

Goal:

- align the implemented auth/project stack with the March 12 Phase 5 recommendation
- keep DTO purity while replacing prototype local fallbacks with the real auth and persistence contract

## File Count Guidance

Current app-level JavaScript count is `20`.

The remaining implementation sequence should stay near the repo target of `17-22` app-level JavaScript files. The preferred path is:

- add `ui/app.js`
- add `export/obj-csv-exporter.js`
- reuse existing `pages/dashboard-page.js`, `services/`, `state/`, and `ui/` files where possible

Adding further files beyond that should require a deliberate reassessment during implementation.

## Relationship To `target-directory-structure.md`

`docs/architecture/target-directory-structure.md` is useful as the destination picture, but these active phases stay anchored to the March 12 roadmap and the repo guardrails.

That means:

- responsibility boundaries come first
- AppState remains the single source of truth
- calculation logic stays in `core/`
- page and entrypoint reshaping should happen only when it directly reduces the remaining controller monolith

The configurator/dashboard HTML split described in the target-directory document is therefore optional follow-on work unless it becomes necessary to complete Phase 7 cleanly.

## End-State Target

These active phases are complete when all of the following are true:

- stats rendering is controlled by a dedicated `StatsPanel` controller with explicit DTO input
- the root bootstrap is separate from the editor controller
- the editor controller no longer owns residual export builders
- the editor controller is reduced to orchestration responsibility
- the auth/project stack uses the real DTO + backend contract rather than prototype local fallbacks
- no duplicate AppState, state cache, or solver math is introduced
