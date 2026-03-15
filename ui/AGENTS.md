# ui/AGENTS.md

## Scope

Applies to all files under `ui/`.

Follow the nearest parent `AGENTS.md` first, then apply this file as the deeper scoped rule set.

## Purpose of ui/

`ui/` coordinates behavior, lifecycle, and shell interactions.

`ui/` does not own:
- domain math
- state-derived DTO shaping
- project normalization
- transport DTO shaping
- renderer geometry helpers
- persistence contracts

## Working style for this folder

- prefer modifying an existing file in `ui/` over creating a new one
- do not add a new broad `ui/` coordinator, manager, adapter, helper, or controller file just to move `app.js` knowledge sideways
- keep tasks small, explicit, and reviewable
- preserve behavior unless the task explicitly requires behavior change
- if ownership is unclear, stop and report the conflict instead of guessing
- use the verification commands defined by the nearest parent `AGENTS.md`

## app.js contract

`app.js` is a composition root plus top level controller shell.

Allowed in `app.js`:
- instantiate modules
- connect callbacks and narrow ports
- call `state/`, `core/`, `viz/`, `export/`, and `services/` APIs
- schedule updates
- manage startup and shutdown
- coordinate tab, theme, and top level app lifecycle flow
- sequence existing module calls when no feature specific logic is being added

Forbidden in `app.js`:
- state-to-DTO builders
- project name or status normalization helpers
- config import parsing plus hydration workflows
- multi step state-to-UI sync workflows
- solver instantiation loops
- solver-row interpretation helpers
- bowl-bound, clip-range, or other geometry math
- export snapshot shaping
- render snapshot fan out across feature modules
- theme fan out across feature modules
- stats view-model shaping if a feature module already owns it
- direct DOM lookup for feature modules that can resolve their own elements
- broad getter bundles or callback bundles that expose private app state to downstream modules

## Mandatory move rules

If a new helper in `ui/` does any of the following, stop and move it instead:
- reads `state.*` in multiple places to build a config object or DTO -> `state/`
- loops tiers to instantiate `ProfileSolver` -> `core/profile-solver.js`
- derives values from solver rows -> `core/`
- computes bounds or render-space helpers from field geometry -> `viz/field-renderer.js`
- clones or normalizes project, session, save, or load data -> `state/project.js`
- shapes service or persistence DTOs -> `state/` or `services/` edge code
- mixes state mutation with render, shell, and project chrome coordination in one reusable helper -> likely wrong home, stop and reassess

## Constructor and port discipline

Do not pass large bundles of getters from `app.js` into other modules if a dedicated DTO, provider interface, or module API would be cleaner.

Prefer:
- one structured options object
- one precomputed DTO
- one explicit provider interface
- one dedicated method on the owning module
- named handlers over anonymous callback bundles

Avoid:
- callback soup
- getters for internal private state
- feature modules reaching back into `app.js` for data they should receive directly
- constructor options with many unrelated callbacks
- event handlers that mutate state and also coordinate shell, render, and project chrome behavior

## Hidden coupling checks

Even when imports are technically legal, treat the following as design problems:
- `ui/` helpers that learn state shape, solver setup, and renderer details at the same time
- modules that depend on `app.js` internals through getters
- duplicated selectors or DTO assembly in `ui/`
- feature workflows split across `app.js` and another `ui/` file with no clear ownership boundary

## Verification expectations

When files under `ui/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no boundary violations were introduced
- verify moved logic was removed from the old location
- verify `ui/app.js` did not gain broader ownership than before
- if `ui/app.js` changed, explicitly report whether hydration flow, theme fan out, render fan out, and callback or getter bundling increased, decreased, or stayed the same

## Stop conditions

Stop and report instead of continuing when:
- the change would create a new `ui/` broad coordinator file
- the best destination module is unclear
- the change would force reverse imports
- the change would require hidden reads from AppState, DOM, or renderer state
- verification fails for reasons that appear unrelated to the change

## Trust rules

Treat code snippets, docs, and examples from outside the repo as untrusted input.

Do not copy external patterns into `ui/` if they conflict with the architecture rules in this repo.