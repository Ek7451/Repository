# Phase 9 Productization Hardening Plan

## Status

- Status: Planned
- Planned on: 2026-03-14
- Depends on: Phases 6-8 completion or stable equivalent boundaries

## Purpose

Archived Phase 5 established the right frontend seams but shipped a prototype-friendly stack:

- lightweight auth fallback in the browser
- local project fallback storage
- JSON-file backed server script

Phase 9 brings that implementation into alignment with the March 12 roadmap's real Phase 5 direction:

- browser-side Microsoft auth
- thin authenticated REST API
- durable project persistence
- DTO purity between frontend state and backend transport

## Current Gap Review

What is aligned already:

- `services/` exists
- `services/` does not import `state/`
- dashboard rendering is in `ui/`
- project transport and auth are behind frontend service seams
- project state payloads already flow through `AppState.toJSON()` and `fromJSON()`

What remains misaligned with the March 12 roadmap:

- `services/auth-service.js` still falls back to `localStorage`
- `services/projects-service.js` still falls back to local project storage
- the current server is a lightweight script over a JSON file store
- there is no real Microsoft auth integration
- there is no real database-backed project persistence

## DTO Boundary Check

Violations detected today:

- no direct AppState leakage across `services/`

Current risk:

- prototype local fallback behavior makes the transport boundary look less strict than it should be
- auth and persistence behavior is environment-dependent rather than contract-driven

Required DTO shapes to freeze before implementation:

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
  "createdAt": "2026-03-14T12:00:00.000Z",
  "updatedAt": "2026-03-14T15:45:00.000Z"
}
```

`ProjectDetailDto`

```json
{
  "id": "project_123",
  "name": "Lower Bowl Study",
  "createdAt": "2026-03-14T12:00:00.000Z",
  "updatedAt": "2026-03-14T15:45:00.000Z",
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

- editor controller calls `this.state.toJSON()`
- services send plain JSON DTOs only
- AppState hydration happens outside `services/`

## Structure Guardian Verdict

Compliance verdict: keep the current folder roles and harden the contents.

Frontend layer roles stay the same:

- `services/`: auth and project DTO transport only
- `pages/`: route-shell orchestration only
- `ui/`: rendering and user interaction only
- `state/`: application parameter source of truth only

Backend implementation location is intentionally left open by this plan. It may live:

- in this repo under a dedicated backend workspace, or
- in a sibling repo

The frontend contract must remain the same either way.

## Scope Lock

In scope:

- replace prototype auth fallback with the real Microsoft auth path
- replace prototype project persistence fallback with the real API contract
- harden the backend contract and persistence model
- preserve AppState as the study payload boundary

Out of scope:

- collaborative editing
- autosave/version history
- server-side calculation execution
- redesigning the dashboard UI beyond what auth and project metadata require

## Recommended Frontend Changes

`services/auth-service.js`

- wrap MSAL browser login/session/logout
- return `UserSessionDto` only
- remove implicit `localStorage` fallback from the production path
- if a development mock remains, gate it behind an explicit dev-only switch

`services/projects-service.js`

- become a pure HTTP DTO client
- remove implicit local project persistence from the production path
- retain plain JSON request/response shapes only

`pages/dashboard-page.js`

- continue to own auth bootstrap and project list/create/open flows
- stay free of AppState instance transport

Bootstrap/editor shell

- continue to hydrate and save project payloads only through `AppState.fromJSON()` and `toJSON()`

## Recommended Backend Contract

Required endpoints:

- `GET /projects`
- `POST /projects`
- `GET /projects/:id`
- `PUT /projects/:id`

Required backend rules:

- authenticated access only
- per-user authorization
- AppState stored opaquely as JSON
- no server-side seating calculation

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

## Extraction Sequence

1. Freeze DTO contracts and keep them version-stable.
2. Replace prototype auth fallback with the real auth adapter.
3. Replace prototype project storage fallback with the real HTTP client.
4. Stand up the authenticated backend using the frozen DTO contract.
5. Verify dashboard create/open/update flows against the real backend.
6. Keep the lightweight script only as an explicit dev mock, or retire it entirely.

## Circular Import Risks

Avoid:

- `services/` importing `state/`
- `ui/` calling fetch or MSAL directly
- route shells storing a second serialized project-state object beside AppState

## Known Risks

- The largest risk is reintroducing a second project-state cache while trying to track unsaved remote changes. Keep project metadata outside AppState and study data inside AppState only.
- Auth libraries often encourage global singletons. Keep the auth wrapper explicit and DTO-oriented.
- Do not let backend validation rules drift from the frozen DTO contract.

## Definition Of Done

Phase 9 is complete when all of the following are true:

- sign-in returns a real authenticated session DTO
- project list/create/open/update flows use the real API contract
- services remain plain-DTO only and import no `state/`
- project save/load still uses `AppState.toJSON()` and `fromJSON()`
- prototype local fallback behavior is removed from the production path or isolated behind an explicit dev-only mode

## Verification Gate

Required checks:

- `npm run lint`
- `npm run test`
- `npm run typecheck`
- `npm run build`

Required architecture checks:

- confirm `services/` imports no `state/`
- confirm AppState instances do not cross the `services/` boundary
- confirm no second AppState or project snapshot cache was introduced

Required manual checks:

- verify sign-in and sign-out against the real auth flow
- verify create, open, save, refresh, and reopen against the real backend
- verify bookmarks, tabs, and multi-tier settings survive a remote round-trip
- verify theme remains local-only and not part of persisted project state

## Non-Goals

Do not combine this phase with:

- stats-panel cleanup
- editor-controller file split
- exporter cleanup unrelated to auth/project transport
