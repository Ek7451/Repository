# Phase 2 Stats Panel Extraction Plan

## Purpose

Phase 2 covers stats-panel extraction only. The goal is to finish separating statistics summary, egress cards, and tier detail rendering from `app.js` without touching solver math, introducing AppState early, or restructuring pages before Phase 3.

This plan is based on:

- `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- `docs/refactors/archive/phase-1-export-extraction-plan.md`
- the current stats seam in `app.js`
- the current extracted implementation in `ui/stats-panel.js`
- the repo guardrails in `AGENTS.md`

## Architecture Verdict

The smallest compliant Phase 2 move is:

- keep all stats UI rendering in `ui/stats-panel.js`
- keep `app.js` as solve-cycle owner and DOM reader until Phase 3 introduces AppState
- convert the current function-based handoff into a narrow `StatsPanel` controller in the existing file, or an equivalently thin module API, without adding more than one helper file
- replace live getter callbacks with explicit arguments assembled in `app.js`
- keep sightline, occupancy, and egress math anchored to the existing protected modules

This phase must not:

- create `state/` or AppState
- move or rewrite logic from `profile-solver.js`, `sightline-calc.js`, `aisle-layout.js`, `sports-templates.js`, or `default-starting-profile.js`
- let `ui/stats-panel.js` read from live form controls or unrelated DOM nodes
- import from `scene3d.js`, `export/`, `services/`, or `app.js`
- introduce a second state cache or stats-specific snapshot

## Current State Review

The roadmap's Phase 2 intent is already partially implemented:

- `app.js` imports `renderStatsPanel` and calls `_updateStats()` after each solve cycle
- `ui/stats-panel.js` already owns most of the stats markup generation
- `app.js` is now `2244` lines and `ui/stats-panel.js` is `510` lines, so the extraction has started but is not yet fully normalized

Current remaining coupling:

- `app.js` still owns `_updateStats()` and assembles DOM-backed callbacks
- `ui/stats-panel.js` depends on `getInputValue`, `getEgressParams`, `getBowlConfig`, `fieldRenderer`, `tierAisleLayouts`, and `sportName`
- per-tier metrics are computed twice inside the module, increasing drift risk
- panel container lookup still happens in `app.js` on each update instead of being owned by a panel object

## Structure Guardian Verdict

Compliance verdict: partial compliance.

- `ui/stats-panel.js` is in the correct layer. Stats summary and tier-detail rendering belong in `ui/`.
- `app.js` still has a thin but unnecessary stats-controller seam.
- No move into `core/`, `viz/`, or `export/` is justified for this phase.
- The main risk is hidden coupling through callbacks and renderer objects, not file placement.

Recommended smallest move:

- keep the stats module in `ui/`
- slim `app.js` to panel instantiation plus data handoff
- pass a narrow row-length adapter rather than a full renderer object when possible

## Import Boundary Audit

Forbidden imports found now:

- none in the current Phase 2 path

Boundary concerns that still need cleanup:

- `ui/stats-panel.js` imports calculation helpers from the current root modules. That is acceptable for this phase because those modules are acting as today's calculation layer.
- The more important boundary issue is hidden reads: `renderStatsPanel()` receives live getters backed by DOM state.

Smallest compliant rewrite:

- `app.js` reads live DOM values
- `app.js` builds a plain stats DTO
- `StatsPanel.update(dto)` consumes plain values plus a narrow adapter for row-length calculations

## Scope Lock

In scope:

- finish extracting stats summary, egress analysis, and tier row-detail rendering out of `app.js`
- align the stats module API with the roadmap and repo guardrails
- preserve current HTML, warnings, collapse-state behavior, and displayed metrics
- remove repeated tier-metric calculation inside the stats module if possible without changing formulas

Out of scope:

- AppState or DOM-to-state migration
- camera bookmarks
- export pipeline changes
- page shell or folder migration beyond this file boundary
- solver, sightline, aisle, or sports template rewrites
- service, auth, dashboard, or persistence work

## Current Responsibility Map

Current stats responsibilities are split across two files:

- `app.js`
  - import seam: line `13`
  - update-cycle trigger: line `1219`
  - stats wrapper: lines `1296-1307`
  - supporting DOM readers that stats depends on today:
    - `_getEgressParams()`: lines `1286-1294`
    - `_getBowlConfig()`: line `2125+`
- `ui/stats-panel.js`
  - row aggregation and C-value analysis: lines `19-97`
  - egress inputs and closed-loop reconciliation: lines `98-189`
  - chart model and summary legend markup: lines `191-298`
  - per-tier row-details markup: lines `299-366`
  - summary and egress card rendering: lines `367-550`

Phase 2 is successful when `app.js` no longer owns a bespoke stats wrapper that passes live getter callbacks into the stats module.

## Proposed File Split Map

Default plan: no new JavaScript files.

Current app-level JavaScript file count, excluding `lib/`, `tests/`, and `scripts/`, is `16`. Phase 2 should keep the app near `16-17` files.

Keep:

- `ui/stats-panel.js`

Touch:

- `app.js`

Optional only if the file becomes unstable during implementation:

- add one helper file under `ui/` for stats view-model or markup concerns, but only if it is clearly reused and keeps the codebase within the repo's file-count target

Responsibility map after Phase 2:

- `app.js`
  - owns solve timing
  - owns DOM reads until AppState exists
  - owns creation of `StatsPanel`
  - passes explicit values and adapters into `statsPanel.update()`
- `ui/stats-panel.js`
  - owns DOM container refs
  - owns view-model assembly for sightline, occupancy, egress, and row-detail sections
  - owns HTML generation and collapse-state preservation
  - may call existing calculation helpers, but must not reimplement them

## Proposed Stats Panel Contract

Recommended interface:

```js
const statsPanel = new StatsPanel({
  summaryEl: document.getElementById('statsContent'),
  detailsEl: document.getElementById('detailsContent')
});

statsPanel.update({
  solvers,
  sportName,
  focalPointFt: { x: focalX, z: focalZ },
  bowlConfig,
  egressParams,
  tierAisleLayouts,
  rowLengthAdapter: {
    calculateRowLength: (config, offset) =>
      this.fieldRenderer.calculateRowLength(config, offset)
  }
});
```

Notes:

- The panel object may store DOM elements only. It must not cache a second copy of application parameters.
- `bowlConfig`, `egressParams`, and `focalPointFt` should be plain objects.
- If `ProfileSolver.calculateTierMetrics()` still expects a renderer-shaped object, pass the narrowest adapter that satisfies that contract.
- Keep `SightlineAnalyzer`, `ProfileSolver.calculateTierMetrics()`, and `getCValueQuality()` as the only metric authorities.

## Internal Split Inside `ui/stats-panel.js`

Keep helpers local to the file unless reuse proves otherwise.

Suggested internal grouping:

- `collectOpenTierState()`
- `buildSightlineSummaryModel()`
- `buildTierMetricsModel()`
- `renderSummaryMarkup()`
- `renderDetailsMarkup()`

Important guardrail:

- compute per-tier metrics once and reuse them for occupancy bars, egress cards, and warnings
- do not duplicate `calculateTierMetrics()` math in UI code

## Extraction Sequence

1. Freeze the current rendered behavior as the baseline for manual comparison.
2. Convert `ui/stats-panel.js` from a free function to a `StatsPanel` controller in the same file, keeping markup output unchanged.
3. Instantiate `StatsPanel` once in `app.js` during `init()` or construction after DOM availability.
4. Replace `_updateStats()` callback handoff with a plain DTO assembled from existing app helpers.
5. Narrow the `fieldRenderer` dependency to a row-length adapter if the protected `ProfileSolver.calculateTierMetrics()` contract allows it.
6. Consolidate duplicated per-tier metric calculation inside `ui/stats-panel.js`.
7. Remove obsolete wrapper code from `app.js` once the new panel contract is stable.

Reason for this order:

- it preserves the current UI first
- it avoids mixing AppState work into Phase 2
- it reduces hidden coupling before any later directory or state migration

## Circular Import Risks

Avoid these failure modes:

- `ui/stats-panel.js` importing `app.js`
- `ui/stats-panel.js` importing `scene3d.js`
- `ui/stats-panel.js` importing anything from `export/`
- any new helper file importing back into `app.js`

The intended dependency direction is:

- `app.js -> ui/stats-panel.js`
- `ui/stats-panel.js -> protected calculation modules only`

## Known Risks And Guardrails

- `ProfileSolver.calculateTierMetrics()` is protected. Do not copy or rewrite its math just to make the panel look more self-contained.
- `SightlineAnalyzer` remains the source of truth for quality distribution and averages.
- Preserve current single-row tier behavior and current first-row exclusions unless the user separately approves a behavior change.
- Preserve open and closed state for `.results-details` sections across rerenders.
- Preserve mirrored-sides display rules and closed-loop aisle reconciliation.
- Because AppState does not exist yet, `app.js` may still read the DOM in this phase. The stats panel may not.
- Do not let the Phase 2 extraction become a second monolith in `ui/`; keep helpers in one file, but grouped by responsibility.

## Definition Of Done

Phase 2 is complete when all of the following are true:

- `app.js` no longer passes DOM getter callbacks into the stats module
- `ui/stats-panel.js` owns the stats container references and update entry point
- stats markup lives entirely outside `app.js`
- no solver math, sightline math, or aisle math is duplicated outside the existing protected modules
- no new parallel state cache or snapshot is introduced
- no forbidden imports are added
- the implementation uses zero or one new JavaScript file at most

Expected implementation impact:

- new JavaScript files: `0` preferred, `1` maximum
- touched existing JavaScript files: `2` preferred (`app.js`, `ui/stats-panel.js`)

## Verification Gate

Required automated checks for the implementation turn:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm `ui/stats-panel.js` does not call `document.getElementById()` or read live form values
- confirm the stats module does not import `app.js`, `scene3d.js`, `export/`, or `services/`
- confirm no duplicate AppState or stats-specific cache was introduced
- confirm the stats module only writes to its owned container elements

Required manual checks:

- compare total occupancy, C-value distribution, average C, and egress widths before and after the refactor
- verify expand and collapse state for tier details survives an update
- verify one-tier, two-tier, and three-tier cases
- verify mirrored sides mode displays combined counts correctly
- verify a closed-loop aisle layout still reconciles section and aisle counts correctly
- verify warning banners still appear for forced max aisle width and non-converged layouts

Suggested manual matrix:

- Football, one tier
- Basketball or soccer with mirrored sides
- Baseball or softball with center offset correction
- multi-tier bowl with aisle layouts populated
- edge case with a tier containing a single row

## Phase 2 Non-Goals Reminder

Do not combine this phase with:

- AppState introduction
- camera bookmark extraction
- export cleanup beyond the already-extracted modules
- page shell or route work
- dashboard, auth, API, or persistence features
