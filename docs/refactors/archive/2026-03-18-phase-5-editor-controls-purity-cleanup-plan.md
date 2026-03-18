# 2026-03-18 Phase 5 Editor Controls Purity Cleanup Plan

## Status

- Status: Completed and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Depends on: shell extraction phases complete or stable enough not to interfere
- Primary goal: keep `ui/editor-controls.js` as the DOM binding owner while moving the remaining pure helpers into existing `state/` or `core/` owners only

## Purpose

`ui/editor-controls.js` is allowed to own:

- DOM lookup
- paired input wiring
- checkbox/select/listener binding
- section enable/disable UI
- emitting a single structured change event back to the app

It should not accumulate pure state or solver helpers once existing owners are available.

Current code already moved several pure helpers into existing modules:

- `getRunoffDistance(...)` in `state/app-state.js`
- `buildFocalXControlConfig(...)` in `state/app-state.js`
- `buildTierRowCountControlConfigs(...)` in `state/app-state.js`
- `buildNextTierDefaultsFromTiers(...)` in `core/profile-solver.js`

This phase cleans up the remaining residue without inventing new files.

## Current Pure Logic Still In `ui/editor-controls.js`

The remaining non-DOM candidates to audit are:

- `TIER_INITIALIZATION_KEYS`
- `DEFAULT_TIER_STATE_TEMPLATE`
- `tierMatchesDefaultState(...)`
- `isTierStateInitialized(...)`
- the tier-initialization decision used by `applyImportedConfig(...)`

These helpers are pure and state-driven.

They do not need to stay in the UI layer just because `EditorControls` currently calls them.

## Existing Destination Analysis

### `state/app-state.js`

Chosen for:

- pure tier-initialization selectors that only inspect state and default state templates
- selectors or flags that describe whether imported tier state should be treated as already user-initialized

### `core/profile-solver.js`

Keep as the owner for:

- next-tier default derivation
- any helper that semantically belongs with tier-default math rather than general state inspection

### Destinations rejected

- new `state/` file
  - Rejected because existing owners already exist.
- new `ui/` helper file
  - Rejected by repo rules and would only move knowledge sideways.

## Scope Lock

In scope:

- `ui/editor-controls.js`
- `state/app-state.js`
- `core/profile-solver.js` only if a tiny naming or export cleanup is needed
- `tests/ui/editor-controls.test.js`
- `tests/state/app-state.test.js` if the new pure selectors need direct unit coverage

Out of scope:

- changing the public `EditorControls` role as the DOM owner
- moving control-id maps out of `ui/editor-controls.js`
- creating a new helper module

## Exact Logic To Move

### Move into `state/app-state.js`

- a pure helper that determines whether tier 2 or tier 3 should be treated as already initialized when an imported config is loaded
- any pure comparison helper needed to support that decision
- any default-template helper used only for that initialization selector

Preferred end shape:

```text
buildTierInitializationFlags(state) -> { tier2Initialized: boolean, tier3Initialized: boolean }
```

or

```text
isTierStateInitialized(state, tierNum) -> boolean
```

Either shape is acceptable if the output is explicit and pure.

### Keep in `core/profile-solver.js`

- `buildNextTierDefaultsFromTiers(...)`
- any tiny helper addition required to keep next-tier default ownership clearly in `core/`

### Keep in `ui/editor-controls.js`

- DOM element lookup helpers
- control-id to state-path maps
- numeric input normalization tied to DOM bounds and control IDs
- paired slider/input synchronization
- section enable/disable UI state
- event listeners and change emission
- canvas drag application methods that mutate the live shared AppState and sync paired controls

## Implementation Sequence

1. Add the tier-initialization selector(s) to `state/app-state.js`.
2. Replace the local pure tier-initialization helpers in `ui/editor-controls.js` with imports from `state/app-state.js`.
3. Keep next-tier default derivation in `core/profile-solver.js`; do not move it into `state/`.
4. Delete the superseded local pure helpers from `ui/editor-controls.js`.
5. Extend focused unit coverage where needed:
   - direct state selector tests if the new state helper is non-trivial
   - existing `EditorControls` tests should continue proving behavior without depending on the old private helpers

## Import Changes

Expected import updates:

- `ui/editor-controls.js` imports one or more tier-initialization selectors from `state/app-state.js`

Avoid:

- adding any import from `state/app-state.js` back into `ui/` that drags in DOM logic
- moving next-tier default derivation into `state/`
- creating a second state source or hidden initialization cache

## Stop Conditions

Stop and keep a helper in `ui/editor-controls.js` if:

- it is tightly bound to control IDs or DOM element semantics
- it relies on slider/input min/max/step attributes
- moving it would only trade one UI-specific helper for another UI-specific helper in a different file

Do not force movement for the sake of movement.

## Compliance Risks

- Do not create a new `state/` file for a tiny selector.
- Do not move DOM-driven numeric normalization into `state/`.
- Do not move tier-default math out of `core/profile-solver.js`.
- Do not leave duplicate pure helpers behind in `ui/editor-controls.js`.

## Verification Gate

Required checks:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Focused suites:

- `npx vitest run tests/ui/editor-controls.test.js`
- `npx vitest run tests/state/app-state.test.js`
- `npx vitest run tests/architecture/layer-boundaries.test.js`

Manual checks:

- imported configs preserve previously customized disabled upper-tier values
- first enable of tier 2 and tier 3 still applies defaults
- later re-enable keeps user-edited tier values
- paired controls stay in sync after canvas drag changes

## Definition Of Done

Phase 5 is complete when all of the following are true:

- `ui/editor-controls.js` remains the DOM binding owner
- pure tier-initialization state inspection no longer lives in `ui/editor-controls.js`
- next-tier default derivation still lives in `core/profile-solver.js`
- no new file was introduced
- editor-controls behavior remains unchanged under the existing test suite
