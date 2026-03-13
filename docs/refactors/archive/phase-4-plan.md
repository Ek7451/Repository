# Phase 4 Camera Bookmarks Extraction Plan

## Status

- Status: Complete
- Completed on: 2026-03-13
- Automated verification passed: `npm run lint`, `npm test`, `npm run typecheck`, `npm run build`
- Architecture confirmation: `ui/camera-bookmarks.js` owns bookmark toolbar and list UI behavior, bookmark data still flows from `this.state.bookmarks`, and no forbidden bookmark-controller imports were introduced
- Manual QA note: browser-driven bookmark flows remain recommended to rerun if you want the full Phase 4 verification matrix captured in-session

## Purpose

Phase 4 covers camera-bookmark extraction only. The goal is to move bookmark toolbar wiring, bookmark-card rendering, dropdown actions, and bookmark-specific UI control flow out of `app.js` now that AppState exists and bookmarks already serialize through the single state model.

This plan is based on:

- `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- `docs/refactors/archive/phase-3-plan.md`
- the current bookmark seam in `app.js`
- the current AppState bookmark contract in `state/app-state.js`
- the current bookmark shell in `index.html`
- the repo guardrails in `AGENTS.md`

## Architecture Verdict

The smallest compliant Phase 4 move is:

- create `ui/camera-bookmarks.js`
- keep `state/app-state.js` as the only owner of serialized bookmark data
- keep `app.js` as the owner of the single AppState object, scene lifecycle, and 3D layout sizing
- move bookmark DOM rendering, toolbar wiring, dropdown lifecycle, and bookmark action coordination into the new UI controller
- pass narrow scene and app callbacks into the controller instead of letting it import `app.js` or `scene3d.js`

This phase must not:

- create a second bookmark cache, bookmark snapshot, or parallel AppState
- move bookmark data ownership back out of `state/`
- move calculation logic out of `core/`
- import `scene3d.js`, `field-renderer.js`, or `export/` directly into the bookmark controller
- start backend, auth, dashboard, persistence, or page-shell restructuring work
- redesign bookmark persistence, thumbnail compression, or scene architecture

Phase 4 is now unblocked because the Phase 3 prerequisite is present:

- `state/app-state.js` exists
- `app.js` initializes a single `this.state`
- config export/load already round-trips through `this.state.toJSON()` and `this.state.fromJSON()`
- bookmark data already lives in `this.state.bookmarks`

## Current State Review

The roadmap's Phase 4 intent is partially implemented already:

- `app.js` is now `2210` lines instead of the original monolith size
- `state/app-state.js` already normalizes and serializes `bookmarks`
- `app.js` initializes bookmark rendering during startup and after config load
- there is still no `ui/camera-bookmarks.js`

Current bookmark-related seams in `app.js`:

- startup render call: line `141`
- bookmark toolbar wiring inside `_wireEvents()`: lines `650-668`
- 3D container sizing depends on bookmark-bar height in `_ensure3DContainerSize()`: lines `958-978`
- bookmark save, thumbnail capture, card rendering, dropdown actions, restore, and delete flow: lines `1929-2098`
- 3D image download helper used by bookmark export: lines `2100-2109`
- config-load rerender call: line `1824`

Current bookmark-related seams outside `app.js`:

- `state/app-state.js:237-249` normalizes bookmark entries
- `state/app-state.js:348` and `state/app-state.js:365` keep bookmarks inside the single AppState shape
- `index.html:2543-2558` already provides the bookmark toolbar shell and list mount point
- `styles.css` already owns bookmark presentation styles
- `tests/state/app-state.test.js` covers bookmark normalization, but there are no bookmark-controller tests

Phase 4 is successful when `app.js` no longer owns bookmark-bar DOM rendering or bookmark-specific event orchestration.

## Structure Guardian Verdict

Compliance verdict: the bookmark controller belongs in `ui/`, not `state/`, `viz/`, or `export/`.

- `ui/camera-bookmarks.js` is the correct destination for bookmark toolbar behavior and bookmark card rendering.
- `state/app-state.js` should keep bookmark data only.
- `app.js` should stay as the composition root that wires AppState, the scene adapter, and the bookmark controller together.
- `index.html` and `styles.css` can remain the bookmark shell and style source for this phase.

Recommended smallest move:

- add `ui/camera-bookmarks.js`
- touch `app.js`
- leave `state/app-state.js` unchanged unless a bookmark normalization bug is discovered during implementation
- avoid HTML and CSS edits unless a controller hook or accessibility fix is strictly necessary

## AppState Readiness Verdict

Canonical and serializable bookmark state:

- `state.bookmarks[*].name`
- `state.bookmarks[*].position`
- `state.bookmarks[*].target`
- `state.bookmarks[*].thumbnail`

Derived or controller-only bookmark state that must stay out of AppState:

- whether the bookmark bar is collapsed
- which dropdown is currently open
- temporary prompt state for rename
- the document-level click closer used to dismiss menus

App-owned runtime state that must stay outside AppState:

- `scene3D`
- current camera/controls objects
- renderer canvas access for thumbnail capture
- 3D container sizing and resize timing

No AppState schema expansion is required for Phase 4. Do not add bookmark ids, UI flags, or scene handles unless the extraction reveals a concrete behavior bug that cannot be solved with the existing array-based model.

## Import Boundary Audit

Forbidden imports in the current bookmark path:

- none

Boundary risks for the extraction:

- `ui/camera-bookmarks.js` must not import `app.js`
- `ui/camera-bookmarks.js` must not import `scene3d.js`
- `ui/camera-bookmarks.js` must not import `export/` modules
- `ui/camera-bookmarks.js` should not import `state/app-state.js` just to reach bookmark data

Smallest compliant rewrite:

- `app.js -> ui/camera-bookmarks.js`
- `app.js` passes plain bookmark data plus narrow callbacks/adapters
- the bookmark controller coordinates UI behavior through those callbacks instead of hidden imports

## Scope Lock

In scope:

- extract camera bookmark toolbar behavior out of `app.js`
- extract bookmark card and dropdown rendering out of `app.js`
- keep bookmark data flowing from `this.state.bookmarks`
- preserve save, restore, rename, delete, export-image, keyboard, and collapse/expand behavior
- keep 3D layout resizing working when bookmark UI height changes
- add a single bookmark controller entry point under `ui/`

Out of scope:

- AppState redesign or persistence feature work
- `scene3d.js` restructuring
- backend, auth, dashboard, or `services/` work
- page shell or route restructuring
- bookmark thumbnail optimization or compression
- theme work
- stats-panel changes
- solver, sightline, aisle, or export rewrites

## Current Responsibility Map

Current bookmark responsibilities are spread across one file plus existing markup/state seams:

- `app.js`
  - bookmark initialization call: line `141`
  - bookmark toolbar event wiring: lines `650-668`
  - bookmark-bar-aware 3D sizing: lines `958-978`
  - bookmark creation and thumbnail capture: lines `1929-1972`
  - bookmark list rendering and dropdown orchestration: lines `1974-2098`
  - bookmark image export helper: lines `2100-2109`
  - config-load bookmark rerender: line `1824`
- `state/app-state.js`
  - bookmark normalization and serialization
- `index.html`
  - bookmark shell and mount points only

The current bookmark block mixes four responsibilities:

- UI event wiring
- UI rendering and dropdown management
- bookmark state mutations
- scene-driven bookmark actions and export handoff

## Proposed File Split Map

Current app-level JavaScript file count, excluding `dist/`, `node_modules/`, `lib/`, `tests/`, and `scripts/`, is `17`. Phase 4 should target `18` after adding one new UI module.

Introduce these files only:

- `ui/camera-bookmarks.js`

Touch:

- `app.js`

Touch only if implementation reveals a real bug:

- `state/app-state.js`
- `index.html`
- `styles.css`

Responsibility map after Phase 4:

- `app.js`
  - owns `this.state`
  - owns `scene3D`
  - instantiates the bookmark controller once after DOM availability
  - supplies callbacks for creating a bookmark from the current scene, restoring a bookmark, exporting a bookmark image, and responding to layout changes
  - keeps `_ensure3DContainerSize()` and any generic 3D image download helper
- `ui/camera-bookmarks.js`
  - owns bookmark toolbar element refs
  - owns bookmark list rendering
  - owns dropdown open/close behavior
  - owns delegated bookmark UI event handling
  - calls app-provided callbacks to mutate the single bookmark array and interact with the scene
- `state/app-state.js`
  - remains the single source of serialized bookmark data

## Recommended Controller Contract

Preferred shape:

```js
const cameraBookmarks = new CameraBookmarks({
  barEl: document.getElementById('cameraBookmarksBar'),
  listEl: document.getElementById('cameraBookmarksList'),
  saveBtnEl: document.getElementById('saveCameraViewBtn'),
  toggleBtnEl: document.getElementById('toggleBookmarksBtn'),
  getBookmarks: () => this.state.bookmarks,
  createCurrentBookmark: () => this._createCurrentCameraBookmark(),
  renameBookmark: (index, nextName) => {
    this.state.bookmarks[index].name = nextName;
  },
  removeBookmark: (index) => {
    this.state.bookmarks.splice(index, 1);
  },
  restoreBookmark: (index) => {
    this._restoreCameraBookmark(this.state.bookmarks[index]);
  },
  exportBookmarkImage: (index) => {
    this._export3DImage(this.state.bookmarks[index]?.name ?? null);
  },
  onLayoutChanged: () => {
    this._ensure3DContainerSize();
    this.scene3D?.forceResize();
  }
});

cameraBookmarks.render();
```

Contract notes:

- the controller may store DOM refs and ephemeral menu state only
- the controller must not copy bookmark data into a second cache
- scene access must happen through callbacks or a narrow adapter, not through direct imports
- if a `destroy()` method is added for document-level listeners, `app.js` should own calling it during teardown or replacement

## Internal Split Inside `ui/camera-bookmarks.js`

Keep helpers local to the file unless reuse becomes real.

Suggested internal grouping:

- `bindToolbarEvents()`
- `render()`
- `renderBookmarkCard()`
- `toggleDropdownForCard()`
- `closeAllDropdowns()`
- `handleListClick()`
- `handleListKeydown()`

Preferred event strategy:

- use one delegated click handler and one delegated keydown handler on the list instead of recreating per-card listeners on every render
- keep one document-level outside-click closer owned by the controller

## Extraction Sequence

1. Add `ui/camera-bookmarks.js` with a controller skeleton, DOM refs, and cleanup hooks.
2. Move bookmark toolbar wiring out of `_wireEvents()` into the controller.
3. Move bookmark list rendering and dropdown orchestration out of `_renderCameraBookmarks()` into the controller.
4. Replace `_saveCameraBookmark()` with a thin app-owned helper that returns a bookmark DTO for the current scene, or an equivalent callback used by the controller.
5. Keep scene restore and image export as thin app callbacks unless the controller can own them without importing visualization modules.
6. Instantiate the controller during app startup, render from `this.state.bookmarks`, and refresh it after config load.
7. Remove obsolete bookmark-specific DOM methods from `app.js`.

Reason for this order:

- it keeps AppState ownership stable
- it avoids mixing scene refactors into the extraction
- it minimizes the time spent in a dual-controller state

## Circular Import Risks

Avoid these failure modes:

- `ui/camera-bookmarks.js` importing `app.js`
- `ui/camera-bookmarks.js` importing `scene3d.js`
- `ui/camera-bookmarks.js` importing `state/app-state.js` to mutate global state directly
- `app.js` growing new bookmark helper files that import back into the controller

The intended dependency direction is:

- `app.js -> ui/camera-bookmarks.js`
- `app.js -> state/app-state.js`

## Known Risks And Guardrails

- The biggest failure mode is recreating bookmark state inside the controller. The source of truth must remain `this.state.bookmarks`.
- Bookmark bar collapsed state is UI-only. Do not serialize it into AppState.
- Preserve the current behavior where saving a view auto-expands the bookmark bar if it is collapsed.
- Preserve the current behavior where bookmark export restores that bookmark's view before exporting the image.
- Preserve keyboard activation with `Enter` and `Space`.
- Preserve the 3D layout resize behavior when the bookmark bar opens, closes, or changes height.
- The current code re-registers a document click closer during every render. The extracted controller should centralize that listener and clean it up predictably.
- `vitest` runs in a `node` environment today, so DOM-heavy bookmark behavior will still rely primarily on manual verification unless the implementation introduces pure helpers worth unit testing.
- Do not expand the phase into markup or styling cleanup just because bookmark styles also exist in `index.html` and `styles.css`.

## Definition Of Done

Phase 4 is complete when all of the following are true:

- `app.js` no longer owns bookmark list markup generation or bookmark dropdown event wiring
- `ui/camera-bookmarks.js` owns the bookmark toolbar and list UI behavior
- bookmark data still lives only in `this.state.bookmarks`
- config export and config load still round-trip bookmarks through AppState
- scene restore and image export happen through explicit callbacks or adapters only
- no forbidden imports are introduced
- no second bookmark cache or second AppState appears
- app-level JavaScript file growth is `+1` preferred, `+2` maximum if one helper becomes unavoidable

Expected implementation impact:

- new JavaScript files: `1`
- touched existing JavaScript files: `1-3`

## Verification Gate

Required automated checks for the implementation turn:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm `ui/camera-bookmarks.js` does not import `app.js`, `scene3d.js`, `export/`, or `services/`
- confirm bookmark data still flows from `this.state.bookmarks`
- confirm no bookmark-specific cache, snapshot, or duplicate AppState was introduced
- confirm the controller does not read unrelated live form values
- confirm 3D layout resize still happens through explicit app-owned callbacks

Required manual checks:

- verify save-view creates a new bookmark with the current camera position, target, and thumbnail
- verify the bookmark bar auto-expands on save when previously collapsed
- verify clicking a bookmark restores the saved view
- verify keyboard activation on a bookmark card still restores the saved view
- verify rename updates the rendered label and survives config export then load
- verify delete removes the bookmark and leaves no orphaned dropdowns behind
- verify export image from a bookmark restores that view before downloading the PNG
- verify bookmark cards still render correctly after config load
- verify switching into the 3D tab with existing bookmarks still sizes the scene correctly
- verify window resize with the bookmark bar open still resizes the 3D scene correctly

Suggested manual matrix:

- 3D tab with zero bookmarks
- 3D tab with multiple bookmarks
- save, rename, delete, and export-image flow in one session
- config round-trip with multiple bookmarks
- restore/export after switching sports or tabs

## Phase 4 Non-Goals Reminder

Do not combine this phase with:

- backend, auth, dashboard, or persistence productization
- AppState redesign
- `scene3d.js` cleanup unrelated to bookmark callbacks
- page-shell or route work
- stats-panel work
- export-layer work
- solver math or protected-module rewrites
