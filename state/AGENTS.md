# state/AGENTS.md

## Scope

Applies to all files under `state/`.

Follow the nearest parent `AGENTS.md` first, then apply this file as the deeper scoped rule set.

## state responsibilities

`state/` owns:
- normalized application state
- serialization and merge behavior
- pure state-derived selectors
- pure state-derived DTO builders
- pure project and session helpers in `project.js`

## Working style for this folder

- prefer extending an existing `state/` module over adding a new one
- keep logic pure and deterministic
- keep inputs and outputs explicit
- return plain data structures unless an existing state class already defines the contract
- use the verification commands defined by the nearest parent `AGENTS.md`

## Allowed here

Move logic here when it:
- reads nested state and returns plain config or DTO objects
- normalizes state or project payloads
- clones metadata or session data
- merges loaded data into canonical state
- derives stable UI input DTOs from canonical state
- provides serialization helpers for save and load flows

## Forbidden

- no DOM
- no renderer calls
- no imports from `ui/`
- no imports from `viz/`
- no browser-only APIs
- no business logic duplicated from `core/`
- no app lifecycle coordination
- no shell behavior
- no transport side effects

## Boundary rules

`state/` may describe data needed by other layers, but it must not coordinate those layers.

Good:
- `state -> plain DTO`
- `state -> pure selector`
- `state -> serialization helper`

Bad:
- `state -> DOM lookup`
- `state -> renderer invocation`
- `state -> shell coordination`
- `state -> service request execution`

## AppState discipline

If this repo uses an AppState model:
- there must be one canonical source of configurable state
- do not create duplicate runtime state mirrors, shadow config objects, or hidden caches
- do not move solver construction or solver-row interpretation into AppState
- do not move geometry helpers into AppState
- do not move project callback emission into AppState

## DTO discipline

State-derived DTO builders should:
- accept explicit inputs
- return plain JSON-compatible data where practical
- avoid hidden reads from globals or DOM
- keep field names stable unless the task explicitly changes the contract

## Verification expectations

When files under `state/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no UI or renderer dependency was introduced
- verify no logic now duplicates `core/`
- verify moved DTO builders or selectors were deleted from their old home
- verify save and load paths still use one canonical state source

## Stop conditions

Stop and report instead of continuing when:
- the change would push solver construction or geometry math into `state/`
- the change would require `state/` to import from `ui/` or `viz/`
- the change would create another competing source of truth
- the correct home looks like `core/`, `viz/`, or `state/project.js` instead