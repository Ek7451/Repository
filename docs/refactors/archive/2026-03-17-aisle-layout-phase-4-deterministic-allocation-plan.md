# Aisle Layout Phase 4 Deterministic Allocation Plan

## Status

- Status: Planned
- Planned on: 2026-03-17
- Depends on: Phase 3 completion
- Primary goal: replace heuristic aisle allocation with a deterministic rule engine inside `core/aisle-layout.js`

## Purpose

Phase 4 is the behavior-changing phase of the aisle refactor.

It replaces the current mixed heuristic policy in `core/aisle-layout.js` with a deterministic allocator driven by:

- mandatory chamfer-to-straight transition aisles
- hard max-seats-between-aisles enforcement
- symmetry rules for closed bowls
- an explicit odd-remainder tie-breaker
- straight-versus-chamfer family preferences
- locked `radial` and `perpendicular` alignment behavior already added in Phase 3

This phase must preserve all low-level geometry and sampling utilities that are already working.

## Architecture Verdict

The smallest compliant move is:

- keep requested aisle count and width in `core/profile-solver.js`
- keep final placement policy in `core/aisle-layout.js`
- keep render consumers in `viz/` unchanged at the call surface

Do not:

- move count allocation into `viz/field-renderer.js`
- create separate unrelated solvers per bowl family
- create a new production coordinator file

The new allocator is one framework with bowl-family branches driven by the perimeter model built in Phase 3.

## Scope Lock

In scope:

- `core/aisle-layout.js`
- `tests/core/aisle-layout.test.js`
- small compatibility test updates in:
  - `tests/viz/field-renderer.test.js`
  - `tests/ui/render-runtime.test.js`
  - `tests/ui/seating-bowl-app-runtime.test.js`
  - `tests/export/obj-csv-exporter.test.js` only if summary semantics need tightened assertions

Out of scope:

- UI work
- AppState or project serialization work
- export payload redesign
- 2D or 3D renderer redesign
- any change to `ui/app.js`

## Current Responsibility Map

### Deterministic helpers to keep

These are safe and reusable:

- `buildAllowedIntervals(...)`
- `distributeCoordsEvenly(...)`
- `distributeIntervalTs(...)`
- `estimateWorstSeatsInInterval(...)`
- `computeEvenOpenPathAisleStations(...)`
- `computeEvenAislesForOpenPaths(...)`
- `buildSectionBoundaries(...)`

### Heuristic functions to delete

Delete these once the deterministic allocator is green:

- `computeAisleStations(...)`
- `candidateScore(...)`
- `betterSingle(...)`
- `betterPair(...)`
- `intervalPressure(...)`
- `spacingVariance(...)`
- `pairAllocationBenefit(...)`
- `singleAllocationBenefit(...)`
- `buildChamferSymmetricStations(...)`
- `buildChamferIntervals(...)`

### Public entrypoint to preserve

- `buildTierAisleLayout(params)`

The public export stays. Only its internal policy path changes.

## Locked Product Rules To Encode

### Hard rules

- The request count comes from `ProfileSolver.calculateTierMetrics(...)`.
- Final placed count may exceed the request only for:
  - mandatory transition aisles
  - hard seat-cap enforcement
- `Full` chamfer bowl mandatory transitions: 8
- `U-End1` mandatory transitions: 4
- `U-End2` mandatory transitions: 4
- Symmetric closed bowls stay symmetric until a single unavoidable odd remainder exists.
- The odd remainder aisle goes on the longest straight segment.
- If opposite longest straights tie, use the top / positive-Y segment.
- Max seats between aisles is a hard rule and is evaluated on back-path interval geometry.
- Re-spacing is rebuilt from scratch whenever aisle count changes.

### Soft preferences

- Avoid centerline placement when another equally valid even-spacing solution exists.
- Prefer discretionary extras on straight segments before chamfer interiors.

## Exact Functions To Add

Add these internal helpers to `core/aisle-layout.js`:

- `computeRequiredSegmentCounts(perimeterModel, options)`
  - computes minimum interior aisle counts per interval from hard seat-cap enforcement
- `normalizeRequiredCountsForSymmetry(perimeterModel, requiredCounts)`
  - equalizes opposite intervals in symmetric closed bowls
- `allocateDeterministicCounts(perimeterModel, requestedDistributedCount, requiredCounts, options)`
  - decides final distributed aisle counts by interval
- `allocateStraightPairs(perimeterModel, allocationState, remaining)`
  - fills opposite straight pairs first on closed symmetric bowls
- `allocateSingleOddRemainder(perimeterModel, allocationState)`
  - places the one discretionary extra aisle on the longest straight, using the locked top-segment tie-breaker
- `materializeDistributedAisles(perimeterModel, intervalCounts, bowlConfig, options)`
  - converts final interval counts into aisle records with `segmentIndex`, `segmentT`, and `alignmentMode`
- `buildForcedTransitionAisles(perimeterModel)`
  - returns mandatory transition aisle records only
- `validateSeatCap(perimeterModel, aisles, options)`
  - final guard used in tests and during layout assembly

## Exact Functions To Edit

Edit these functions in `core/aisle-layout.js`:

- `buildTierAisleLayout(params)`
  - replace all branches that call `computeAisleStations(...)` or `buildChamferSymmetricStations(...)`
  - build the perimeter model
  - build forced transition aisles
  - compute required interval counts
  - reconcile requested target versus required minimums
  - allocate deterministic distributed counts
  - materialize final aisle records
  - keep the same return shape
- `distributeIntervalTs(...)`
  - keep the function, but ensure its axis-exclusion behavior remains the only centerline-avoidance mechanism used by the new allocator
- `estimateWorstSeatsInInterval(...)`
  - keep as the seat-cap evaluator

## Exact Deletion Order

Delete in this order:

1. stop calling `buildChamferSymmetricStations(...)`
2. stop calling `computeAisleStations(...)`
3. remove `candidateScore(...)`
4. remove `betterSingle(...)`
5. remove `betterPair(...)`
6. remove `intervalPressure(...)`
7. remove `spacingVariance(...)`
8. remove `pairAllocationBenefit(...)`
9. remove `singleAllocationBenefit(...)`
10. remove `buildChamferSymmetricStations(...)`
11. remove `buildChamferIntervals(...)`

Delete only after the deterministic allocator path passes all targeted tests.

## Target Algorithm By Bowl Family

### `Full` chamfer bowls

- start with 8 mandatory transition aisles
- build closed symmetric interval families
- compute hard seat-cap minimums from back-path lengths
- mirror required counts across opposite intervals
- allocate discretionary extras to opposite straight pairs first
- if one odd remainder remains after paired allocation, place it on the longest straight
- only allocate chamfer interiors if hard seat-cap rules require them or if straight intervals are exhausted and the requested total still exceeds mandatory plus straight-only capacity

### `U-End1` and `U-End2`

- start with 4 mandatory transition aisles
- treat the path as open
- compute hard seat-cap minimums from back-path lengths
- distribute additional aisles deterministically by interval family, preferring straights
- no closed-wrap symmetry logic
- no one-off heuristic fallback

### `Sides`, `Side1`, and `Side2`

- keep even linear spacing behavior
- route through the same top-level `buildTierAisleLayout(...)` pipeline
- do not use chamfer rules or forced transitions

### Arc bowls

- keep current non-chamfer path behavior for now
- do not introduce new mandatory-transition logic in this phase

## Final Count Reconciliation Rules

Let:

- `forcedCount` = mandatory transitions
- `requestedTarget` = rounded `targetAisles`
- `requiredDistributed` = hard seat-cap driven interior minimums
- `requestedDistributed` = `max(0, requestedTarget - forcedCount)`

Then:

- `finalDistributedTarget = max(requestedDistributed, requiredDistributed)`
- `finalActualCount = forcedCount + sum(distributedIntervalCounts)`
- `targetAisles` returned in the tier layout stays `max(requestedTarget, finalActualCount)`

This preserves existing downstream expectations around `targetAisles`.

## Temporary Compatibility Rules

During implementation:

- do not change the shape of `sectionBoundaries`
- do not change the signature of `buildTierAisleLayout(...)`
- do not rename `forcedCount` or `targetAisles`
- do not change `viz/field-renderer.js` or `viz/scene3d.js` call sites unless a compatibility test proves it is unavoidable

## Extraction Sequence

1. Add red tests for deterministic behavior in `tests/core/aisle-layout.test.js`.
2. Implement `buildForcedTransitionAisles(...)`.
3. Implement `computeRequiredSegmentCounts(...)`.
4. Implement `normalizeRequiredCountsForSymmetry(...)`.
5. Implement `allocateStraightPairs(...)`.
6. Implement `allocateSingleOddRemainder(...)`.
7. Implement `allocateDeterministicCounts(...)`.
8. Implement `materializeDistributedAisles(...)`.
9. Replace allocator branches in `buildTierAisleLayout(...)`.
10. Run focused tests against `Full` chamfer bowls first.
11. Extend the same deterministic path to `U-End1/U-End2`.
12. Keep linear open-path bowls on the existing even-spacing utility functions, but through the new top-level pipeline.
13. Remove the old heuristic helper functions.
14. Re-run full verification.

## Exact Tests To Add Or Update

### `tests/core/aisle-layout.test.js`

Add tests for:

- symmetric `Full` chamfer bowl with low requested target still returns exactly 8 aisles
- odd discretionary remainder lands on the longest straight
- tied opposite longest straights choose the top / positive-Y segment
- `U-End1` and `U-End2` each force 4 transition aisles
- hard max-seats-between-aisles adds aisles when required
- centerline avoidance is respected when an equally valid alternative exists
- straight distributed aisles honor `straightAisleMode`
- chamfer distributed aisles honor `chamferAisleMode`
- overcrowding regression:
  - requested count less than mandatory transitions should not produce extra discretionary aisles
  - requested count just above mandatory transitions should not overfill chamfer intervals

### `tests/viz/field-renderer.test.js`

Update only as needed to assert:

- `generateTierAisleLayout(...)` still returns a layout with stable top-level fields
- deterministic allocation output still flows into the section-summary path

### `tests/ui/render-runtime.test.js` and `tests/ui/seating-bowl-app-runtime.test.js`

Update only as needed to assert:

- tier aisle layouts still move through the render snapshot unchanged at the interface level

### `tests/export/obj-csv-exporter.test.js`

Tighten assertions only if necessary around:

- `forcedCount`
- `targetAisles`
- actual section and aisle summaries derived from `sectionSummary`

## Import Changes

No new import boundary changes are expected.

Specifically:

- no new imports from `viz/` into `core/`
- no new imports from `ui/` into `core/`
- no new file-level exports are required beyond the existing public surface

## Rollback Point

If Phase 4 introduces behavior regressions:

1. restore the pre-phase allocator body in `buildTierAisleLayout(...)`
2. keep the Phase 3 perimeter model and mode-aware resolver
3. leave deterministic tests in place where they capture approved product rules

This rollback keeps the seam improvements while reverting only the new policy path.

## Definition Of Done

Phase 4 is complete when all of the following are true:

- `computeAisleStations(...)` is gone
- `buildChamferSymmetricStations(...)` is gone
- heuristic scoring helpers are gone
- `Full` chamfer bowls produce exactly 8 mandatory transition aisles when no extras are required
- `U-End1` and `U-End2` each produce exactly 4 mandatory transition aisles before extras
- symmetric closed bowls stay symmetric except for one locked odd remainder
- the odd remainder tie-break uses the top / positive-Y straight
- max seats between aisles is never violated on the governing back-path intervals
- centerline placement is avoided when possible
- `buildTierAisleLayout(...)` still returns the same top-level layout shape
- no new production file was added

## Verification Gate

Run:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Review after verification:

- no new lint warnings
- no renderer interface churn
- no export payload regressions
- deterministic behavior confirmed by direct core tests

