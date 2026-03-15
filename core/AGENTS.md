# core/AGENTS.md

## Scope

Applies to all files under `core/`.

## core responsibilities

- domain rules
- solver construction helpers
- solver result interpretation helpers
- calculation only

## forbidden

- no DOM
- no browser-only APIs
- no imports from `ui/` or `viz/`

## placement rules

Move logic here when it:
- instantiates or configures `ProfileSolver`
- derives values from solver rows
- computes next-tier defaults from prior solver output