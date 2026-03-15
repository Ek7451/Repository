# viz/AGENTS.md

## Scope

Applies to all files under `viz/`.

## viz responsibilities

- rendering
- render-support geometry
- bounds and path helpers needed by rendering

## forbidden

- no project/session logic
- no direct form reads
- no editor shell coordination
- no app lifecycle logic

## placement rules

Move logic here when it:
- computes bowl geometry
- computes field-plan bounds
- derives render-space helper values from bowl geometry