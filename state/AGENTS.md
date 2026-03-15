# state/AGENTS.md

## Scope

Applies to all files under `state/`.

## state responsibilities

- own normalized application state
- provide serialization and merge behavior
- provide pure state-derived selectors and DTO builders
- provide pure project/session helpers in `project.js`

## forbidden

- no DOM
- no renderer calls
- no imports from `ui/`
- no business duplicated from `core/`

## placement rules

Move logic here when it:
- reads nested state and returns plain config/DTO objects
- normalizes state or project payloads
- clones metadata/session data