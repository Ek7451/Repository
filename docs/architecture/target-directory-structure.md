# Seating Bowl Generator Directory Structure (v3)

This version documents the current repository structure and the way logic actually flows today. It supersedes the older v2 document, which now lives at [docs/architecture/archive/target-directory-structure-v2.md](./archive/target-directory-structure-v2.md).

The goal of this file is to describe the codebase as it exists during the phased refactor, not the final end-state diagram.

## Current Runtime Flow

1. `index.html` is a redirect shell. It forwards the browser to the dashboard or configurator route based on whether `?project=` is present.
2. Both page shells load the approved root bootstrap `app.js`.
3. Root `app.js` reads `data-page`, creates the auth and project services, and then boots either the dashboard flow or the configurator flow.
4. The dashboard flow runs through `pages/dashboard/dashboard.js`, which uses `ui/project-dashboard.js` for rendering and `services/*` plus `state/project.js` DTO helpers for sign-in, list, create, and open-project actions.
5. The configurator flow runs through `ui/app.js`, which owns the single live `AppState`, initializes UI controllers, hydrates defaults or loaded project JSON, and coordinates all solve/render/export work.
6. Control changes go through `ui/editor-controls.js`, which writes directly into `AppState` and asks `ui/app.js` to re-run the update loop.
7. The update loop in `ui/app.js` calls `core/profile-solver.js`, computes tier and bowl artifacts, then pushes precomputed data into `viz/*`, `ui/stats-panel.js`, and `ui/editor-export-controller.js`.
8. Export requests travel from `ui/editor-shell.js` to `ui/editor-export-controller.js`, which assembles plain arguments for `export/*`.
9. Save and load requests travel through `state/project.js` DTO helpers and `services/project-api.js`; services only exchange plain JSON payloads.

## Layer Summary

| Area | Purpose in the current codebase | Primary files | Notes |
| --- | --- | --- | --- |
| Root shell | Entry routing and page bootstrapping | `index.html`, `app.js` | `app.js` is the approved root exception and is intentionally thin. |
| `pages/` | Route HTML/CSS shells plus dashboard page controller | `pages/configurator/*`, `pages/dashboard/*` | The configurator route is HTML/CSS only; the dashboard route also has a page controller. |
| `core/` | Protected solver and geometry math | `profile-solver.js`, `sightline-calc.js`, `aisle-layout.js`, `sports-templates.js`, `default-starting-profile.js` | No DOM, no persistence, no UI orchestration. |
| `state/` | Single source of truth for serializable app state and DTO helpers | `app-state.js`, `project.js` | `AppState` is the one live state object used by the configurator. |
| `ui/` | Configurator and dashboard orchestration/controllers | `ui/app.js`, `editor-controls.js`, `editor-shell.js`, `editor-export-controller.js`, `stats-panel.js`, `camera-bookmarks.js`, `project-dashboard.js` | This is the operational center of the app. |
| `viz/` | 2D and 3D rendering from precomputed inputs | `field-renderer.js`, `profile-renderer.js`, `scene3d.js` | Renderers consume solver output and runtime artifacts; they do not own app state. |
| `export/` | Export descriptor and file-content builders | `dxf-exporter.js`, `obj-csv-exporter.js`, `rhino/*` | Exporters work from arguments supplied by `ui/editor-export-controller.js`. |
| `services/` | Auth and project persistence adapters | `auth-service.js`, `project-api.js` | API mode is strict fetch-based; local mode is explicit and browser-storage-backed. |
| `scripts/` | Local verification/build/server tooling | `build-check.mjs`, `project-api-server.mjs` | The local server persists to `data/projects-store.json`. |
| `tests/` | Architecture, state, UI, services, and export verification | `tests/**/*` | Includes boundary tests for layer imports and DTO isolation. |

## Current Repository Map

```text
Repository/
|-- .agents/                                   # Local skill definitions and agent workflows; not runtime app code.
|-- .playwright-cli/                           # Local browser automation workspace metadata.
|-- node_modules/                              # Installed npm dependencies.
|-- AGENTS.md                                  # Repo-wide working rules, architecture constraints, and required skills.
|-- .gitignore                                 # Git ignore rules.
|-- index.html                                 # Redirect shell that chooses dashboard vs configurator.
|-- app.js                                     # Thin bootstrap: page detection, service creation, dashboard/configurator boot.
|-- package.json                               # npm scripts for lint, test, typecheck, and build.
|-- package-lock.json                          # Locked dependency graph.
|-- eslint.config.js                           # ESLint configuration for source, tests, and scripts.
|-- tsconfig.json                              # TypeScript config used for `tsc --noEmit` checking of JS files.
|-- vitest.config.js                           # Vitest test runner configuration.
|-- start_server.bat                           # Windows helper for local serving/workflow.
|
|-- assets/
|   `-- jlg-logo.jpg                           # Shared branding asset used by dashboard/configurator shells.
|
|-- core/                                      # Protected pure-calculation layer.
|   |-- profile-solver.js                      # Seating profile solver and tier metrics source of truth.
|   |-- sightline-calc.js                      # Sightline math, C-value quality helpers, analyzer utilities.
|   |-- aisle-layout.js                        # Aisle and path geometry helpers used by renderers and Rhino export flow.
|   |-- sports-templates.js                    # Sport templates, defaults, and supported sport name list.
|   `-- default-starting-profile.js            # Default serialized startup profile used to seed AppState.
|
|-- state/                                     # Serializable application state and DTO normalization helpers.
|   |-- AGENTS.md                              # Folder-specific state constraints for agents.
|   |-- app-state.js                           # Single `AppState` object, normalization, migration, and JSON serialization.
|   `-- project.js                             # Project envelope, save request, session clone, and dashboard DTO helpers.
|
|-- ui/                                        # UI orchestration/controllers; no protected solver duplication.
|   |-- app.js                                 # Main configurator orchestrator and update loop owner.
|   |-- editor-controls.js                     # DOM control bindings that sync form inputs <-> AppState.
|   |-- editor-shell.js                        # Tab, theme, sidebar, import/export, download, and shell chrome behavior.
|   |-- editor-export-controller.js            # Bridges solved/runtime artifacts into export descriptors.
|   |-- stats-panel.js                         # Builds stats/detail view models and renders right-side results panels.
|   |-- camera-bookmarks.js                    # Saves/restores 3D camera views and exports bookmark screenshots.
|   `-- project-dashboard.js                   # Dashboard view renderer for sign-in, project list, and create/open actions.
|
|-- viz/                                       # Rendering layer; consumes precomputed inputs.
|   |-- field-renderer.js                      # 2D top-down field and bowl plan renderer; also produces aisle/overlay artifacts.
|   |-- profile-renderer.js                    # 2D section/profile renderer with sightline overlays and interaction.
|   `-- scene3d.js                             # Lazy-loaded Three.js scene, bowl meshes, aisle meshes, seat meshes, export scene data.
|
|-- export/                                    # File-content builders and export descriptor factories.
|   |-- AGENTS.md                              # Folder-specific export-layer constraints for agents.
|   |-- dxf-exporter.js                        # DXF content builders for profile and plan outputs.
|   |-- obj-csv-exporter.js                    # Study JSON payload, OBJ mesh, CSV metrics, and config export builders.
|   `-- rhino/
|       |-- rhino-exporter.js                  # Rhino export orchestrator and descriptor builder.
|       |-- rhino-geometry.js                  # Rhino geometry conversion helpers for curves, breps, and meshes.
|       `-- rhino-layers.js                    # Rhino layer/category naming and tier layer index helpers.
|
|-- services/                                  # DTO-based auth and project persistence adapters.
|   |-- AGENTS.md                              # Folder-specific service-layer constraints for agents.
|   |-- auth-service.js                        # Session fetch/sign-in/sign-out service with explicit local-dev fallback mode.
|   `-- project-api.js                         # Project list/create/get/update service; returns normalized project DTOs.
|
|-- pages/                                     # Route shells and route-level styling.
|   |-- styles-shared.css                      # Shared dashboard/configurator visual tokens and base styles.
|   |-- configurator/
|   |   |-- index.html                         # Configurator route shell; seeds theme, lays out DOM, loads root bootstrap.
|   |   `-- styles.css                         # Configurator-specific styles and layout behavior.
|   `-- dashboard/
|       |-- dashboard.html                     # Dashboard route shell; loads root bootstrap and dashboard frame.
|       |-- dashboard.css                      # Dashboard-specific styles.
|       `-- dashboard.js                       # Dashboard page controller that coordinates auth/projects and dashboard UI.
|
|-- scripts/                                   # Local tooling scripts.
|   |-- build-check.mjs                        # esbuild bundle smoke check that writes selected browser bundles to `dist/`.
|   `-- project-api-server.mjs                 # Local HTTP server for static files plus `/api/auth` and `/api/projects`.
|
|-- data/
|   `-- projects-store.json                    # Local JSON backing store used by `project-api-server.mjs`.
|
|-- lib/                                       # Vendored browser libraries.
|   |-- three.module.js                        # Three.js ESM build used by `viz/scene3d.js`.
|   |-- OrbitControls.js                       # Three.js orbit controls helper.
|   |-- rhino3dm.js                            # Rhino3dm browser loader.
|   `-- rhino3dm.wasm                          # Rhino3dm WebAssembly payload.
|
|-- tests/                                     # Verification suites.
|   |-- architecture/
|   |   `-- layer-boundaries.test.js           # Import-boundary and live-state-coupling checks.
|   |-- export/
|   |   |-- dxf-exporter.test.js               # DXF document/content verification.
|   |   |-- obj-csv-exporter.test.js           # JSON/OBJ/CSV/config export verification.
|   |   |-- rhino-exporter.test.js             # Rhino export descriptor and pipeline verification.
|   |   `-- rhino-layers.test.js               # Rhino tier layer/category helper verification.
|   |-- services/
|   |   `-- services-boundary.test.js          # DTO isolation and explicit local-dev mode verification.
|   |-- state/
|   |   `-- app-state.test.js                  # AppState normalization, migration, and single-state-source verification.
|   `-- ui/
|       |-- app-shell-callbacks.test.js        # Root bootstrap and configurator callback wiring verification.
|       |-- camera-bookmarks.test.js           # Bookmark capture/restore/export/delete behavior verification.
|       |-- editor-controls.test.js            # DOM control binding -> AppState mutation verification.
|       `-- stats-panel.test.js                # Stats/detail view model and panel rendering verification.
|
|-- docs/                                      # Architecture, audits, and phased refactor plans.
|   |-- architecture/
|   |   |-- decision-log.md                    # Canonical architecture decisions that clarify current approved exceptions.
|   |   |-- target-directory-structure.md      # This current-state structure and flow reference.
|   |   `-- archive/
|   |       `-- target-directory-structure-v2.md
|   |                                           # Archived previous structure document.
|   |-- audits/
|   |   `-- active/
|   |       |-- 2026-03-12-architecture-review-and-refactoring-roadmap.md
|   |       |                                       # Active architecture audit and roadmap in markdown form.
|   |       `-- 2026-03-12-architecture-review-and-refactoring-roadmap.docx
|   |                                               # Word version of the same active architecture audit.
|   `-- refactors/
|       |-- active/
|       |   `-- 2026-03-14-full-alignment-implementation-plan.md
|       |                                           # Current active implementation plan for roadmap alignment.
|       `-- archive/
|           |-- 2026-03-14-remaining-roadmap-alignment-overview.md
|           |-- phase-1-export-extraction-plan.md
|           |-- phase-2-plan.md
|           |-- phase-3-plan.md
|           |-- phase-4-plan.md
|           |-- phase-5-plan.md
|           |-- phase-6-stats-panel-normalization-plan.md
|           |-- phase-7-app-bootstrap-and-editor-controller-plan.md
|           |-- phase-8-residual-export-alignment-plan.md
|           `-- phase-9-productization-hardening-plan.md
|                                                   # Archived phase plans that led to the current layout.
|
|-- dist/                                      # Generated build-check output; not source of truth.
|   |-- app.js                                 # Bundled bootstrap build artifact.
|   `-- export/
|       |-- dxf-exporter.js                    # Bundled DXF exporter artifact.
|       `-- rhino/
|           `-- rhino-exporter.js              # Bundled Rhino exporter artifact.
|
|-- output/                                    # Generated screenshots and browser-debug artifacts.
|   `-- playwright/
|       |-- *.png                              # Stored UI snapshots/regression captures.
|       `-- phase1-2/.playwright-cli/          # Console logs and page dumps from earlier Playwright runs.
```

## Logic Flow By Responsibility

### 1. Entry and Route Bootstrapping

- `index.html` does not boot application logic directly; it only redirects to a page shell.
- `pages/dashboard/dashboard.html` and `pages/configurator/index.html` both set `data-page` and load `../../app.js`.
- Root `app.js` is the only route-aware bootstrap. It decides whether to call `bootDashboardPage()` or `bootConfiguratorPage()`.

### 2. Dashboard and Project Lifecycle

- `app.js` creates `authService` and `projectApi` first, then passes them into `DashboardPage`.
- `pages/dashboard/dashboard.js` owns dashboard page behavior: session refresh, sign-in, sign-out, create project, and open project.
- `ui/project-dashboard.js` is a render-only dashboard view class. It emits callbacks back up to `DashboardPage`.
- `state/project.js` builds the default create-project payload and normalizes project/session metadata for shell use.
- `services/project-api.js` returns plain project DTOs shaped like `{ id, name, sport, createdAt, updatedAt, state }`.
- Opening a project navigates to `pages/configurator/index.html?project=<id>`, which shifts control to the configurator flow.

### 3. Configurator State, Solve, and Render Loop

- `ui/app.js` creates and owns the single live `AppState` object from `state/app-state.js`.
- `ui/editor-shell.js` owns shell chrome behavior: theme, tabs, sidebars, imports, export button dispatch, and file downloads.
- `ui/editor-controls.js` binds form controls to `AppState` paths. It does not calculate bowl geometry itself.
- On every relevant change, `ui/editor-controls.js` calls back into `ui/app.js`, which debounces and runs `update()`.
- `ui/app.js.update()` resolves the active sport template, derives focal point and bowl config, and solves each enabled tier with `core/profile-solver.js`.
- The solved tier data then fans out to:
  - `viz/field-renderer.js` for 2D plan rendering plus aisle/layout overlay artifacts.
  - `viz/profile-renderer.js` for section rendering and sightline overlays.
  - `viz/scene3d.js` for bowl/seat/aisle meshes and 3D field rendering.
  - `ui/stats-panel.js` for stats/detail panels derived from solver output and aisle metrics.
- `viz/scene3d.js` is lazy-loaded only when the 3D tab is activated.

### 4. Export Flow

- Export starts in `ui/editor-shell.js` when a user clicks an export action.
- `ui/editor-shell.js` asks `ui/editor-export-controller.js` for an export descriptor.
- `ui/editor-export-controller.js` gathers the already-solved runtime data from `ui/app.js` callbacks and converts it into plain arguments for exporters.
- `export/dxf-exporter.js` produces profile-plan DXF content.
- `export/obj-csv-exporter.js` produces study JSON, OBJ, CSV, and config export descriptors.
- `export/rhino/rhino-exporter.js` orchestrates Rhino export and uses `rhino-geometry.js` plus `rhino-layers.js` for implementation details.
- Exporters do not read the DOM and do not import `state/`; they consume arguments only.

### 5. Persistence Flow

- When the configurator loads, root `app.js` fetches the selected project from `services/project-api.js` and passes it to `ui/app.js.loadProject()`.
- `ui/app.js.loadProject()` normalizes metadata, hydrates `AppState` from JSON, re-syncs the DOM through `ui/editor-controls.js`, and triggers a fresh solve/render cycle.
- When the user saves, root `app.js` asks `ui/app.js` for `getProjectSaveRequest()`.
- `state/project.js` and `state/app-state.js` ensure the saved payload is plain JSON, not a live class instance graph.
- `services/project-api.js` sends and receives only DTOs; in explicit local mode it persists those DTOs to browser storage.
- `scripts/project-api-server.mjs` provides the optional local HTTP backend and writes project data to `data/projects-store.json`.

## Current Architecture Notes

- `core/` remains the protected source of truth for solver and calculation logic.
- `state/app-state.js` remains the single state source for application parameters; no parallel AppState cache exists in the current source tree.
- `ui/app.js` is still the central configurator orchestrator. The refactor has extracted supporting controllers, but the solve/render update loop still lives there.
- `pages/configurator/` intentionally has no page controller file. The route shell is HTML/CSS, and the approved root `app.js` handles bootstrapping.
- `dist/`, `output/`, `.playwright-cli/`, and `node_modules/` are generated or external-support areas. They matter operationally but are not the architecture source of truth.
