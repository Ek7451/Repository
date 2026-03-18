# 2026-03-18 Phase 7 Final Doc And Test Alignment Plan

## Status

- Status: Completed and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Depends on: Phases 1, 2, 3, 5, and 6 implemented
- Primary goal: make the final architecture explicit, shrink the remaining mixed test surface, and retire superseded active planning notes

## Purpose

This phase closes the loop.

The earlier phases change runtime ownership. This phase makes that ownership visible and durable in:

- architecture docs
- decision log
- test file boundaries
- active versus archived refactor notes

## Expected End State Before This Phase Starts

By the time Phase 7 begins, the codebase should look roughly like this:

- `ui/editor-shell.js` is a thin facade over extracted shell owners
- `ui/project-chrome-shell.js` owns project toolbar/menu/picker/option-manager DOM
- `ui/workspace-shell.js` owns theme/tabs/sidebar/layout shell DOM
- `ui/editor-controls.js` is the DOM binding owner only
- root `app.js` is either unchanged or cleaned up only by a tiny pure-helper move

If any of those are not true, Phase 7 should not try to paper over the mismatch with documentation.

## Scope Lock

In scope:

- `docs/architecture/target-directory-structure.md`
- `docs/architecture/decision-log.md`
- `tests/ui/app-shell-callbacks.test.js`
- `tests/ui/project-chrome-shell.test.js`
- `tests/ui/workspace-shell.test.js`
- `tests/architecture/layer-boundaries.test.js`
- `docs/refactors/active/*`
- `docs/refactors/archive/*`

Out of scope:

- new runtime behavior
- new architectural experiments
- cosmetic documentation cleanup unrelated to the implemented shell split

## Required Doc Updates

### `docs/architecture/target-directory-structure.md`

Reflect the final runtime truth:

- `ui/editor-shell.js` is the facade/composition shell
- `ui/project-chrome-shell.js` owns project-related shell UI
- `ui/workspace-shell.js` owns non-project workspace shell UI
- `ui/render-runtime.js` remains the solve/runtime DTO owner
- `ui/stats-view-model.js` remains the stats view-model owner

Update:

- runtime flow steps
- `ui/` layer summary
- repository map
- logic-flow sections
- current architecture notes

### `docs/architecture/decision-log.md`

Add a dated final-shell-split entry recording:

- why `EditorShell` remains as a thin facade instead of being deleted entirely
- why project and workspace shell ownership were separated
- why `ui/app.js` was intentionally not reopened as the destination

## Required Test Realignment

### `tests/ui/app-shell-callbacks.test.js`

Final responsibility:

- root bootstrap wiring
- `SeatingBowlApp` public facade behavior
- `EditorShell` facade expectations from the app layer
- cross-module integration seams that truly belong to app orchestration

It should no longer be the home for direct project-picker, option-manager, theme-toggle, sidebar-resize, or tooltip behavior tests.

### `tests/ui/project-chrome-shell.test.js`

Final responsibility:

- project toolbar rendering
- menu behavior
- option manager behavior
- project picker behavior
- save/status/employee/project-name UI behavior

### `tests/ui/workspace-shell.test.js`

Final responsibility:

- theme
- tabs
- canvas hookup
- 3D layout resize
- sidebar collapse and resize
- tooltips
- feedback button
- generic collapsibles

### `tests/architecture/layer-boundaries.test.js`

Update only as needed to reflect the new shell file set and confirm:

- no reverse imports
- no `state/` to `ui/` or `viz/` leaks
- no new facade bypass around `ui/editor-shell.js`

## Active And Archive Plan Hygiene

When the implementation is finished:

- keep `docs/refactors/archive/2026-03-18-complete-refactor-plan.md` only if it remains the current umbrella reference after execution
- archive completed phase plan docs once the implemented architecture matches them
- do not archive active plans before the code is actually landed and verified
- leave a clear breadcrumb from archive docs back to the final implemented structure

## Implementation Sequence

1. Update architecture docs to match the implemented runtime, not the earlier proposal.
2. Add the decision-log entry that explains the final shell boundaries.
3. Finish the test-boundary cleanup so each test file maps cleanly to one feature owner.
4. Confirm no stale helper remains in:
   - `ui/editor-shell.js`
   - `ui/editor-controls.js`
   - root `app.js`
5. Move completed plan docs from `active/` to `archive/` only after all verification passes.

## Compliance Risks

- Do not use docs to describe a structure that the code does not yet implement.
- Do not keep stale mixed tests around "just in case" if they duplicate the new focused suites.
- Do not archive the active plans early and lose the execution record before the implementation is stable.
- Do not let `tests/ui/app-shell-callbacks.test.js` remain a catch-all shell dump file.

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

Manual checks:

- project toolbar flows
- workspace layout/theme flows
- direct-entry bootstrap
- export/import surfaces still reachable from the intended shell owners

## Definition Of Done

Phase 7 is complete when all of the following are true:

- the architecture docs describe the implemented runtime accurately
- the decision log records the final shell-boundary decisions
- the large mixed shell harness is fully split by feature ownership
- no stale duplicate helper remains in the old homes
- active and archived refactor docs accurately reflect what is still pending versus what has landed
