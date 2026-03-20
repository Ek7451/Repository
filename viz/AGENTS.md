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

`viz/` does not own the source of truth for domain calculations.
- authoritative aisle, egress, occupancy, and seat-count calculations belong in `core/`
- `viz/` may consume those values, format them, place them, and choose how to display them
- `viz/` may use rendered widths for geometry and band shapes, but it must not invent a separate domain calculation path for labels, metrics, or annotations

## Working style for this folder

- prefer extending an existing `viz/` module over adding a new one
- consume explicit inputs
- keep rendering contracts narrow and stable
- keep visual helpers close to the renderer that uses them unless reuse is real
- treat calculated label values as read-only inputs from authoritative upstream sources
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
- no duplicate seat, egress, occupancy, or aisle-width calculations when `core/` already owns the value

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
- inferring authoritative seat counts, occupancies, required widths, or governing widths from local geometry when those values already exist upstream

## Calculated value consumption rules

For labels, overlays, annotations, and render-adjacent reporting:
- consume authoritative calculated values from `core/` helpers or `core`-produced summaries
- keep `viz/` logic focused on formatting, placement, culling, rotation, and draw order
- if rendered geometry width and governing width differ, use the appropriate upstream field for each purpose instead of collapsing them into one local recomputation

Do not:
- recompute aisle occupancy from rendered polygons
- recompute required or governing aisle width from measured geometry in `viz/`
- recompute seat counts from sampled path gaps when `core/seat-math.js` already owns that conversion
- create `viz/`-local formulas that can diverge from labels, metrics, or exports elsewhere in the app

## Placement checks

If a helper:
- instantiates or configures a solver -> move to `core/`
- reads nested state to build a config DTO -> move to `state/`
- normalizes project or session payloads -> move to `state/project.js`
- coordinates tabs, shell, or startup flow -> move to `ui/`
- computes authoritative seat, occupancy, or egress values -> move to the existing authoritative `core/` module

## Verification expectations

When files under `viz/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no DOM or form reads were introduced unless the file already explicitly owns the element and the parent rules allow it
- verify no project or session logic leaked in
- verify moved geometry helpers were removed from their old home
- verify render consumers still pass explicit inputs
- verify label and annotation values come from authoritative upstream fields rather than `viz/`-local formulas
- verify any value also surfaced in metrics or exports still points back to the same `core/` source

## Stop conditions

Stop and report instead of continuing when:
- the change would make `viz/` depend on `ui/`
- the change would make `viz/` read live form or shell state
- the logic is actually domain math rather than render-support geometry
- the helper is only being extracted by file size and not by responsibility
- the only way to implement the request is to make `viz/` a second source of truth for an existing calculated value
