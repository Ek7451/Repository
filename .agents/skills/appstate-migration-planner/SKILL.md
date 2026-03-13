---
name: appstate-migration-planner
description: Use for AppState design, DOM-to-state migration, save/load preparation, dashboard prerequisites, or any task that changes where application state lives.
---

Convert the prototype from DOM-as-state to one explicit AppState model.

Core rules:
- there is exactly one AppState object
- AppState is the source of truth for configurable parameters
- calculation and export code must not read form values directly
- do not create snapshot, runtimeState, currentConfig, or other competing caches

Audit tasks:
1. find all direct DOM reads that affect behavior
2. find all controller properties acting as state
3. identify which values are canonical versus derived
4. define the minimum complete AppState shape
5. plan the smallest safe migration order

Migration order:
1. define AppState shape
2. wire inputs to update AppState
3. change orchestration to read from AppState
4. remove direct DOM reads from export and calculation-related paths
5. add toJSON() and fromJSON()
6. verify save/load round-trip

Output:
1. state inventory
2. proposed AppState shape
3. canonical vs derived split
4. migration sequence
5. risk register
6. verification checklist