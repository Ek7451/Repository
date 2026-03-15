# App.js Thinning Phase 1 Project Boundary Plan

## Status

- Status: Planned
- Planned on: 2026-03-15
- Depends on: current `ui/app.js` audit only
- Primary goal: remove pure project helper logic from `ui/app.js` without changing shell behavior

## Purpose

Phase 1 is the smallest safe extraction in the `ui/app.js` cleanup sequence.

It moves the remaining pure project-name and status-normalization logic into `state/project.js`, which already owns adjacent project/session helpers.

This phase does not redesign persistence, editor lifecycle, or AppState ownership. It only removes pure project helper logic from `ui/app.js`.

## Architecture Verdict

The smallest compliant move is:

- move project-name derivation from `ui/app.js` to `state/project.js`
- move project-status normalization from `ui/app.js` to `state/project.js`
- keep shell callback emission in `ui/app.js`
- keep load/save orchestration in `ui/app.js`

This matches the layer rules:

- `state/project.js` owns pure project naming/status/save helpers
- `ui/app.js` keeps lifecycle and callback orchestration only

## Scope Lock

In scope:

- `ui/app.js`
- `state/project.js`
- tests covering shell callback snapshots and project helper normalization

Out of scope:

- AppState selector extraction
- solver construction extraction
- clip-range and bowl-bounds geometry
- exporter redesign

## Current Responsibility Slice

`ui/app.js` still owns these pure helpers:

- local `normalizeProjectStatus(message, tone)` near the top of the file
- local `_deriveProjectName()` based on `this.state.sport`

Those helpers are used by these app-level methods:

- `getProjectChrome()`
- `getProjectSaveRequest()`
- `setProjectStatus()`
- `loadProject()`

The orchestration in those methods should remain in `ui/app.js`, but the pure helper logic should not.

## Exact Logic To Move

Source logic to move from `ui/app.js`:

- `normalizeProjectStatus(message, tone = 'default')`
- `_deriveProjectName()`

Destination file:

- `state/project.js`

New or expanded `state/project.js` helpers:

- `normalizeProjectStatus(message, tone = 'default')`
- `deriveProjectNameFromSport(sport, fallback = 'Seating')`

Expected `ui/app.js` result after the move:

- `getProjectChrome()` delegates name fallback to `deriveProjectNameFromSport(this.state?.sport)`
- `getProjectSaveRequest()` delegates name fallback to the same helper before calling `buildProjectSaveRequest(...)`
- `setProjectStatus()` delegates normalization to `normalizeProjectStatus(...)`
- `loadProject()` uses the same helper-derived fallback when composing the success message

## Imports To Change

`ui/app.js`

- extend the existing import from `state/project.js`
- remove the local `normalizeProjectStatus` function
- remove the local `_deriveProjectName()` method

`state/project.js`

- no reverse imports
- no DOM access
- no `ui/` dependencies

## Extraction Sequence

1. Add `normalizeProjectStatus` to `state/project.js`.
2. Add `deriveProjectNameFromSport` to `state/project.js`.
3. Update `ui/app.js` imports to consume those helpers.
4. Replace local project-name/status fallback logic with delegated calls.
5. Delete the old local helper function and old private method from `ui/app.js`.
6. Verify project chrome snapshots, save-request naming, and status callback emission still match current behavior.

## Compliance Risks

- The default status message must remain exactly `Project persistence ready`.
- Empty or whitespace-only tones must still normalize to `default`.
- Empty or whitespace-only sports must still produce `Seating Study`.
- `getProjectSaveRequest()` must continue mutating `this._projectMetadata.name` to the normalized trimmed name before refreshing chrome.

## Definition Of Done

Phase 1 is complete when all of the following are true:

- `ui/app.js` no longer contains project-name derivation logic
- `ui/app.js` no longer contains project-status normalization logic
- `state/project.js` owns the pure helpers instead
- `ui/app.js` still emits the same project chrome and status callback payloads
- no duplicate helper remains in `ui/app.js`

## Verification Gate

Required checks:

- `npm run lint`
- `npx vitest run tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- `npm run build`

Recommended focused assertions:

- status callback snapshots remain unchanged
- save request name fallback still resolves to `<sport> Study`
- project chrome snapshots still expose plain DTO data only

