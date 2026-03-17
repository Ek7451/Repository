# Dashboard-to-Configurator Cutover

## Summary
- Deliver this in 3 phases, with no new files.
- The configurator becomes the only interactive route. `/` and direct configurator URLs funnel into the same bootstrap in [app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/app.js).
- In `devBackend=local`, Microsoft SSO is scaffolded but auto-completes with a seeded local session for development.
- First authenticated entry with no `project` query creates and opens a persisted `Untitled Project` containing one default `Option 1`.
- Keep exactly one live AppState. Inactive options are stored only as serialized `AppStateData` snapshots inside the project document.

## Implementation Changes
- Phase 1: remove the dashboard boot path from [app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/app.js), stop routing missing-session users to the dashboard, and delete the legacy dashboard route artifacts once the configurator owns the live entry flow. `DashboardPage` usage is fully removed in the live runtime.
- Phase 1 interface change: [services/auth-service.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/auth-service.js) gets one Microsoft-sign-in seam. Local-dev mode fulfills it with the existing plain session DTO; future real SSO replaces only that service implementation.
- Phase 2: move project chrome into [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js) plus configurator HTML/CSS. Add the 3-part toolbar at the top-left of the center panel: hamburger menu, hover-editable project name field with pencil affordance, and options dropdown.
- Phase 2: the hamburger menu owns `New project`, `Open project`, `Duplicate project`, `Delete project`, `Import`, and `Export`. `Open project` becomes an in-configurator modal with search, row-open, and row overflow duplicate/delete actions. Keep save/theme/sign-out in the left rail for v1 to minimize shell churn; remove the back-to-dashboard affordance.
- Phase 2 interface change: `EditorShell` receives one narrow project/menu action port instead of more direct DOM wiring from the route shell. That port owns semantic actions only: create/open/duplicate/delete project, rename project, select/create/manage option, duplicate/delete/rename option, import/export, sign out.
- Phase 3: extend [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) and [ui/project-shell-controller.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/project-shell-controller.js) to model a project document shaped as `{ id, name, createdAt, updatedAt, activeOptionId, options[] }`, where each option is `{ id, name, color, createdAt, updatedAt, state: AppStateData }`.
- Phase 3 naming rules: default project name is `Untitled Project`; default option names are `Option 1`, `Option 2`, etc.; duplicates append `Copy`; deleting the last remaining option is disallowed.
- Phase 3: [ui/app.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/app.js) stays thin. If it changes at all, limit it to narrow snapshot/load wrappers around the single active AppState. All project-document normalization stays out of it.
- Phase 3 persistence rule: ordinary configurator parameter edits remain explicit-save. Project rename, option rename, option create, option duplicate, option delete, and option selection immediately persist the full project document after staging the active option snapshot.
- Phase 3 service rule: [services/project-api.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/services/project-api.js) keeps plain DTO boundaries, fully supports the new option document in local mode, and normalizes both legacy single-state projects and new option-based projects in API mode. Top-level `sport` remains derived from the active option for list summaries.

## Test Plan
- `/` and `/pages/configurator/index.html` both end in the configurator flow, and `?project=` still opens that project.
- Local-dev auth auto-establishes a stub session, sign-out clears it, and bootstrap re-enters the auth path correctly.
- First authenticated load with no project id creates and opens `Untitled Project` with one default option and default AppState data.
- Hamburger actions behave correctly: create opens a new untitled project, open modal search/open works, duplicate works, delete current project lands in a fresh untitled project, and modal duplicate/delete refresh the list.
- Project name hover/edit autosaves and survives reload.
- Options dropdown and manage modal support select/create/rename/duplicate/delete; switching options swaps the active AppState without creating a second live state source.
- Legacy saved projects containing only `state` load as a single-option project document and save back through the new path.
- Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## Assumptions
- No new files are introduced. [ui/editor-shell.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/ui/editor-shell.js) is the correct DOM owner for toolbar, dropdown, and modal behavior; `ui/app.js` is rejected for that work because it must remain a thin composition/orchestration shell.
- [state/project.js](/c:/Users/Elliott%20Klinger/Desktop/Repository/state/project.js) is the correct home for pure project-document and option DTO helpers; `state/app-state.js` is rejected because inactive options are persisted snapshots, not additional live AppState objects.
- The old dashboard route is no longer part of the live runtime; `pages/dashboard/dashboard.js`, `pages/dashboard/dashboard.html`, `pages/dashboard/dashboard.css`, and `ui/project-dashboard.js` have been removed from the live path.
- Backend and real Microsoft SSO implementation are out of scope for this change. Verification must prove local-dev behavior end-to-end and API-mode DTO compatibility, not a live external integration.
