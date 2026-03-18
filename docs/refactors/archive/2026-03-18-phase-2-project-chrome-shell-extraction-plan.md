# 2026-03-18 Phase 2 Project Chrome Shell Extraction Plan

## Status

- Status: Completed and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Depends on: Phase 1 shell characterization and doc sync
- Primary goal: remove project-toolbar, project-menu, project-picker, and option-manager ownership from `ui/editor-shell.js`

## Purpose

This phase splits the project-specific shell surfaces out of the remaining UI monolith while keeping `ui/app.js` stable.

The extraction must reduce responsibility concentration, not just move methods into another same-layer dumping ground.

## Current Responsibility Slice To Extract

The current `ui/editor-shell.js` project chrome slice includes:

- project save button handling and busy rendering
- project status rendering
- project-name edit lifecycle
- project menu rendering, submenu state, and action dispatch
- export trigger and config-import trigger dispatch from the project menu surface
- employee identity rendering in the project toolbar area
- active option trigger and dropdown behavior
- option manager modal state, row actions, rename flows, and busy-state rendering
- project picker modal state, search, row menu, and list actions
- background inert locking tied to project picker and option manager
- project-related document click and `Escape` handling

Today that logic lives beside:

- theme persistence
- view tabs and results tabs
- canvas hookup
- sidebar collapse and resize
- tooltips
- feedback button handling
- generic collapsible section behavior

That is the responsibility concentration this phase must reduce.

## Existing Module Analysis

### Existing destinations considered

- `ui/editor-shell.js`
  - Rejected because it is the source monolith and keeping the project slice there does not reduce responsibility concentration.
- `ui/project-shell-controller.js`
  - Rejected because it is the pure project/status DTO owner.
  - It should not take on DOM binding, modal lifecycle, toolbar event handling, or menu interaction logic.
- `ui/app.js`
  - Rejected because the top-level configurator should coordinate shell modules, not own feature shell DOM.

### New file justification

Create `ui/project-chrome-shell.js` only because the current repo still has no compliant existing owner for:

- project-toolbar DOM
- project-menu DOM and action routing
- project-picker modal UI
- option-manager modal UI
- project-specific shell background locking

Single responsibility of the new file:

- own project-related shell surfaces and their narrow action callbacks

This is not a vague same-layer coordinator because it owns one feature family: project chrome and project-chrome-adjacent modal behavior.

## Scope Lock

In scope:

- new `ui/project-chrome-shell.js`
- `ui/editor-shell.js`
- `ui/app.js` only if a narrow facade seam change is unavoidable
- `tests/ui/project-chrome-shell.test.js`
- `tests/ui/app-shell-callbacks.test.js`

Out of scope:

- workspace shell behavior
- theme, tabs, sidebars, tooltips, feedback, and generic collapsibles
- changes to `ProjectShellController` project DTO semantics
- changes to root `app.js` project action orchestration

## Public API Preservation Rule

Preserve the existing `EditorShell` outward API wherever possible:

- `renderProjectChrome(...)`
- `renderProjectStatus(...)`
- `setProjectSaveBusy(...)`
- `renderOptionChrome(...)`
- `init()`
- `destroy()`

`ui/app.js` should continue talking to `EditorShell`, not directly to `ProjectChromeShell`.

## Exact Logic To Move

Move these current `EditorShell` responsibilities into `ui/project-chrome-shell.js`:

- constructor state for:
  - `_projectChrome`
  - `_projectStatus`
  - `_projectSaveBusy`
  - `_projectMenuOpen`
  - `_projectMenuSubmenu`
  - `_projectMenuBusyAction`
  - `_projectOptionMenuOpen`
  - `_projectOptionManagerOpen`
  - `_projectOptionManagerSearch`
  - `_projectOptionEditingId`
  - `_projectNameEditing`
  - `_projectNameDraft`
  - `_projectOptionNameDrafts`
  - `_skipNextProjectNameBlur`
  - `_optionChrome`
  - `_projectPicker`
- project-facing render methods:
  - `renderProjectChrome(...)`
  - `renderProjectStatus(...)`
  - `setProjectSaveBusy(...)`
  - `renderOptionChrome(...)`
- project DOM binding:
  - `_bindProjectChrome()`
- project rendering helpers:
  - `_renderProjectNameField()`
  - `_renderEmployeeIdentity(...)`
  - `_renderSaveButton()`
  - `_renderOptionChrome()`
  - `_renderOptionManager()`
  - `_renderProjectMenu()`
  - `_renderProjectPicker()`
- project-name editing methods
- option menu and option-manager methods
- project menu methods
- project picker methods
- project-specific document click and `Escape` handling branches
- modal inert/background lock behavior

Keep these responsibilities out of the new file:

- DTO shaping for project metadata, status, or save requests
- persistence service calls
- export descriptor building
- config import parsing or state hydration
- top-level app lifecycle

## Proposed Ports

`ui/project-chrome-shell.js` should receive one narrow options object with explicit ports, not a callback pile:

```text
{
  projectActions,
  onExportRequested(kind),
  onConfigImported({ file, text }),
  getActiveViewTab? or syncFromState(activeViewTab)
}
```

Preferred shape:

- keep `projectActions` as the already-existing structured action port from root `app.js`
- keep export and config-import callbacks separate and explicitly named
- avoid passing AppState getters, renderer getters, or broad app-owned callback bundles

The export button enablement rule should not require a broad getter bundle.

Approved approaches:

- either pass the active view tab through `syncFromState(...)`, or
- pass one narrow `isScene3DActive()` provider if keeping state push would create more churn

Prefer the pushed `activeViewTab` state if it keeps the child module more deterministic.

## Target File Responsibilities

### `ui/project-chrome-shell.js`

- own project toolbar DOM querying and rendering
- own menu open/close and submenu state
- own option dropdown and option-manager state
- own project picker state and loading/busy rendering
- own project-chrome modal background locking
- invoke project action methods and shell callbacks through narrow ports only

### `ui/editor-shell.js`

- become the shell composition facade
- construct `ProjectChromeShell`
- delegate project-facing public methods to it
- keep only non-project shell responsibilities after this phase
- keep `download(...)` on the facade unless moving it is clearly necessary later

### `ui/app.js`

- ideally unchanged
- if touched, only keep constructor wiring and existing `EditorShell` facade calls
- do not gain any project-menu DOM or modal state

## Implementation Sequence

1. Add `ui/project-chrome-shell.js` with copied project state, project render methods, and project event binding logic.
2. Move the project-related constructor state out of `EditorShell` and into `ProjectChromeShell`.
3. Move project rendering helpers and action handlers into the new owner.
4. Keep `EditorShell` public methods stable by delegating to the new child.
5. Move project-specific document click and keydown handling into the new child so `EditorShell` stops owning that feature state.
6. Update focused tests to import and exercise `ProjectChromeShell` directly where possible.
7. Keep `tests/ui/app-shell-callbacks.test.js` for facade-level and `SeatingBowlApp` wiring expectations only.

## Import Changes

Expected import updates:

- `ui/editor-shell.js` imports `ui/project-chrome-shell.js`
- `tests/ui/project-chrome-shell.test.js` imports `ui/project-chrome-shell.js`

Avoid:

- any import from `ui/project-chrome-shell.js` into `state/`, `core/`, or `services/`
- any reverse import from `ProjectShellController` into the new shell module

## Compliance Risks

- Do not move project DOM behavior into `ProjectShellController`.
- Do not let `ProjectChromeShell` read live app state through new getters.
- Do not move export descriptor or config hydration logic into the new file.
- Do not leave duplicate project helper methods behind in `ui/editor-shell.js`.
- Do not let `ui/app.js` gain new project-menu branching just because the child module split is in progress.

## Verification Gate

Required checks:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Focused suites:

- `npx vitest run tests/ui/project-chrome-shell.test.js`
- `npx vitest run tests/ui/app-shell-callbacks.test.js`
- `npx vitest run tests/architecture/layer-boundaries.test.js`

Manual checks:

- save current project
- rename current project
- open hamburger menu and export submenu
- trigger config import from the toolbar menu
- open option menu and option manager
- create, rename, duplicate, select, and delete options
- open project picker, search, open, duplicate, and delete
- confirm background inert-locking for project picker and option manager

## Definition Of Done

Phase 2 is complete when all of the following are true:

- project-toolbar and project-modal behavior no longer live directly in `ui/editor-shell.js`
- `ui/project-chrome-shell.js` owns one coherent project-shell responsibility
- `ui/editor-shell.js` is smaller by responsibility, not only by line count
- `ui/app.js` did not gain project DOM ownership
- `ProjectShellController` remains a pure DTO/status owner
- focused project-chrome tests replace direct project-feature assertions in the old mixed shell harness
