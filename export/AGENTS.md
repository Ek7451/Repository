# export/AGENTS.md

## Scope

Applies to all files under `export/`.

Follow the nearest parent `AGENTS.md` first, then apply this file as the deeper scoped rule set.

## export responsibilities

`export/` owns export formatting, export assembly, and export-specific helpers.

Export modules accept solver output and required inputs as arguments.

## Working style for this folder

- prefer extending an existing exporter over adding a new export abstraction
- keep export contracts explicit and stable
- keep helpers inside the exporter unless reuse is real
- prefer pure functions or small focused classes
- use the verification commands defined by the nearest parent `AGENTS.md`

## Required boundary rules

- no imports from `ui/`
- no direct DOM reads
- no hidden reads from AppState
- no shell coordination
- no project save or load normalization unless the task is explicitly about export persistence format and the parent rules allow it

## Input contract rules

Export code must receive everything it needs through arguments, DTOs, or narrow provider interfaces.

Prefer:
- explicit export input objects
- stable output schemas
- narrow geometry or snapshot providers when direct data passing is impractical

Avoid:
- getters that expose private controller state
- exporter code that reaches back into `app.js`
- export payload assembly in `ui/app.js`
- hidden dependence on current tab, shell state, or DOM state

## Placement checks

If a helper:
- builds state-derived DTOs from nested state -> move to `state/`
- computes solver defaults or interprets solver rows -> move to `core/`
- computes render-space geometry -> move to `viz/`
- normalizes project or session payloads -> move to `state/project.js`

## Verification expectations

When files under `export/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no UI imports or DOM reads were introduced
- verify export inputs are explicit
- verify output shape changes are intentional and documented
- verify moved export helpers were deleted from the old location

## Stop conditions

Stop and report instead of continuing when:
- the exporter needs live AppState or DOM access to function
- the exporter contract would silently change for callers
- the proposed helper belongs in `state/`, `core/`, or `viz/` instead