# core/AGENTS.md

## Scope

Applies to all files under `core/`.

Follow the nearest parent `AGENTS.md` first, then apply this file as the deeper scoped rule set.

## core responsibilities

`core/` owns:
- domain rules
- solver construction helpers
- solver result interpretation helpers
- calculations
- deterministic transformation of domain inputs into domain outputs

## Working style for this folder

- prefer extending an existing `core/` module over adding a new one
- keep logic pure where possible
- keep inputs explicit
- keep outputs explicit
- do not hide behavior behind global state, DOM, or browser APIs
- use the verification commands defined by the nearest parent `AGENTS.md`

## Allowed here

Move logic here when it:
- instantiates or configures `ProfileSolver`
- derives values from solver rows
- computes next-tier defaults from prior solver output
- interprets solver results into domain values
- validates domain assumptions without involving UI or rendering

## Forbidden

- no DOM
- no browser-only APIs
- no imports from `ui/`
- no imports from `viz/`
- no editor shell logic
- no app lifecycle behavior
- no persistence or transport wiring
- no direct form reads
- no renderer calls

## Design rules

Prefer:
- pure functions
- small focused classes when stateful domain objects are truly needed
- deterministic outputs for the same inputs
- plain input and output contracts

Avoid:
- hidden reads from AppState
- mixed UI and domain logic
- mixed rendering and domain logic
- configuration inferred from DOM or shell state
- side-effect driven domain behavior

## Boundary checks

If a helper:
- computes render-space geometry -> move to `viz/`
- reads nested application state to build a DTO -> move to `state/`
- normalizes project or session payloads -> move to `state/project.js`
- coordinates tabs, theme, or shell behavior -> move to `ui/`

## Verification expectations

When files under `core/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no browser, DOM, or UI imports were introduced
- verify moved calculation logic was removed from its old home
- verify callers pass explicit inputs instead of relying on hidden reads

## Stop conditions

Stop and report instead of continuing when:
- the change would require `core/` to know about the shell, renderer, or DOM
- the change mixes solver logic with render geometry
- the proposed helper is actually a state selector or DTO builder
- the change depends on browser-only behavior