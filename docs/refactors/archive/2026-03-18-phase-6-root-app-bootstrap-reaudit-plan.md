# 2026-03-18 Phase 6 Root App Bootstrap Re-Audit Plan

## Status

- Status: Completed as verified no-op and archived
- Completed on: 2026-03-18
- Planned on: 2026-03-18
- Depends on: shell extraction and controls cleanup stable enough to judge the remaining bootstrap shape accurately
- Primary goal: confirm whether root `app.js` needs any final pure-helper cleanup without inventing an unauthorized coordinator

## Purpose

Root `app.js` is an approved exception in this repo.

It is allowed to own:

- route detection
- runtime config resolution
- auth and project service creation
- session bootstrap
- initial project resolution
- injected project action port creation
- redirect and route replacement behavior

This phase exists to prevent a late line-count refactor from violating that contract.

## Current Audit

Current root `app.js` responsibilities are mostly compliant:

- URL/runtime helpers:
  - `resolveRuntimeConfig(...)`
  - `buildConfiguratorUrl(...)`
  - route URL helpers
- bootstrap flow:
  - `bootConfiguratorPage(...)`
  - `bootAppShell(...)`
  - session and project entry helpers
- project action orchestration:
  - `createProjectActionPort(...)`
  - persistence, open, duplicate, delete, rename, sign-out flows

Current pure helper candidates are limited:

- `getProjectActionErrorMessage(...)`
- small project-state staging wrappers around already-existing `state/project.js` helpers

Most of the file is orchestration, not misplaced pure logic.

## Architecture Verdict

Default expectation for this phase:

- root `app.js` likely stays mostly as-is
- only make a move if a pure helper clearly belongs in `state/project.js`
- stop immediately if the only way to shrink the file is to create a new bootstrap or `ui/` coordinator

## Existing Destination Analysis

### `state/project.js`

Acceptable only for:

- pure project name, status, save-request, or project-state-document helpers
- pure helper logic that does not depend on services, routing, history, location, or app lifecycle

### Root `app.js`

Remain here if the logic:

- sequences service calls
- coordinates route replacement
- coordinates app status updates around async work
- depends on `location`, `history`, or bootstrap timing
- is the concrete implementation of the project action port

### Destinations rejected

- new root helper/coordinator file
  - Rejected unless the user later explicitly asks for a new-file bootstrap split.
- moving orchestration into `ui/app.js`
  - Rejected because it would make the configurator runtime route-aware and reopen the wrong shell.

## Scope Lock

In scope:

- `app.js`
- `state/project.js` only if a pure helper move is clearly justified
- `tests/ui/app-shell-callbacks.test.js`
- `tests/architecture/layer-boundaries.test.js`

Out of scope:

- changing the injected project action port contract unless absolutely required
- moving service orchestration into `ui/`
- adding a new bootstrap helper file

## Audit Checklist

For each helper in root `app.js`, ask:

1. Does it sequence async service work, routing, or app lifecycle?
   - If yes, keep it in root `app.js`.
2. Is it a pure project/status/save helper that returns plain data?
   - If yes, consider `state/project.js`.
3. Would moving it require `state/project.js` to learn about services, `location`, `history`, or the app instance?
   - If yes, keep it in root `app.js`.
4. Would moving it only reduce lines while keeping the same responsibility concentration?
   - If yes, do not move it.

## Only Approved Moves

Make a move only if one of these is true:

- a duplicated pure project naming helper is still present in root `app.js`
- a duplicated pure project status helper is still present in root `app.js`
- a duplicated pure save-request shaping helper is still present in root `app.js`

If none of those are true:

- record that root `app.js` remains intentionally thin enough
- do not force a code change

## Implementation Sequence

1. Re-audit the post-Phase-5 root `app.js` against the approved thin-bootstrap contract.
2. Identify any duplicated pure project helper that still exists after the other phases land.
3. If a pure helper exists, move it to `state/project.js` and update imports.
4. If no pure helper exists, keep root `app.js` unchanged and document the explicit no-op decision in the final implementation notes.

## Import Changes

Expected import changes:

- none by default
- at most, a narrow additional import from `state/project.js` into root `app.js`

Avoid:

- importing `ui/app.js` or other UI modules into `state/project.js`
- creating a new root bootstrap helper module
- pushing service or routing logic into `state/project.js`

## Stop Conditions

Stop and leave root `app.js` as-is when:

- the remaining logic is primarily orchestration
- a move would require a new file
- a move would create a vague helper that still knows about services, routes, app status, and project actions together
- the only apparent win is line-count reduction

## Compliance Risks

- Do not turn root `app.js` into a second architecture project.
- Do not reopen `ui/app.js` to absorb route/bootstrap behavior.
- Do not move action-port orchestration into `state/project.js`.
- Do not claim a cleanup is compliant if it only renames the orchestration into another file.

## Verification Gate

Required checks:

- `npm run lint`
- `npm test`
- `npm run typecheck`
- `npm run build`

Focused suites:

- `npx vitest run tests/ui/app-shell-callbacks.test.js`
- `npx vitest run tests/architecture/layer-boundaries.test.js`

Manual checks:

- direct-entry boot still works
- runtime query parameter handling still works
- create/open/duplicate/delete/rename/sign-out flows still work through the injected project action port

## Definition Of Done

Phase 6 is complete when one of the following is true:

- a clearly pure helper moved from root `app.js` into `state/project.js` with no contract drift, or
- the repo documents that root `app.js` is already compliant enough and no code move is justified

In both cases:

- no new coordinator file was introduced
- route/bootstrap orchestration remains in root `app.js`
