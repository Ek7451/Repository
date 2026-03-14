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
            email: 'pat@example.com'
        });
        await expect(service.getSession()).resolves.toEqual(session);

        await service.signOut();
        await expect(service.getSession()).resolves.toBeNull();
    });

    it('keeps project API mode strict and returns only DTO data from fetch', async () => {
        /** @type {any} */ (globalThis.fetch).mockResolvedValue(createJsonResponse(200, {
            projects: [
                {
                    id: 'project-1',
                    name: 'Lower Bowl Study',
                    sport: 'Football',
                    createdAt: '2026-03-14T12:00:00.000Z',
                    updatedAt: '2026-03-14T15:45:00.000Z',
                    ownerId: 'ignore-me'
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
                updatedAt: '2026-03-14T15:45:00.000Z'
            }
        ]);
    });

    it('uses explicit local project mode without leaking AppState instances', async () => {
        const authService = createAuthService({ devBackend: 'local' });
        const projectsService = createProjectsService({ devBackend: 'local' });

        await authService.signIn({
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });

        const appStateJson = {
            _version: 'phase6-app-state',
            sport: 'Football',
            setup: { customRunoff: 25, focalZ: 0, sightlineVisuals: true, sectionMetrics: false },
            bowl: {
                type: 'Full',
                cornerRad: 10,
                sideLength: 300,
                structuralDepth: 0,
                clipEnabled: false,
                clipAxis: 'X',
                clipPosition: 0,
                clipSide: 'positive'
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
        };

        const created = await projectsService.createProject({
            name: 'Local Study',
            state: appStateJson
        });

        expect(created.name).toBe('Local Study');
        expect(created.state).toEqual(appStateJson);
        expect(created.state).not.toBe(appStateJson);

        appStateJson.sport = 'Mutated';
        const loaded = await projectsService.getProject(created.id);

        expect(loaded.state.sport).toBe('Football');
        await expect(projectsService.listProjects()).resolves.toHaveLength(1);
    });
});
