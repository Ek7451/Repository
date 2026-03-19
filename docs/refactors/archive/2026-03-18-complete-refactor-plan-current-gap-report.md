# 2026-03-18 Complete Refactor Plan Current Gap Report

## Status

- Status: current-state gap report
- Reviewed on: 2026-03-18
- Baseline plan: `docs/refactors/archive/2026-03-18-complete-refactor-plan.md`
- Scope: current repository state on disk
- Goal: identify only the plan items that are not already fully implemented

## Overall Verdict

Most of the 2026-03-18 refactor plan is already implemented.

Confirmed complete based on the current codebase:

- the stats view-model split is landed
- `ui/editor-shell.js` is dramatically thinner and now composes `ProjectChromeShell` and `WorkspaceShell`
- project shell DOM and workspace shell DOM have been split into dedicated files
- the `EditorControls` purity cleanup moved the planned state-derived selectors and tier-initialization helpers into existing `state/` and `core/` owners
- root `app.js` remains the bootstrap and project-action-port owner
- focused shell test files exist and the old mixed shell assertions have largely been pushed into feature-owned suites

Remaining items found in the current repo:

1. `ui/editor-shell.js` still owns part of the config-import feature seam instead of being pure composition/facade code.
2. `docs/architecture/target-directory-structure.md` is not fully synced to the current repository tree and test layout.

## Remaining Item 1: `ui/editor-shell.js` Still Owns Config-Import File Handling

### Why this is still incomplete

The Phase 2 and Phase 3 shell split work was intended to leave `ui/editor-shell.js` as a thin facade/composition shell.

That is mostly true, but the file still directly:

- queries `#configFileInput`
- binds the `change` listener for that input
- reads the selected file text
- forwards the parsed text payload through `onConfigImported`

Current evidence:

- `ui/editor-shell.js:163` binds `configFileInput`
- `ui/editor-shell.js:188` starts `_handleConfigImportChange(...)`
- `ui/editor-shell.js:194` reads `await file.text()`
- `ui/editor-shell.js:195` calls `this._onConfigImported?.({ file, text })`

At the same time, the project-shell owner already handles the project-menu import trigger itself:

- `ui/project-chrome-shell.js:1208` clicks `configFileInput`

### Why this matters against the plan

The split removed almost all project and workspace DOM ownership from `EditorShell`, but config-import file handling is still split across:

- `ui/project-chrome-shell.js` for the menu action
- `ui/editor-shell.js` for the file-input event and file read

That leaves one feature-specific DOM seam in the facade file, so the shell split is not fully finished by responsibility even though it is mostly finished by structure.

### Smallest compliant follow-up

Move the `configFileInput` event binding and file-read handoff out of `ui/editor-shell.js` and into the focused shell owner that already triggers the import surface, while still keeping JSON parsing and state hydration out of the shell layer.

## Remaining Item 2: `docs/architecture/target-directory-structure.md` Is Not Fully Current

### Why this is still incomplete

Phase 7 required the architecture docs and repository map to reflect the implemented structure accurately.

The current document is close, but it still misses part of the current tree:

- it documents `docs/refactors/active/` as an existing empty folder, but that path does not exist in the repository today
- it omits existing test files from the repository map, including:
  - `tests/state/project.test.js`
  - `tests/ui/seating-bowl-app-runtime.test.js`

Current evidence:

- `docs/architecture/target-directory-structure.md:156` to `docs/architecture/target-directory-structure.md:158` describe `docs/refactors/active/`
- `tests/state/project.test.js` exists on disk but is not listed in the `tests/state/` map
- `tests/ui/seating-bowl-app-runtime.test.js` exists on disk but is not listed in the `tests/ui/` map

### Why this matters against the plan

This leaves the Phase 7 doc-alignment work partially complete:

- the code and tests are further along than the architecture doc says
- the repository map is no longer a fully accurate current-state reference

### Smallest compliant follow-up

Update `docs/architecture/target-directory-structure.md` so the repository map matches the real tree:

- either create and document `docs/refactors/active/`, or stop documenting it as a present folder
- add the missing current test files to the repository map
- keep the rest of the runtime ownership notes unchanged unless another mismatch is found during that doc edit

## Items Reviewed And Considered Complete

- `ui/stats-view-model.js` exists and is used by `ui/render-runtime.js`
- `ui/stats-panel.js` is renderer-focused and consumes a view-model DTO
- `ui/editor-shell.js` no longer owns project-menu, project-picker, option-manager, theme, tabs, sidebar resize, tooltip, or feedback behavior directly
- `ui/project-chrome-shell.js` and `ui/workspace-shell.js` both exist and have focused test files
- `state/app-state.js` owns the tier-initialization selectors planned for the `EditorControls` purity cleanup
- `core/profile-solver.js` owns next-tier default derivation
- root `app.js` still looks like the intended bootstrap/project-action owner, not a revived editor monolith
- `tests/ui/app-shell-callbacks.test.js` no longer appears to be the direct home for project-picker, option-manager, theme-toggle, sidebar-resize, or tooltip behavior tests

## Recommended Next Order

1. Finish the config-import seam cleanup in `ui/editor-shell.js`.
2. Sync `docs/architecture/target-directory-structure.md` to the real tree.
3. Re-run the existing verification suite after those two follow-ups.
