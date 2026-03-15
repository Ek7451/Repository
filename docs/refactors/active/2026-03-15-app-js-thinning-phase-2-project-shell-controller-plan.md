# App.js Thinning Phase 2 Project Shell Controller Plan

## Status

- Status: Implemented
- Planned on: 2026-03-15
- Implemented on: 2026-03-15
- Depends on: Phase 1 completion
- Primary goal: remove mutable project/session/status shell state from `ui/app.js`

## Executor Handoff Summary

- Source logic to move:
  - fields in `ui/app.js`:
    - `_session`
    - `_projectMetadata`
    - `_projectStatus`
    - `_onProjectChromeChanged`
    - `_onStatusChanged`
  - methods in `ui/app.js`:
    - `_refreshProjectChrome()`
    - `_emitProjectChromeChanged()`
    - `_emitStatusChanged()`
  - stateful logic currently inside:
    - `setSession(...)`
    - `setProjectMetadata(...)`
    - `setProjectName(...)`
    - `getProjectMetadata()`
    - `getProjectChrome()`
    - `getProjectStatus()`
    - `getProjectSaveRequest()`
    - `setProjectStatus(...)`
- Destination files:
  - new `ui/project-shell-controller.js`
  - `ui/app.js` as a thin facade over the new controller
- Imports to change:
  - `ui/app.js` imports `ProjectShellController`
  - `ui/project-shell-controller.js` imports helpers from `state/project.js`
- Verification commands:
  - `npm run lint`
  - `npx vitest run tests/ui/app-shell-callbacks.test.js tests/state/project.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Purpose

`ui/app.js` currently owns a second stateful subsystem in addition to the live `AppState`:

- project metadata
- current session snapshot
- status banner state
- chrome/status callback emission

That logic is not composition-root work. It is a dedicated shell concern and should move into a focused `ui/` controller while continuing to use the pure helpers already in `state/project.js`.

## Architecture Verdict

The smallest compliant move is:

- create `ui/project-shell-controller.js`
- keep pure cloning and DTO shaping in `state/project.js`
- keep `ui/app.js` public methods intact by delegating them to the new controller

Do not move this mutable shell state into `state/project.js`. That file must stay pure.

## Scope Lock

In scope:

- `ui/app.js`
- new `ui/project-shell-controller.js`
- existing tests that assert project chrome and status behavior

Out of scope:

- app bootstrap in top-level `app.js`
- config load orchestration
- Scene3D lifecycle
- render runtime caches

## Current Responsibility Slice

`ui/app.js` currently owns all of this project-shell behavior:

- constructor callback storage for chrome and status updates
- mutable project metadata/session/status fields
- callback emission methods
- save-request shaping tied to metadata normalization

This is why `ui/app.js` is still acting like a feature controller instead of a thin coordinator.

## Exact Logic To Move

### New controller responsibilities

Create `ui/project-shell-controller.js` to own:

- callback storage
- mutable session snapshot
- mutable project metadata
- mutable status banner state
- chrome/status emission
- save-request naming normalization

### Proposed controller API

`ProjectShellController` should expose:

- `setSession(session)`
- `setProjectMetadata(project)`
- `setProjectName(name)`
- `getProjectMetadata()`
- `getProjectChrome()`
- `getProjectStatus()`
- `getProjectSaveRequest(stateJson)`
- `setProjectStatus(message, tone = 'default')`

Constructor contract:

- `new ProjectShellController({ getSportName, onProjectChromeChanged, onStatusChanged })`

`getSportName` should be a narrow callback returning the current sport string only. The controller should not receive the whole `AppState` object.

### `ui/app.js` after the move

Keep these methods on `SeatingBowlApp`, but make them thin delegations:

- `setSession(...)`
- `setProjectMetadata(...)`
- `setProjectName(...)`
- `getProjectMetadata()`
- `getProjectChrome()`
- `getProjectStatus()`
- `getProjectSaveRequest()`
- `setProjectStatus(...)`

`loadProject(project)` remains in `ui/app.js` because it is orchestration:

- delegate metadata update to the new controller
- call `_loadStateFromConfig(...)`
- set the final success status

## Imports To Change

### `ui/app.js`

- stop importing project helper functions used only by the controller:
  - `buildProjectChromeSnapshot`
  - `buildProjectSaveRequest`
  - `cloneProjectMetadata`
  - `cloneSessionDto`
  - `deriveProjectNameFromSport`
  - `normalizeProjectStatus`
- import `ProjectShellController`

### `ui/project-shell-controller.js`

- import from `state/project.js`:
  - `buildProjectChromeSnapshot`
  - `buildProjectSaveRequest`
  - `cloneProjectMetadata`
  - `cloneSessionDto`
  - `deriveProjectNameFromSport`
  - `normalizeProjectStatus`

No reverse imports from `state/` are allowed.

## Extraction Sequence

1. Add `ui/project-shell-controller.js`.
2. Move the project/session/status fields and emission helpers into the new controller.
3. Update `ui/app.js` to construct the controller in the constructor.
4. Delegate the existing public project/status methods to the controller.
5. Update `getProjectSaveRequest()` in `ui/app.js` to pass `this.state.toJSON()` into the controller.
6. Delete the moved fields and private emission helpers from `ui/app.js`.

## Compliance Risks

- Preserve the current callback payload shapes exactly.
- Preserve the current `getProjectSaveRequest()` behavior that normalizes and persists the project name before refreshing chrome.
- Do not let the new controller import `ui/app.js`, `viz/`, or service modules.
- Do not let `ui/app.js` keep shadow copies of the moved fields.

## Definition Of Done

- `ui/app.js` no longer stores project metadata, session, or status state directly
- `ui/app.js` no longer owns chrome/status emission helpers
- `SeatingBowlApp` public shell-facing methods still behave exactly the same
- `state/project.js` remains pure
- no duplicate helper or shadow field remains in `ui/app.js`

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/app-shell-callbacks.test.js tests/state/project.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- `getProjectChrome()` remains immutable to callers
- status updates remain normalized exactly as before
- `loadProject(...)` still emits the same loaded-project success message
