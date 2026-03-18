# Aisle Layout Phase 3 Perimeter Model And Station Resolution Plan

## Status

- Status: Planned
- Planned on: 2026-03-17
- Depends on: Phase 2 completion
- Primary goal: replace implicit path interpretation with an explicit perimeter model and mode-aware station resolution inside `core/aisle-layout.js`

## Purpose

Phase 3 is the seam-hardening phase for the aisle refactor.

It does not replace the current discretionary aisle allocator yet. Instead, it:

- preserves the existing public entrypoints
- preserves the low-level path and sampling primitives that already work
- replaces the current ad hoc chamfer and straight-edge interpretation with explicit topology records
- splits aisle station resolution into explicit `radial` and `perpendicular` behaviors

The outcome of Phase 3 should be that Phase 4 can replace the allocator without also having to rediscover bowl topology or reinterpret path geometry.

## Architecture Verdict

The smallest compliant move is to keep this work inside `core/aisle-layout.js`.

Do not:

- create a new production file for aisle policy
- move topology or station-resolution logic into `viz/field-renderer.js`
- move topology or station-resolution logic into `viz/scene3d.js`
- move topology or station-resolution logic into `core/profile-solver.js`

Why:

- `core/aisle-layout.js` already owns shared aisle placement and path sampling
- `viz/` consumes aisle layout output but does not own domain placement rules
- `core/profile-solver.js` owns requested aisle count and width, not perimeter placement

The only new file allowed in this phase is the focused test file:

- `tests/core/aisle-layout.test.js`

Existing modules considered and rejected as the destination:

- `viz/field-renderer.js`
  - rejected because it owns bowl render geometry and rendering-adjacent summarization, not domain placement policy
- `viz/scene3d.js`
  - rejected because it consumes aisle layout data and geometry segments but should not own policy interpretation
- `core/profile-solver.js`
  - rejected because it solves egress count and width, not path topology or station mapping
- a new `core/aisle-policy.js`
  - rejected because `core/aisle-layout.js` can still own this responsibility cleanly after internal restructuring

## Scope Lock

In scope:

- `core/aisle-layout.js`
- `tests/core/aisle-layout.test.js`
- small compatibility assertions in `tests/viz/field-renderer.test.js` only if needed

Out of scope:

- replacing the discretionary allocator
- changing `buildTierAisleLayout(...)` call sites
- UI dropdown work
- AppState or save/load schema work
- export-layer redesign
- any edit to `ui/app.js`

## Current Responsibility Map

### Functions to keep as-is

These are stable, deterministic, and already shared by 2D and 3D consumers:

- `clamp01(...)`
- `normalizeUnit(...)`
- `normalizeArcDelta(...)`
- `dedupeSorted(...)`
- `lineDirection(...)`
- `arcTangent(...)`
- `partStartDirection(...)`
- `partEndDirection(...)`
- `stationDistance(...)`
- `buildGeometryPaths(...)`
- `samplePathPoint(...)`
- `samplePathPointByRatio(...)`
- `sampleAisleBand(...)`
- `buildSectionBoundaries(...)`

### Functions to keep but narrow in purpose

- `buildAllowedIntervals(...)`
- `distributeCoordsEvenly(...)`
- `distributeIntervalTs(...)`
- `estimateWorstSeatsInInterval(...)`

These are deterministic spacing utilities and should remain reusable. They are not the heuristic problem.

### Functions or branches to replace in this phase

- `findChamferCornerAnchors(...)`
  - current issue: it excludes open-path endpoint transitions, so `U-End1` and `U-End2` only surface 3 forced chamfer transitions instead of 4
- `getCachedChamferAnchors(...)`
  - replace with cache helpers that can store generic topology records, not only chamfer anchors
- `resolveAisleStationRatios(...)`
  - current issue: it mixes transition pinning, segment interpolation, and one hardcoded axis-preserving behavior
- the straight-edge axis-preservation branch inside `resolveAisleStationRatios(...)`
  - current issue: it is effectively one mode, but the product now requires two explicit modes

### Current observed geometry facts the new model must encode

Using the actual bowl geometry builders in `viz/field-renderer.js` and `viz/scene3d.js`:

- `Full` chamfer rectangular bowl
  - 1 closed path
  - 8 alternating diagonal and axis-aligned line parts
  - 8 chamfer-to-straight transitions
- `U-End1` chamfer rectangular bowl
  - 1 open path
  - 5 line parts in sequence: straight, chamfer, straight, chamfer, straight
  - 4 chamfer-to-straight transitions
- `U-End2` chamfer rectangular bowl
  - 1 open path
  - 5 line parts in sequence: straight, chamfer, straight, chamfer, straight
  - 4 chamfer-to-straight transitions
- `Sides`
  - 2 open straight paths
  - 0 chamfer transitions
- `Side1`
  - 1 open straight path
  - 0 chamfer transitions

The current code undercounts open-path chamfer transitions because endpoint transitions are not treated as anchors.

## Target Shape For Phase 3

After Phase 3, `core/aisle-layout.js` should have three internal responsibility groups:

1. path and sampling primitives
2. perimeter-model construction
3. station-resolution helpers

The allocator remains temporarily unchanged in behavior, but it must consume the new model and the new station metadata.

## Exact Functions To Add

Add these internal helpers to `core/aisle-layout.js`:

- `collectTransitionAnchors(path)`
  - returns every chamfer-to-straight transition on a path
  - must include open-path endpoint transitions when the first or last part is chamfer-like
- `getCachedTransitionAnchors(path, cache)`
  - replacement cache accessor for transition anchors
- `buildPerimeterIntervals(pathFront, pathBack, anchors)`
  - returns interval records between adjacent transition anchors
- `buildSymmetryGroups(path, intervals, bowlConfig)`
  - assigns stable `symmetryKey` and opposite-pair relationships for closed symmetric bowls
- `buildPerimeterModel(frontPaths, backPaths, bowlConfig)`
  - returns one normalized topology object used by both the allocator and station resolver
- `resolveTransitionOrdinal(pathFront, pathBack, aisle, cache)`
  - resolves `cornerOrdinal`-based mandatory transitions
- `resolveRadialStationRatios(pathFront, pathBack, aisle, cache)`
  - preserves the current acceptable radial behavior, but as a named mode
- `resolvePerpendicularStationRatios(pathFront, pathBack, aisle, cache)`
  - projects a distributed aisle to remain normal to the local edge family
- `projectPerpendicularStationToCounterpart(pathSource, pathTarget, intervalRecord, sourceU)`
  - low-level helper used only by `resolvePerpendicularStationRatios(...)`

## Exact Functions To Edit

Edit these functions in `core/aisle-layout.js`:

- `resolveAisleStationRatios(pathFront, pathBack, aisle, chamferCache = null)`
  - keep the public signature unchanged
  - widen `chamferCache` usage so it can hold transition anchors and interval records by path
  - dispatch in this order:
    - transition ordinal
    - `alignmentMode === 'perpendicular'`
    - default radial
- `buildTierAisleLayout(params)`
  - build and cache the perimeter model up front
  - continue returning the same top-level layout object
  - do not replace the allocator yet
  - when generating forced stations, use `collectTransitionAnchors(...)`, not `findChamferCornerAnchors(...)`

## Exact Functions To Keep Temporarily For Compatibility

- `findChamferCornerAnchors(...)`
  - keep only during Phase 3 if needed as a wrapper to avoid large local churn
  - do not let any new code depend on it directly

## Runtime Payload Rules

Phase 3 introduces one new aisle-record field:

- `alignmentMode`

Allowed values:

- `'radial'`
- `'perpendicular'`

Population rules:

- mandatory transition aisles may omit `alignmentMode`
- distributed straight-segment aisles use `bowlConfig.straightAisleMode`
- distributed chamfer-segment aisles use `bowlConfig.chamferAisleMode`
- if the mode is missing, default to `'radial'`

Compatibility rules:

- keep `cornerOrdinal`
- keep `segmentIndex`
- keep `segmentT`
- keep `pathIndex`
- keep `forced`
- keep `anchorType`

## Temporary Compatibility Rules

Until Phase 4 lands:

- `buildTierAisleLayout(...)` must still route into the current allocator path
- the new perimeter model is allowed to coexist with the old `buildChamferSymmetricStations(...)` implementation temporarily
- the old heuristic allocator is allowed to emit aisle records so long as they are stamped with the correct new `alignmentMode`
- no renderer call site should change

## Extraction Sequence

1. Create `tests/core/aisle-layout.test.js` with characterization tests for actual geometry families.
2. Add tests proving mandatory transition counts:
   - `Full` chamfer: 8
   - `U-End1`: 4
   - `U-End2`: 4
   - `Sides`: 0
   - `Side1`: 0
3. Implement `collectTransitionAnchors(...)`.
4. Implement `getCachedTransitionAnchors(...)`.
5. Implement `buildPerimeterIntervals(...)`.
6. Implement `buildSymmetryGroups(...)`.
7. Implement `buildPerimeterModel(...)`.
8. Refactor forced-station creation in `buildTierAisleLayout(...)` to use the new transition anchors.
9. Implement `resolveTransitionOrdinal(...)`.
10. Split `resolveAisleStationRatios(...)` into:
    - `resolveTransitionOrdinal(...)`
    - `resolveRadialStationRatios(...)`
    - `resolvePerpendicularStationRatios(...)`
11. Stamp `alignmentMode` onto distributed aisle records.
12. Run downstream tests to confirm `viz/` consumers still work.
13. Remove any temporary wrapper path that duplicates anchor logic.

## Exact Tests To Add Or Update

### New file: `tests/core/aisle-layout.test.js`

Add tests for:

- `buildGeometryPaths(...)` path count and closure for `Full`, `U-End1`, `U-End2`, `Sides`, and `Side1`
- transition-anchor count for the same families
- open-end endpoint transition detection on `U-End1` and `U-End2`
- `resolveAisleStationRatios(...)` default radial behavior on a widening straight interval
- `resolveAisleStationRatios(...)` perpendicular behavior on the same interval
- distinct output between radial and perpendicular modes

### Update only if required: `tests/viz/field-renderer.test.js`

Add a thin compatibility assertion that `generateTierAisleLayout(...)` still returns a tier layout with:

- `aisles`
- `forcedCount`
- `targetAisles`
- `sectionBoundaries`

and does not require any new renderer call signature.

## Import Changes

No import boundary changes are expected in this phase.

Specifically:

- do not introduce imports from `viz/` into `core/`
- do not introduce imports from `ui/` into `core/`
- do not introduce imports from `core/aisle-layout.js` into new modules because no new module should exist

## Rollback Point

If Phase 3 causes regressions:

1. revert the `resolveAisleStationRatios(...)` rewrite first
2. revert forced-station generation back to the pre-phase anchor helper
3. leave the new tests in place if they characterize real geometry correctly

Rollback is complete when:

- renderers again use the pre-phase resolution path
- no new payload field is required by downstream callers

## Definition Of Done

Phase 3 is complete when all of the following are true:

- `core/aisle-layout.js` has an explicit perimeter model
- `Full` chamfer bowls expose 8 transition anchors
- `U-End1` and `U-End2` each expose 4 transition anchors
- `resolveAisleStationRatios(...)` is explicitly mode-aware
- no new production file was added
- all new logic stays in `core/`
- `buildTierAisleLayout(...)` still returns the same top-level contract
- `viz/field-renderer.js` and `viz/scene3d.js` continue to consume aisle records without interface churn

## Verification Gate

Run:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Focused assertions to review after the test run:

- open-end chamfer transitions are now counted
- radial and perpendicular modes produce different resolved stations where geometry widens
- no new lint warnings were introduced

