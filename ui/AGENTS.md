# ui/AGENTS.md

## Scope

Applies to all files under `ui/`.

## Purpose of ui/

`ui/` coordinates behavior. It does not own domain math, state-derived DTO shaping, project normalization, or renderer geometry helpers.

## app.js contract

`app.js` is a composition root plus controller shell.

Allowed in `app.js`:
- instantiate modules
- connect callbacks
- call state/core/viz module APIs
- schedule updates
- manage startup/shutdown
- coordinate tab/theme/app lifecycle flow

Forbidden in `app.js`:
- state-to-DTO builders
- project name/status normalization helpers
- solver instantiation loops
- solver-row interpretation helpers
- bowl-bound or clip-range geometry math
- export snapshot shaping
- stats view-model shaping if a feature module already owns it
- direct DOM lookup for feature modules that can resolve their own elements

## Mandatory move rules

If a new helper in `ui/` does any of the following, stop and move it instead:
- reads `state.*` in multiple places to build a config object -> `state/`
- loops tiers to instantiate `ProfileSolver` -> `core/profile-solver.js`
- computes bounds from field geometry -> `viz/field-renderer.js`
- clones or normalizes project/session/save data -> `state/project.js`

## Constructor discipline

Do not pass large bundles of getters from `app.js` into other modules if a dedicated DTO or module API would be cleaner.

Prefer:
- one structured options object
- one precomputed DTO
- one dedicated method on the owning module

Avoid:
- callback soup
- getters for internal private state
- feature modules reaching back into `app.js` for data they should receive directly