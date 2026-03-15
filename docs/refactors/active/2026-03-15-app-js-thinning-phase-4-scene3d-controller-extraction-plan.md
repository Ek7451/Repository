# App.js Thinning Phase 4 Scene3D Controller Extraction Plan

## Status

- Status: Completed
- Planned on: 2026-03-15
- Completed on: 2026-03-15
- Depends on: Phase 3 completion
- Primary goal: remove raw Scene3D host lifecycle and bookmark feature ownership from `ui/app.js`

## Completion Notes

- Implemented `ui/scene3d-controller.js` as the Scene3D feature owner.
- Moved Scene3D lifecycle, loading/error container markup, ready/loading flags, bookmark ownership, theme application, export-scene access, and active-tab resize/update behavior out of `ui/app.js`.
- Updated `ui/app.js` to construct `Scene3DController` and delegate activation, theme updates, runtime updates, export access, bookmark rendering, and teardown through the controller.
- Removed direct `CameraBookmarks`/raw `Scene3D` ownership from `ui/app.js`; `ui/scene3d-controller.js` now imports `CameraBookmarks` and performs the lazy `../viz/scene3d.js` import.
- Verification run on 2026-03-15:
  - `npm run lint`
  - `npx vitest run tests/ui/scene3d-controller.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Executor Handoff Summary

- Source logic to move:
  - fields in `ui/app.js`:
    - `scene3D`
    - `_scene3dReady`
    - `_scene3dLoading`
    - `cameraBookmarks`
  - methods in `ui/app.js`:
    - `_init3DAsync()`
    - `_initCameraBookmarks()`
    - `_getSceneExportData()`
    - scene-related branches inside:
      - `destroy()`
      - `_handleThemeChanged(...)`
      - `_handleViewTabChanged(...)`
      - `_update3D()`
- Destination files:
  - new `ui/scene3d-controller.js`
  - `ui/app.js` as a thin delegator
- Imports to change:
  - `ui/app.js` imports `Scene3DController`
  - `ui/scene3d-controller.js` imports `CameraBookmarks`
  - `ui/scene3d-controller.js` performs the existing lazy import of `../viz/scene3d.js`
- Verification commands:
  - `npm run lint`
  - `npx vitest run tests/ui/scene3d-controller.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
  - `npm run build`

## Purpose

`ui/app.js` still behaves like the Scene3D feature owner.

It currently owns:

- lazy module loading
- loading and failure markup in the Scene3D container
- ready/loading flags
- bookmark feature instantiation
- theme application into the 3D scene
- resize and activation rules
- export-scene access

Those responsibilities are feature-specific `ui/` control logic, not app-root orchestration.

## Architecture Verdict

The smallest compliant move is:

- create a dedicated `ui/scene3d-controller.js`
- keep DOM and bookmark feature ownership in `ui/`
- keep `viz/scene3d.js` renderer-only
- keep `ui/app.js` responsible only for when Scene3D is activated or updated

Do not move loading markup or bookmark logic into `viz/scene3d.js`.

## Scope Lock

In scope:

- `ui/app.js`
- new `ui/scene3d-controller.js`
- existing `ui/camera-bookmarks.js`
- only tiny alignment changes to `viz/scene3d.js` if a public method name or null-safety check must be clarified

Out of scope:

- render-runtime cache extraction
- export contract rewrite
- shell state extraction already handled earlier

## Current Responsibility Slice

`ui/app.js` currently owns these Scene3D-specific behaviors:

- `_init3DAsync()` lazy imports `Scene3D`, writes loading/error HTML, creates the scene, applies theme, marks ready, and triggers the first update
- `_initCameraBookmarks()` constructs `CameraBookmarks` with DOM elements and scene callbacks
- `_update3D()` reads shell visibility state, forces resize, updates the 3D field, and updates the 3D bowl
- `destroy()` disposes Scene3D and bookmarks directly

That is a full feature controller embedded inside the app root.

## Exact Logic To Move

### New controller responsibilities

Create `ui/scene3d-controller.js` to own:

- lazy creation of `Scene3D`
- `scene3D` instance storage
- ready/loading flags
- Scene3D container loading and failure markup
- bookmark feature setup and teardown
- theme application to Scene3D
- Scene3D export-scene access
- active-tab resize/update behavior

### Proposed controller API

`Scene3DController` should expose:

- `activate()`
- `applyTheme(theme)`
- `update(snapshot, { isActive })`
- `getExportSceneData()`
- `getGeometryPort()`
- `destroy()`

Constructor contract:

- `new Scene3DController({`
- `  containerEl,`
- `  bookmarksBarEl,`
- `  bookmarksListEl,`
- `  saveBookmarkBtnEl,`
- `  toggleBookmarksBtnEl,`
- `  getTheme,`
- `  getBookmarks,`
- `  getSportName,`
- `  download,`
- `  ensureContainerSize,`
- `  onLayoutChanged`
- `})`

`getGeometryPort()` should return only the scene methods later needed by export code:

- `getExportSceneData`
- `buildClosedStructuralProfile`
- `getBowlGeometrySegments`

Do not return the entire controller or the entire `Scene3D` instance as a generic service object.

### `ui/app.js` after the move

`ui/app.js` should keep only orchestration:

- create `Scene3DController`
- call `scene3DController.applyTheme(theme)` during theme changes
- call `scene3DController.activate()` when the Scene3D tab is activated
- call `scene3DController.update(snapshot, { isActive })` from the update flow
- call `scene3DController.destroy()` from `destroy()`

## Imports To Change

### `ui/app.js`

- remove direct `CameraBookmarks` import
- remove any direct use of `Scene3D`
- import `Scene3DController`

### `ui/scene3d-controller.js`

- import `CameraBookmarks`
- keep the existing lazy import of `../viz/scene3d.js`

No reverse imports into `viz/` are allowed.

## Extraction Sequence

1. Add `ui/scene3d-controller.js`.
2. Move lazy Scene3D creation and ready/loading state into the new controller.
3. Move bookmark feature construction and teardown into the controller.
4. Replace scene-specific branches in `ui/app.js` with controller calls.
5. Delete the raw Scene3D fields and helpers from `ui/app.js`.

## Compliance Risks

- Preserve the current loading and failure user feedback in the Scene3D container.
- Preserve bookmark layout-resize behavior when the bookmarks bar expands or collapses.
- Preserve the current first-render path that updates the 3D scene immediately after successful init.
- Do not leak raw Scene3D instance ownership back into `ui/app.js` through a broad getter.

## Definition Of Done

- `ui/app.js` no longer stores raw Scene3D readiness/loading state
- `ui/app.js` no longer constructs `CameraBookmarks`
- `ui/app.js` no longer owns `_init3DAsync()` or `_getSceneExportData()`
- Scene3D lifecycle and bookmarks are isolated in a dedicated `ui/` controller
- `viz/scene3d.js` remains a renderer endpoint only

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/scene3d-controller.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- `activate()` performs lazy init once only
- failure markup is rendered when the dynamic import path throws
- bookmark export and layout callbacks still fire through the controller
- active Scene3D tab still forces resize before update
