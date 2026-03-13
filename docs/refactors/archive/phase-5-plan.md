# Phase 5 Backend, Auth, Dashboard, And Persistence Productization Plan

## Status

- Status: Complete
- Completed on: 2026-03-13
- Automated verification passed: `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`
- Architecture confirmation: `services/` was added without `state/` imports, dashboard rendering lives in `ui/project-dashboard.js`, project transport stays in `services/`, and study persistence still flows through the single AppState JSON contract in `app.js` and `state/app-state.js`
- Manual QA note: sign-in, dashboard refresh, project create/open/update, AppState hydration, bookmark reopen behavior, and local-theme isolation were reported working in browser checks after implementation

## Completion Summary

Phase 5 shipped with the smallest compliant productization move described in the roadmap:

- `services/auth-service.js` provides a session DTO seam
- `services/projects-service.js` handles project list/create/open/update through plain JSON DTOs only
- `ui/project-dashboard.js` owns dashboard rendering and user interactions without calling transport directly
- `pages/dashboard-page.js` owns dashboard auth/session/project orchestration
- `app.js` keeps the single AppState object and now loads and saves remote projects through `this.state.fromJSON()` and `this.state.toJSON()`
- `index.html` now contains the minimum dashboard/editor shell hooks for the Phase 5 route flow
- `scripts/project-api-server.mjs` and `start_server.bat` provide the lightweight local backend contract and startup path used for project persistence verification

Phase 5 is now complete because authenticated project persistence exists without changing configurable state ownership, reopening the AppState migration, or moving calculations out of the browser.

## Purpose

Phase 5 productizes project persistence after the refactor foundation is in place. The goal is to add authenticated project save/load, a lightweight dashboard, and a thin backend contract without moving calculations off the client and without reopening the AppState migration.

This plan is based on:

- `docs/audits/active/2026-03-12-architecture-review-and-refactoring-roadmap.md`
- `docs/refactors/archive/phase-3-plan.md`
- `docs/refactors/archive/phase-4-plan.md`
- the current `state/app-state.js` serialization contract
- the current `app.js` config export/load seam
- the repo guardrails in `AGENTS.md`

## Architecture Verdict

The smallest compliant Phase 5 move is:

- keep `state/app-state.js` as the only owner of configurable study state
- keep calculations, solve orchestration, renderers, and exports browser-side
- add a thin `services/` layer that only sends and receives plain JSON DTOs
- add `pages/` route shells for dashboard and editor entry flows
- keep dashboard rendering in `ui/` and let `pages/` own service calls
- wrap persisted studies in project metadata without teaching `AppState` about auth, users, or transport

This phase must not:

- move `ProfileSolver`, `SightlineAnalyzer`, `AisleLayout`, or sports template logic onto the server
- let `services/` import `state/` or accept AppState instances directly
- serialize theme, Three.js objects, timers, loading flags, or export menu UI state
- create `currentProjectState`, `projectSnapshot`, `draftState`, or any second application-state cache beside `this.state`
- turn `ui/` into a service layer or let dashboard widgets call backend adapters directly
- combine persistence productization with unrelated page redesign, styling overhaul, or export rewrites

## Current State Review

The current repo is ready for Phase 5 in the specific way the roadmap intended:

- `state/app-state.js` already owns normalized serializable state and exposes `fromJSON()`, `mergeJSON()`, and `toJSON()`
- `app.js` initializes the single AppState during startup and already round-trips config export/load through `this.state.toJSON()` and `this.state.fromJSON()`
- bookmark data already lives inside `this.state.bookmarks`
- stats, DXF, and Rhino logic are already extracted out of the original monolith
- `ui/camera-bookmarks.js` already owns bookmark toolbar/list behavior

Current persistence-related seams:

- `state/app-state.js:26-57` defines the canonical persisted state shape
- `state/app-state.js:382-419` owns AppState JSON hydration and serialization
- `app.js:141` hydrates startup state from `DEFAULT_STARTUP_PROFILE`
- `app.js:1804-1841` exports and loads plain JSON config files through AppState
- `app.js:168-237` keeps theme persistence in `localStorage`, which should remain outside project persistence

Current productization gaps:

- there is no `services/` folder
- there is no `pages/` folder
- there is no auth client, no session abstraction, and no API transport layer
- there is no dashboard or project list UI
- there is no project metadata model around saved AppState payloads
- `package.json` currently includes no auth or backend client dependencies

Phase 5 is successful when authenticated project persistence exists without changing the ownership of application parameters.

## Structure Guardian Verdict

Compliance verdict: Phase 5 should add `services/` and `pages/`, but it should keep their roles narrow.

- `services/` is the correct layer for auth and project transport adapters only.
- `pages/` is the correct layer for route-shell orchestration and service calls.
- `ui/` is the correct layer for dashboard rendering and interaction handling that works from explicit DTOs and callbacks.
- `state/` must remain the only source of truth for study parameters.
- `app.js` should remain the editor orchestration root unless a later phase proves a split is necessary.

Recommended smallest move:

- add `services/auth-service.js`
- add `services/projects-service.js`
- add `ui/project-dashboard.js`
- add `pages/dashboard-page.js`
- touch `app.js`
- touch `index.html`

Optional only if implementation pressure makes it necessary:

- add `pages/editor-page.js` as a thin route shell, but only if the dashboard/editor split becomes awkward inside the current entry flow

Current app-level JavaScript file count, excluding tests, scripts, dist, node_modules, lib, and config files, is `16`. Phase 5 should target `20` preferred and `21` maximum.

## AppState Readiness Verdict

Persisted canonical study state is already available through `AppState.toJSON()`:

- `sport`
- `setup`
- `bowl`
- `occupancy`
- `ui.activeViewTab`
- `ui.activeResultsTab`
- `tiers`
- `bookmarks`

Project metadata that belongs outside AppState:

- `projectId`
- `name`
- `createdAt`
- `updatedAt`
- `ownerId`
- optional dashboard summary fields derived by the backend

Auth and infrastructure state that must stay outside AppState:

- MSAL account/session objects
- access tokens and expiration timestamps
- dashboard filter text, sort order, and loading indicators
- current network request state
- theme preference
- Three.js runtime objects

Phase 5 should treat AppState as the persisted study payload, not as the transport envelope.

## DTO Boundary Check

Services must only handle plain JSON-compatible DTOs. Recommended shapes:

`UserSessionDto`

```json
{
  "userId": "entra-object-id",
  "displayName": "Elliott Example",
  "email": "elliott@example.com"
}
```

`ProjectSummaryDto`

```json
{
  "id": "project_123",
  "name": "Lower Bowl Study",
  "sport": "Football",
  "updatedAt": "2026-03-13T18:22:00.000Z",
  "createdAt": "2026-03-12T21:05:00.000Z"
}
```

`ProjectDetailDto`

```json
{
  "id": "project_123",
  "name": "Lower Bowl Study",
  "createdAt": "2026-03-12T21:05:00.000Z",
  "updatedAt": "2026-03-13T18:22:00.000Z",
  "state": {
    "_version": "phase6-app-state"
  }
}
```

`SaveProjectRequestDto`

```json
{
  "name": "Lower Bowl Study",
  "state": {
    "_version": "phase6-app-state"
  }
}
```

Serialization boundary:

- `app.js` or `pages/editor-page.js` calls `this.state.toJSON()` to produce the `state` field
- `services/projects-service.js` sends and receives DTOs only
- `pages/dashboard-page.js` and the editor shell decide when to hydrate `AppState.fromJSON(project.state)`
- `state/app-state.js` stays unaware of project ids, users, tokens, and HTTP

Hard DTO rules for this phase:

- no `AppState` instance crosses the `services/` boundary
- no `Date`, `Map`, class instances, or DOM nodes cross the `services/` boundary
- bookmark thumbnails remain strings inside the JSON payload until a later dedicated optimization phase

## Import Boundary Audit

Current forbidden imports in the repo areas relevant to Phase 5:

- none detected in the current app/state/ui/viz/export structure

Boundary rules for the new work:

- `services/*` must not import from `state/`
- `services/*` must not import from `ui/`, `viz/`, or `export/`
- `pages/*` may import `ui/`, `state/`, and `services/`
- `ui/project-dashboard.js` should not import `services/`; it should receive DTOs and callbacks from `pages/dashboard-page.js`
- `app.js` should not become a general-purpose API client; persistence entry points should be kept narrow

Smallest compliant dependency direction:

- `pages/dashboard-page.js -> services/auth-service.js`
- `pages/dashboard-page.js -> services/projects-service.js`
- `pages/dashboard-page.js -> ui/project-dashboard.js`
- `pages/dashboard-page.js -> state/app-state.js` only if it needs to prepare a new blank study
- `app.js -> state/app-state.js`
- `app.js -> pages/dashboard-page.js` only through a route-shell entry decision, not through hidden circular imports

## Scope Lock

In scope:

- browser-side auth integration planning and implementation seam
- project list/create/open/update persistence flows
- a lightweight dashboard route or shell
- project metadata around serialized AppState payloads
- a thin backend contract for project CRUD
- save/open flows that use AppState round-trip rather than ad hoc DOM scraping
- preserving the current single-page editor behavior after a project is loaded

Out of scope:

- server-side calculation execution
- collaborative editing
- real-time presence, comments, or version history
- export pipeline redesign
- bookmark thumbnail compression
- global page redesign beyond the minimum route-shell/dashboard work
- React/Vue migration
- replacing `index.html` with a framework router

## Current Responsibility Map

Current persistence and startup responsibilities are concentrated in one editor entry flow:

- `app.js`
  - startup AppState hydration
  - config export/load
  - editor orchestration
  - bookmark save/load through AppState
  - theme persistence outside project state
- `state/app-state.js`
  - canonical study schema
  - normalization
  - JSON round-trip
- `index.html`
  - current single-shell UI only

What is missing today:

- auth/session responsibility
- project metadata ownership
- remote persistence transport
- dashboard route shell
- dashboard UI controller

## Proposed File And Responsibility Map

Introduce these files:

- `services/auth-service.js`
  - wraps MSAL browser login/logout/session retrieval
  - returns `UserSessionDto` only
  - no AppState imports
- `services/projects-service.js`
  - wraps `GET /projects`, `POST /projects`, `GET /projects/:id`, and `PUT /projects/:id`
  - sends and receives project DTOs only
  - no DOM or AppState imports
- `ui/project-dashboard.js`
  - renders project list, empty state, loading state, and create/open actions
  - emits callbacks for open/create/refresh/sign-out
  - no transport logic
- `pages/dashboard-page.js`
  - owns auth/session bootstrap for the dashboard route
  - calls service adapters
  - passes DTOs and callbacks into `ui/project-dashboard.js`

Touch:

- `app.js`
  - add narrow project save/load hooks
  - load remote project DTO state through `AppState.fromJSON()`
  - expose current project name/id to the shell without creating parallel study state
- `index.html`
  - add the minimum shell hooks for dashboard and signed-in editor controls

Optional only if needed:

- `pages/editor-page.js`
  - route shell that composes `app.js` with signed-in project context
  - only add this if the current entry point cannot stay understandable with one dashboard shell

Avoid introducing:

- `services/project-dto.js`
- `services/api-client.js`
- `state/project-state.js`
- `ui/auth-context.js`
- any barrel file

## Recommended Backend Contract

This plan assumes a thin REST backend because the March 12 roadmap explicitly recommended one. To stay aligned with the current JavaScript stack, the preferred first implementation is a small Node/Express service, but the frontend DTO contract should remain valid if the server is later implemented in FastAPI instead.

Required endpoints:

- `GET /projects`
- `POST /projects`
- `GET /projects/:id`
- `PUT /projects/:id`

Recommended persistence model:

```sql
projects (
  id uuid primary key,
  user_id text not null,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  state jsonb not null
)
```

Backend rules:

- authenticate the caller before project access
- authorize by `user_id`
- store AppState JSON opaquely in `state`
- do not reimplement seating calculations server-side
- do not make the backend depend on frontend module structure

## Dashboard And Persistence Sequence

1. Freeze the project DTO contract.
   - Finalize `UserSessionDto`, `ProjectSummaryDto`, `ProjectDetailDto`, and `SaveProjectRequestDto`.
   - Confirm that project metadata stays outside AppState.

2. Add the frontend service boundary.
   - Implement `services/auth-service.js`.
   - Implement `services/projects-service.js`.
   - Keep all payloads plain JSON.

3. Add the first dashboard shell.
   - Implement `ui/project-dashboard.js`.
   - Implement `pages/dashboard-page.js`.
   - Keep service calls in `pages/`, not `ui/`.

4. Wire remote project load into the editor.
   - Load `project.state` through `this.state.fromJSON(project.state)`.
   - Update the DOM from AppState using the existing editor flow.
   - Keep remote-load logic as a thin wrapper around the current config-load seam.

5. Wire remote project save from the editor.
   - Save `this.state.toJSON()` through `projects-service`.
   - Track only project metadata outside AppState.
   - Avoid a second unsaved-changes cache unless a later requirement makes it unavoidable.

6. Add backend implementation.
   - Implement auth verification and project CRUD.
   - Keep server payload validation schema aligned to the frozen DTO contract.

7. Verify round-trip and entry flows.
   - New project from dashboard
   - Open existing project
   - Save over existing project
   - Refresh dashboard and reopen the same project

Reason for this order:

- it locks the transport contract before UI and backend drift apart
- it preserves AppState as the only study-state source
- it keeps the dashboard additive instead of forcing a broad editor rewrite

## Save/Open Behavior Recommendation

Recommended product behavior for the first shippable Phase 5 slice:

- dashboard lists projects and offers create/open only
- editor loads one project at a time
- save is explicit, not background autosave
- opening a project replaces the current AppState in one controlled hydration path
- local config file export/load remains available as a separate offline mechanism

Do not add in the first slice:

- background autosave
- conflict resolution
- cross-tab draft merging
- project version history

## Known Risks And Guardrails

- The biggest failure mode is reintroducing parallel state by storing both `currentProject.state` and `this.state`. The project envelope may track id/name metadata only; the study data lives in `this.state`.
- Auth libraries often encourage singleton global clients. Keep the auth wrapper thin and explicit rather than spreading token logic across UI files.
- Dashboard summary cards may tempt a second derived cache. Prefer the backend returning summary DTOs directly.
- Bookmark thumbnails can make project payloads large. Preserve current behavior first and treat thumbnail optimization as a follow-up.
- If route-shell work starts expanding into a full page framework migration, stop and reassess. Phase 5 is productization, not a frontend rewrite.
- Theme must remain local UI preference, not project data.
- `services/` must stay transport-only. Validation, AppState hydration, and DOM updates stay outside that layer.

## Definition Of Done

Phase 5 is complete when all of the following are true:

- users can authenticate and receive a stable session DTO
- users can list, create, open, and update projects through a thin backend
- project persistence uses `AppState.toJSON()` and `AppState.fromJSON()` as the study payload boundary
- the editor still owns exactly one AppState object
- no service module imports `state/`
- dashboard rendering lives in `ui/` and transport stays outside it
- saved projects reopen with the same sport, tiers, bowl settings, occupancy, active tabs, and bookmarks
- local file export/load still works
- no protected `core/` module is moved or duplicated
- app-level JavaScript file count stays within the repo target range

Expected implementation impact:

- new JavaScript files: `4` preferred, `5` maximum
- touched existing JavaScript files: `2-4`

## Verification Gate

Required automated checks for the implementation turn:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm `services/` imports no files from `state/`
- confirm project save/load uses AppState JSON, not DOM scraping
- confirm no second AppState, snapshot, or project-state cache was introduced
- confirm `ui/project-dashboard.js` does not call transport directly
- confirm `export/` and `viz/` still consume arguments, not backend/session state

Required manual checks:

- verify sign-in and sign-out update the dashboard shell correctly
- verify a new project starts from the intended default AppState
- verify save persists the current study and dashboard refresh shows the updated metadata
- verify open hydrates the editor to the saved state, including bookmarks
- verify local config export then remote save preserve equivalent study data
- verify theme preference still behaves locally and is not stored in project data
- verify opening one remote project after another does not leave stale DOM values behind

Suggested manual matrix:

- create a new football study, save, refresh, and reopen
- modify a multi-tier study with bookmarks, save, and reopen
- open a project, export a local config file, reload the browser, and reopen from the dashboard
- switch theme, save a project, and confirm theme does not travel with the project

## Phase 5 Non-Goals Reminder

Do not combine this phase with:

- solver or sightline rewrites
- export module restructuring
- bookmark compression work
- a React-style state system
- an EventBus or service locator
- server-side calculation ports
- collaborative multiplayer or comment systems
