# viz/AGENTS.md

## Scope

Applies to all files under `viz/`.

Follow the nearest parent `AGENTS.md` first, then apply this file as the deeper scoped rule set.

## viz responsibilities

`viz/` owns:
- rendering
- render-support geometry
- bounds and path helpers needed by rendering
- translation of precomputed inputs into visual output

## Working style for this folder

- prefer extending an existing `viz/` module over adding a new one
- consume explicit inputs
- keep rendering contracts narrow and stable
- keep visual helpers close to the renderer that uses them unless reuse is real
- use the verification commands defined by the nearest parent `AGENTS.md`

## Allowed here

Move logic here when it:
- computes bowl geometry for rendering
- computes field-plan bounds
- derives render-space helper values from bowl geometry
- prepares visual-only data derived from already computed domain values
- owns draw order, camera framing support, or render bounds behavior

## Forbidden

- no project or session logic
- no direct form reads
- no editor shell coordination
- no app lifecycle logic
- no save or load normalization
- no service or transport logic
- no solver construction
- no hidden reads from AppState

## Input rules

`viz/` should consume precomputed inputs from callers.

Prefer:
- explicit render input objects
- explicit geometry arguments
- stable helper APIs

Avoid:
- reading DOM or controls directly
- reaching into `ui/app.js`
- inferring state from shell behavior
- mixing render code with project persistence concerns

## Placement checks

If a helper:
- instantiates or configures a solver -> move to `core/`
- reads nested state to build a config DTO -> move to `state/`
- normalizes project or session payloads -> move to `state/project.js`
- coordinates tabs, shell, or startup flow -> move to `ui/`

## Verification expectations

When files under `viz/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no DOM or form reads were introduced unless the file already explicitly owns the element and the parent rules allow it
- verify no project or session logic leaked in
- verify moved geometry helpers were removed from their old home
- verify render consumers still pass explicit inputs

## Stop conditions

Stop and report instead of continuing when:
- the change would make `viz/` depend on `ui/`
- the change would make `viz/` read live form or shell state
- the logic is actually domain math rather than render-support geometry
- the helper is only being extracted by file size and not by responsibility