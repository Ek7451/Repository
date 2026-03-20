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

Authoritative calculation ownership in `core/`:
- `egress-policy.js` owns aisle and egress policy calculations such as tributary occupancy, required aisle width, governing or assigned aisle width, aisle-count resolution from policy caps, and related compliance checks
- `seat-math.js` owns seat-count conversions from run length, centerline gaps, span gaps, and left or right aisle boundary deductions
- other `core/` modules may measure inputs or assemble summaries, but they must reuse these authoritative helpers instead of cloning the underlying formulas

## Working style for this folder

- prefer extending an existing `core/` module over adding a new one
- keep logic pure where possible
- keep inputs explicit
- keep outputs explicit
- do not hide behavior behind global state, DOM, or browser APIs
- extend the existing authoritative calculation helper before adding a second formula in another `core/` file
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
- one authoritative calculation path per domain value

Avoid:
- hidden reads from AppState
- mixed UI and domain logic
- mixed rendering and domain logic
- configuration inferred from DOM or shell state
- side-effect driven domain behavior
- duplicate formulas for the same seat, aisle, occupancy, required-width, or governing-width value

## Calculated value source of truth

If a calculated value can appear in labels, metrics, exports, summaries, or renderer-facing artifacts:
- compute it from one authoritative `core/` helper or one `core/` summary field derived from that helper
- propagate the computed value downstream instead of recomputing it in another layer
- prefer adding a narrow accessor or summary field over re-deriving the value from intermediate geometry or layout data

Do not:
- re-derive aisle widths in `aisle-layout.js`, `profile-solver.js`, exporters, or renderers when `egress-policy.js` already owns the width logic
- re-derive seat counts from measured gaps when `seat-math.js` already owns the conversion
- keep parallel "estimate", "label", "metric", or "export" formulas for the same domain value unless the prompt explicitly requires different semantics and the distinction is named in the contract

## Boundary checks

If a helper:
- computes render-space geometry -> move to `viz/`
- reads nested application state to build a DTO -> move to `state/`
- normalizes project or session payloads -> move to `state/project.js`
- coordinates tabs, theme, or shell behavior -> move to `ui/`
- computes egress widths, aisle loads, or seat counts from domain inputs -> keep it in the existing authoritative `core/` owner instead of recreating it elsewhere in `core/`

## Verification expectations

When files under `core/` change:
- run the relevant repo verification commands from the nearest parent `AGENTS.md`
- verify no browser, DOM, or UI imports were introduced
- verify moved calculation logic was removed from its old home
- verify callers pass explicit inputs instead of relying on hidden reads
- verify labels, metrics, summaries, and exports still consume the same authoritative `core/` value
- verify no second formula was introduced for aisle widths, aisle occupancies, or seat counts

## Stop conditions

Stop and report instead of continuing when:
- the change would require `core/` to know about the shell, renderer, or DOM
- the change mixes solver logic with render geometry
- the proposed helper is actually a state selector or DTO builder
- the change depends on browser-only behavior
- the proposed change can only be implemented by introducing a second competing source of truth for an existing calculated value
