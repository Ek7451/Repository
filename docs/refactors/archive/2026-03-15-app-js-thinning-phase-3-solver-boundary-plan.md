# App.js Thinning Phase 3 Solver Boundary Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: Phase 2 completion
- Primary goal: remove solver construction and solver-row interpretation from `ui/app.js`

## Purpose

Phase 3 moves the remaining solver-specific logic out of `ui/app.js` and into `core/profile-solver.js`.

The editor controller should coordinate solving. It should not instantiate solver loops, infer next-tier defaults from prior solver rows, or interpret solved tiers for metrics bookkeeping.

This phase preserves behavior by expanding the existing `core/profile-solver.js` surface instead of creating a new solver module.

## Architecture Verdict

The smallest compliant move is:

- move solver instantiation into `core/profile-solver.js`
- move next-tier default derivation into `core/profile-solver.js`
- move tier-index and tier-metrics interpretation helpers into `core/profile-solver.js`
- keep `ui/app.js` responsible only for when solving happens and where results go next

This matches the layer rules:

- `core/` owns solver construction and solver-row interpretation
- `ui/app.js` should not loop tiers to build `ProfileSolver` instances

## Scope Lock

In scope:

- `ui/app.js`
- `core/profile-solver.js`
- any focused tests needed for the new core helpers

Out of scope:

- field-plan aisle layout generation
- bowl-bounds and clip-range geometry
- project/status helpers
- AppState selector helpers already covered in Phases 1 and 2

## Current Responsibility Slice

`ui/app.js` still owns these solver-specific helpers:

- local `getSolverTierIndex(...)`
- `_solveActiveTiers(focalPointFt)`
- `_getTierDefaultsForEnabledTier(tierNum)`

`ui/app.js` also contains solver-result interpretation inside `_renderFieldView(...)`:

- loop solved tiers
- derive a stable tier index per solver
- call `ProfileSolver.calculateTierMetrics(...)`
- build a `Map` keyed by tier index

That interpretation belongs in `core/`, even if final aisle-layout generation remains for Phase 4.

## Exact Logic To Move

Source logic to move from `ui/app.js`:

- `getSolverTierIndex(solver, fallbackIndex = 0)`
- `_solveActiveTiers(focalPointFt)`
- `_getTierDefaultsForEnabledTier(tierNum)`
- the tier-metrics-by-index portion of `_renderFieldView(...)`

Destination file:

- `core/profile-solver.js`

New or expanded `core/profile-solver.js` exports:

- `getSolverTierIndex(solver, fallbackIndex = 0)`
- `buildActiveTierSolvers(tiers, focalPointFt)`
- `buildNextTierDefaultsFromSolvers(solvers, tierNum)`
- `buildTierMetricsByIndex({ solvers, bowlConfig, egressParams, offsetCorrection, calculateRowLength })`

Important boundary rule:

- `core/profile-solver.js` must not import `viz/field-renderer.js`
- if row-length calculation is needed, pass a narrow `calculateRowLength(bowlConfig, offset)` function into the new core helper

Preferred implementation detail:

- keep the existing `ProfileSolver.calculateTierMetrics(...)` signature untouched for the first move if that avoids extra churn
- the new core helper may create a narrow local adapter around the passed `calculateRowLength` callback

## Imports To Change

`ui/app.js`

- stop defining `getSolverTierIndex` locally
- import the new helper exports from `core/profile-solver.js`
- replace `_solveActiveTiers(...)` and `_getTierDefaultsForEnabledTier(...)` call sites with imported helpers

Likely app-level call sites:

- `EditorControls` `getTierDefaults` callback
- `update()`
- `_renderFieldView(...)` or its Phase 4 replacement

No reverse imports are allowed from `core/` to `ui/` or `viz/`.

## Extraction Sequence

1. Add `getSolverTierIndex` and `buildActiveTierSolvers` to `core/profile-solver.js`.
2. Add `buildNextTierDefaultsFromSolvers` to `core/profile-solver.js`.
3. Add `buildTierMetricsByIndex(...)` to `core/profile-solver.js` using a narrow row-length callback input.
4. Add focused tests covering solver construction, tier-default derivation, and tier-metrics indexing.
5. Update `ui/app.js` to use the new core helpers.
6. Delete the local helper function and private solver methods from `ui/app.js`.
7. Keep final field-layout generation in place until Phase 4 moves the viz-specific parts.

## Compliance Risks

- Tier defaults must preserve the existing behavior of `firstRowDist = lastRow.x`, `firstRowElev = lastRow.z + 20`, and `riserHeight = 12`.
- Tier index fallback behavior must remain stable for both solved tiers and export paths.
- The new core helper must not pull a full renderer instance into `core/`; pass only a narrow calculation seam.
- `ui/app.js` should not replace deleted solver helpers with new private wrappers that do the same work.

## Definition Of Done

Phase 3 is complete when all of the following are true:

- `ui/app.js` no longer loops tiers to construct `ProfileSolver` instances
- `ui/app.js` no longer derives next-tier defaults from solved row data
- `ui/app.js` no longer interprets solver tier indices or tier-metrics mapping directly
- `core/profile-solver.js` owns the moved logic instead
- no new reverse imports or hidden callback reach-through are introduced

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/editor-controls.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- add and run focused `core/profile-solver` helper tests
- `npm run build`

Recommended focused assertions:

- solver lists preserve row counts and `tierIndex` behavior
- tier-default callbacks in `EditorControls` still hydrate the same values
- tier-metrics indexing remains stable for multi-tier solves

