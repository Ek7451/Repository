import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthService } from '../../services/auth-service.js';
import { createProjectsService } from '../../services/project-api.js';

class MemoryStorage {
    constructor() {
        this.map = new Map();
    }

    get length() {
        return this.map.size;
    }

    clear() {
        this.map.clear();
    }

    getItem(key) {
        return this.map.has(key) ? this.map.get(key) : null;
    }

    key(index) {
        return Array.from(this.map.keys())[index] ?? null;
    }

    removeItem(key) {
        this.map.delete(key);
    }

    setItem(key, value) {
        this.map.set(key, String(value));
    }
}

function createJsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        }
    };
}

function createExpectedCapabilities(value) {
    return {
        canCreateProject: value,
        canListProjects: value,
        canOpenProject: value,
        canRenameProject: value,
        canDuplicateProject: value,
        canDeleteProject: value,
        canSaveProject: value,
        canManageProjectOptions: value
    };
}

describe('service DTO boundaries', () => {
    const originalFetch = globalThis.fetch;
    const originalLocalStorage = globalThis.localStorage;

    beforeEach(() => {
        globalThis.fetch = vi.fn();
        globalThis.localStorage = /** @type {Storage} */ (new MemoryStorage());
    });

    afterEach(() => {
        vi.restoreAllMocks();

        if (originalFetch === undefined) {
            delete globalThis.fetch;
        } else {
            globalThis.fetch = originalFetch;
        }

        if (originalLocalStorage === undefined) {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = originalLocalStorage;
        }
    });

    it('keeps auth API mode strict and does not fall back to browser storage', async () => {
        const service = createAuthService();

        globalThis.localStorage.setItem('sbg-dev-auth-session', JSON.stringify({
            userId: 'dev-user',
            displayName: 'Dev User',
            email: 'dev@example.com'
        }));
        /** @type {any} */ (globalThis.fetch).mockRejectedValue(new Error('offline'));

        await expect(service.signIn({
            displayName: 'Pat Example',
            email: 'pat@example.com'
        })).rejects.toThrow('offline');
    });

    it('uses explicit local auth mode when requested', async () => {
        const service = createAuthService({ devBackend: 'local' });

        const session = await service.signIn({
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });

        expect(session).toEqual({
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        });
        await expect(service.getAuthState()).resolves.toEqual({
            status: 'authenticated',
            reason: '',
            session,
            capabilities: createExpectedCapabilities(true)
        });
        await expect(service.getSession()).resolves.toEqual(session);

        await service.signOut();
        await expect(service.getAuthState()).resolves.toEqual({
            status: 'unauthenticated',
            reason: '',
            session: null,
            capabilities: createExpectedCapabilities(false)
        });
        await expect(service.getSession()).resolves.toBeNull();
    });

    it('seeds a local Microsoft session without requiring manual sign-in input', async () => {
        const service = createAuthService({ devBackend: 'local' });

        const session = await service.signInWithMicrosoft();

        expect(session).toEqual({
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        });
        await expect(service.getAuthState()).resolves.toEqual({
            status: 'authenticated',
            reason: '',
            session,
            capabilities: createExpectedCapabilities(true)
        });
        await expect(service.getSession()).resolves.toEqual(session);
    });

    it('returns an explicit scaffold error for Microsoft sign-in in API mode', async () => {
        const service = createAuthService();

        await expect(service.signInWithMicrosoft()).rejects.toThrow(
            'Microsoft SSO is not implemented in this build.'
        );
    });

    it('returns an unauthenticated auth state on a 401 session response', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(401, {
            error: 'No active session.'
        }));

        const service = createAuthService();

        await expect(service.getAuthState()).resolves.toEqual({
            status: 'unauthenticated',
            reason: '',
            session: null,
            capabilities: createExpectedCapabilities(false)
        });
    });

    it('preserves forbidden auth status and capability overrides from the auth API', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(403, {
            auth: {
                status: 'forbidden',
                reason: 'Managed device required.',
                capabilities: {
                    canListProjects: true
                }
            }
        }));

        const service = createAuthService();

        await expect(service.getAuthState()).resolves.toEqual({
            status: 'forbidden',
            reason: 'Managed device required.',
            session: null,
            capabilities: {
                ...createExpectedCapabilities(false),
                canListProjects: true
            }
        });
    });

    it('accepts optional profile fields from the auth API without changing the required contract', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(200, {
            session: {
                userId: 'user-1',
                displayName: 'Pat Example',
                email: 'pat@example.com',
                jobTitle: 'Design Technology Specialist II',
                photoUrl: 'https://example.com/avatar.png'
            }
        }));

        const service = createAuthService();

        await expect(service.getAuthState()).resolves.toEqual({
            status: 'authenticated',
            reason: '',
            session: {
                userId: 'user-1',
                displayName: 'Pat Example',
                email: 'pat@example.com',
                jobTitle: 'Design Technology Specialist II',
                photoUrl: 'https://example.com/avatar.png'
            },
            capabilities: createExpectedCapabilities(true)
        });
        await expect(service.getSession()).resolves.toEqual({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II',
            photoUrl: 'https://example.com/avatar.png'
        });
    });

    it('preserves optional server metadata on project summary DTOs in API mode', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(200, {
            projects: [
                {
                    id: 'project-1',
                    name: 'Lower Bowl Study',
                    sport: 'Football',
                    createdAt: '2026-03-14T12:00:00.000Z',
                    updatedAt: '2026-03-14T15:45:00.000Z',
                    ownerId: 'user-1',
                    tenantId: 'tenant-1',
                    lastSyncedAt: '2026-03-14T15:44:00.000Z',
                    revision: 'rev-7',
                    access: {
                        role: 'owner',
                        canShare: true
                    }
                }
            ]
        }));

        const service = createProjectsService();
        await expect(service.listProjects()).resolves.toEqual([
            {
                id: 'project-1',
                name: 'Lower Bowl Study',
                sport: 'Football',
                createdAt: '2026-03-14T12:00:00.000Z',
                updatedAt: '2026-03-14T15:45:00.000Z',
                ownerId: 'user-1',
                tenantId: 'tenant-1',
                lastSyncedAt: '2026-03-14T15:44:00.000Z',
                revision: 'rev-7',
                access: {
                    role: 'owner',
                    canShare: true
                }
            }
        ]);
    });

    it('round-trips revision metadata through API project updates', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(200, {
            project: {
                id: 'project-1',
                name: 'Lower Bowl Study',
                sport: 'Football',
                createdAt: '2026-03-14T12:00:00.000Z',
                updatedAt: '2026-03-14T16:00:00.000Z',
                revision: 4,
                state: { sport: 'Football' }
            }
        }));

        const service = createProjectsService();
        await expect(service.updateProject('project-1', {
            name: 'Lower Bowl Study',
            state: { sport: 'Football' },
            revision: 3
        })).resolves.toEqual({
            id: 'project-1',
            name: 'Lower Bowl Study',
            sport: 'Football',
            createdAt: '2026-03-14T12:00:00.000Z',
            updatedAt: '2026-03-14T16:00:00.000Z',
            revision: 4,
            state: { sport: 'Football' }
        });

        expect(globalThis.fetch).toHaveBeenCalledWith('/api/projects/project-1', expect.objectContaining({
            method: 'PUT',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            }
        }));
        expect(JSON.parse(/** @type {any} */ (globalThis.fetch).mock.calls[0][1].body)).toEqual({
            name: 'Lower Bowl Study',
            state: { sport: 'Football' },
            revision: 3
        });
    });

    it('sends delete requests to the project detail endpoint in API mode', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue({
            ok: true,
            status: 204,
            async json() {
                throw new Error('No content');
            }
        });

        const service = createProjectsService();
        await expect(service.deleteProject('project-1')).resolves.toBeUndefined();

        expect(globalThis.fetch).toHaveBeenCalledWith('/api/projects/project-1', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json'
            }
        });
    });

    it('surfaces API delete errors from the backend payload', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(404, {
            error: 'Project not found.'
        }));

        const service = createProjectsService();
        await expect(service.deleteProject('missing-project')).rejects.toThrow('Project not found.');
    });

    it('uses explicit local project mode without leaking project document instances', async () => {
        const authService = createAuthService({ devBackend: 'local' });
        const projectsService = createProjectsService({ devBackend: 'local' });

        await authService.signIn({
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });

        const projectStateDocument = {
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Football',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-16T00:00:00.000Z',
                    updatedAt: '2026-03-16T00:00:00.000Z',
                    state: {
                        _version: 'phase6-app-state',
                        sport: 'Football',
                        setup: { customRunoff: 25, focalZ: 0, sightlineVisuals: true, sectionMetrics: false },
                        bowl: {
                            type: 'Full',
                            cornerRad: 10,
                            sideLength: 300,
                            structuralDepth: 6
                        },
                        occupancy: {
                            seatWidth: 20,
                            minAisle: 48,
                            maxAisle: 72,
                            seatsBetweenAisles: 20,
                            egressFactor: 0.2,
                            showSeatCubes3D: false
                        },
                        ui: { activeViewTab: 'profile', activeResultsTab: 'statsTab' },
                        tiers: [],
                        bookmarks: []
                    }
                }
            ]
        };

        const created = await projectsService.createProject({
            name: 'Local Study',
            state: projectStateDocument
        });

        expect(created).toMatchObject({
            name: 'Local Study',
            revision: 1
        });
        expect(created.state).toEqual(projectStateDocument);
        expect(created.state).not.toBe(projectStateDocument);

        projectStateDocument.options[0].state.sport = 'Mutated';
        const loaded = await projectsService.getProject(created.id);

        expect(loaded.state.sport).toBe('Football');
        expect(loaded.state.options[0].state.sport).toBe('Football');
        await expect(projectsService.listProjects()).resolves.toHaveLength(1);
    });

    it('deletes only the signed-in local project and removes it from later list results', async () => {
        const authService = createAuthService({ devBackend: 'local' });
        const projectsService = createProjectsService({ devBackend: 'local' });

        await authService.signIn({
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });

        const owned = await projectsService.createProject({
            name: 'Owned Study',
            state: { sport: 'Football' }
        });

        globalThis.localStorage.setItem('sbg-dev-projects', JSON.stringify([
            {
                id: 'other-project',
                ownerId: 'other@example.com',
                name: 'Other Study',
                sport: 'Soccer',
                createdAt: '2026-03-15T00:00:00.000Z',
                updatedAt: '2026-03-15T00:00:00.000Z',
                state: { sport: 'Soccer' }
            },
            ...JSON.parse(globalThis.localStorage.getItem('sbg-dev-projects') ?? '[]')
        ]));

        await expect(projectsService.deleteProject(owned.id)).resolves.toBeUndefined();
        await expect(projectsService.listProjects()).resolves.toEqual([]);

        const rawProjects = JSON.parse(globalThis.localStorage.getItem('sbg-dev-projects') ?? '[]');
        expect(rawProjects).toHaveLength(1);
        expect(rawProjects[0].id).toBe('other-project');
    });

    it('keys local project ownership off the session principal id while keeping legacy email-owned records readable', async () => {
        globalThis.localStorage.setItem('sbg-dev-auth-session', JSON.stringify({
            userId: 'entra-user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com'
        }));
        const projectsService = createProjectsService({ devBackend: 'local' });

        const created = await projectsService.createProject({
            name: 'Scoped Study',
            state: { sport: 'Football' }
        });

        const rawProjects = JSON.parse(globalThis.localStorage.getItem('sbg-dev-projects') ?? '[]');
        expect(rawProjects).toHaveLength(1);
        expect(rawProjects[0].ownerId).toBe('entra-user-1');

        globalThis.localStorage.setItem('sbg-dev-projects', JSON.stringify([
            {
                id: 'legacy-project',
                ownerId: 'pat@example.com',
                name: 'Legacy Study',
                sport: 'Soccer',
                createdAt: '2026-03-15T00:00:00.000Z',
                updatedAt: '2026-03-15T00:00:00.000Z',
                state: { sport: 'Soccer' }
            },
            {
                id: 'other-project',
                ownerId: 'other@example.com',
                name: 'Other Study',
                sport: 'Baseball',
                createdAt: '2026-03-15T01:00:00.000Z',
                updatedAt: '2026-03-15T01:00:00.000Z',
                state: { sport: 'Baseball' }
            },
            ...rawProjects
        ]));

        await expect(projectsService.listProjects()).resolves.toEqual(expect.arrayContaining([
            expect.objectContaining({ id: created.id, name: 'Scoped Study', ownerId: 'entra-user-1' }),
            expect.objectContaining({ id: 'legacy-project', name: 'Legacy Study' })
        ]));
        await expect(projectsService.listProjects()).resolves.toHaveLength(2);
        await expect(projectsService.getProject('legacy-project')).resolves.toMatchObject({
            id: 'legacy-project',
            name: 'Legacy Study'
        });
        await expect(projectsService.getProject('other-project')).rejects.toThrow('Project not found.');
    });

    it('throws when deleting a missing local project id', async () => {
        const authService = createAuthService({ devBackend: 'local' });
        const projectsService = createProjectsService({ devBackend: 'local' });

        await authService.signIn({
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });

        await expect(projectsService.deleteProject('missing-project')).rejects.toThrow('Project not found.');
    });
});
