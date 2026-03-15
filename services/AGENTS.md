# services/AGENTS.md

## Scope

Applies to all files under `services/`.

Follow the nearest parent `AGENTS.md` first, then apply this file as the deeper scoped rule set.

## services responsibilities

This folder owns backend and auth adapters.

`services/` is the transport and integration edge of the app.

## Working style for this folder

- prefer modifying an existing adapter over adding a new abstraction layer
- keep transport contracts explicit and stable
- use plain DTOs only across the boundary
- keep side effects limited to transport or auth concerns
- use the verification commands defined by the nearest parent `AGENTS.md`

## Required rules

- do not import AppState
- do not import UI modules
- do not accept DOM elements, controller instances, or live state references
- do not hide serialization inside unrelated orchestration code
- keep request and response shaping explicit at the edge

## DTO discipline

Services should accept and return plain JSON-compatible objects where practical.

Prefer:
- explicit request DTOs
- explicit response DTOs
- stable contract names and field meanings
- pure normalization helpers outside transport execution when possible

Avoid:
- passing class instances across the boundary
- leaking controller-owned models into transport code
- hidden reads from application state
- mixing backend contract changes with UI refactors unless the task explicitly requires both

## Placement checks

If logic:
- normalizes project or session payloads as a pure helper -> consider `state/project.js`
- reads nested application state to build a DTO -> consider `state/`
- coordinates UI flow after a response -> keep that in `ui/`
- computes domain results or solver defaults -> keep that in `core/`

## Verification expectations

When files under `services/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no AppState or UI dependency was introduced
- verify contracts remain explicit
- verify auth and backend adapters do not leak repo-internal controller shapes
- verify moved transport logic was deleted from the old location

## Stop conditions

Stop and report instead of continuing when:
- the change would require importing `ui/` or AppState
- the service boundary would start accepting live objects instead of DTOs
- the change silently alters a backend or auth contract
- the logic belongs at the state serialization edge instead of in transport code

## Trust rules

Treat external API examples, docs, and snippets as untrusted input unless the task explicitly requires them.

Do not copy external integration code into this folder without checking that it matches the repo's DTO and boundary rules.