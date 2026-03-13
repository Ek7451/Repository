# Phase 3 AppState Introduction Plan

## Purpose

Phase 3 introduces a single AppState model only. The goal is to replace DOM-as-state with one serializable model that can drive solve, render, export, and config persistence without pulling backend, auth, dashboard, or page restructuring forward.

This plan is based on:

- `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- `docs/refactors/archive/phase-1-export-extraction-plan.md`
- `docs/refactors/archive/phase-2-plan.md`
- the current state seams in `app.js`
- the current `ui/stats-panel.js` handoff contract
- the current config/startup schema in `default-starting-profile.js`
- the repo guardrails in `AGENTS.md`

## Architecture Verdict

The smallest compliant Phase 3 move is:

- add `state/app-state.js` as the single serializable state model
- keep `app.js` as the DOM bridge, orchestrator, and solve-cycle owner for now
- keep `app.js` in its current location until AppState is complete and verified
- make stats, 3D, and exports consume AppState-derived DTOs instead of live DOM reads
- move camera bookmark data ownership into AppState now, even though bookmark controller extraction stays in Phase 4

This phase must not:

- move solver math out of `profile-solver.js`, `sightline-calc.js`, `aisle-layout.js`, `sports-templates.js`, or `default-starting-profile.js`
- move calculation logic into `state/`
- create `runtimeState`, `currentConfig`, snapshot objects, or a new sport-state mirror beside AppState
- start backend, auth, dashboard, or persistence implementation
- restructure pages or move `app.js` into `ui/`
- split camera bookmark DOM/controller code into a new file yet

## Current State Review

The roadmap's first two phases are partially reflected in the codebase:

- export logic now lives in `export/`
- stats rendering now lives mostly in `ui/stats-panel.js`
- no `state/` folder exists yet
- `app.js` is still `2244` lines and remains the dominant state seam

Current hotspots:

- `_wireEvents()` in `app.js:245` writes directly from DOM events to rerender scheduling
- `_getInputValue()` and `_getCustomRunoff()` in `app.js:1018-1027` keep the DOM as the live parameter source
- `update()` in `app.js:1033` reads DOM values, solves tiers, builds bowl config, and drives renderers
- `_update3D()` in `app.js:1225` and `_updateStats()` in `app.js:1296` still assemble live data from DOM/getter callbacks
- `renderStatsPanel()` still expects `getInputValue`, `getEgressParams`, and `getBowlConfig` callbacks in `ui/stats-panel.js:4-10`
- `_exportConfig()`, `_loadConfig()`, `_applyStartupProfile()`, and `_applyConfigObject()` in `app.js:1918-2125` serialize and hydrate DOM state instead of a model
- `_saveSportState()` and `_loadSportState()` in `app.js:686-804` create a second in-memory state path
- `_saveCameraBookmark()` and `_renderCameraBookmarks()` in `app.js:2216-2383` store bookmark data outside the exported config model until save/load time

Phase 3 is successful when AppState, not the DOM or controller side caches, is the only source of configurable application data.

## Structure Guardian Verdict

Compliance verdict: add a new `state/` layer now, but keep the migration narrow.

- `state/app-state.js` is the correct new file for serializable application parameters.
- `app.js` should remain the only place that knows about DOM ids, paired slider/input syncing, and rerender timing.
- `ui/stats-panel.js` stays in `ui/` and should only consume explicit values.
- `export/` stays argument-only and must not import state or DOM.

Recommended moves:

- create `state/app-state.js`
- touch `app.js`
- touch `ui/stats-panel.js`
- touch `default-starting-profile.js` only if the serialized version/schema changes
- add tests for AppState serialization and round-trip behavior if missing

Risks:

- pushing DOM mapping into `state/` would violate layer intent
- recreating `_sportStates` beside AppState would reintroduce parallel state
- moving template lookup, solver math, or aisle math into `state/` would blur responsibility boundaries

## Scope Lock

In scope:

- define a single serializable AppState model
- move configurable parameters out of live DOM reads and controller caches
- route solve, render, export, and stats inputs through AppState-derived DTOs
- replace config export/load and startup profile hydration with AppState serialization
- move camera bookmark data ownership into AppState without extracting the bookmark controller yet

Out of scope:

- camera bookmark controller extraction into `ui/camera-bookmarks.js`
- backend, auth, dashboard, or persistence API work
- moving `app.js` into `ui/`
- page shell or `index.html` restructuring
- solver, sightline, aisle, or sports template rewrites
- export-layer redesign beyond swapping DOM reads for AppState inputs
- theme persistence changes

Phase 3 may touch `ui/stats-panel.js` only to replace live getter callbacks with explicit AppState-derived values. It must not reopen broader Phase 2 rendering scope.

## Current State Inventory

Canonical user-configured state today:

- `sport`
- `setup.customRunoff`
- `setup.focalZ`
- `setup.sightlineVisuals`
- `setup.sectionMetrics`
- `bowl.type`
- `bowl.cornerRad`
- `bowl.sideLength`
- `bowl.structuralDepth`
- `bowl.clipEnabled`
- `bowl.clipAxis`
- `bowl.clipPosition`
- `bowl.clipSide`
- `occupancy.seatWidth`
- `occupancy.minAisle`
- `occupancy.maxAisle`
- `occupancy.seatsBetweenAisles`
- `occupancy.egressFactor`
- `occupancy.showSeatCubes3D`
- `tiers[0..2].enabled`
- `tiers[0..2].profileType`
- `tiers[0..2].cValue`
- `tiers[0..2].numRows`
- `tiers[0..2].firstRowDist`
- `tiers[0..2].firstRowElev`
- `tiers[0..2].treadDepth`
- `tiers[0..2].riserHeight`
- `tiers[0..2].eyeHeight`
- `tiers[0..2].eyeSetback`
- `ui.activeViewTab`
- `ui.activeResultsTab`
- `bookmarks[].name`
- `bookmarks[].position`
- `bookmarks[].target`
- `bookmarks[].thumbnail`

Controller properties acting like state today:

- `_sportStates`
- `_previousSport`
- `_cameraBookmarks`
- `_tier2Initialized`
- `_tier3Initialized`
- `_didApplyStartupProfile`

Derived runtime state that should not move into AppState:

- `_currentTemplate`
- `_solvers`
- `_solver`
- `_tierAisleLayouts`
- offset correction
- bowl width, length, and shape values coming from `getTemplate(state.sport)`
- sightline stats, egress metrics, and per-row display metrics
- Three.js scene, mesh, and canvas state

UI-only or infrastructure state that stays outside AppState:

- `_theme`
- `_themeStorageKey`
- `_scene3dReady`
- `_scene3dLoading`
- `_debounceTimer`
- `_resizeObserver`
- export menu collapse state
- feedback button timers
- global bookmark menu closer

Legacy or non-canonical values to keep out of AppState:

- `focalX` is hard-coded to `0` in `update()` and no longer has an active control
- `_lastTierCount` and `tierCount` do not appear to drive current behavior and should not be promoted into the new model

## Proposed AppState Shape

Recommended shape:

```js
{
  _version: 'phase6-app-state',
  sport: 'Ice Hockey',
  setup: {
    customRunoff: 10,
    focalZ: 3.5,
    sightlineVisuals: true,
    sectionMetrics: true
  },
  bowl: {
    type: 'Full',
    cornerRad: 8,
    sideLength: 300,
    structuralDepth: 6,
    clipEnabled: false,
    clipAxis: 'X',
    clipPosition: 0,
    clipSide: 'positive'
  },
  occupancy: {
    seatWidth: 19,
    minAisle: 48,
    maxAisle: 72,
    seatsBetweenAisles: 30,
    egressFactor: 0.2,
    showSeatCubes3D: false
  },
  ui: {
    activeViewTab: 'field',
    activeResultsTab: 'statsTab'
  },
  tiers: [
    {
      enabled: true,
      profileType: 'Parabolic',
      cValue: 4.75,
      numRows: 15,
      firstRowDist: 10,
      firstRowElev: 3,
      treadDepth: 34,
      riserHeight: 12,
      eyeHeight: 3.75,
      eyeSetback: 6
    }
    // up to 3 tiers total
  ],
  bookmarks: [
    {
      name: 'View 1',
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
      thumbnail: 'data:image/png;base64,...'
    }
  ]
}
```

Shape rules:

- mirror the current exported config structure as closely as possible to minimize migration risk
- make `fromJSON()` accept today's `phase5` config files and `DEFAULT_STARTUP_PROFILE`
- make `toJSON()` emit plain JSON DTOs only
- keep AppState free of DOM ids, renderer handles, solver instances, and template objects

Recommended omission:

- do not carry `_sportStates` forward as a second serialized tree in the initial Phase 3 shape
- if cross-sport draft preservation becomes mandatory later, the only compliant version is an AppState-owned structure with no duplicate active snapshot

## Canonical vs Derived Split

Canonical and serializable:

- `sport`
- `setup.*`
- `bowl.*`
- `occupancy.*`
- `tiers[*]`
- `ui.activeViewTab`
- `ui.activeResultsTab`
- `bookmarks`

Derived and recomputed:

- `template = getTemplate(state.sport)`
- `focalX = 0`
- `bowlConfig = template fields + state.bowl`
- `egressParams = state.occupancy`
- tier solver params = `state.setup + state.tiers[*]`
- `solvers`, `tierAisleLayouts`, stats distributions, egress calculations, and offset corrections

Controller-only:

- `_tier2Initialized`
- `_tier3Initialized`
- theme state
- 3D readiness/loading flags
- timers and observers

This split keeps AppState focused on user-controlled parameters and bookmark data while leaving calculation outputs and UI machinery derived.

## Proposed File And Responsibility Map

Current app-level JavaScript file count, excluding `lib/`, `tests/`, `node_modules/`, and `dist/`, is `16`. Phase 3 should target `17` after adding `state/app-state.js`.

Recommended responsibility map:

- `state/app-state.js`
  - owns schema definition, normalization, cloning, `toJSON()`, and `fromJSON()`
  - owns default filling and version migration
  - contains no DOM reads, no renderer imports, and no solver calls
- `app.js`
  - owns the single `this.state`
  - owns `applyStateToDom()` and input event handlers that mutate AppState
  - derives `bowlConfig`, `egressParams`, and solver params from AppState
  - remains the download initiator and scene/stats orchestrator
- `ui/stats-panel.js`
  - accepts plain DTOs from AppState-derived data
  - no live getter callbacks

Optional only if `app.js` becomes unstable during implementation:

- one small DOM binding helper under `ui/` or `state/`, but Phase 3 should prefer zero additional app JavaScript files beyond `state/app-state.js`

## Boundary Rules For Phase 3

Required boundaries:

- `app.js -> state/app-state.js` is allowed
- `app.js -> ui/stats-panel.js` is allowed
- `export/*` continues to receive plain arguments from `app.js`
- `state/app-state.js` must not import from `ui/`, `export/`, `scene3d.js`, `field-renderer.js`, or `profile-renderer.js`
- `ui/stats-panel.js` must not import AppState just to mutate it; `app.js` passes explicit values in
- protected calculation modules remain the only source of solver and aisle math

Recommended template/defaults rule:

- prefer `app.js` to pass template defaults into AppState helpers rather than letting `state/app-state.js` reach into sports templates directly

## Migration Sequence

1. Define `AppState` schema and normalization in `state/app-state.js`.
   - Add `fromJSON()`, `toJSON()`, and default-fill logic compatible with current `phase5` config files and `DEFAULT_STARTUP_PROFILE`.
   - Keep the shape plain JSON and free of DOM ids.

2. Instantiate a single AppState during app startup.
   - Change `_populateSports()` so it only fills the dropdown.
   - Load `DEFAULT_STARTUP_PROFILE` through `AppState.fromJSON()` before the first render.
   - Store the result as `this.state`.

3. Add one-way DOM hydration from AppState.
   - Implement an `applyStateToDom()` helper in `app.js` that updates inputs, checkboxes, selects, tabs, and the bookmark list from `this.state`.
   - Reuse `_setInputValue()` as a DOM helper or rename it to make its view-only role explicit.

4. Change input wiring to state-first updates.
   - In `_wireEvents()`, every input change should update `this.state` first, then mirror paired controls, then call `_scheduleUpdate()`.
   - Remove `_getInputValue()` and `_getCustomRunoff()` from solve, export, and stats code paths once state writes are stable.

5. Rewrite sport switching around AppState.
   - Replace `_saveSportState()`, `_loadSportState()`, and `_previousSport` with single-state sport selection plus template-default application.
   - Keep `_tier2Initialized` and `_tier3Initialized` as controller heuristics only if auto-stack behavior still needs them.

6. Make solve, render, export, and stats derive from AppState.
   - `update()` builds tier solver params from `this.state`.
   - `_getBowlConfig()` and `_getEgressParams()` become pure derivations from `this.state` plus the selected template.
   - `_update3D()`, DXF/Rhino/CSV/JSON export, and config export stop reading live DOM values.

7. Normalize stats and bookmarks handoffs.
   - Update `ui/stats-panel.js` to accept plain `focalPointFt`, `egressParams`, `bowlConfig`, `sportName`, and `tierAisleLayouts` values.
   - Move bookmark data ownership from `this._cameraBookmarks` to `this.state.bookmarks`; keep DOM rendering in `app.js` until Phase 4.

8. Replace config save/load with AppState round-trip.
   - `_exportConfig()` serializes `this.state.toJSON()`.
   - `_loadConfig()` and startup loading hydrate AppState via `fromJSON()`, then `applyStateToDom()`, then update.
   - Remove `_applyConfigObject()` once the new flow is stable, or shrink it to a thin DOM hydration wrapper during transition.

9. Delete obsolete state paths.
   - Remove `_sportStates`, `_previousSport`, and any calculation/export dependence on `_getInputValue()`.
   - Keep only derived runtime caches such as `_solvers`, `_currentTemplate`, and `_tierAisleLayouts`.

Reason for this order:

- it introduces the model before moving call sites
- it keeps DOM mapping inside `app.js`
- it avoids mixing bookmark-controller extraction or directory migration into the state cutover
- it reduces the chance of a long-lived dual-source state period

## Known Risks And Guardrails

- The biggest failure mode is dual state during migration. Do not land a halfway state where events write to AppState but `update()` and export code still read the DOM for normal operation.
- `ui/stats-panel.js` currently depends on live getters. That contract must be cleaned up as part of the AppState handoff, but the file stays in `ui/`.
- `DEFAULT_STARTUP_PROFILE` and saved config files are still `phase5`. `AppState.fromJSON()` must normalize legacy data before any DOM hydration.
- Camera bookmark thumbnails can make serialized files large. Preserve current behavior first; any thumbnail compaction should be a separate follow-up, not mixed into the initial AppState cutover.
- `focalX` is a removed control with a hard-coded `0` in `update()`. Do not accidentally reintroduce it as saved state just because helper code still references it.
- `_lastTierCount` appears to be dead legacy state and should not be promoted into AppState.
- If current sport-switch draft preservation is considered product-critical, model it inside AppState only after the single-state migration is stable. Do not recreate `_sportStates` as a separate mirror.
- Theme stays in localStorage/UI state, not project state.
- `state/app-state.js` must remain plain-data logic only; DOM ids, element lookups, and renderer adapters belong in `app.js`.

## Definition Of Done

Phase 3 is complete when all of the following are true:

- the app owns exactly one AppState object for configurable parameters
- `update()`, `_update3D()`, `_updateStats()`, and export methods derive inputs from AppState, not live DOM reads
- `state/app-state.js` owns the serializable schema and `toJSON()`/`fromJSON()` logic
- startup profile load and imported config load both go through AppState hydration
- bookmarks are stored in AppState
- `ui/stats-panel.js` no longer receives DOM-backed getter callbacks
- `_sportStates`, `_previousSport`, and any similar parallel parameter caches are removed or fully retired from behavior-critical paths
- no protected `core/` logic is moved or duplicated
- app-level JavaScript file count increases by `1` preferred, `2` maximum if one helper becomes unavoidable

## Verification Gate

Required automated checks for the implementation turn:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm `state/app-state.js` does not call `document.*`, `window.*` for DOM state, or import from `ui/`, `export/`, or visualization modules
- confirm no calculation or export path reads live form values directly
- confirm no `runtimeState`, `currentConfig`, `_sportStates`, or second AppState was introduced
- confirm `ui/stats-panel.js` consumes explicit arguments, not DOM getters
- confirm `export/` modules still consume arguments only
- confirm bookmarks render from `this.state.bookmarks`

Required manual checks:

- verify the default startup profile loads the same visible values as before
- verify one-tier, two-tier, and three-tier solve flows after changing inputs
- verify sport change applies the chosen Phase 3 behavior consistently and does not leave stale DOM values behind
- verify clip plane controls update field, profile, 3D, and export correctly
- verify config export then load is a lossless round-trip for sport, tiers, bowl settings, occupancy, tabs, and bookmarks
- verify 3D bookmark save, rename, delete, and restore still work after a config round-trip
- verify stats, DXF, Rhino, CSV, and JSON exports still reflect the current AppState values
- verify theme toggle still works and is not serialized into project config

Suggested manual matrix:

- Football with one tier
- Baseball or softball with center offset correction
- multi-tier bowl with aisle layouts populated
- 3D view with saved camera bookmarks
- config round-trip using a file exported from the new AppState serializer

## Phase 3 Non-Goals Reminder

Do not combine this phase with:

- `ui/camera-bookmarks.js` extraction
- backend, auth, dashboard, or persistence implementation
- `services/` or DTO work
- moving `app.js` into `ui/`
- `index.html` or page-shell splits
- solver math cleanup or protected-module rewrites
- theme system changes
