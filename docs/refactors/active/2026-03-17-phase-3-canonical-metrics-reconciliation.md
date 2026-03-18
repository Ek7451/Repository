# Phase 3 — Canonical Metrics Reconciliation And Consumer Cleanup

## Goal
Make `core/profile-solver.js` the single canonical owner of reconciled tier metrics after actual aisle layout generation, then simplify downstream UI consumers.

## In Scope
- Add `reconcileTierMetricsByIndexWithLayoutSummaries` to `core/profile-solver.js`.
- Update `ui/render-runtime.js` to reconcile tier metrics after `buildTierAisleLayouts` and before stats/render consumers receive data.
- Delete `reconcileTierMetricsForStats` from `ui/stats-panel.js`.
- Make `ui/stats-panel.js` a pure render consumer of already reconciled tier metrics.

## Exact Logic To Move Or Delete

### Move into `core/profile-solver.js`
- `reconcileTierMetricsForStats` behavior currently owned by `ui/stats-panel.js`, rewritten as a core-side reconciliation helper:
  - `reconcileTierMetricsByIndexWithLayoutSummaries({ tierMetricsByIndex, tierAisleLayouts, egressParams })`

### Delete from `ui/stats-panel.js`
- `reconcileTierMetricsForStats`
- Any remaining metric patching that reshapes canonical tier metrics instead of rendering them

## Runtime Flow After This Phase
1. Build base tier metrics from `core/profile-solver.js`.
2. Build actual tier aisle layouts.
3. Reconcile tier metrics by index using actual layout summaries in `core/profile-solver.js`.
4. Pass reconciled metrics into stats and render consumers.
5. Keep `ui/stats-panel.js` render-only.

## File Targets
- `core/profile-solver.js`
- `ui/render-runtime.js`
- `ui/stats-panel.js`
- `tests/ui/stats-panel.test.js`
- `tests/ui/render-runtime.test.js`
- any direct tests covering profile-solver reconciliation behavior

## Behavior Preservation Constraints
- Preserve existing public metric field names.
- Preserve current visible values where current behavior is intentionally retained.
- Reconciliation must happen in `core/profile-solver.js`, not in `ui/` or `viz/`.
- `ui/app.js` remains untouched as a seat/egress owner.

## Known Gap Left Open
- This phase does **not** create a canonical section-metrics DTO.
- `field-renderer` section occupancy labels may remain geometry-derived overlay outputs.
- Export consumers remain deferred unless needed to keep checks green.

## Risks
- If runtime still hands unreconciled metrics to consumers, the split remains incomplete.
- If `stats-panel` keeps patch logic, authority stays split across core and UI.

## Verification Focus
- `tests/ui/stats-panel.test.js`
- `tests/ui/render-runtime.test.js`
- `tests/core/profile-solver.test.js`
- `tests/ui/editor-export-controller.test.js`
- manual checks for:
  - full closed bowl with section metrics on
  - low `seatsBetweenAisles` cases
  - mirrored `Sides` mode
  - perpendicular vs radial aisle modes
  - 3D seat cube preview totals

## Out of Scope
- canonical section-metrics DTO creation
- JSON/CSV exporter schema cleanup
- UI wording cleanup such as “Original Egress Calc”

## Phase Exit Criteria
- `core/profile-solver.js` is the only canonical reconciliation owner.
- `ui/render-runtime.js` uses reconciled metrics before fan-out.
- `ui/stats-panel.js` is render-only and no longer patches metrics.