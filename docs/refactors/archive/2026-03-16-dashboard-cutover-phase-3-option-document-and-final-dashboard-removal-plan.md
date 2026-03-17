# Dashboard Cutover Phase 3 Option Document And Final Dashboard Removal Plan

## Status

- Status: Planned
- Planned on: 2026-03-16
- Depends on: Phases 1 and 2
- Primary goal: finish option management and remove the last live dashboard implementation paths without introducing a second canonical state source

## Purpose

Phase 3 completes the cutover.

It introduces the persisted multi-option project document, wires the right-side option dropdown and manage modal, keeps exactly one live AppState, and removes the remaining runtime dependence on the old dashboard implementation.

This is the only phase that changes what a saved project `state` blob means.

## Phase Diagram

```mermaid
flowchart LR
    A[Project DTO from service] --> B[state.project normalizeProjectEnvelope]
    B --> C[Project state document]
    C --> D[activeOptionId]
    C --> E[options[] full AppState snapshots]
    D --> F[Load active option snapshot into live AppState]
    F --> G[ui/app.js update/render loop]
    G --> H[User edits active option]
    H --> I[Explicit Save]
    H --> J[Option create/rename/duplicate/delete/select]
    J --> K[Stage active AppState snapshot back into active option]
    K --> L[Persist updated project DTO immediately]
    L --> A
```

## Scope Lock

In scope:

- [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js)
- [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js)
- [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js)
- [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js)
- [app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/app.js)
- [services/project-api.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/project-api.js)
- [scripts/project-api-server.mjs](/c:/Users/Elliott%20Klinger/Desktop/Repository/scripts/project-api-server.mjs)
- legacy dashboard runtime file cleanup
- focused state, service, and shell tests

Out of scope:

- redesigning the core solve/render architecture
- moving project DTO logic into `services/`
- changing the public HTTP shape away from `{ name, state }`

## Architecture Verdict

The smallest compliant move is:

- keep the service contract shape stable as `{ name, state }`
- change the meaning of the persisted `state` blob from raw `AppStateData` to a project state document owned by [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js)
- keep only one live AppState in [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js)
- let [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js) own project chrome plus option metadata snapshots
- let [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js) own the options dropdown and manage modal DOM

Modules considered:

- [state/app-state.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/app-state.js): rejected for inactive option storage because inactive options are persisted project-document snapshots, not live canonical AppState
- [services/project-api.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/project-api.js): rejected for owning project-document normalization because `services/` must stay at the DTO edge
- [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js): rejected for option-document mutation logic beyond thin snapshot capture/load helpers

## Project State Document Shape

Persist the project document inside the existing `project.state` field.

```text
project.state = {
  _projectVersion: "dashboard-cutover-v1",
  sport: string,               // derived from the active option for backward-compatible summaries
  activeOptionId: string,
  options: [
    {
      id: string,
      name: string,
      color: string,
      createdAt: string,
      updatedAt: string,
      state: AppStateData
    }
  ]
}
```

Rules:

- `sport` is a derived summary mirror of the active option's sport and exists only for compatibility with existing project summary derivation.
- exactly one option is active at a time
- inactive options exist only as serialized snapshots inside `project.state.options[]`
- deleting the last remaining option is forbidden
- default option names are `Option 1`, `Option 2`, and so on
- creating a new option creates an empty option from `createDefaultAppStateData()`
- duplicating an option clones that option's full snapshot

## Current Responsibility Slice

Current code gaps before this phase:

- saved projects still treat `project.state` as a single raw AppState JSON object
- [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js) tracks only project metadata and status, not option metadata
- [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js) has no option manager DOM behavior
- [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js) can load one state blob only
- legacy dashboard runtime files still exist even though the live shell moved to configurator

## Target Files And Exact Responsibilities

### [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js)

- define and normalize the project state document shape
- convert legacy single-state projects into one-option documents named `Option 1`
- own pure helpers for:
  - creating the default project state document
  - staging the active AppState snapshot back into the active option
  - selecting, renaming, duplicating, creating, and deleting options
  - deriving the summary `sport` field from the active option

### [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js)

- expand the shell snapshot to include:
  - `activeOptionId`
  - option summaries for the shell
  - option-manager availability flags
- own the plain-data shell view model for project name plus option metadata
- build the save request by combining project metadata with the current project state document, not by inventing option DTOs in `ui/app.js`

### [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js)

- remain the owner of the single live AppState only
- add thin helpers to:
  - capture the current AppState JSON
  - replace the current AppState from an option snapshot
  - sync shell and rerender after an option switch
- do not own option-document normalization or mutation rules

### [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js)

- complete the right-side option dropdown
- add `+ Option` and `Manage` entries
- add the center-screen manage-options modal
- bind rename, duplicate, delete, select, and create actions through the existing structured project action port

### [app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/app.js)

- implement service-backed handlers for:
  - option create
  - option rename
  - option duplicate
  - option delete
  - option select
- on every option action:
  - snapshot the current live AppState
  - delegate document mutation to the correct state/project or project-shell helper
  - persist the updated project DTO immediately
  - reload the active option snapshot into the configurator if the active option changed
- remove the last live references to the legacy dashboard runtime

### [services/project-api.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/project-api.js)

- continue accepting and returning plain `{ name, state }` payloads
- clone the new project state document without leaking controller or AppState instances
- continue to expose project summaries using the compatibility `sport` mirror stored inside the project state document

### [scripts/project-api-server.mjs](/c:/Users/Elliott%20Klinger/Desktop/Repository/scripts/project-api-server.mjs)

- continue storing arbitrary `state` JSON
- when creating or updating a project, keep `project.sport` derived from `payload.state.sport`
- do not require backend schema changes beyond accepting the richer JSON blob

## Option Action Rules

Persisted behavior for this phase:

- project name rename: autosave immediately
- option create: create a new empty option, make it active, persist immediately
- option rename: persist immediately
- option duplicate: persist immediately and make the duplicate active
- option delete: persist immediately; if the active option is deleted, load the nearest remaining option
- option select: stage the current active snapshot first, then switch, then persist
- ordinary bowl/configuration edits: remain explicit-save only in this phase

## Imports To Change

[ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js)

- extend imports from [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) only through explicit DTO helpers if needed
- do not import from `services/`

[services/project-api.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/project-api.js)

- no imports from `state/`
- keep service-level cloning and validation local to the service edge

[app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/app.js)

- delete any remaining imports or references to the legacy dashboard controller

## Implementation Sequence

1. Expand [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) with the project state document model and legacy-project normalization helpers.
2. Update [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js) to expose project chrome plus option summary data.
3. Add the thin AppState snapshot/load helpers to [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js).
4. Complete the options dropdown and manage modal in [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js).
5. Implement the service-backed option handlers in [app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/app.js).
6. Update [services/project-api.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/project-api.js) and [scripts/project-api-server.mjs](/c:/Users/Elliott%20Klinger/Desktop/Repository/scripts/project-api-server.mjs) only as needed to preserve plain DTO transport and summary sport compatibility.
7. Delete or archive the legacy dashboard runtime files once they are unreferenced:
   - [pages/dashboard/dashboard.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/pages/dashboard/dashboard.js)
   - [ui/project-dashboard.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-dashboard.js)

## DTO And Boundary Notes

- The transport contract stays `{ name, state }`; do not add live controller data or new top-level callback-shaped payloads.
- The project state document is persisted JSON, not a second live AppState object.
- All project-document mutation rules belong in [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) or [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js), not in `services/`.
- `services/project-api.js` must still not import `state/`.

## Compliance Risks

- Do not let [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js) become the project-option rules engine.
- Do not create an in-memory option cache separate from the persisted project document plus the single live AppState.
- Do not let [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js) mutate project documents directly; it should emit semantic actions only.
- Do not silently delete the last option.

## Verification Gate

Required checks:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Required focused assertions:

- legacy projects with raw AppState JSON normalize to one option named `Option 1`
- new projects save and reload the full project state document through both local storage mode and the local API server
- selecting an option stages the old active snapshot before loading the new one
- creating an empty option starts from the default AppState JSON
- duplicating and deleting options preserve the single live AppState invariant
- the live app no longer imports or boots the dashboard controller/view

## Definition Of Done

Phase 3 is complete when all of the following are true:

- saved projects persist the multi-option document inside `project.state`
- the configurator can select, create, rename, duplicate, and delete options
- only one live AppState exists at runtime
- option actions autosave immediately while ordinary configuration edits remain explicit-save
- the legacy dashboard runtime is removed from the live application path
- no new reverse imports or service-to-state boundary violations were introduced
