# 2026-03-18 Phase 3 Workspace Shell Extraction Plan

## Status

- Status: Completed and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Depends on: Phase 2 project-chrome extraction
- Primary goal: move non-project shell behavior out of `ui/editor-shell.js` so the remaining file becomes a thin shell facade

## Purpose

After Phase 2, `ui/editor-shell.js` should no longer own project chrome directly.

This phase finishes the shell split by extracting the shared workspace shell behavior that still does not belong in `ui/app.js`:

- theme
- tabs
- canvas hookup
- resize observation
- sidebar collapse and resize
- generic shell interaction behavior

## Current Responsibility Slice To Extract

The current workspace slice in `ui/editor-shell.js` includes:

- theme state, persistence, and toggle behavior
- active view tab and active results tab DOM activation
- right-sidebar auto-open behavior on results tab change
- field/profile canvas lookup and resize observation
- `handleViewTabChanged(...)` orchestration for field/profile/scene activation
- scene3D container sizing
- scene3D resize notifications triggered by layout changes
- left and right sidebar collapse behavior
- left and right sidebar manual resize behavior
- feedback button behavior
- tooltip initialization and placement
- generic collapsible section toggling
- window resize handling for active Scene3D state

Those responsibilities do not belong with project picker, option manager, or project menu behavior.

## Existing Module Analysis

### Existing destinations considered

- `ui/editor-shell.js`
  - Rejected because it preserves the current monolith.
- `ui/scene3d-controller.js`
  - Rejected because only a subset of the extracted behavior is 3D-specific.
  - Tabs, sidebars, theme, tooltip behavior, and feedback behavior are broader workspace shell concerns.
- `ui/app.js`
  - Rejected because the top-level app should coordinate workspace shell behavior, not own shell DOM and resize mechanics directly.

### New file justification

Create `ui/workspace-shell.js` only because the current repo still has no compliant existing owner for:

- theme state and persistence
- shell tab DOM
- sidebar layout DOM
- canvas hookup and resize observation
- generic workspace shell interactions

Single responsibility of the new file:

- own non-project editor chrome and layout behavior

This is not a vague coordinator because it is bounded to one feature family: shared workspace shell behavior.

## Scope Lock

In scope:

- new `ui/workspace-shell.js`
- `ui/editor-shell.js`
- `ui/app.js` only if a narrow facade or constructor seam change is required
- `tests/ui/workspace-shell.test.js`
- `tests/ui/app-shell-callbacks.test.js`

Out of scope:

- project toolbar, project menu, project picker, and option manager
- `ProjectShellController`
- stats DTO shaping
- root `app.js` project action port behavior

## Public API Preservation Rule

Preserve the existing `EditorShell` outward workspace-facing API wherever possible:

- `getTheme()`
- `syncFromState(...)`
- `getViewCanvases()`
- `connectViewCanvases(...)`
- `applyUrlViewOverride()`
- `handleViewTabChanged(...)`
- `ensure3DContainerSize()`
- `isScene3DActive()`
- `destroy()`

`ui/app.js` should continue to talk to `EditorShell`, not directly to `WorkspaceShell`.

## Exact Logic To Move

Move these current `EditorShell` responsibilities into `ui/workspace-shell.js`:

- constructor state for:
  - `_themeStorageKey`
  - `_theme`
  - `_feedbackBtnCopyFallbackTimer`
  - `_feedbackBtnResetTimer`
  - `_viewResizeObserver`
- public workspace methods:
  - `getTheme()`
  - `applyTheme(...)`
  - `syncFromState(...)`
  - `getViewCanvases()`
  - `connectViewCanvases(...)`
  - `applyUrlViewOverride()`
  - `setViewTab(...)`
  - `setResultsTab(...)`
  - `ensure3DContainerSize()`
  - `observeViewCanvases(...)`
  - `handleViewTabChanged(...)`
  - `isScene3DActive()`
- workspace render/bind helpers:
  - `_getSavedTheme()`
  - `_refreshThemeToggleButton()`
  - `_bindThemeToggle()`
  - `_bindSidebarChrome()`
  - `_bindSidebarResizer(...)`
  - `_bindTabs()`
  - `_bindFeedbackButton()`
  - `_bindWindowResize()`
  - `_bindCollapsibleSections()`
  - `_initTooltips()`
  - `_notifyScene3DResize()`
  - `_disconnectViewCanvasObserver()`
- associated file-scope workspace helpers such as:
  - `normalizeViewTab(...)`
  - `normalizeResultsTab(...)`
  - `isScene3DPanelActive()`
  - `dispatchShellResize()`
  - `setSidebarWidth(...)`
  - `syncLeftSidebarSliderState(...)`
  - `resizeCanvasToParent(...)`
  - tooltip markup resolution helpers

Keep these responsibilities out of the new file:

- project menu and modal behavior
- project persistence action routing
- export descriptor building
- config import hydration
- app lifecycle and project load behavior

## Proposed Ports

`ui/workspace-shell.js` should receive one explicit workspace options object:

```text
{
  themeStorageKey,
  onThemeChanged(theme, options),
  onViewTabChanged(tab),
  onResultsTabChanged(tab),
  onScene3DResizeRequested()
}
```

These callbacks are all workspace-shell callbacks, not app-private getters.

Do not add:

- AppState getters
- renderer getters
- project DTO getters

If later work needs more shell state, prefer a pushed DTO or a dedicated method instead of growing the constructor with mixed-purpose callbacks.

## Target File Responsibilities

### `ui/workspace-shell.js`

- own non-project shell DOM querying and render state
- own theme persistence and toggle UI
- own tab activation and layout resize behavior
- own canvas hookup and resize observation
- own generic shell interactions like tooltips, feedback, and collapsible sections
- notify the app through narrow named callbacks only

### `ui/editor-shell.js`

- become a thin composition facade over:
  - `ProjectChromeShell`
  - `WorkspaceShell`
- keep any intentionally shared utility that truly belongs at the facade level only
- continue exposing the stable public shell API used by `ui/app.js`

### `ui/app.js`

- ideally unchanged
- if touched, only keep wiring to the stable `EditorShell` facade
- do not absorb any tab, sidebar, theme, or resize DOM logic

## Implementation Sequence

1. Add `ui/workspace-shell.js` with copied workspace state and workspace binding/render methods.
2. Move workspace constructor state out of `EditorShell`.
3. Move theme, tab, canvas, sidebar, tooltip, feedback, and generic workspace behavior into the new owner.
4. Keep `EditorShell` public methods stable by delegating workspace behavior to the new child.
5. Ensure `destroy()` tears down both composed shell children cleanly.
6. Migrate focused workspace tests to import `WorkspaceShell` directly where appropriate.

## Import Changes

Expected import updates:

- `ui/editor-shell.js` imports `ui/workspace-shell.js`
- `tests/ui/workspace-shell.test.js` imports `ui/workspace-shell.js`

Avoid:

- imports from `ui/workspace-shell.js` into `state/`, `core/`, `viz/`, or `services/`
- any new reverse import from `WorkspaceShell` back into `ui/app.js`

## Compliance Risks

- Do not let `WorkspaceShell` learn project status, project metadata, or project modal state.
- Do not move export descriptor or config hydration behavior into the workspace shell just because the old file owned the UI surface nearby.
- Do not leave duplicate workspace helpers behind in `ui/editor-shell.js`.
- Do not push canvas, tab, or resize DOM logic up into `ui/app.js`.

## Verification Gate

Required checks:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Focused suites:

- `npx vitest run tests/ui/workspace-shell.test.js`
- `npx vitest run tests/ui/app-shell-callbacks.test.js`
- `npx vitest run tests/ui/scene3d-controller.test.js`
- `npx vitest run tests/architecture/layer-boundaries.test.js`

Manual checks:

- theme toggle and persisted reload behavior
- profile, field, and 3D tab switching
- results tab switching and right-sidebar auto-open behavior
- left and right sidebar collapse behavior
- left and right sidebar resize behavior
- 3D resize notification behavior after layout changes
- tooltip visibility and placement
- feedback button behavior

## Definition Of Done

Phase 3 is complete when all of the following are true:

- non-project shell behavior no longer lives directly in `ui/editor-shell.js`
- `ui/workspace-shell.js` owns one coherent workspace-shell responsibility
- `ui/editor-shell.js` is reduced to composition and facade delegation
- `ui/app.js` did not gain theme, tab, resize, or sidebar DOM ownership
- focused workspace tests replace the old mixed workspace assertions in `tests/ui/app-shell-callbacks.test.js`
