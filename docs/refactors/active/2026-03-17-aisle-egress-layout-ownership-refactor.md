# Seat Math / Egress Policy Split

## Summary
- The split is sound, with one refinement: the current risk is not only duplicated formulas, but split authority. Tier totals come from [`core/profile-solver.js`](/c:/Users/Elliott%20Klinger/Desktop/Repository/core/profile-solver.js#L478), actual aisle geometry comes from [`core/aisle-layout.js`](/c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js#L1701), and some displayed section occupancy data is recomputed inside [`viz/field-renderer.js`](/c:/Users/Elliott%20Klinger/Desktop/Repository/viz/field-renderer.js#L1612) and patched again in [`ui/stats-panel.js`](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/stats-panel.js#L311).
- Biggest current design risk: actual layout can diverge from solver-estimated aisles, so seat/egress metrics are being reconciled outside the canonical owner. That is a larger drift risk than any single duplicated formula.
- JSON/CSV export is explicitly not the source of truth for this refactor. Treat it as a deferred consumer.

## Current State Audit
- `ProfileSolver.calculateTierMetrics` is the current authoritative source for:
  - Per-tier occupancy: `capacity`
  - Row-level displayed seat counts: `row.computedSeats` and `row.computedSeatsPerSide`
  - Solver-estimated aisle count/width: `numAisles`, `aisleWidth`, `numSections`, `occupantsPerSection`, `occupantsPerAisleLine`
- `buildStatsViewModel` in [`ui/stats-panel.js`](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/stats-panel.js#L482) is the current visible all-tier total source in the app UI. It sums tier `capacity` at line 539. `ui/app.js` only orchestrates consumers and is not a seat/egress owner.
- `ui/render-runtime.js` builds solver metrics first, then builds actual aisle layouts, then hands both to stats/UI. That ordering is why `stats-panel` currently patches metrics after the fact.
- `core/aisle-layout.js` currently owns mixed responsibilities:
  - Geometry/layout: interval discovery, deterministic allocation, alignment modes, section boundaries
  - Seat-cap validation math: `estimateWorstSeatsInInterval`
  - Seat-limit policy loops: `computeRequiredSegmentCounts`, `validateSeatCap`
- `viz/field-renderer.js` currently owns mixed responsibilities:
  - Correct viz ownership: aisle polygons, label anchors, draw order, section numbering
  - Incorrect authority: back-row section seat counts, per-row section seat counts, section occupancy totals
- `viz/scene3d.js` contains another seat-count formula for seat preview instancing.
- `core/sightline-calc.js`, `core/sports-templates.js`, and `core/default-starting-profile.js` do not own seat or egress math. They only supply sightline utilities, templates, and default inputs.
- The occupancy control copy in `pages/configurator/index.html` already documents the current solver proxy model: max seats/row is evaluated against average tier length, not true section outputs.

### Ownership Trace
| Value | Raw math owner today | Canonical UI owner today | Renderer consumer today | Notes |
|---|---|---|---|---|
| Aisle width labels | `ProfileSolver.calculateTierMetrics` | tier metrics DTO from `profile-solver` | field renderer consumes width to build layout | Canonical today |
| Per-row seat counts | `ProfileSolver` for row totals; `field-renderer` for per-section row labels | row table uses `row.computedSeats`; no canonical per-section row DTO | field renderer draws row seat labels | Split today |
| Per-tier occupancy | `ProfileSolver.capacity` | tier metrics DTO from `profile-solver` | stats panel only consumes | Canonical today |
| All-tier total occupancy | `buildStatsViewModel` sum of tier capacities | stats summary DTO, sourced from solver tier capacities | none | Canonical app-visible total today |
| Per-section occupancy labels | `field-renderer.getTierSectionMetricsOverlayData` | none | field renderer and plan export consume | True geometry-derived section totals, but not canonical |

### Section Label Verdict
- Field-plan section occupancy labels are true occupancies for the drawn aisle-defined sections. They are computed by summing row-by-row section seat counts against actual aisle boundaries.
- `stats-panel` `occupantsPerSection` is not a true per-section output. It is either:
  - solver proxy `OccBlock`, or
  - `capacity / actualSections` average when `allSectionPathsClosed` is true.
- Architecture gap: section occupancy exists as geometry-derived overlay data, but there is no canonical section-metrics DTO. Section boundaries do not currently imply canonical ownership of section occupancy labels.

## Proposed Module Boundaries
- `core/seat-math.js`
  - Own only deterministic seat formulas.
  - Include:
    - seats from usable run length
    - seats from centerline gap minus aisle width
    - seats per block / seats per section averages
    - shared seat-count rounding rules
  - Consumers: `profile-solver`, `aisle-layout`, `field-renderer`, `scene3d`
- `core/egress-policy.js`
  - Own only policy and code-rule decisions.
  - Include:
    - minimum blocks/aisles from `seatsBetweenAisles`
    - tributary load per aisle line
    - required aisle width from load + factor + min/max width
    - escalation when max width cap forces added blocks
    - local seat-cap compliance loop for layout intervals
    - future circulation constraints such as cross-aisle depth
- `core/profile-solver.js`
  - Remains the canonical owner of the tier metrics DTO used by app UI.
  - Keeps:
    - row-length collection through the existing narrow callback
    - mirrored-sides handling
    - writing `row.computed*`
    - assembling and publishing final tier metrics
    - new core-side reconciliation helper that updates final tier metrics from actual layout summaries after layout generation
- `core/aisle-layout.js`
  - Keeps:
    - path sampling
    - perimeter intervals
    - aisle station distribution
    - alignment mode stamping
    - section boundary definition
  - Stops owning private seat formulas and direct code-policy decisions
  - Delegates seat counts to `seat-math` and seat-limit policy to `egress-policy`
- `viz/field-renderer.js`
  - Keeps:
    - bowl geometry generation
    - aisle polygons
    - label anchor placement
    - section numbering
    - drawing
  - Stops owning canonical metric reconciliation
  - In this slice, may still assemble overlay DTOs, but all seat counts must come from `seat-math`, not inline formulas
- `viz/scene3d.js`
  - Keeps only visual seat placement
  - Reuses `seat-math` for preview counts to remove another drift source
- `ui/stats-panel.js`
  - Becomes render-only
  - Delete `reconcileTierMetricsForStats`
  - Consume already reconciled tier metrics from runtime

### New File Justification
- `core/seat-math.js` is justified.
  - Logic moved: all shared seat-count formulas now duplicated in `profile-solver`, `aisle-layout`, `field-renderer`, and `scene3d`
  - Existing destinations considered and rejected:
    - `core/profile-solver.js`: solver-centric orchestrator, wrong shared owner for layout/render consumers
    - `core/aisle-layout.js`: geometry-centric and would force solver to depend on layout knowledge
    - `viz/field-renderer.js`: would violate `core`/`viz` direction for solver consumers
  - Single responsibility: canonical seat-count math only
- `core/egress-policy.js` is justified.
  - Logic moved: block/aisle/width policy, seat-limit compliance rules, future circulation constraints
  - Existing destinations considered and rejected:
    - `core/profile-solver.js`: solver-specific, but layout also needs the same policy
    - `core/aisle-layout.js`: keeps policy mixed into geometry and blocks future circulation ownership
    - `ui/stats-panel.js`: wrong layer, already doing non-compliant metric reshaping
  - Single responsibility: code/policy decisions only
- Do not add a third new module for canonical tier metrics. Keep that ownership in `core/profile-solver.js`.

## Function Extraction Map
| Current logic | Current file | Destination | Action |
|---|---|---|---|
| `Math.floor(usable / seatWidthIn)` style row seat formulas | `core/profile-solver.js` | `core/seat-math.js` | Move |
| `SeatsInBlockPerRow`, average seats/section arithmetic | `core/profile-solver.js` | `core/seat-math.js` | Move |
| Fixed-point loop for blocks, aisle lines, width cap, tributary load | `core/profile-solver.js` | `core/egress-policy.js` | Move high-level policy solver |
| Row mutation and final metrics DTO assembly | `core/profile-solver.js` | stay in `core/profile-solver.js` | Keep |
| `estimateWorstSeatsInInterval` seat formula | `core/aisle-layout.js` | `core/seat-math.js` + thin geometry shell in `aisle-layout` | Wrap |
| `computeRequiredSegmentCounts` / `validateSeatCap` rule loops | `core/aisle-layout.js` | `core/egress-policy.js` + `aisle-layout` geometry inputs | Rewrite |
| `reconcileTierMetricsForStats` | `ui/stats-panel.js` | `core/profile-solver.js` | Move |
| Back-row section seat counts and overlay seat totals | `viz/field-renderer.js` | keep geometry loop local for now, but replace inline counts with `seat-math` | Wrap in this slice |
| Seat preview count in `_createTierSeatPreviewMesh` | `viz/scene3d.js` | `core/seat-math.js` | Wrap |

### Proposed Helper APIs
- `core/seat-math.js`
  - `countSeatsFromUsableRunLengthIn({ usableRunLengthIn, seatWidthIn })`
  - `countSeatsFromCenterlineGapFt({ centerGapFt, aisleWidthFt, seatWidthIn })`
  - `computeUsableRunLengthIn({ totalRunLengthIn, aisleLineCount, aisleWidthIn })`
  - `computeAverageSeatsPerBlock({ seatsPerRow, blockCount })`
- `core/egress-policy.js`
  - `computeMinimumBlockCountForSeatLimit({ backRowSeatsPerRun, seatsBetweenAisles })`
  - `computeTributaryOccupancyPerAisle({ occupantsPerBlock, blockCount })`
  - `computeAssignedAisleWidthIn({ tributaryOccupancy, egressFactor, minAisleWidthIn, maxAisleWidthIn })`
  - `computeRequiredBlockCountForWidthCap({ seatsPerRow, rowCount, assignedAisleWidthIn, egressFactor })`
  - `solveUniformTierEgressPolicy({ avgRunLengthIn, backRunLengthIn, rowCount, seatWidthIn, seatsBetweenAisles, minAisleWidthIn, maxAisleWidthIn, egressFactor })`
  - `findRequiredIntervalAisleCount({ maxSeatsBetweenAisles, measureWorstSeatsForCount, maxCount })`
- `core/profile-solver.js`
  - `reconcileTierMetricsByIndexWithLayoutSummaries({ tierMetricsByIndex, tierAisleLayouts, egressParams })`

## Dependency Design
```text
core/seat-math.js
  imports: none

core/egress-policy.js
  imports: core/seat-math.js

core/profile-solver.js
  imports: core/seat-math.js, core/egress-policy.js
  must not import: viz/, ui/

core/aisle-layout.js
  imports: core/seat-math.js, core/egress-policy.js
  must not import: profile-solver.js, viz/, ui/

viz/field-renderer.js
  imports: core/aisle-layout.js, core/seat-math.js
  must not import: core/egress-policy.js for canonical UI decisions

viz/scene3d.js
  imports: core/aisle-layout.js, core/seat-math.js

ui/render-runtime.js
  imports: core/profile-solver.js
  flow: base tier metrics -> actual tier layouts -> core-side reconciliation -> stats/render consumers

ui/stats-panel.js
  imports: no seat/egress math modules after refactor
```
- Prevent circular dependencies by keeping `seat-math` leaf-most and `egress-policy` dependent only on `seat-math`.
- `profile-solver` must continue consuming geometry through explicit callbacks/summary DTOs, not by importing `field-renderer` or `aisle-layout`.
- `aisle-layout` must consume policy as pure functions, not via `ProfileSolver`.
- Rendering remains downstream-only. It may use shared math, but it must not publish canonical tier metrics.

## Migration Sequence
1. Add unit tests for raw seat formulas and egress policy using current behavior as fixtures.
2. Create `core/seat-math.js`; move all shared seat formulas there with no caller shape changes.
3. Replace inline seat math in `core/profile-solver.js`, `core/aisle-layout.js`, `viz/field-renderer.js`, and `viz/scene3d.js` with `seat-math` calls.
4. Create `core/egress-policy.js`; move the solver fixed-point block/aisle/width logic there.
5. Refactor `core/profile-solver.js` to call `solveUniformTierEgressPolicy`, but keep row mutation and returned metric field names unchanged.
6. Refactor `core/aisle-layout.js` so seat-cap escalation and validation call `egress-policy` helpers with geometry-supplied measurement callbacks; keep aisle placement outputs unchanged.
7. Add `reconcileTierMetricsByIndexWithLayoutSummaries` to `core/profile-solver.js`.
8. Update `ui/render-runtime.js` to call the reconciliation helper after `buildTierAisleLayouts` and before building stats view-models.
9. Delete `reconcileTierMetricsForStats` from `ui/stats-panel.js`; stats panel becomes a pure consumer.
10. Leave JSON/CSV exporter updates out of this slice unless needed to keep compilation/tests green. Update those later to consume the reconciled canonical DTO.

## Verification Strategy
- Required repo commands after implementation:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
- Targeted regression tests to preserve:
  - `tests/core/profile-solver.test.js`
  - `tests/core/aisle-layout.test.js`
  - `tests/viz/field-renderer.test.js`
  - `tests/ui/stats-panel.test.js`
  - `tests/ui/render-runtime.test.js`
  - `tests/ui/editor-export-controller.test.js`
- Add new unit coverage for:
  - seat formulas in `seat-math`
  - fixed-point egress policy convergence
  - interval seat-limit policy using a measurement callback
- Manual checks:
  - Full closed bowl with section metrics on: same tier capacity, same aisle width label, same section `occ` labels, same row seat labels
  - Full bowl with low `seatsBetweenAisles`: same extra aisles inserted by layout
  - Mirrored `Sides` mode: same row totals and all-tier total occupancy
  - Perpendicular vs radial aisle modes: same policy counts, same geometry mode behavior
  - Seat cubes on in 3D: same preview seat totals
- Current baseline from the inspected repo:
  - `npm run test`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm run lint`: exits 0 with existing unrelated warnings in `viz/`

## Risks And Assumptions
- Assumption: preserve all current public DTO field names and visible values in this slice. Do not silently “correct” metrics while extracting logic.
- Assumption: JSON/CSV export is a deferred consumer and not part of canonical ownership work here.
- Risk: actual layout can add aisles beyond solver estimates. If core-side reconciliation is skipped, the split remains incomplete even if formulas are deduplicated.
- Risk: `field-renderer` section occupancy labels are true geometry-derived section totals today, but they still lack a canonical section-metrics DTO. This refactor should call that gap out, not pretend it is solved by section boundaries alone.
- Risk: `stats-panel` copy such as “Original Egress Calc” currently renders the same metrics object it displays elsewhere. Do not expand scope into UI wording cleanup unless a caller break forces it.
- Future default: cross-aisle sizing and circulation depth must be added to `core/egress-policy.js` as new options on object-style APIs, not hardcoded into `aisle-layout` geometry.

