# Phase 7 App Bootstrap And Editor Controller Plan

## Status

- Status: Planned
- Planned on: 2026-03-14
- Depends on: Phase 6 completion

## Purpose

Phase 7 addresses the biggest remaining structural problem from the March 12 audit: the editor controller is still too large and still shares a file with bootstrap and route-shell behavior.

The goal is to split responsibilities so that:

- the root `app.js` becomes the bootstrap and route shell only
- a dedicated `ui/app.js` owns editor orchestration
- the editor controller is reduced toward the roadmap target of roughly `600-800` lines

## Architecture Verdict

The smallest compliant move is:

- create `ui/app.js`
- move the current editor `App` class into `ui/app.js`
- keep the root `app.js` as a thin entry/bootstrap module
- keep `pages/dashboard-page.js` as the dashboard route shell

This phase should avoid adding a separate `pages/editor-page.js` unless implementation pressure makes it unavoidable. The preferred route-shell split is:

- root `app.js`: entrypoint and route/bootstrap glue
- `pages/dashboard-page.js`: dashboard page shell
- `ui/app.js`: editor controller

That keeps file growth within the repo target while still separating the editor monolith from entry/bootstrap concerns.

## Current Responsibility Map

The current root `app.js` still combines these groups:

- route/bootstrap logic
- dashboard/editor shell switching
- project load/save/sign-out wiring
- project chrome updates
- theme initialization and persistence
- DOM-to-state binding helpers
- tabs, sidebars, tooltips, and resize behavior
- solve/render orchestration
- residual export handling

This mix is the remaining version of the original God Object problem.

## Structure Guardian Verdict

Compliance verdict: `app.js` is still over-burdened even though several responsibilities have already been extracted.

Correct destination after Phase 7:

- root `app.js`
  - boot only
  - route choice only
  - shell wiring only
- `ui/app.js`
  - editor orchestration only
  - AppState bridge only
  - renderer and exporter delegation only

## Import Boundary Audit

Forbidden imports found now:

- none

Boundary cleanup still required:

- route-shell logic should stop living inside the editor controller module
- project service wiring should stop sharing a file with solve/render orchestration

Intended dependency direction after Phase 7:

- root `app.js` -> `ui/app.js`
- root `app.js` -> `pages/dashboard-page.js`
- root `app.js` -> `services/*`
- `ui/app.js` -> `core/`, `state/`, `viz/`, `export/`, `ui/*`

## AppState Boundary Review

Canonical configurable state remains:

- `this.state` in the editor controller

Shell-only or non-project state should remain outside AppState:

- authenticated session DTO
- project metadata DTO
- route mode
- save-button busy state

Derived runtime state may stay on the editor controller:

- current template
- solved tiers
- tier aisle layouts
- scene readiness flags

Do not move session or project metadata into AppState during this phase.

## Scope Lock

In scope:

- create `ui/app.js`
- move the editor `App` class out of the root entry file
- reduce the root `app.js` to bootstrap, route shell, and service orchestration
- expose a narrow public API from the editor controller to the bootstrap shell

Out of scope:

- residual export extraction beyond using the existing exporters
- MSAL/backend hardening
- HTML or CSS restructuring unless the move cannot be wired cleanly without a small shell hook adjustment

## Proposed Public Editor API

Preferred editor-controller surface:

```js
const editorApp = new SeatingBowlApp({
  authSession,
  onProjectNameChanged: (name) => { ... },
  onStatusChanged: ({ message, tone }) => { ... }
});

await editorApp.init();
editorApp.setSession(sessionDto);
editorApp.setProjectMetadata(projectDto);
editorApp.loadProject(projectDto);
editorApp.getProjectSaveRequest();
editorApp.setProjectName(name);
editorApp.destroy?.();
```

Rules:

- the bootstrap shell may own page-level DOM and route controls
- the editor controller may own editor DOM and renderer lifecycle
- services stay outside the editor controller

## Proposed File Split Map

Preferred end-state files after Phase 7:

- `app.js`
  - boot entry
  - route selection
  - dashboard-page creation
  - project load/save/sign-out wiring
- `ui/app.js`
  - editor controller
  - AppState bridge
  - update cycle
  - renderer coordination
  - stats and bookmark controller composition
- `pages/dashboard-page.js`
  - unchanged route-shell role

## Extraction Sequence

0.  Confirm npm run lint covers app.js and ui/stats-panel.js. Fix package.json lint configuration before beginning the extraction so the verification gate is valid at close.
1. Copy the current `App` class into `ui/app.js` without behavior changes.
2. Export a stable editor-controller class from `ui/app.js`.
3. Reduce the root `app.js` to bootstrap code that instantiates the editor controller and dashboard page.
4. Keep the public editor API narrow and DTO-shaped.
5. Rewire project load/save/sign-out through the bootstrap shell only.
6. Remove obsolete editor-class code from the root entry file.
7. Verify the entry route still handles dashboard mode and editor mode correctly.

## Circular Import Risks

Avoid:

- `ui/app.js` importing the root `app.js`
- `pages/dashboard-page.js` importing the editor controller
- service modules importing the editor controller

## Known Risks

- The easiest mistake is leaving half the route-shell DOM code in `ui/app.js`, which recreates the same blend under a different path.
- The bootstrap shell should not become a second editor controller.
- Keep only one AppState owner. The bootstrap shell must not create or cache a second state snapshot.

## Definition Of Done

Phase 7 is complete when all of the following are true:

- root `app.js` is bootstrap-only
- `ui/app.js` owns the editor controller
- service wiring and route switching no longer live inside the editor controller module
- the editor controller public API is explicit and narrow
- AppState ownership stays singular

## Verification Gate

Required checks:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `confirm npm run lint covers root app.js and ui/app.js (carry-forward from Phase 6 lint gap)`

Required architecture checks:

- confirm root `app.js` no longer contains the editor class
- confirm `ui/app.js` does not import `services/`
- confirm no second AppState object or shadow project-state cache was introduced

Required manual checks:

- verify dashboard route still loads without a `project` query param
- verify editor route still loads with a valid `project` query param
- verify sign-out, back-to-dashboard, load-project, and save-project flows still work
- verify the editor still initializes bookmarks, stats, 2D, and 3D views correctly

## Non-Goals

Do not combine this phase with:

- MSAL or backend replacement
- new dashboard features
- export-layer changes beyond existing delegations
