# Seating Bowl Generator Directory Structure (v4)

`Status:` active draft in `docs/architecture/active/`

This version redraws the existing v3 directory guide for faster scanning. It is a presentation cleanup, not a new architecture proposal. The baseline current-state document remains [../target-directory-structure.md](../target-directory-structure.md).

## 1. One-Screen Mental Model

```text
Browser
  -> index.html
     -> app.js (root bootstrap, route-aware)
        `-> Configurator flow
             -> ui/app.js (main orchestrator)
             -> state/app-state.js
             -> core/*
             -> viz/*
             -> ui/editor-*
             -> export/*
             -> services/project-api.js
```

Read it this way:

- `app.js` is the only route-aware bootstrap.
- `ui/app.js` is the configurator orchestration shell, not the math or DTO source of truth.
- `state/` owns serializable state plus DTO shaping helpers.
- `core/` owns calculation and solver logic.
- `viz/` consumes precomputed inputs and renders them.
- `export/` builds files from plain arguments.
- `services/` exchanges plain JSON payloads with auth and project persistence.

## 2. Layer Cheat Sheet

| Area | What it owns | What it should not own | Key anchors |
| --- | --- | --- | --- |
| Root shell | Page detection and app bootstrapping | Solver math, DTO shaping, rendering details | `index.html`, `app.js` |
| `pages/` | Route HTML/CSS shells and shared shell styling | Shared app state, protected math | `pages/configurator/*`, `pages/styles-shared.css` |
| `core/` | Pure calculations, solvers, sightlines, aisle math, sport templates | DOM, renderer state, persistence, editor shell logic | `profile-solver.js`, `sightline-calc.js`, `aisle-layout.js` |
| `state/` | Canonical serializable state, normalization, project/session DTO helpers | DOM access, renderer calls, shell orchestration | `app-state.js`, `project.js` |
| `ui/` | Configurator orchestration, control binding, shell behavior, panel rendering | Duplicated solver math, state DTO builders that belong in `state/`, geometry helpers that belong in `viz/` | `ui/app.js`, `editor-controls.js`, `editor-shell.js` |
| `viz/` | 2D/3D rendering and rendering-adjacent geometry | Direct form reads, project/session logic | `field-renderer.js`, `profile-renderer.js`, `scene3d.js` |
| `export/` | Export descriptor and file-content builders | Live DOM reads, live app state ownership | `dxf-exporter.js`, `obj-csv-exporter.js`, `rhino/*` |
| `services/` | Auth and project persistence adapters | UI orchestration, editor state ownership | `auth-service.js`, `project-api.js` |
| `tests/` | Boundary, behavior, DTO, and rendering verification | Runtime ownership | `tests/**/*` |
| `docs/` | Architecture decisions, audits, refactor plans | Runtime logic | `docs/architecture/*`, `docs/refactors/*` |

## 3. Runtime Flow At A Glance

### Entry and routing

```text
index.html
  -> forwards to configurator route

pages/configurator/index.html
  -> loads ../../app.js

app.js
  -> creates services
  -> detects current page via data-page
  -> boots configurator
```

### Configurator path

```text
app.js
  -> bootConfiguratorPage()
     -> ui/app.js
        -> creates the single live AppState
        -> wires editor shell and controls
        -> runs solve/render/export coordination
```

Configurator update loop:

```text
ui/editor-controls.js
  -> writes changes into AppState
  -> asks ui/app.js to update

ui/app.js.update()
  -> derives solve inputs
  -> calls core/profile-solver.js
  -> fans solved data out to:
     - viz/field-renderer.js
     - viz/profile-renderer.js
     - viz/scene3d.js
     - ui/stats-panel.js
     - ui/editor-export-controller.js
```

Persistence and export:

```text
Save/load
  ui/app.js <-> state/project.js <-> services/project-api.js

Export
  ui/editor-shell.js
    -> ui/editor-export-controller.js
    -> export/*
```

## 4. Annotated Repository Map

### A. Entry, routes, and shared shells

```text
Repository/
|-- index.html                              # Redirect shell: forwards to the configurator route.
|-- app.js                                  # Thin root bootstrap: page detection, service creation, configurator boot.
|-- pages/
|   |-- styles-shared.css                   # Shared visual tokens/base styles for the configurator shell.
|   |-- configurator/
|   |   |-- index.html                      # Configurator route shell; loads ../../app.js.
|   |   `-- styles.css                      # Configurator-only layout and styling.
```

### B. Runtime layers

```text
|-- core/                                   # Pure domain and calculation layer.
|   |-- profile-solver.js                   # Seating profile solver and tier metrics.
|   |-- sightline-calc.js                   # Sightline and C-value helpers.
|   |-- aisle-layout.js                     # Aisle/path geometry helpers reused by rendering/export.
|   |-- sports-templates.js                 # Sport templates and supported sport defaults.
|
|-- state/                                  # Canonical serializable app state and DTO builders.
|   |-- AGENTS.md                           # State-layer working constraints.
|   |-- app-state.js                        # Single live AppState normalization/serialization.
|   `-- project.js                          # Project envelope, save/load, session clone helpers.
|
|-- ui/                                     # Orchestration and controllers.
|   |-- app.js                              # Configurator orchestrator and update loop owner.
|   |-- editor-controls.js                  # DOM control bindings <-> AppState mutations.
|   |-- editor-shell.js                     # Tabs, sidebars, theme, import/export, shell chrome.
|   |-- editor-export-controller.js         # Turns solved/runtime data into exporter arguments.
|   |-- stats-panel.js                      # Stats/detail view model rendering.
|   |-- camera-bookmarks.js                 # 3D bookmark save/restore/export behavior.
|
|-- viz/                                    # Rendering layer fed by precomputed inputs.
|   |-- field-renderer.js                   # 2D plan rendering plus field/bowl overlay artifacts.
|   |-- profile-renderer.js                 # 2D section rendering and sightline overlays.
|   `-- scene3d.js                          # Lazy-loaded 3D scene and mesh generation.
|
|-- export/                                 # File-content builders and export descriptor factories.
|   |-- AGENTS.md                           # Export-layer working constraints.
|   |-- dxf-exporter.js                     # DXF builders for profile/plan outputs.
|   |-- obj-csv-exporter.js                 # Study JSON, OBJ, CSV, and config export builders.
|   `-- rhino/
|       |-- rhino-exporter.js               # Rhino export orchestrator.
|       |-- rhino-geometry.js               # Rhino geometry conversion helpers.
|       `-- rhino-layers.js                 # Rhino layer/category naming helpers.
|
|-- services/                               # DTO-based adapters for auth and persistence.
|   |-- AGENTS.md                           # Service-layer working constraints.
|   |-- auth-service.js                     # Session fetch/sign-in/sign-out service.
|   `-- project-api.js                      # Project list/create/get/update transport layer.
```

### C. Support, assets, and enforcement

```text
|-- assets/
|   `-- jlg-logo.jpg                        # Shared branding asset.
|
|-- lib/
|   |-- three.module.js                     # Vendored Three.js ESM build.
|   |-- OrbitControls.js                    # Three.js orbit control helper.
|   |-- rhino3dm.js                         # Rhino browser loader.
|   `-- rhino3dm.wasm                       # Rhino WebAssembly payload.
|
|-- scripts/
|   |-- build-check.mjs                     # Bundles selected browser entry points into dist/.
|   `-- project-api-server.mjs              # Local static/API server for auth/projects.
|
|-- data/
|   `-- projects-store.json                 # Local JSON backing store for the server script.
|
|-- tests/
|   |-- architecture/                       # Layer boundary and architecture guard tests.
|   |-- export/                             # Exporter verification suites.
|   |-- services/                           # DTO isolation and service behavior tests.
|   |-- state/                              # AppState normalization/migration tests.
|   `-- ui/                                 # App wiring, controls, bookmarks, panel tests.
|
|-- docs/
|   |-- architecture/
|   |   |-- decision-log.md                 # Canonical architecture decisions.
|   |   |-- target-directory-structure.md   # Current v3 current-state reference.
|   |   |-- active/                         # Active architecture drafts, including this file.
|   |   `-- archive/                        # Archived structure docs.
|   |-- audits/                             # Architecture reviews and roadmap docs.
|   `-- refactors/                          # Active and archived refactor plans.
|
|-- dist/                                   # Generated build artifacts; not source of truth.
|-- output/                                 # Generated screenshots/debug artifacts.
|-- .playwright-cli/                        # Browser automation workspace metadata.
`-- node_modules/                           # Installed npm dependencies.
```

## 5. Quick Ownership Lookup

Use this section when you know the type of change but not the destination folder yet.

| If the change is about... | Primary home |
| --- | --- |
| route bootstrapping or choosing the configurator entry path | `app.js` |
| configurator orchestration or top-level update sequencing | `ui/app.js` |
| form control bindings and DOM-to-state sync | `ui/editor-controls.js` |
| shell tabs, theme, sidebar, import/export triggers | `ui/editor-shell.js` |
| project/session save-load DTO shaping | `state/project.js` |
| canonical live configurator state | `state/app-state.js` |
| solver defaults, tier solving, sightline math | `core/` |
| field/bowl render geometry and 2D plan output | `viz/field-renderer.js` |
| section/profile rendering | `viz/profile-renderer.js` |
| 3D scene creation and mesh output | `viz/scene3d.js` |
| export descriptor assembly from already-solved inputs | `ui/editor-export-controller.js` |
| export file generation | `export/` |
| auth and project persistence transport | `services/` |

## 6. Important Boundaries To Keep In Mind

- `core/` does pure calculation only.
- `state/` can normalize and serialize state, but it does not touch the DOM or renderers.
- `viz/` renders from inputs; it does not own project/session logic.
- `export/` consumes arguments; it does not read live DOM state.
- `services/` move DTOs; they do not own UI workflow.
- `ui/app.js` is still the configurator coordination center, but it should stay an orchestration shell.
- `pages/configurator/` intentionally has no page controller file; the root bootstrap handles startup.
- The legacy dashboard route artifacts are no longer part of the live runtime.

## 7. Current "Do Not Misread" Notes

- `dist/`, `output/`, `.playwright-cli/`, and `node_modules/` are operationally important but not architecture source-of-truth directories.
- The presence of `ui/app.js` does not mean `ui/` owns solver math or DTO shaping; it coordinates those concerns through the correct layers.
- `state/app-state.js` remains the single live configurator state source in the current codebase.
- `viz/scene3d.js` is activated lazily from the UI path; it is not part of initial page boot for every route.
- This file documents the repository as it exists now during the phased refactor, not a hypothetical end-state.
