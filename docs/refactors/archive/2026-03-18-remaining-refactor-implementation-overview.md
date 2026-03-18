# 2026-03-18 Remaining Refactor Implementation Overview

## Status

- Status: Completed and archived implementation overview
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Source plan: `docs/refactors/archive/2026-03-18-complete-refactor-plan.md`
- Basis: current repository state audited on 2026-03-18
- Goal: turn the remaining high-risk shell and bootstrap work into executable phase plans without reopening already-corrected seams

## Current Codebase Delta Versus The Complete Plan

The high-level complete plan is still directionally correct, but the current repo has already advanced past one of its proposed phases.

Confirmed current-state facts:

- `ui/stats-view-model.js` already exists.
- `tests/ui/stats-view-model.test.js` already exists.
- `ui/render-runtime.js` already imports `buildStatsViewModel` from `ui/stats-view-model.js`.
- `ui/stats-panel.js` is now renderer-focused and consumes a view-model DTO.
- `ui/app.js` is already materially thinner than the older app-thinning plans and should stay stable unless an extracted shell seam forces a narrow facade change.

That means:

- Complete-plan Phase 4 is already implemented in the current codebase.
- The remaining primary monolith is `ui/editor-shell.js`.
- The remaining secondary cleanup target is `ui/editor-controls.js`.
- Root `app.js` should be re-audited late and only changed if a pure helper move is clearly compliant.

## Current Risk Ranking

1. `ui/editor-shell.js`
   - Still mixes project menu, project picker, option manager, project-name editing, employee chrome, theme, tabs, sidebar resize, feedback, tooltips, config import, and export trigger handling.
2. `tests/ui/app-shell-callbacks.test.js`
   - Still mixes `SeatingBowlApp` orchestration assertions with direct `EditorShell` feature behavior.
3. `docs/architecture/target-directory-structure.md`
   - No longer matches current runtime truth for `RenderRuntime`, `ProjectShellController`, or the already-landed stats view-model split.
4. `ui/editor-controls.js`
   - Still holds a small set of pure tier-initialization helpers that should be audited against existing `state/` and `core/` owners.
5. Root `app.js`
   - Still has a long action-port implementation, but most of that logic is bootstrap orchestration and should not be moved just for line count.

## Phase Documents Created From This Overview

- `docs/refactors/archive/2026-03-18-phase-1-shell-characterization-and-doc-sync-plan.md`
- `docs/refactors/archive/2026-03-18-phase-2-project-chrome-shell-extraction-plan.md`
- `docs/refactors/archive/2026-03-18-phase-3-workspace-shell-extraction-plan.md`
- `docs/refactors/archive/2026-03-18-phase-5-editor-controls-purity-cleanup-plan.md`
- `docs/refactors/archive/2026-03-18-phase-6-root-app-bootstrap-reaudit-plan.md`
- `docs/refactors/archive/2026-03-18-phase-7-final-doc-and-test-alignment-plan.md`

No separate Phase 4 plan was created because the current codebase already contains the `stats-view-model` split that the complete plan proposed.

## Execution Order

1. Phase 1
   - Lock behavior with focused tests and update architecture docs to current truth before structural shell extraction.
2. Phase 2
   - Extract project-specific shell ownership out of `ui/editor-shell.js`.
3. Phase 3
   - Extract non-project workspace shell ownership out of `ui/editor-shell.js`.
4. Phase 5
   - Finish the remaining `EditorControls` purity cleanup using existing `state/` and `core/` owners only.
5. Phase 6
   - Re-audit root `app.js` and stop unless a small pure move is clearly justified.
6. Phase 7
   - Realign docs, tests, and active-plan inventory to the final implemented structure.

## Global Guardrails

- Keep `ui/app.js` as a thin composition root and runtime orchestrator.
- Prefer keeping the public `EditorShell` facade stable while changing its internals.
- Do not create a new broad `ui/` coordinator to move `EditorShell` knowledge sideways.
- Only add the two new `ui/` files already justified by the complete plan if the extraction work proves the current repo still has no compliant existing owner:
  - `ui/project-chrome-shell.js`
  - `ui/workspace-shell.js`
- Keep `ProjectShellController` as the pure project/status snapshot owner; do not move DOM behavior there.
- Keep stats work out of the remaining phase queue unless a later shell split forces a tiny import or test adjustment.

## Shared Verification Commands

Run after each implemented phase as applicable:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Targeted suites that should stay green throughout the remaining work:

- `npx vitest run tests/architecture/layer-boundaries.test.js`
- `npx vitest run tests/ui/app-shell-callbacks.test.js`
- `npx vitest run tests/ui/editor-controls.test.js`
- `npx vitest run tests/ui/render-runtime.test.js`
- `npx vitest run tests/ui/scene3d-controller.test.js`
- `npx vitest run tests/ui/editor-export-controller.test.js`
- `npx vitest run tests/ui/stats-panel.test.js tests/ui/stats-view-model.test.js`

Focused shell suites to add during Phases 1 through 3:

- `tests/ui/project-chrome-shell.test.js`
- `tests/ui/workspace-shell.test.js`

## Completion Gate

This remaining sequence is complete only if all of the following are true:

- `ui/editor-shell.js` becomes a thin facade or composition root instead of the direct owner of both project chrome and workspace chrome.
- Project toolbar/menu/picker/option-manager ownership no longer shares a file with theme, tabs, sidebar resize, tooltips, and feedback behavior.
- `ui/app.js` does not regain project DTO shaping, hydration workflows, render fan out, or callback soup.
- `ui/editor-controls.js` keeps DOM binding ownership but not stray pure state or solver helpers that clearly fit existing owners.
- Root `app.js` either stays intentionally thin enough or only receives a documented pure-helper cleanup.
- `docs/architecture/target-directory-structure.md` reflects the runtime that actually exists after implementation.
- The large mixed shell test harness is split by feature ownership.
