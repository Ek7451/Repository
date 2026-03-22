# 2026-03-22 Enterprise Readiness Cutover Checklist

## Status

Assessment: `partially ready`

The codebase can absorb Microsoft SSO and Azure tenant-backed project storage without a rewrite, but it is not ready for the final enterprise switch yet. The immediate seam work already in the repo tightened the main boundaries:

- `app.js` gates `?devBackend=local` to localhost and `file:` development only.
- `services/auth-service.js` exposes an auth-context DTO seam with `status`, `reason`, `session`, and capability flags.
- `services/project-api.js`, `scripts/project-api-server.mjs`, and `state/project.js` preserve optional server-owned project metadata such as `ownerId`, `tenantId`, `lastSyncedAt`, `revision`, and `access`.
- `ui/project-shell-controller.js` and `ui/app.js` accept auth context explicitly so capability-driven UI behavior can evolve without rewiring the shell.

## What Was Implemented Now

### Dev-mode policy

- Local auth and local project storage still exist for development.
- The local backend switch is no longer intended as a production runtime escape hatch.
- Allowed dev entry points:
  - `http://localhost/...?...&devBackend=local`
  - `file:///.../pages/configurator/index.html?devBackend=local`
- Non-local hosts must ignore `?devBackend=local`.

### Auth seam

- The app can now distinguish:
  - `authenticated`
  - `unauthenticated`
  - `forbidden`
  - `error`
- Capability flags exist for:
  - project create, list, and open
  - project rename, duplicate, and delete
  - project save
  - project option management

### Project DTO seam

- Project save requests can carry `revision`.
- Project summaries and details can carry optional metadata from a future backend:
  - `ownerId`
  - `tenantId`
  - `lastSyncedAt`
  - `revision`
  - `access`
- Local dev storage now keys ownership to the session principal id first, while still reading legacy email-owned records.

### UI seam

- The Employee Strip path remains session-driven and ready for:
  - `displayName`
  - `email`
  - `jobTitle`
  - `photoUrl`
- UI rendering still does not depend on Microsoft-specific APIs directly.

## What Is Still Left To Do

### Must do before Microsoft SSO cutover

- Replace the scaffold auth server flow with a real Microsoft Entra ID sign-in flow.
- Move session verification to a server-authoritative implementation.
- Stop trusting browser-submitted profile identity as the source of truth.
- Define the production auth-state payload returned by the backend:
  - `status`
  - `reason`
  - `session`
  - `capabilities`

### Must do before Azure tenant storage cutover

- Replace local or browser-backed project persistence with a backend-owned project API backed by tenant storage.
- Make server revision handling authoritative.
- Add server-side access enforcement for project read, write, delete, and share operations.
- Decide and document the final ownership model:
  - user principal id
  - tenant scope
  - any shared-access model

### Must do before Intune-aligned access rollout

- Add backend capability issuance based on enterprise policy and device or access posture.
- Treat `forbidden` as a first-class state in the UI, not a generic auth failure.
- Ensure access control is enforced server-side even if the client hides disabled actions.

## Continuing To Develop In Dev Mode

Use local mode only for local development and UI iteration.

### Supported dev patterns

- UI and feature work on localhost with `?devBackend=local`
- local project CRUD for single-user development
- Employee Strip work using the local auth session DTO
- service and UI tests that rely on local session and local project seams

### Dev mode limitations

- Local auth is not secure and is not a production candidate.
- Local project storage is browser and device scoped and is not cross-device storage.
- Local capabilities are only defaults for development and should not be treated as enterprise authorization truth.

## Final Switch Blueprint

### Microsoft SSO

- Keep `app.js` as the thin bootstrap.
- Replace the current auth implementation behind `services/auth-service.js`.
- Preserve the auth-context contract so `ui/` continues to consume only normalized DTOs.

### Intune and access control

- Issue capability flags from the backend after enterprise identity and policy checks complete.
- Feed those capabilities into `ui/project-shell-controller.js`.
- Keep the UI capability-aware, but enforce real access on the backend.

### Azure tenant storage

- Keep project persistence behind `services/project-api.js`.
- Replace the current dev or scaffold backend with a real API backed by Azure tenant storage.
- Preserve `revision` and server metadata through `state/project.js` rather than rebuilding DTOs in `ui/`.

### Employee Strip profile data

- Read profile fields from the normalized auth session payload.
- Populate:
  - `displayName`
  - `email`
  - `jobTitle`
  - `photoUrl`
- Do not move identity-provider logic into `ui/project-chrome-shell.js`.

## Remaining Risks

### Blockers

- Production auth is still scaffold-grade.
- Production storage is still scaffold-grade.
- Authorization is not yet backend-authoritative.

### High risk

- Shared or tenant-scoped project access rules are not yet modeled.
- Revision and conflict handling are only a seam today, not a full concurrency policy.

### Medium risk

- The boundary between project-owned state and user-owned UI preferences is still loose for future shared-cloud behavior.

## Recommended Next Sequence

1. Implement the real backend auth contract that returns auth context and capability DTOs.
2. Replace scaffold session handling with server-owned session verification.
3. Implement backend project persistence with revision-aware save semantics.
4. Add server-enforced access checks for every project operation.
5. Connect enterprise profile fields to the existing Employee Strip DTO path.

## Validation Notes

The immediate seam work should stay validated with:

- `npm test -- --run tests/services/services-boundary.test.js tests/state/project.test.js tests/ui/project-shell-controller.test.js tests/ui/app-shell-callbacks.test.js tests/architecture/layer-boundaries.test.js`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Full `npm test` may still surface unrelated pre-existing failures in older UI and viz suites. Those should be tracked separately from the enterprise-readiness seam work.
