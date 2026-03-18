# Complete Refactor Plan

## Status

- Status: Completed and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Scope: current repository state after the `2026-03-17` aisle and egress ownership work
- Goal: finish the remaining architectural cleanup without reopening already-stabilized `core/`, `viz/`, or the newly-thinned `ui/app.js`

## Inputs

- `AGENTS.md`
- `ui/AGENTS.md`
- `state/AGENTS.md`
- `docs/architecture/target-directory-structure.md`
- `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- `docs/refactors/archive/2026-03-14-full-alignment-implementation-plan.md`
- `docs/refactors/archive/2026-03-15-app-js-full-decoupling-execution-plan.md`
- `docs/refactors/archive/2026-03-15-app-js-thinning-refactor-sequence-overview.md`
- current `app.js`, `ui/*`, `state/*`, `core/*`, `viz/*`, `export/*`, and `tests/*`

## Current Responsibility Map

- Root `app.js`
  - Mostly correct as the route/bootstrap shell.
  - Still owns a long project action port and persistence workflow orchestration.
  - This is a secondary concern, not the first refactor target, because the best compliant destination is still narrow.

- `ui/app.js`
  - Now reads as a composition root and top-level runtime orchestrator.
  - It should stay stable and should not be reopened except where downstream shell contracts change.

- `ui/editor-shell.js`
  - Current highest-risk UI monolith.
  - Mixes project chrome, project menu, project picker, option manager, save/status UI, employee identity, theme, tabs, sidebars, resize, tooltips, feedback, config import, and export dispatch.

- `ui/stats-panel.js`
  - Still mixes pure stats/details DTO shaping with HTML rendering.
  - `ui/render-runtime.js` currently imports `buildStatsViewModel` from a renderer module, which is a boundary smell even though it is technically legal.

- `ui/editor-controls.js`
  - Correctly owns DOM binding.
  - Still carries some pure control-derivation and tier-initialization logic that should be pushed into existing `state/` or `core/` owners.

- `tests/ui/app-shell-callbacks.test.js`
  - Has grown into a mixed harness for `SeatingBowlApp` and `EditorShell` behavior.
  - It should be split once shell features get their own owners.

- `core/*`, `viz/*`, `state/project.js`, and `ui/render-runtime.js`
  - Mostly in the right layer today.
  - They should only receive narrow follow-on changes needed to support the shell and stats cleanup.

## Current Risk Ranking

| File | Current issue | Risk |
| --- | --- | --- |
| `ui/editor-shell.js` | several feature owners bundled into one DOM controller | High |
| `tests/ui/app-shell-callbacks.test.js` | broad mixed test harness hiding feature boundaries | High |
| `ui/stats-panel.js` | DTO builder and renderer coupled together | Medium |
| `ui/editor-controls.js` | DOM binding mixed with some pure derivation helpers | Medium |
| root `app.js` | bootstrap plus long action-port orchestration | Medium, defer until shell split settles |

## Target End State

- Root `app.js` remains the route/bootstrap shell and project-action injector.
- `ui/app.js` remains the configurator composition root, lifecycle owner, and update scheduler.
- `ui/editor-shell.js` becomes a thin shell composition module rather than the direct owner of every toolbar, modal, tab, resize, and theme feature.
- Project-related shell DOM moves behind one dedicated project-chrome owner.
- View/layout/theme shell DOM moves behind one dedicated workspace-shell owner.
- Stats DTO shaping is separated from stats HTML rendering.
- `ui/editor-controls.js` keeps DOM binding but stops owning pure derivation helpers that already fit existing `state/` or `core/` modules.
- Tests mirror the feature boundaries instead of centralizing everything in one shell test file.

## Phase Order

### Phase 1 - Baseline, Characterization, And Doc Sync

Purpose:
- Lock the current post-`ui/app.js` baseline before moving the remaining large UI shells.

Work:
- Add or tighten focused characterization coverage around:
  - project menu and picker flows
  - option manager flows
  - theme/tab/sidebar/resize behavior
  - stats DTO output versus stats rendering
- Update architecture docs so they describe the current runtime truth:
  - `ui/project-shell-controller.js`
  - `ui/render-runtime.js`
  - `ui/scene3d-controller.js`
  - `ui/editor-export-controller.js`
- Mark `ui/editor-shell.js` as the current highest-risk remaining UI monolith.

Files likely touched:
- `docs/architecture/target-directory-structure.md`
- `tests/ui/app-shell-callbacks.test.js`
- new focused test files under `tests/ui/`

Import changes:
- none required in production code

### Phase 2 - Split Project Chrome Out Of `ui/editor-shell.js`

Purpose:
- Remove project-specific shell ownership from the general editor shell.

Exact logic to move:
- project name edit lifecycle
- project save button rendering
- employee identity rendering
- project menu rendering and action dispatch
- project picker modal state, rendering, and row-menu behavior
- project option menu and option manager modal behavior
- modal background locking tied to project picker and option manager
- project-status and project-chrome DOM updates that are specific to the project toolbar surfaces

Primary destination:
- new `ui/project-chrome-shell.js`

Existing destinations considered and rejected:
- `ui/editor-shell.js`
  - Rejected because it is the source monolith and keeping the logic there does not reduce responsibility concentration.
- `ui/project-shell-controller.js`
  - Rejected because it owns plain chrome/status snapshots and save-request shaping, not DOM binding, modal behavior, or user interaction handlers.
- `ui/app.js`
  - Rejected because moving shell DOM there would re-centralize UI knowledge in the top-level app facade.

Why the new file is justified:
- No existing module can own project toolbar DOM, project menu, picker, option-manager interactions, and save-status chrome without violating the current layer boundaries.
- The responsibility is singular: project-related shell UI surfaces and their narrow action callbacks.

Files likely touched:
- new `ui/project-chrome-shell.js`
- `ui/editor-shell.js`
- `ui/app.js`
- `tests/ui/app-shell-callbacks.test.js`
- new `tests/ui/project-chrome-shell.test.js`

Import changes:
- `ui/editor-shell.js` imports and composes `ui/project-chrome-shell.js`
- `ui/app.js` keeps the same outward shell API where possible

### Phase 3 - Split Workspace Shell Out Of `ui/editor-shell.js`

Purpose:
- Separate non-project shell behavior from project toolbar behavior.

Exact logic to move:
- theme read/apply/toggle behavior
- view tab and results tab activation
- canvas hookup and resize observation
- sidebar collapse and resize behavior
- Scene3D resize notifications driven by shell layout changes
- tooltips
- feedback button behavior
- generic collapsible section behavior

Primary destination:
- new `ui/workspace-shell.js`

Existing destinations considered and rejected:
- `ui/editor-shell.js`
  - Rejected because it would preserve the current shell monolith.
- `ui/scene3d-controller.js`
  - Rejected because only a small subset of the layout behavior is 3D-specific; the rest belongs to shared shell layout and tabs.
- `ui/app.js`
  - Rejected because the top-level app should coordinate shell modules, not own shared DOM lookup and resize mechanics.

Why the new file is justified:
- The workspace shell has one clear job: own non-project editor chrome and layout behavior.
- Keeping this logic in `ui/editor-shell.js` would still leave one oversized DOM owner after Phase 2.

Files likely touched:
- new `ui/workspace-shell.js`
- `ui/editor-shell.js`
- `ui/app.js`
- new `tests/ui/workspace-shell.test.js`

Import changes:
- `ui/editor-shell.js` imports and composes `ui/workspace-shell.js`
- `ui/editor-shell.js` becomes a narrow facade over project-chrome and workspace shell features

### Phase 4 - Separate Stats DTO Building From Stats Rendering

Purpose:
- Remove the `RenderRuntime -> StatsPanel renderer module` coupling and keep `StatsPanel` focused on rendering.

Exact logic to move:
- `buildStatsViewModel`
- `buildTierStatsViewModel`
- any pure stats/detail DTO helpers that do not build HTML

Primary destination:
- new `ui/stats-view-model.js`

Existing destinations considered and rejected:
- `ui/stats-panel.js`
  - Rejected because it keeps DTO shaping bundled with HTML generation and keeps `ui/render-runtime.js` dependent on a renderer file.
- `ui/render-runtime.js`
  - Rejected because it would make runtime orchestration own stats-specific labels, formatting, and feature display rules.
- `state/app-state.js`
  - Rejected because the inputs are solved runtime artifacts and reconciled metrics, not canonical application state selectors.

Why the new file is justified:
- The repo does not have a compliant existing home for a stats-specific view-model builder that is pure, UI-facing, and not a renderer.
- This creates one clear feature boundary instead of letting runtime orchestration or HTML rendering absorb the responsibility.

Files likely touched:
- new `ui/stats-view-model.js`
- `ui/stats-panel.js`
- `ui/render-runtime.js`
- `tests/ui/stats-panel.test.js`
- new `tests/ui/stats-view-model.test.js`

Import changes:
- `ui/render-runtime.js` imports from `ui/stats-view-model.js`
- `ui/stats-panel.js` stops exporting view-model builders

### Phase 5 - Finish `ui/editor-controls.js` Purity Cleanup Using Existing Modules

Purpose:
- Keep `EditorControls` as the DOM binding owner, but push pure derivation helpers into existing modules.

Exact logic to move into existing owners:
- extend `state/app-state.js` for any remaining pure control-config selectors or tier-initialization selectors that read only state
- extend `core/profile-solver.js` for any remaining next-tier default derivation that belongs with solver-derived defaults
- leave element lookup, paired input wiring, section enable/disable UI, and event listeners in `ui/editor-controls.js`

Existing destinations:
- `state/app-state.js`
- `core/profile-solver.js`

Files likely touched:
- `ui/editor-controls.js`
- `state/app-state.js`
- `core/profile-solver.js`
- `tests/ui/editor-controls.test.js`

Import changes:
- `ui/editor-controls.js` imports a smaller set of explicit pure helpers from `state/app-state.js` and `core/profile-solver.js`

### Phase 6 - Re-Audit Root `app.js` Against The Thin Bootstrap Contract

Purpose:
- Decide whether any remaining root bootstrap helpers can move without inventing an unauthorized new coordinator.

Allowed moves only:
- move duplicated pure project-name, status, or save-request shaping into `state/project.js` if any still remain
- keep route URL building, session bootstrap, service calls, and project action orchestration in root `app.js` unless a clearly compliant existing owner emerges

Stop condition:
- If the only way to shrink root `app.js` is to add a new root or `ui/` coordinator file, stop and keep the current bootstrap shape.

Files likely touched:
- root `app.js`
- `state/project.js`
- `tests/architecture/layer-boundaries.test.js`
- `tests/ui/app-shell-callbacks.test.js`

Import changes:
- only narrow additional `state/project.js` imports if they replace duplicated pure helpers

### Phase 7 - Final Doc And Test Alignment

Purpose:
- Make the final architecture explicit and executable.

Work:
- update architecture docs to reflect the final shell split
- split large mixed shell tests into feature-owned files
- confirm no stale helper remains in the old modules
- archive superseded refactor notes once implementation lands

Files likely touched:
- `docs/architecture/target-directory-structure.md`
- `docs/architecture/decision-log.md`
- `docs/refactors/archive/*`
- `tests/ui/*`

## Explicit Non-Goals

- no redesign of `core/aisle-layout.js`, `core/profile-solver.js`, `viz/field-renderer.js`, or `viz/scene3d.js` beyond narrow support changes
- no new EventBus, PubSub, service locator, or DI container
- no second app-state object, runtime snapshot mirror, or shadow config cache
- no new vague `ui/` coordinator whose only purpose is to relocate existing knowledge sideways
- no forced shrinkage of root `app.js` if the destination would violate the repo rules

## Verification Commands

Run after each implemented phase:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Targeted suites during execution:

- `npx vitest run tests/architecture/layer-boundaries.test.js`
- `npx vitest run tests/ui/app-shell-callbacks.test.js tests/ui/project-shell-controller.test.js`
- `npx vitest run tests/ui/editor-controls.test.js tests/ui/render-runtime.test.js`
- `npx vitest run tests/ui/scene3d-controller.test.js tests/ui/editor-export-controller.test.js`
- `npx vitest run tests/ui/stats-panel.test.js`
- new focused shell and stats tests added in Phases 2 through 4

Manual checks after shell phases:

- project save, rename, create, open, duplicate, delete
- option create, rename, duplicate, select, delete
- project picker search and row-menu behavior
- theme toggle
- sidebar collapse and resize
- profile/field/3D tab switching
- config import and export menu flow

## Why This Plan Reduces Responsibility Concentration

- It does not reopen the already-stabilized `ui/app.js` extraction work.
- It targets the actual remaining monolith (`ui/editor-shell.js`) instead of only chasing line counts elsewhere.
- It separates project shell, workspace shell, stats DTO shaping, and controls derivation by responsibility rather than by arbitrary file size.
- It preserves the existing layer contracts: `state/` stays pure, `core/` stays pure, `viz/` stays render-focused, and `ui/app.js` stays an orchestrator.

## Completion Gate

This refactor sequence is complete only if all of the following are true:

- `ui/editor-shell.js` is reduced to shell composition and narrow facade methods
- project-related shell DOM ownership no longer lives in the same module as tabs, sidebars, theme, tooltips, and feedback behavior
- `ui/render-runtime.js` no longer imports stats DTO builders from `ui/stats-panel.js`
- `ui/stats-panel.js` is renderer-focused
- `ui/editor-controls.js` keeps DOM ownership only and no longer hoards pure derivation helpers that belong in existing modules
- root `app.js` either remains intentionally thin enough or has only compliant pure-helper moves into `state/project.js`
- no reverse imports are introduced
- no duplicate helper remains in the source module after each move
- tests, lint, build, and typecheck pass when the implementation work is performed
