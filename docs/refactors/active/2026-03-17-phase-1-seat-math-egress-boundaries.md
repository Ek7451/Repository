# Phase 1 — Seat Math / Egress Boundary Definition

## Goal
Define the canonical ownership split before code moves begin.

## In Scope
- Confirm the current authority split across `core/profile-solver.js`, `core/aisle-layout.js`, `viz/field-renderer.js`, `viz/scene3d.js`, `ui/render-runtime.js`, and `ui/stats-panel.js`.
- Lock the intended module ownership for:
  - deterministic seat math
  - egress/code-policy logic
  - canonical tier metrics DTO assembly
  - geometry-derived aisle and section layout
  - render-only consumers
- Preserve the rule that `core/profile-solver.js` remains the canonical owner of the tier metrics DTO used by app UI.
- Preserve the rule that JSON/CSV export is a deferred consumer and not the source of truth for this refactor.
- Justify the two allowed new files:
  - `core/seat-math.js`
  - `core/egress-policy.js`

## Explicit Ownership Definition

### Canonical owners after the split
- `core/seat-math.js`
  - deterministic seat formulas only
  - no geometry ownership
  - no UI ownership
  - no policy decisions
- `core/egress-policy.js`
  - policy and code-rule decisions only
  - no aisle geometry generation
  - no renderer ownership
- `core/profile-solver.js`
  - canonical tier metrics DTO assembly
  - row mutation and published tier metrics
  - reconciliation of solver metrics with actual layout summaries
- `core/aisle-layout.js`
  - actual aisle geometry and section boundary definition
  - geometry inputs to policy checks
  - no private seat formulas
  - no direct egress-policy loops embedded inline once extraction is complete
- `viz/field-renderer.js`
  - rendering, overlay placement, section numbering, label anchors
  - may assemble overlay DTOs for rendering
  - must not remain the canonical metrics reconciler
- `viz/scene3d.js`
  - visual seat preview placement only
- `ui/stats-panel.js`
  - render-only consumer of already reconciled metrics

## Current State Audit
- `ProfileSolver.calculateTierMetrics` is the current authoritative source for:
  - per-tier occupancy: `capacity`
  - row-level displayed seat counts: `row.computedSeats` and `row.computedSeatsPerSide`
  - solver-estimated aisle count/width: `numAisles`, `aisleWidth`, `numSections`, `occupantsPerSection`, `occupantsPerAisleLine`
- `buildStatsViewModel` in `ui/stats-panel.js` is the current visible all-tier total source in app UI.
- `ui/render-runtime.js` currently builds solver metrics first, then actual aisle layouts, then passes both into stats/UI.
- `core/aisle-layout.js` currently mixes:
  - geometry/layout ownership
  - seat-cap validation math
  - seat-limit policy loops
- `viz/field-renderer.js` currently mixes:
  - correct viz ownership
  - non-canonical occupancy and section seat recomputation
- `viz/scene3d.js` contains another seat-count formula for preview instancing.

## Ownership Trace
| Value | Raw math owner today | Canonical UI owner today | Renderer consumer today | Boundary verdict |
|---|---|---|---|---|
| Aisle width labels | `ProfileSolver.calculateTierMetrics` | tier metrics DTO from `profile-solver` | field renderer consumes width to build layout | keep canonical in `profile-solver` |
| Per-row seat counts | `ProfileSolver`; `field-renderer` for per-section labels | row table uses `row.computedSeats` | field renderer draws labels | split authority must be reduced |
| Per-tier occupancy | `ProfileSolver.capacity` | tier metrics DTO from `profile-solver` | stats panel consumes | keep canonical in `profile-solver` |
| All-tier total occupancy | `buildStatsViewModel` sum of tier capacities | stats summary DTO sourced from solver capacities | none | keep as consumer-only aggregation |
| Per-section occupancy labels | `field-renderer.getTierSectionMetricsOverlayData` | none | field renderer and plan export consume | still non-canonical after this phase |

## Section Label Verdict
- Field-plan section occupancy labels are true occupancies for drawn aisle-defined sections.
- `stats-panel` `occupantsPerSection` is not a true per-section output today.
- This refactor does **not** create a canonical section-metrics DTO.
- Section occupancy remains a known architecture gap after this phase set.

## Approved New File Justification

### `core/seat-math.js`
- Logic moved:
  - shared seat-count formulas duplicated in `profile-solver`, `aisle-layout`, `field-renderer`, and `scene3d`
- Existing destinations considered and rejected:
  - `core/profile-solver.js`: solver-centric, wrong shared owner for layout/render consumers
  - `core/aisle-layout.js`: geometry-centric and would force solver dependence on layout ownership
  - `viz/field-renderer.js`: would violate `core` to `viz` layering for solver consumers
- Single responsibility:
  - canonical seat-count math only

### `core/egress-policy.js`
- Logic moved:
  - block/aisle/width policy
  - seat-limit compliance rules
  - future circulation constraints
- Existing destinations considered and rejected:
  - `core/profile-solver.js`: solver-specific, but layout also needs the same policy
  - `core/aisle-layout.js`: keeps policy mixed into geometry ownership
  - `ui/stats-panel.js`: wrong layer and already non-compliant as a metrics reshaper
- Single responsibility:
  - code/policy decisions only

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

## Out of Scope
- JSON/CSV exporter canonicalization
- UI wording cleanup
- creation of a canonical section-metrics DTO
- changes to sightline, template, or default-starting-profile ownership

## Phase Exit Criteria
- Ownership boundaries are explicit and stable.
- The allowed new files are justified without introducing a third ownership module.
- Canonical tier metrics ownership remains in `core/profile-solver.js`.
- No code implementation step in later phases requires changing the boundary decisions above.