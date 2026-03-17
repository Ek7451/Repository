## 1. Executive recommendation

Rewrite the aisle policy layer inside [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), not the low-level geometry layer.

Keep as-is:
- `buildGeometryPaths(...)`, `samplePathPointByRatio(...)`, `sampleAisleBand(...)`, and the underlying line/arc sampling helpers in [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js).
- `ProfileSolver.calculateTierMetrics(...)` and `buildTierMetricsByIndex(...)` in [core/profile-solver.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/profile-solver.js) as the source of requested aisle count and width.
- The public entrypoint `buildTierAisleLayout(...)`; keep the export, replace its internals with a deterministic pipeline.
- Existing renderer consumers in [viz/field-renderer.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/field-renderer.js) and [viz/scene3d.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/scene3d.js) if the aisle payload remains backward-compatible.

Replace:
- `computeAisleStations(...)`
- `buildChamferSymmetricStations(...)`
- The heuristic scoring/allocation helpers that feed them
- The hard-coded mixed-mode logic inside `resolveAisleStationRatios(...)`

Observed cause of overcrowding:
- The base egress count loop in [core/profile-solver.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/profile-solver.js) is not the main problem.
- The policy layer in [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js) inflates final count and distributes extras unpredictably. Live audit examples:
- `Full` chamfer bowl returns 8 aisles even when `targetAisles` is 0, 2, 4, 6, or 8.
- `U-End1` currently forces 3 aisles because endpoint chamfer transitions are missed.

## 2. Current architecture audit

| File | Role in aisle behavior | Key functions / flow | Audit verdict |
| --- | --- | --- | --- |
| [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js) | Core aisle placement, path sampling, station resolution | `buildGeometryPaths`, `resolveAisleStationRatios`, `buildTierAisleLayout`, heuristic allocators | Keep geometry/sampling; rewrite allocation and mode resolution |
| [core/profile-solver.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/profile-solver.js) | Computes requested aisle count/width from egress | `ProfileSolver.calculateTierMetrics`, `buildTierMetricsByIndex` | Keep as aisle-count source |
| [viz/field-renderer.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/field-renderer.js) | Builds bowl geometry commands, calls core layout, summarizes sections, draws 2D aisles | `_getBowlGeometry`, `buildTierAisleLayouts`, `generateTierAisleLayout`, `_summarizeTierLayoutSections`, `_drawTierAisles` | Geometry grammar is stable; consumer contract should stay stable |
| [viz/scene3d.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/scene3d.js) | Builds parallel bowl geometry commands, draws 3D aisle meshes and seat blocking | `_getBowlGeometrySegments`, `_createTierAisleGeometry`, `_createTierSeatPreviewMesh` | Keep; rely on updated resolver |
| [state/app-state.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/app-state.js) | Canonical state, normalization, bowl DTO creation | `createDefaultStateData`, `normalizeAppState`, `buildBowlConfig` | Add new bowl config fields here |
| [ui/render-runtime.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/render-runtime.js) | Orchestrates state -> metrics -> tier layouts -> render snapshot | `recompute` | No structural change planned |
| [ui/editor-controls.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-controls.js) | Left-panel DOM wiring to AppState | `SELECT_STATE_PATHS`, `syncFromState`, `_wireEvents` | Add dropdown wiring here |
| [pages/configurator/index.html](c:/Users/Elliott%20Klinger/Desktop/Repository/pages/configurator/index.html) | Actual left-panel controls | Bowl Configuration section | Add two new selects here |
| [core/default-starting-profile.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/default-starting-profile.js) | Startup defaults | `DEFAULT_STARTUP_PROFILE` | Add default aisle mode fields |
| [state/project.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) | Save/load/project normalization | `normalizeAppStateSnapshot` via AppState | No direct edit expected; new fields flow automatically |
| [ui/editor-export-controller.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-export-controller.js) | Export-time runtime artifacts | `_buildTierRuntimeArtifacts` | Verify only; keep payload compatibility |
| [export/obj-csv-exporter.js](c:/Users/Elliott%20Klinger/Desktop/Repository/export/obj-csv-exporter.js) | Consumes `tierLayout.sectionSummary` and aisle counts | `buildTierStudyRecord` | Verify only; no planned edit |

### Responsibility map inside `core/aisle-layout.js`

| Function group | Functions | Keep / replace | Why |
| --- | --- | --- | --- |
| Path construction and sampling | `buildGeometryPaths`, `samplePathPoint`, `samplePathPointByRatio`, `sampleAisleBand` | Keep | Pure, deterministic, already shared by 2D/3D |
| Generic math | `clamp01`, `normalizeUnit`, arc/line tangent helpers | Keep | Low-risk utility layer |
| Segment / transition classification | `classifyAxisDirection`, `buildChamferIntervals`, parts of `findChamferCornerAnchors` | Mine and refactor | Useful, but current anchor finder misses open-end terminal transitions |
| Heuristic allocation | `computeAisleStations`, `candidateScore`, `betterSingle`, `betterPair`, `intervalPressure`, `pairAllocationBenefit`, `singleAllocationBenefit`, `buildChamferSymmetricStations` | Replace | This is the unpredictable policy layer |
| Station resolution | `resolveAisleStationRatios` | Rewrite | It hardcodes one mixed behavior and cannot cleanly support both radial and perpendicular modes |
| Layout assembly | `buildSectionBoundaries`, `buildTierAisleLayout` | Keep shell, replace policy internals | Stable consumer contract, wrong internal strategy |

### Geometry representation audit

Observed command grammar from both renderers:
- `moveTo`, `lineTo`, `arc`, `closePath`
- `buildGeometryPaths(...)` turns those into stable `path.parts` records with `type`, `length`, `startDist`, and line/arc geometry.

Observed supported rectangular bowl families:
- `Full`: 1 closed path, 8 alternating axis/diagonal line parts when `corner === 'Chamfer'`
- `Sides`: 2 open straight paths
- `Side1`: 1 open straight path
- `U-End1`: 1 open path with 5 parts: straight, chamfer, straight, chamfer, straight
- `U-End2`: 1 open path with 5 parts: straight, chamfer, straight, chamfer, straight

Mandatory chamfer/straight transition counts for the new solver:
- `Full` chamfer: 8
- `U-End1` chamfer: 4
- `U-End2` chamfer: 4
- `Sides` / `Side1` / `Side2`: 0

Current code mismatch:
- `findChamferCornerAnchors(...)` only forces 3 on `U-End1/U-End2` because open-path endpoint transitions are excluded.

Baseline verification observed before planning:
- `npm test`: pass
- `npm run typecheck`: pass
- `npm run build`: pass
- `npm run lint`: pass with 12 pre-existing warnings in [viz/field-renderer.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/field-renderer.js), [viz/profile-renderer.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/profile-renderer.js), and [viz/scene3d.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/scene3d.js)

## 3. Rule translation

### Hard rules
- `ProfileSolver.calculateTierMetrics(...)` remains the source of requested aisle count and aisle width.
- Final placed aisle count may exceed the solver request only for:
- Mandatory chamfer/straight transitions
- Hard max-seats-between-aisles compliance
- Full symmetric closed bowls must stay symmetric until a single unavoidable odd remainder exists.
- A single odd remainder aisle goes on the longest straight segment.
- If opposite longest straights tie, use the top / positive-Y straight.
- Every chamfer/straight junction is mandatory:
- `Full`: 8
- `U-End1`: 4
- `U-End2`: 4
- Maximum seats between aisles is enforced against the governing back-row/perimeter interval and may add aisles.
- Aisle additions/removals re-space the whole affected segment family evenly from scratch.
- Straight and chamfer distributed aisles each use their own alignment mode:
- `radial`
- `perpendicular`

### Soft preferences
- Avoid centerline placement when another equally valid even-spacing solution exists.
- Prefer discretionary extra aisles on straight segments before placing interior aisles inside chamfer segments.
- Preserve existing low-level geometry sampling utilities instead of replacing them.

### Deterministic tie-breakers
- Hard seat-cap minimum beats symmetry preference.
- Symmetry beats centerline avoidance.
- Straight segments beat chamfer segments for discretionary extras.
- Longer back-path interval beats shorter interval.
- If interval lengths tie inside the same family, use stable perimeter order.
- If the final remaining choice is the tied opposite longest straight pair, use the top / positive-Y member.

## 4. Proposed target design

Keep one solver framework in [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), with bowl-family adaptation driven by a perimeter model rather than separate unrelated solvers.

### Target pipeline
1. Build front and back `paths` with `buildGeometryPaths(...)`.
2. Build a perimeter model from the actual path parts:
- path closure
- interval family: `straight`, `chamfer`, `arc`, `open-linear`
- front/back interval lengths
- stable segment index
- symmetry partner key
- transition anchors
3. Seed mandatory transition aisles.
4. Compute minimum added aisles required by max-seats-between-aisles using back-path interval lengths.
5. Allocate remaining discretionary aisles deterministically:
- pair opposite straights first
- use chamfer interiors only when required
- allow exactly one odd remainder on the longest straight
6. Materialize aisle records with stable metadata for rendering:
- `pathIndex`
- `forced`
- `anchorType`
- `segmentIndex`
- `segmentT`
- `alignmentMode`
- existing `cornerOrdinal` retained as the mandatory transition ordinal to avoid consumer churn
7. Resolve row-by-row front/back stations in `resolveAisleStationRatios(...)`:
- transition aisles stay pinned by ordinal
- radial uses shared segment fraction
- perpendicular projects along the local segment normal to the counterpart segment
8. Reuse `buildSectionBoundaries(...)` and downstream section-summary/render/export surfaces unchanged.

### Bowl-family adaptation
- `Full` chamfer: closed path, full symmetry groups, 8 mandatory transitions, opposite straight pairing, chamfer ring only if hard requirements force chamfer interiors.
- `U-End1` / `U-End2` chamfer: open path, 4 mandatory transitions including the terminal open-end junction, top/bottom symmetry only where geometry mirrors.
- `Sides` / `Side1` / `Side2`: no chamfer logic; continue even straight-only spacing.
- Arc bowls: keep existing non-chamfer distribution path; no mandatory chamfer transitions.

### Why the current resolver must change
- `resolveAisleStationRatios(...)` currently unconditionally preserves world X/Y on non-corner aisles for straight edges.
- That hardcodes one behavior and prevents clean coexistence of both `radial` and `perpendicular`.
- The new resolver should stay in the same file and public slot, but dispatch explicitly by `alignmentMode`.

## 5. Exact implementation plan

### Phase 1: Characterize the current geometry seam
- Goal: Lock the reusable geometry/path behavior before changing policy.
- Files touched: planned new [tests/core/aisle-layout.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/aisle-layout.test.js).
- Exact functions to edit: none in production.
- Exact functions to create: test helpers for rectangular bowl geometry setup and tier-layout assertions.
- Exact functions to delete or deprecate: none.
- Why here: prevents accidental geometry regressions while the policy layer is replaced.
- Risk level: low.
- Rollback: remove the test file only; no runtime impact.

### Phase 2: Add backward-compatible state and UI plumbing
- Goal: Introduce the two arrangement controls and carry them through canonical state without changing behavior yet.
- Files touched: [state/app-state.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/app-state.js), [core/default-starting-profile.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/default-starting-profile.js), [pages/configurator/index.html](c:/Users/Elliott%20Klinger/Desktop/Repository/pages/configurator/index.html), [ui/editor-controls.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-controls.js), [tests/state/app-state.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/state/app-state.test.js), [tests/ui/editor-controls.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/editor-controls.test.js), [tests/ui/render-runtime.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/render-runtime.test.js), [tests/ui/seating-bowl-app-runtime.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/seating-bowl-app-runtime.test.js).
- Exact functions to edit: `createDefaultStateData`, `normalizeAppState`, `buildBowlConfig`, `syncFromState`, `_wireEvents`.
- Exact functions to create: `normalizeAisleMode(...)`.
- Exact functions to delete or deprecate: none.
- Why here: this is low-risk, fully backward-compatible, and gives the core solver an explicit config contract.
- Risk level: low.
- Rollback: revert state fields and dropdowns; core logic remains untouched.

### Phase 3: Build the deterministic perimeter model and mode-aware station resolver
- Goal: Replace ad hoc path interpretation with an explicit interval/transition model and split radial vs perpendicular resolution.
- Files touched: [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), [tests/core/aisle-layout.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/aisle-layout.test.js).
- Exact functions to edit: `resolveAisleStationRatios`.
- Exact functions to create: `buildPerimeterModel(...)`, `findTransitionAnchors(...)`, `buildSymmetryGroups(...)`, `resolveRadialStationRatios(...)`, `resolvePerpendicularStationRatios(...)`, `projectNormalToCounterpartSegment(...)`.
- Exact functions to delete or deprecate: direct use of `findChamferCornerAnchors(...)`; keep only as an internal wrapper if needed during migration.
- Why here: the allocator should not be rewritten until the model and resolver seams are explicit.
- Risk level: medium.
- Rollback: keep the old `buildTierAisleLayout(...)` path temporarily while the new model/resolver are dark.

### Phase 4: Replace the allocation policy
- Goal: Remove heuristic scoring and install a deterministic rule engine.
- Files touched: [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), [tests/core/aisle-layout.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/aisle-layout.test.js), [tests/viz/field-renderer.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/viz/field-renderer.test.js).
- Exact functions to edit: `buildTierAisleLayout`.
- Exact functions to create: `computeRequiredSegmentCounts(...)`, `allocateAislesDeterministically(...)`, `materializeAisleRecords(...)`, `validateSeatCap(...)`.
- Exact functions to delete or deprecate: `computeAisleStations(...)`, `buildChamferSymmetricStations(...)`, `candidateScore(...)`, `betterSingle(...)`, `betterPair(...)`, `intervalPressure(...)`, `spacingVariance(...)`, `pairAllocationBenefit(...)`, `singleAllocationBenefit(...)`, and the gap-scoring helpers only used by the heuristic path.
- Why here: this is the behavior-changing phase and should happen only after state and topology seams are stable.
- Risk level: high.
- Rollback: restore the old allocator body inside `buildTierAisleLayout(...)` while keeping the new tests and model helpers.

### Phase 5: Verify downstream compatibility surfaces
- Goal: Confirm render, stats, and export consumers still work with the new aisle records and section boundaries.
- Files touched: planned test-only updates in [tests/ui/render-runtime.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/render-runtime.test.js), [tests/ui/seating-bowl-app-runtime.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/seating-bowl-app-runtime.test.js), and, only if required by failing assertions, small compatibility edits in [viz/field-renderer.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/field-renderer.js).
- Exact functions to edit: only if needed, `generateTierAisleLayout(...)`.
- Exact functions to create: none planned.
- Exact functions to delete or deprecate: none planned.
- Why here: consumer changes should be minimal because the public entrypoint stays stable.
- Risk level: medium.
- Rollback: revert any compatibility-only changes; keep the core allocator swap isolated.

### Phase 6: Full verification and manual QA
- Goal: Prove the refactor changed aisle policy only, not unrelated behavior.
- Files touched: none unless defects are found.
- Exact functions to edit/create/delete: none planned.
- Why here: final gate after behavior changes.
- Risk level: low.
- Rollback: revert Phase 4 first, then Phase 3 if the issue is in mode resolution.

## 6. Exact edits by file

- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), keep `buildGeometryPaths(...)`, `samplePathPointByRatio(...)`, `sampleAisleBand(...)`, and `buildSectionBoundaries(...)` unchanged.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), replace `computeAisleStations(...)` and `buildChamferSymmetricStations(...)` with a single deterministic allocator driven by a perimeter model.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), replace `findChamferCornerAnchors(...)` usage with endpoint-aware transition detection so `U-End1/U-End2` count 4 mandatory transitions.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), keep `cornerOrdinal` on runtime aisle records but redefine it in comments as the stable transition ordinal.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), rewrite `resolveAisleStationRatios(...)` to branch by `alignmentMode` instead of always coercing straight-edge aisles to axis-preserved coordinates.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), add `alignmentMode` to distributed aisle records and set it from `bowlConfig.straightAisleMode` or `bowlConfig.chamferAisleMode`.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), compute hard seat-cap minimums from back-path interval lengths before discretionary distribution.
- In [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js), allocate discretionary extras to straights first, then chamfers only when required.
- In [state/app-state.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/app-state.js), add `bowl.straightAisleMode` and `bowl.chamferAisleMode` to the typedef, default state, normalization, and `buildBowlConfig(...)`.
- In [state/app-state.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/app-state.js), default both new fields to `'radial'` when missing from imported profiles or project documents.
- In [core/default-starting-profile.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/default-starting-profile.js), add the two new bowl fields so startup state reflects the canonical schema.
- In [pages/configurator/index.html](c:/Users/Elliott%20Klinger/Desktop/Repository/pages/configurator/index.html), add two `<select>` controls under Bowl Configuration:
- `straightAisleMode`
- `chamferAisleMode`
- In [ui/editor-controls.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-controls.js), add both new select IDs to `SELECT_STATE_PATHS`.
- In [ui/editor-controls.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-controls.js), let `syncFromState()` populate both dropdowns from `state.bowl`.
- In [ui/editor-controls.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-controls.js), wire both dropdowns through `_bindSelectControl(...)`.
- In [tests/core/aisle-layout.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/aisle-layout.test.js), add direct solver-policy tests for mandatory transitions, symmetry, odd remainder, seat cap forcing, centerline avoidance, and mode resolution.
- In [tests/state/app-state.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/state/app-state.test.js), extend `buildBowlConfig(...)` expectations to include both new mode fields and backward-compatible defaults.
- In [tests/ui/editor-controls.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/editor-controls.test.js), add DOM stubs for both new selects and assert state round-trip through the left panel.
- In [tests/viz/field-renderer.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/viz/field-renderer.test.js), add a thin integration test that `generateTierAisleLayout(...)` preserves the stable tier layout contract while core allocation behavior changes beneath it.
- No production edit is planned for [ui/app.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js), [ui/render-runtime.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/render-runtime.js), [viz/scene3d.js](c:/Users/Elliott%20Klinger/Desktop/Repository/viz/scene3d.js), [state/project.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js), [ui/editor-export-controller.js](c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-export-controller.js), or [export/obj-csv-exporter.js](c:/Users/Elliott%20Klinger/Desktop/Repository/export/obj-csv-exporter.js); these are regression surfaces only.

## 7. Code snippets and interface sketches

```js
// state/app-state.js
bowl: {
  type: 'Full',
  cornerRad: 10,
  sideLength: 300,
  structuralDepth: 12,
  structuralProfileMode: 'stepped',
  straightAisleMode: 'radial',
  chamferAisleMode: 'radial'
}
```

```js
// buildBowlConfig(state, template)
{
  width,
  length,
  shape,
  radius_arc,
  arc_angle,
  type,
  corner: 'Chamfer',
  radius,
  sideLength,
  structuralDepth,
  structuralProfileMode,
  straightAisleMode,
  chamferAisleMode
}
```

```js
// core/aisle-layout.js
function buildPerimeterModel(frontPaths, backPaths, bowlConfig) {
  return {
    paths: [
      {
        pathIndex: 0,
        closed: true,
        intervals: [
          { intervalIndex: 0, family: 'straight', startU, endU, frontLengthFt, backLengthFt, symmetryKey },
          { intervalIndex: 1, family: 'chamfer', startU, endU, frontLengthFt, backLengthFt, symmetryKey }
        ],
        transitions: [
          { cornerOrdinal: 0, uFront, uBack, forced: true, anchorType: 'forced_transition' }
        ]
      }
    ]
  };
}
```

```js
// runtime aisle payload
{
  pathIndex: 0,
  forced: false,
  anchorType: 'segment_distributed',
  cornerOrdinal: undefined,   // retained name, now means transition ordinal when present
  segmentIndex: 3,
  segmentT: 0.5,
  alignmentMode: 'perpendicular', // or 'radial'
  u: 0.42
}
```

```js
// mode-aware resolver
export function resolveAisleStationRatios(pathFront, pathBack, aisle, cache = null) {
  if (Number.isFinite(aisle.cornerOrdinal)) return resolveTransitionOrdinal(pathFront, pathBack, aisle, cache);
  if (aisle.alignmentMode === 'perpendicular') return resolvePerpendicularStationRatios(pathFront, pathBack, aisle, cache);
  return resolveRadialStationRatios(pathFront, pathBack, aisle, cache);
}
```

```js
// deterministic allocator pseudocode
function buildTierAisleLayout(params) {
  const model = buildPerimeterModel(frontPaths, backPaths, bowlConfig);
  const mandatory = findTransitionAnchors(model);
  const minimums = computeRequiredSegmentCounts(model, mandatory, maxSeatsBetweenAisles, seatWidthIn, aisleWidthFt);
  const finalCount = reconcileTargetCount(targetAisles, mandatory.length, minimums.total, model.symmetry);
  const allocation = allocateAislesDeterministically(model, mandatory, minimums, finalCount, {
    preferStraights: true,
    avoidCenterline: true,
    oddTieBreak: 'top'
  });
  return materializeAisleRecords(model, allocation, aisleWidthFt);
}
```

```js
// ui/editor-controls.js
const SELECT_STATE_PATHS = {
  bowlType: ['bowl', 'type'],
  structuralProfileMode: ['bowl', 'structuralProfileMode'],
  straightAisleMode: ['bowl', 'straightAisleMode'],
  chamferAisleMode: ['bowl', 'chamferAisleMode']
};
```

## 8. Data model and UI contract changes

| Field | Lives in state | `buildBowlConfig` output | Default | UI control | Backward compatibility |
| --- | --- | --- | --- | --- | --- |
| `straightAisleMode` | `state.bowl.straightAisleMode` | `bowlConfig.straightAisleMode` | `'radial'` | Bowl Configuration dropdown | Missing older saves normalize to `'radial'` |
| `chamferAisleMode` | `state.bowl.chamferAisleMode` | `bowlConfig.chamferAisleMode` | `'radial'` | Bowl Configuration dropdown | Missing older saves normalize to `'radial'` |

UI labels:
- `Straight Segment Aisle Arrangement`
- `Chamfer Segment Aisle Arrangement`

UI option values:
- `radial`
- `perpendicular`

Serialization impact:
- No special project migration file is needed.
- [state/project.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) already normalizes project option state through `createAppState().fromJSON(...).toJSON()`.
- Older startup profiles, imported configs, and project documents will pick up both new fields automatically through [state/app-state.js](c:/Users/Elliott%20Klinger/Desktop/Repository/state/app-state.js).

## 9. Testing strategy

### Unit tests required
- Add direct allocator tests in [tests/core/aisle-layout.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/aisle-layout.test.js).
- Cover `Full`, `U-End1`, `U-End2`, `Sides`, and `Side1`.
- Assert exact mandatory transition counts:
- `Full`: 8
- `U-End1`: 4
- `U-End2`: 4
- `Sides` / `Side1`: 0
- Assert that `Full` chamfer with `targetAisles` below 8 still returns exactly 8 and no interior extras.
- Assert that the odd remainder lands on the longest straight and uses the top segment on opposite-pair ties.
- Assert that seat-cap forcing adds aisles when needed even if `targetAisles` is smaller.
- Assert that centerline is avoided when an off-axis even-spacing solution exists.
- Assert `radial` and `perpendicular` resolve to different front/back stations on a widening straight segment.
- Assert chamfer distributed aisles honor `chamferAisleMode`.

### Integration tests required
- Extend [tests/state/app-state.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/state/app-state.test.js) for new bowl defaults and DTO output.
- Extend [tests/ui/editor-controls.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/editor-controls.test.js) for dropdown sync and change events.
- Extend [tests/ui/render-runtime.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/render-runtime.test.js) and [tests/ui/seating-bowl-app-runtime.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/ui/seating-bowl-app-runtime.test.js) so render snapshots carry the new bowl config fields without touching `ui/app.js`.
- Extend [tests/viz/field-renderer.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/viz/field-renderer.test.js) to ensure the tier layout contract survives the allocator rewrite.
- Re-run export and stats tests to ensure `sectionSummary` and actual aisle counts still reconcile correctly.

### Manual test matrix required
| Scenario | Setup | Expected |
| --- | --- | --- |
| Symmetric closed chamfer bowl | `Full`, chamfer, low target count | 8 mandatory transition aisles, symmetric layout |
| Odd remainder on longest straight | Symmetric closed bowl with one discretionary extra beyond paired allocations | Single extra goes on the longest straight; if tied opposite pair, top segment wins |
| Mandatory chamfer transitions | `Full`, `U-End1`, `U-End2` | Forced transition counts of 8 / 4 / 4 |
| Seat-cap forcing | Small `seatsBetweenAisles`, long back row | Final count increases until no section violates cap |
| Centerline avoidance | Straight segment wide enough for off-center spacing | New aisles are not centered if an equal-spacing off-axis solution exists |
| Radial mode | Straight and chamfer dropdowns set to `radial` | Aisle traces fan/radiate the same way across rows |
| Perpendicular mode | Straight and/or chamfer dropdowns set to `perpendicular` | Each distributed aisle stays normal to the local segment family |
| Separate straight vs chamfer modes | Straight=`perpendicular`, chamfer=`radial` and vice versa | Mixed family behavior works in one bowl |
| Overcrowding regression | Full chamfer bowl with low target count | No discretionary extras appear on straights/chamfers beyond mandatory transitions unless hard seat cap requires them |
| Export/regression pass | OBJ/CSV export, stats overlay, 3D scene | No missing aisle meshes, no broken section counts |

### Verification commands
- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Acceptance on lint:
- Do not add new warnings.
- Existing baseline warnings in `viz/` are tolerated only if unchanged.

## 10. Success criteria

- `buildTierAisleLayout(...)` remains the single public entrypoint and its consumers do not need a new call pattern.
- `ui/app.js` is untouched.
- No new production file is introduced.
- Low-level geometry/path sampling utilities remain intact and shared.
- `Full` chamfer bowls produce exactly 8 mandatory transition aisles before any discretionary additions.
- `U-End1` and `U-End2` produce exactly 4 mandatory transition aisles.
- Symmetric closed bowls stay symmetric except for a single odd remainder aisle.
- The odd remainder tie-break on equal opposite longest straights is deterministic and uses the top segment.
- Max seats between aisles is never violated on the governing back-row intervals.
- Straight and chamfer alignment can be switched independently from the left panel.
- Missing older state/project fields load cleanly and default to radial mode.
- `npm test`, `npm run typecheck`, and `npm run build` pass.
- `npm run lint` introduces no new warnings.
- `sectionSummary`, stats, exports, and 2D/3D aisle rendering still work off the updated runtime layout payload.

## 11. Open questions and decision log

### Decisions locked for implementation
- `U-End1/U-End2` terminal chamfer-to-straight endpoint transitions are mandatory. Count all 4.
- If a symmetric closed bowl has an odd remainder aisle and opposite longest straights tie, use the top / positive-Y segment.
- Default both new UI/state fields to `radial`.
- Keep `buildTierAisleLayout(...)` as the dispatcher; rewrite its internals instead of adding a new production module.
- Keep `cornerOrdinal` as the runtime field name to avoid unnecessary consumer churn.

### Remaining non-blocking assumptions
- Arc bowls stay on the existing non-chamfer allocation path in this refactor.
- The new dropdowns stay visible for all bowl types; if a current bowl family has no chamfer intervals, the chamfer mode is simply inert.
- One new test file is justified: [tests/core/aisle-layout.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/aisle-layout.test.js).
- Rejected existing test homes:
- [tests/viz/field-renderer.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/viz/field-renderer.test.js): renderer-surface focused, not the owner of core allocation policy
- [tests/core/profile-solver.test.js](c:/Users/Elliott%20Klinger/Desktop/Repository/tests/core/profile-solver.test.js): owns egress/count solver behavior, not placement policy
- Why the new test file is justified: it has one clear responsibility, direct coverage of core aisle placement rules

## 12. Builder handoff checklist

- Add `straightAisleMode` and `chamferAisleMode` to canonical bowl state, defaults, normalization, and `buildBowlConfig(...)`.
- Add both dropdowns to Bowl Configuration and wire them through `EditorControls`.
- Add direct characterization tests for mandatory transition counts and alignment modes.
- Refactor [core/aisle-layout.js](c:/Users/Elliott%20Klinger/Desktop/Repository/core/aisle-layout.js) into:
- perimeter model
- mandatory transition detection
- hard seat-cap minimum computation
- deterministic discretionary allocation
- mode-aware station resolution
- Delete the old heuristic allocator helpers after the new path is green.
- Preserve `buildTierAisleLayout(...)`, `buildGeometryPaths(...)`, `samplePathPointByRatio(...)`, `sampleAisleBand(...)`, and `buildSectionBoundaries(...)`.
- Re-run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- Confirm no new warnings and no changes to `ui/app.js`.
