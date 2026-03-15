# AGENTS.md

## Mission

Keep `ui/app.js` as a thin composition root and orchestration shell.

The repo is being refactored in phases.

For multi-file or structural changes, start in Ask mode and produce a short implementation plan before editing code.

## Architecture north star

- `ui/app.js` is allowed to:
  - construct modules
  - wire callbacks
  - start and stop the app
  - trigger high-level update flow
  - coordinate module calls

- `ui/app.js` is not allowed to:
  - define geometry math
  - shape project DTOs
  - normalize project/session payloads
  - read nested state to build config objects
  - build export payloads
  - compute solver defaults from solver rows
  - compute field-plan bounds
  - own feature-specific DOM query logic when a feature module already exists

## Layer contracts

- `core/`
  - pure domain and calculation logic only
  - no DOM
  - no editor shell logic
  - no app instance state
  - no imports from `ui/` or `viz/`

- `state/`
  - canonical application state and state-derived selectors/DTO builders
  - may normalize, clone, serialize, and merge state
  - may accept template input as arguments
  - no DOM
  - no renderer calls
  - no editor shell imports

- `viz/`
  - rendering and rendering-adjacent geometry only
  - consumes precomputed inputs
  - may expose geometry helpers needed by rendering
  - no direct form reads
  - no project/session logic

- `ui/`
  - orchestration, event wiring, shell coordination
  - no duplicated domain math
  - no duplicated state-shaping helpers already suited for `state/`
  - no renderer geometry helpers already suited for `viz/`

- `state/project.js`
  - project/session cloning
  - project envelope normalization
  - save/load DTO shaping
  - project naming/status helper functions if pure
  - no UI callback emission
  - no DOM
  - no app lifecycle behavior

## Placement rules

When adding or moving code, use these rules:

- If logic reads nested app state and returns plain config or DTO objects, move it to `state/`.
- If logic instantiates solvers, interprets solver rows, or derives next-tier defaults from solver output, move it to `core/profile-solver.js`.
- If logic computes field geometry, bowl bounds, or render-space geometry, move it to `viz/field-renderer.js`.
- If logic normalizes project metadata, session data, save payloads, or project names/status as pure helpers, move it to `state/project.js`.
- If logic only wires modules together, it may stay in `ui/app.js`.

## Import boundaries

Allowed directions:

- `ui/` may import from `state/`, `core/`, `viz/`
- `viz/` may import from `core/` only if needed for rendering support
- `state/` may not import from `ui/` or `viz/`
- `core/` may not import from `ui/`, `viz/`, or browser APIs

Reject any change that introduces reverse imports across these boundaries.

## app.js hard guardrails

Before editing `ui/app.js`, check all of these:

- Is this code only wiring modules or sequencing existing module calls?
- Does it avoid reading more than one nested state branch to build a DTO?
- Does it avoid direct project normalization logic?
- Does it avoid geometry math?
- Does it avoid solver-construction details?
- Does it avoid feature-specific DOM querying already owned by another module?

If any answer is "no", do not add the logic to `ui/app.js`. Place it in the correct module.

## Anti-patterns to reject

- adding "just one helper" to `ui/app.js` for convenience
- duplicated state selectors in `ui/`
- duplicated solver math outside `core/`
- duplicated field geometry outside `viz/`
- export payload assembly in `ui/app.js`
- introducing a second app state object, snapshot cache, or hidden mutable mirror
- EventBus, PubSub, service locator, or dependency injection container patterns

## Refactor workflow

For changes larger than 1 file or 50 lines:

1. Ask mode first:
   - identify target modules
   - list functions to move
   - list imports to change
   - list verification commands

2. Make the smallest valid move:
   - move logic without changing behavior
   - preserve public interfaces unless the task explicitly includes API cleanup

3. Verify:
   - run the required tests
   - run lint if configured
   - verify imports obey the boundary rules
   - verify no duplicated logic remains in `ui/app.js`

## Completion gate

A refactor is not complete unless all of the following are true:

- `ui/app.js` got smaller or simpler
- the moved logic now lives in the correct layer
- no new reverse imports were introduced
- no duplicate helper remains in `ui/app.js`
- tests and verification commands pass
- final notes state exactly what moved and why