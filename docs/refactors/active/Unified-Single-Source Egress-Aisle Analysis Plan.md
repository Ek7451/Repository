# Unified Single-Source Egress / Aisle Analysis Plan

## Summary
- Make [core/aisle-layout.js](/C:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js) the single authoritative workflow for aisle placement results, per-section seat counts, per-aisle occupancies, required/governing/rendered aisle widths, and tier/configuration totals.
- Keep [core/egress-policy.js](/C:/Users/Elliott%20Klinger/Desktop/Repository/core/egress-policy.js) and `core/seat-math.js` as pure helper libraries only. They may be called by `core/aisle-layout.js`, but no non-`core` module may call them to derive user-facing truth.
- `viz`, `ui`, and `export` must consume final analysis data only. No fallback width math, occupancy math, seat counting, or total reductions outside `core`.
- No new files. Preserve existing layer boundaries. Do not broaden `ui/app.js`.

## Architectural Rules To Enforce
- `core/` owns all domain math and solver-result interpretation. No DOM, no renderer calls, no `ui/` imports.
- `viz/` may gather geometry inputs and render them, but must not calculate seat counts, occupancies, aisle widths, or totals.
- `ui/` may coordinate and format data for display, but must not derive egress values, totals, or section metrics.
- `export/` may shape export records only from explicit inputs; it must not infer “common” widths or recompute totals.
- Preserve existing modules first. Do not add files. Do not move logic into `ui/app.js`.
- No reverse imports. `core` stays independent of `viz`; geometry enters `core` only through explicit callbacks/DTOs.

## Authoritative Core Contract
Add one new exported entry point in [core/aisle-layout.js](/C:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js):

```js
export function buildTierAisleAnalysis({
    tierIndex,
    rows,
    bowlConfig,
    offsetCorrection = 0,
    egressParams,
    getPathsForOffset,
    getRowLengthFt
}) { /* authoritative tier solve */ }
```

Add one configuration aggregator in the same file:

```js
export function buildConfigurationAisleSummary({ tierLayouts }) {
    return {
        totalOccupancyAllTiers: 0,
        totalAislesAllTiers: 0,
        totalSectionsAllTiers: 0,
        tierSeatCounts: [],
        maxRequiredAisleWidthInOverall: 0
    };
}
```

`buildTierAisleAnalysis()` returns the existing layout shell plus an expanded authoritative `sectionSummary`. Keep current top-level layout keys (`aisles`, `sectionBoundaries`, `forcedCount`, `axisExclusionFt`) for compatibility, but make `sectionSummary` the only truth source.

### Required `sectionSummary` additions
- `rowSummaries`: `[{ rowIndex, seatCount, sectionCount, maxContinuousSectionSeats }]`
- `tierSeatCount`
- `largestSectionOccupancy`
- `largestContinuousRowSeatCount`
- `maxRequiredAisleWidthIn`
- `maxGoverningAisleWidthIn`
- `minRenderedAisleWidthIn`
- `maxRenderedAisleWidthIn`
- `hasVariableRenderedAisleWidths`
- `renderedWidthSolveConverged`
- `renderedWidthSolveIterations`

### Required per-aisle fields
- `requiredWidthIn`
- `governingWidthIn`
- `renderedWidthIn`
- `renderedWidthFt`
- `tributaryOccupancy`
- `renderedWidthCompliant`

### Required per-section fields
- `rowSeatCounts`
- `occupancy`
- `frontRowSeats`
- `backRowSeats`
- `minSeatsPerRow`
- `maxSeatsPerRow`
- `avgSeatsPerRow`

## Core Implementation Design
Keep `buildTierAisleLayout()` in [core/aisle-layout.js](/C:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js) as the centerline-placement helper only. It should not become the authoritative summary API.

`buildTierAisleAnalysis()` should perform two nested solves:

1. Outer aisle-count solve
- Build initial centerlines with `buildTierAisleLayout(...)`.
- Use the existing deterministic placement strategy only. Do not introduce a new variable-width centerline optimizer in this refactor.
- Seed placement width with `maxAisleWidthIn / 12` so spacing and buffers are physically feasible at the legal maximum width.
- If the final section summary is not seat-cap or width-cap compliant, increment aisle count and rebuild centerlines.
- Stop at first compliant layout. If none is found within a sane cap, return the last layout with `converged: false` and fail tests accordingly.

2. Inner rendered-width solve
- For a fixed set of centerlines, iteratively solve per-aisle rendered widths from actual section occupancies.
- Section seat counts must be computed from actual adjacent aisle widths, not one common width.

Required seat-count formula:

```js
const usableGapFt = Math.max(
    0,
    centerGapFt - (leftRenderedWidthFt * 0.5) - (rightRenderedWidthFt * 0.5)
);
const seatCount = seatingLengthToSeatCount(usableGapFt, seatWidthIn);
```

Suggested inner loop:

```js
let renderedWidthsIn = new Array(layout.aisles.length).fill(minAisleWidthIn);
const seen = new Map();

for (let pass = 0; pass < 12; pass += 1) {
    const sections = measureSectionsFromRenderedWidths({ renderedWidthsIn, ... });
    const aisleLoads = computeAisleTributaryOccupancies({
        aisleCount: layout.aisles.length,
        sections
    });
    const nextWidthsIn = aisleLoads.map((tributaryOccupancy) =>
        computeAssignedAisleWidthIn({
            tributaryOccupancy,
            egressFactor,
            minAisleWidthIn,
            maxAisleWidthIn
        })
    );

    if (sameRoundedVector(nextWidthsIn, renderedWidthsIn)) break;
    if (seen.has(serializeRoundedVector(nextWidthsIn))) {
        renderedWidthsIn = widestVectorInCycle(seen, nextWidthsIn);
        break;
    }

    seen.set(serializeRoundedVector(renderedWidthsIn), renderedWidthsIn);
    renderedWidthsIn = nextWidthsIn;
}
```

Cycle handling is mandatory. If the width vector oscillates, choose the widest vector seen in the cycle, recompute once with that vector, and set `renderedWidthSolveConverged = false`. This keeps results deterministic and safe.

## Compatibility Layer Changes
### `core/profile-solver.js`
- Stop using `buildTierMetricsByIndex()` plus `reconcileTierMetricsByIndexWithLayoutSummaries()` as the runtime truth path.
- Add `buildTierMetricsByIndexFromLayouts({ tierLayouts, egressParams, solvers })`.
- This function is a pure adapter only. It must not recalculate egress truth; it only maps authoritative `sectionSummary` fields into the legacy metrics shape used by UI/tests.

Legacy field mapping:
- `capacity` = `summary.tierSeatCount`
- `numAisles` = `summary.actualAisles`
- `numSections` = `summary.actualSections`
- `backRowSeatsPerRow` = sum of `summary.backRowSectionSeatCounts`
- `occupantsPerSection` = `summary.largestSectionOccupancy`
- `occupantsPerAisleLine` = `max(summary.aisleOccupancyTotals)`
- `capacityWidth` = `summary.maxRequiredAisleWidthIn`
- `governingWidth` = `summary.maxGoverningAisleWidthIn`
- `renderedAisleWidth` = `summary.maxRenderedAisleWidthIn`
- `seatsPerBlock` = `summary.avgBackRowSeatsPerSection`
- `maxSeatsPerSectionRow` = `summary.maxBackRowSeatsPerSection`
- `renderedWidthCompliant` = `summary.compliance.renderedWidthCompliant`

Also stamp legacy per-row display fields from `rowSummaries` for compatibility:
- `row.computedSeats`
- `row.computedBlocks`

Do not let [ui/stats-view-model.js](/C:/Users/Elliott%20Klinger/Desktop/Repository/ui/stats-view-model.js) derive these.

### `viz/field-renderer.js`
- Keep `buildTierAisleLayouts(...)` method name for compatibility, but ignore `tierMetricsByIndex` as a source of truth.
- Delegate each tier to `buildTierAisleAnalysis(...)`.
- Render aisle bands only from `sectionSummary.aisles[i].renderedWidthFt`.
- Width labels must render `renderedWidthIn` directly from summary.
- Row seat labels must position themselves from the adjacent aisle’s `renderedWidthFt`, never from `tierLayout.aisleWidthFt`.

### `viz/scene3d.js`
- Use `sectionSummary.aisles[i].renderedWidthFt` for aisle mesh width and seat-preview blocked spans.
- No width fallback logic outside `sectionSummary`.

### `ui/render-runtime.js`
- Replace the current estimate-first flow with:
  1. build solvers
  2. build tier layouts via `fieldGeometryPort.buildTierAisleLayouts(...)`
  3. build legacy metrics from layouts via `buildTierMetricsByIndexFromLayouts(...)`
  4. build configuration totals via `buildConfigurationAisleSummary(...)`
- Remove runtime use of `reconcileTierMetricsByIndexWithLayoutSummaries()`.

### `ui/stats-view-model.js`
- Read total occupancy from `configurationSummary.totalOccupancyAllTiers`, not a UI-side reduce.
- Read row totals from authoritative row data or stamped row fields only.
- Do not infer section counts, aisle counts, or widths.

### `export/obj-csv-exporter.js`
- Export per-tier aggregate values from `sectionSummary`.
- Preserve existing scalar compatibility fields, but set them from authoritative maxima:
  - `renderedCommonWidthIn` = `maxRenderedAisleWidthIn`
- Add additive export fields:
  - `renderedWidthMinIn`
  - `renderedWidthMaxIn`
  - `renderedWidthVaries`
- Exporter must not decide whether widths vary by recomputing anything beyond reading summary data.

## Potential Implementation Challenges
- Convergence/oscillation: variable width affects seat counts, which affects occupancies, which affects width again. Use explicit cycle detection and deterministic widest-vector fallback.
- Mirrored `Sides` mode: keep calculation per physical side/aisle in `core`; only display combination happens in UI. Never combine before solving widths.
- Legacy scalar fields: some UI/export/tests expect one width. Preserve them as authoritative maxima while adding new min/max/range metadata.
- Placement truth vs optimization: this refactor preserves current deterministic centerline placement. It does not introduce a new optimizer that repositions aisles based on per-aisle widths.

## Test Plan And Acceptance Criteria
### Core tests
- Add tier-analysis tests in `tests/core/aisle-layout.test.js` that prove:
  - section row seat counts change when adjacent aisle widths differ
  - aisle tributary occupancies match section occupancies exactly
  - `tierSeatCount` equals the sum of all section row seat counts
  - `actualAisles`, `actualSections`, `largestSectionOccupancy`, and `largestContinuousRowSeatCount` match summary arrays
  - variable-width solve converges or reports non-convergence deterministically
  - outer aisle-count solve increases aisle count when width-cap compliance fails

### Renderer tests
- In `tests/viz/field-renderer.test.js`, assert:
  - plan-view aisle polygon width matches `renderedWidthFt`
  - width label text matches `renderedWidthIn`
  - row seat-count label offsets move when adjacent aisle width changes
- Extend 3D coverage so mesh/blocking width follows `renderedWidthFt`, not `tierLayout.aisleWidthFt`

### Runtime / UI / export tests
- In `tests/core/profile-solver.test.js`, assert legacy metric fields map exactly from `sectionSummary`
- In `tests/ui/stats-view-model.test.js`, assert total occupancy comes from configuration summary and matches tier totals exactly
- In `tests/export/obj-csv-exporter.test.js`, assert min/max/varies fields are exported and scalar compatibility fields equal the authoritative max

### Acceptance criteria
- All 11 user-listed truths come from `core` outputs only.
- No `viz/`, `ui/`, or `export/` code computes seat counts, occupancies, required widths, or governing widths.
- `ui/app.js` is unchanged.
- No new files.
- No reverse imports.
- `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` pass.
- Architecture audit passes:
  - no calls to `computeAssignedAisleWidthIn`, `computeRequiredAisleWidthIn`, `computeAisleTributaryOccupancies`, or `countSeatsFromCenterlineGapFt` outside `core/`
  - no UI-side reduction used as the authoritative total occupancy source

## Assumptions And Defaults
- Internal seed calculations inside `core` are allowed as solver initialization only; no intermediate estimate may escape `core` or be shown to users.
- `buildTierAisleLayout()` remains the centerline-placement strategy for this refactor.
- Legacy scalar width fields remain for compatibility and represent the authoritative maximum rendered width across aisles.
- No new files will be added; all work stays in existing `core`, `viz`, `ui`, and `export` modules.
