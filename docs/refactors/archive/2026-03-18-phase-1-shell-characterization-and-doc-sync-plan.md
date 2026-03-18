# 2026-03-18 Phase 1 Shell Characterization And Doc Sync Plan

## Status

- Status: Completed and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Depends on: none
- Primary goal: lock current shell behavior and current architecture truth before splitting the remaining UI monoliths

## Purpose

This phase is intentionally non-structural in production code.

Its job is to make the current runtime behavior explicit in tests and docs so that Phases 2 and 3 can move `EditorShell` responsibilities without guessing what the existing shell is supposed to do.

## Current-State Findings Driving This Phase

- `ui/editor-shell.js` is still the highest-risk UI monolith in the repo.
- `tests/ui/app-shell-callbacks.test.js` currently mixes:
  - `SeatingBowlApp` facade and orchestration assertions
  - direct `EditorShell` project-option and picker behavior
  - shell layout and theme behavior
- `docs/architecture/target-directory-structure.md` is behind current runtime truth:
  - it still describes `ui/app.js` as directly solving and fanning out all render inputs
  - it does not represent `ui/render-runtime.js` as the current solve/runtime DTO owner
  - it still says `ui/stats-panel.js` builds view models, which is no longer true
  - it does not call out `ui/project-shell-controller.js` as the project chrome/status DTO owner

## Scope Lock

In scope:

- `docs/architecture/target-directory-structure.md`
- `docs/architecture/decision-log.md`
- `tests/ui/app-shell-callbacks.test.js`
- new focused shell test files under `tests/ui/`

Out of scope:

- any structural production refactor in `ui/editor-shell.js`
- any new `ui/` runtime files
- any constructor-contract cleanup in `ui/app.js`

## Architecture Verdict

The smallest compliant move is:

- update docs to describe the runtime that exists today
- split the broad shell test harness by responsibility before production code is split by responsibility
- keep all production imports unchanged in this phase

This phase exists to reduce extraction risk, not to reduce line count.

## Doc Updates Required

### `docs/architecture/target-directory-structure.md`

Update these runtime truths:

- root `app.js` owns route/bootstrap plus the injected project action port
- `ui/app.js` owns the live `AppState`, lifecycle, and top-level orchestration, but delegates solve/runtime DTO work to `ui/render-runtime.js`
- `ui/render-runtime.js` owns:
  - active solver construction
  - field/profile/scene/stats snapshot DTO assembly
  - export-context snapshot assembly
- `ui/project-shell-controller.js` owns project chrome snapshots, project option chrome snapshots, save-request shaping, and normalized status DTOs
- `ui/stats-view-model.js` owns stats/detail view-model shaping
- `ui/stats-panel.js` owns rendering only
- `ui/editor-shell.js` is the current mixed owner of both project and workspace shell behavior and is the next refactor target

### `docs/architecture/decision-log.md`

Add a brief dated decision entry that records:

- the stats view-model split is now implemented
- `ui/app.js` should remain stable while `ui/editor-shell.js` becomes the next UI split target
- future shell extraction should preserve a thin `EditorShell` facade instead of expanding `ui/app.js`

## Test Split Plan

### Keep `tests/ui/app-shell-callbacks.test.js` focused on:

- `SeatingBowlApp` public facade behavior
- root bootstrap and project action port wiring expectations
- `EditorShell` facade method usage from `ui/app.js`
- cross-module shell/runtime wiring that genuinely belongs to app orchestration

### Add `tests/ui/project-chrome-shell.test.js`

Use existing `EditorShell` behavior as the characterization baseline for:

- project name edit start, commit, and cancel flows
- save button busy-state behavior
- project menu open, close, submenu, and action-dispatch behavior
- export-trigger and config-import trigger behavior as project-toolbar menu surfaces
- option trigger menu, option manager open/close, rename, duplicate, delete, and select flows
- project picker open/close, search, row-menu, open, duplicate, and delete flows
- modal background locking and inert-state behavior for project picker and option manager
- employee identity rendering and project status rendering

### Add `tests/ui/workspace-shell.test.js`

Use existing `EditorShell` behavior as the characterization baseline for:

- theme initialization, persistence, and toggle behavior
- view-tab and results-tab activation
- right-sidebar auto-open behavior when switching results tabs
- canvas hookup and resize observation
- 3D container sizing and resize notifications
- sidebar collapse and resize behavior
- feedback-button fallback behavior
- tooltip activation behavior
- generic collapsible-section behavior

## Naming And Ownership Rule For The New Tests

- Name the tests after the target responsibility boundaries, not after the current monolith.
- During Phase 1 they may still import `EditorShell`.
- During Phases 2 and 3 they should migrate to the new owners without changing the tested behavior.

That gives the extraction work a stable test destination instead of forcing another later rename pass.

## Implementation Sequence

1. Update `docs/architecture/target-directory-structure.md` to current runtime truth.
2. Add one short decision-log entry capturing the now-approved shell split direction.
3. Slim `tests/ui/app-shell-callbacks.test.js` down to app/bootstrap and shell-facade concerns.
4. Move direct shell feature assertions into:
   - `tests/ui/project-chrome-shell.test.js`
   - `tests/ui/workspace-shell.test.js`
5. Keep the DOM fakes intentionally lightweight; do not introduce a new shared test-helper module unless duplication becomes a real blocker.

## Compliance Risks

- Do not let this phase drift into production extraction work.
- Do not rewrite assertions to match a desired future shell contract; characterize current behavior first.
- Do not create a new runtime module under `ui/` in the name of test preparation.
- Do not leave architecture docs in a half-current state where `RenderRuntime` and `stats-view-model` are omitted.

## Verification Gate

Required checks:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Focused suites:

- `npx vitest run tests/ui/app-shell-callbacks.test.js`
- `npx vitest run tests/ui/project-chrome-shell.test.js`
- `npx vitest run tests/ui/workspace-shell.test.js`
- `npx vitest run tests/architecture/layer-boundaries.test.js`

## Definition Of Done

Phase 1 is complete when all of the following are true:

- the current runtime documentation reflects `RenderRuntime`, `ProjectShellController`, and `stats-view-model` accurately
- the broad shell test harness is split by target ownership
- Phases 2 and 3 can extract shell behavior against focused tests instead of one mixed integration file
- no production runtime file changed beyond documentation-only references
