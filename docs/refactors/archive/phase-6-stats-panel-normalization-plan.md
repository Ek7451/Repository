# Phase 6 Stats Panel Normalization Plan

## Status

- Status: Planned
- Planned on: 2026-03-14
- Depends on: archived Phase 2 and archived Phase 3 completion

## Purpose

Phase 6 finishes the part of the roadmap that was only partially completed by the archived Phase 2 work.

The goal is to make the stats panel a true UI controller with a stable DTO contract so that:

- `ui/stats-panel.js` owns only stats DOM behavior and markup
- the editor controller assembles stats input once per update cycle
- metric calculations are no longer duplicated inside the stats renderer
- the stats path no longer depends on live DOM lookups or a full renderer object

## Architecture Verdict

The smallest compliant move is:

- keep the stats module in `ui/`
- convert `renderStatsPanel()` into a `StatsPanel` controller
- instantiate that controller once
- move view-model assembly into the editor controller
- pass a single explicit stats DTO into `statsPanel.update()`

This phase must not:

- move sightline, profile, or aisle math out of the protected `core/` modules
- reintroduce DOM-as-state
- let the stats panel import from `app.js`, `services/`, or `export/`
- create a stats-specific cache or second state object

## Current Gap Review

What exists now:

- `ui/stats-panel.js` contains the extracted stats markup and most stats behavior
- `app.js` calls `_updateStats()` after each solve cycle

What remains misaligned:

- `ui/stats-panel.js` exports a function, not a controller object
- `app.js` still passes `statsEl`, `detailsEl`, and `fieldRenderer` into that function each update
- `ui/stats-panel.js` still calls `ProfileSolver.calculateTierMetrics()` internally
- tier metrics are calculated more than once inside the stats module

## Structure Guardian Verdict

Compliance verdict: partial compliance today, full compliance after a single-file normalization.

Correct destination:

- `ui/stats-panel.js`

Required boundary after Phase 6:

- editor controller owns stats data assembly
- `StatsPanel` owns DOM containers, detail-section state preservation, and markup updates

## Import Boundary Audit

Forbidden imports found now:

- none

Boundary cleanup still required:

- the stats module should not depend on `fieldRenderer` as a hidden collaborator
- the stats module should not be responsible for deciding when to call protected calculation helpers

Smallest compliant rewrite:

- the editor controller computes the stats view-model
- `StatsPanel.update(viewModel)` renders that model

## Scope Lock

In scope:

- convert the stats module from free function to controller
- move stats DTO assembly into the editor controller
- compute tier metrics once per update cycle and reuse them
- keep current rendered content and warnings unless a bug forces a small correction

Out of scope:

- moving the editor controller into `ui/app.js`
- export cleanup
- dashboard/auth/backend work
- markup or styling redesign unrelated to the stats contract

## Proposed Stats Contract

Preferred end-state interface:

```js
const statsPanel = new StatsPanel({
  statsEl: document.getElementById('statsContent'),
  detailsEl: document.getElementById('detailsContent')
});

statsPanel.update({
  summary: {
    totalOccupancy,
    cValueDistribution,
    averageCValue
  },
  tiers: [
    {
      tierIndex: 0,
      title: 'Tier 1',
      metrics,
      rows,
      warnings
    }
  ],
  disclaimers: [...],
  uiState: {
    openDetailSections
  }
});
```

Contract rules:

- `StatsPanel` may own DOM references and open/collapsed section state only
- the DTO must be plain data only
- `StatsPanel` must not call `document.getElementById()` during update
- `StatsPanel` must not call `ProfileSolver.calculateTierMetrics()` or derive aisle metrics internally once this phase is complete

## Responsibility Map After Phase 6

Editor controller responsibilities:

- gather solver output
- compute sightline summary
- compute tier metrics once
- assemble the stats DTO
- call `statsPanel.update(dto)`

`ui/stats-panel.js` responsibilities:

- preserve open/collapsed result-section state
- generate summary markup
- generate detail markup
- write only to its owned container elements

## Extraction Sequence

1. Freeze the current stats output and interaction behavior as the baseline.
2. Convert `ui/stats-panel.js` into a `StatsPanel` class in the same file.
3. Move DOM container ownership into the constructor.
4. Add a plain stats DTO shape in the editor controller.
5. Compute per-tier metrics once in the editor controller and remove duplicate stats-side calculations.
6. Replace `_updateStats()` with a thin `this.statsPanel.update(dto)` call.
7. Remove obsolete function-style plumbing.

## Circular Import Risks

Avoid:

- `ui/stats-panel.js` importing the editor controller
- new helper files importing back into `ui/stats-panel.js`
- moving calculation helpers into `ui/` just to support the panel

Intended dependency direction:

- editor controller -> `ui/stats-panel.js`
- editor controller -> protected calculation modules

## Known Risks

- If the DTO is under-specified, the implementation may be tempted to keep `fieldRenderer` or `getInputValue` style callbacks in the stats path. Reject that.
- If the editor controller computes metrics multiple times for stats and export separately, the duplication risk merely moves files. Prefer one per-update-cycle assembly path.
- Preserve the current expand/collapse behavior for tier detail sections during rerenders.

## Definition Of Done

Phase 6 is complete when all of the following are true:

- `ui/stats-panel.js` exports a controller object rather than only a render function
- the stats module owns its container references
- the stats module consumes a plain DTO
- the stats module no longer receives a live `fieldRenderer` object as a hidden dependency
- tier metrics are computed once and reused across the panel
- no duplicate AppState or stats cache is introduced

## Verification Gate

Required checks:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm `ui/stats-panel.js` imports no `app.js`, `services/`, or `export/`
- confirm the stats module does not read live form values
- confirm the stats module writes only to its owned container elements

Required manual checks:

- compare total occupancy, average C, and quality distribution before and after the refactor
- verify expand/collapse state survives an update
- verify one-tier, multi-tier, mirrored-side, and aisle-layout-populated cases
- verify warning banners still appear where expected

## Non-Goals

Do not combine this phase with:

- moving the editor controller into `ui/app.js`
- residual export extraction
- auth/project stack hardening
- page-shell HTML restructuring
