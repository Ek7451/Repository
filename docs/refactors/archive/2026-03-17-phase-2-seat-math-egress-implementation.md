# Phase 2 — Seat Math / Egress Shared Logic Extraction

## Goal
Extract shared seat math and egress policy logic into the approved core modules while preserving behavior.

## In Scope
- Add tests for extracted seat math and egress policy behavior.
- Create `core/seat-math.js`.
- Create `core/egress-policy.js`.
- Replace duplicated inline seat formulas in:
  - `core/profile-solver.js`
  - `core/aisle-layout.js`
  - `viz/field-renderer.js`
  - `viz/scene3d.js`
- Move solver fixed-point block/aisle/width logic out of `core/profile-solver.js` into `core/egress-policy.js`.
- Refactor `core/aisle-layout.js` to use pure policy helpers for seat-cap escalation and validation.

## Exact Logic To Move

### Into `core/seat-math.js`
- `Math.floor(usable / seatWidthIn)` style row seat formulas from `core/profile-solver.js`
- `SeatsInBlockPerRow` and average seats/section arithmetic from `core/profile-solver.js`
- `estimateWorstSeatsInInterval` seat formula from `core/aisle-layout.js` via a thin geometry shell
- Back-row section seat-count formulas and overlay seat totals in `viz/field-renderer.js` should call shared helpers instead of inline math
- Seat preview count logic in `_createTierSeatPreviewMesh` in `viz/scene3d.js`

### Into `core/egress-policy.js`
- Fixed-point loop for blocks, aisle lines, width cap, and tributary load from `core/profile-solver.js`
- `computeRequiredSegmentCounts` and `validateSeatCap` rule loops from `core/aisle-layout.js`, rewritten to accept geometry-supplied measurement callbacks

## Proposed Helper APIs

### `core/seat-math.js`
- `countSeatsFromUsableRunLengthIn({ usableRunLengthIn, seatWidthIn })`
- `countSeatsFromCenterlineGapFt({ centerGapFt, aisleWidthFt, seatWidthIn })`
- `computeUsableRunLengthIn({ totalRunLengthIn, aisleLineCount, aisleWidthIn })`
- `computeAverageSeatsPerBlock({ seatsPerRow, blockCount })`

### `core/egress-policy.js`
- `computeMinimumBlockCountForSeatLimit({ backRowSeatsPerRun, seatsBetweenAisles })`
- `computeTributaryOccupancyPerAisle({ occupantsPerBlock, blockCount })`
- `computeAssignedAisleWidthIn({ tributaryOccupancy, egressFactor, minAisleWidthIn, maxAisleWidthIn })`
- `computeRequiredBlockCountForWidthCap({ seatsPerRow, rowCount, assignedAisleWidthIn, egressFactor })`
- `solveUniformTierEgressPolicy({ avgRunLengthIn, backRunLengthIn, rowCount, seatWidthIn, seatsBetweenAisles, minAisleWidthIn, maxAisleWidthIn, egressFactor })`
- `findRequiredIntervalAisleCount({ maxSeatsBetweenAisles, measureWorstSeatsForCount, maxCount })`

## Implementation Sequence
1. Add unit tests for raw seat formulas and egress policy using current behavior as fixtures.
2. Create `core/seat-math.js`; move all shared seat formulas there with no caller shape changes.
3. Replace inline seat math in `core/profile-solver.js`, `core/aisle-layout.js`, `viz/field-renderer.js`, and `viz/scene3d.js` with `seat-math` calls.
4. Create `core/egress-policy.js`; move the solver fixed-point block/aisle/width logic there.
5. Refactor `core/profile-solver.js` to call `solveUniformTierEgressPolicy`, but keep row mutation and returned metric field names unchanged.
6. Refactor `core/aisle-layout.js` so seat-cap escalation and validation call `egress-policy` helpers with geometry-supplied measurement callbacks; keep aisle placement outputs unchanged.

## File Targets
- `core/profile-solver.js`
- `core/aisle-layout.js`
- `viz/field-renderer.js`
- `viz/scene3d.js`
- `tests/core/profile-solver.test.js`
- `tests/core/aisle-layout.test.js`
- new focused tests for `core/seat-math.js`
- new focused tests for `core/egress-policy.js`

## Behavior Preservation Constraints
- Preserve all current public DTO field names.
- Preserve visible seat, aisle, and occupancy values in this phase.
- Do not silently “correct” layout/solver drift yet.
- Do not move canonical metric reconciliation into `viz/` or `ui/`.

## Risks
- Layout and solver outputs can still diverge after extraction if reconciliation is not implemented in the next phase.
- `field-renderer` still assembles geometry-derived overlay data and is not yet replaced by a canonical section DTO.

## Out of Scope
- `ui/render-runtime.js` flow changes
- `ui/stats-panel.js` reconciliation removal
- export consumer updates unless required for green checks

## Phase Exit Criteria
- Shared seat formulas exist only in `core/seat-math.js`.
- Shared egress policy loops exist only in `core/egress-policy.js`.
- Callers delegate to those modules without changing visible behavior.
- No reverse imports are introduced.