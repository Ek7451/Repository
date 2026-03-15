# App.js Thinning Phase 3 Editor Controls And Shell Decoupling Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: Phase 2 completion
- Primary goal: stop `EditorControls` from implicitly driving shell sync and Scene3D restoration through `ui/app.js`

## Executor Handoff Summary

- Source logic to move or rewrite:
  - `EditorControls` constructor options:
    - `syncShellState`
    - `onScene3DTabRestored`
  - `EditorControls.syncFromState()` side effects that currently:
    - call shell sync
    - trigger Scene3D tab restoration
  - `ui/app.js._applyStateToDom()`
  - `ui/app.js._setupCanvases()`
  - `ui/app.js._handleViewTabChanged(...)` canvas lookup usage
- Destination files:
  - existing `ui/editor-controls.js`
  - existing `ui/editor-shell.js`
  - `ui/app.js` as explicit top-level orchestrator
- Imports to change:
  - no new layer-crossing imports expected
- Verification commands:
  - `npm run lint`
  - `npx vitest run tests/ui/editor-controls.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Purpose

`EditorControls` currently owns more than form behavior.

It reaches back into app lifecycle through two callbacks:

- `syncShellState`
- `onScene3DTabRestored`

Because of that, `ui/app.js._applyStateToDom()` is misleading. It looks like form sync, but it also syncs shell tab state and can reactivate Scene3D indirectly.

That hidden reach-through makes later controller extraction harder and keeps `ui/app.js` coupled to control internals.

## Architecture Verdict

The smallest compliant move is:

- make `EditorControls.syncFromState()` responsible for form DOM only
- make `ui/app.js` explicitly call shell sync after form sync
- move canvas lookup ownership into `EditorShell` instead of `ui/app.js`

Do not create a new controller here. This phase should simplify the current wiring first.

## Scope Lock

In scope:

- `ui/editor-controls.js`
- `ui/editor-shell.js`
- `ui/app.js`
- focused tests for control and shell interactions

Out of scope:

- Scene3D extraction itself
- render-runtime extraction
- project-shell state

## Current Responsibility Slice

### In `ui/editor-controls.js`

`EditorControls` currently accepts:

- `syncShellState`
- `onScene3DTabRestored`

And `syncFromState()` currently:

- syncs form controls
- syncs shell tab state
- restores the Scene3D tab path if active

### In `ui/app.js`

`_applyStateToDom()` currently delegates all of that hidden behavior to `editorControls.syncFromState()`.

`_setupCanvases()` and `_handleViewTabChanged(...)` also do direct `document.getElementById(...)` lookup for view canvases even though `EditorShell` already owns view-tab shell behavior.

## Exact Logic To Move Or Rewrite

### `ui/editor-controls.js`

- Remove `syncShellState` and `onScene3DTabRestored` from the constructor contract.
- Change `syncFromState()` so it updates only:
  - form fields
  - checkbox/select states
  - control visibility inside the form
- Keep tier initialization and clip-range sync inside `EditorControls`; those still belong to the form module.

### `ui/editor-shell.js`

Add a small shell-owned helper:

- `getViewCanvases()`

It should return:

- `fieldCanvas`
- `profileCanvas`

This lets `ui/app.js` stop doing direct feature-specific DOM lookup for canvases.

### `ui/app.js`

Rewrite `_applyStateToDom()` to do explicit orchestration in order:

1. `editorControls.syncFromState()`
2. `editorShell.syncFromState({ activeViewTab, activeResultsTab })`
3. if the active tab is `scene3d`, explicitly route through `_handleViewTabChanged('scene3d')`

Rewrite `_setupCanvases()` and `_handleViewTabChanged(...)` to use `editorShell.getViewCanvases()` instead of local `getCanvasElement(...)`.

Keep `_handleViewTabChanged(...)` in `ui/app.js` for now. This phase is about removing hidden reach-through, not moving Scene3D ownership yet.

## Imports To Change

No new cross-layer imports are needed.

The change is internal to:

- `ui/editor-controls.js`
- `ui/editor-shell.js`
- `ui/app.js`

## Extraction Sequence

1. Update `EditorControls` so `syncFromState()` no longer touches shell sync or Scene3D restoration.
2. Update `EditorControls` constructor call in `ui/app.js` to remove the obsolete callbacks.
3. Add `EditorShell.getViewCanvases()`.
4. Update `_applyStateToDom()` in `ui/app.js` to explicitly orchestrate form sync and shell sync.
5. Update `_setupCanvases()` and `_handleViewTabChanged(...)` in `ui/app.js` to use shell-provided canvases.
6. Delete now-unused local canvas lookup paths if they become dead.

## Compliance Risks

- Restored `scene3d` state must still trigger the same activation path after config load.
- Canvas resize behavior must not change when switching between profile and field views.
- Do not let `EditorControls` keep new private app-lifecycle callbacks under different names.
- Keep `EditorShell` shell-focused; do not move solving or runtime cache logic there.

## Definition Of Done

- `EditorControls` owns form DOM only
- shell sync and Scene3D activation are explicit in `ui/app.js`
- `ui/app.js` no longer relies on hidden form-module side effects for tab restoration
- canvas lookup for the view shell is owned by `EditorShell`

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/editor-controls.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- `EditorControls.syncFromState()` no longer calls shell sync callbacks
- `_applyStateToDom()` still restores the `scene3d` view when state says it is active
- view-tab switching still resizes the correct canvas and schedules the correct rerender
