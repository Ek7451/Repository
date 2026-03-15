import { describe, expect, it } from 'vitest';

import { DashboardPage } from '../../pages/dashboard/dashboard.js';
import { ProjectShellController } from '../../ui/project-shell-controller.js';
import { ProjectDashboard } from '../../ui/project-dashboard.js';

function createInteractiveElement(attributes = {}) {
    const listeners = new Map();

    return {
        addEventListener(eventName, handler) {
            listeners.set(eventName, handler);
        },
        getAttribute(name) {
            return attributes[name] ?? null;
        },
        click() {
            listeners.get('click')?.({
                stopPropagation() {},
                preventDefault() {}
            });
        },
        keydown(key) {
            listeners.get('keydown')?.({
                key,
                stopPropagation() {},
                preventDefault() {}
            });
        }
    };
}

function createFormElement() {
    return {
        addEventListener() {}
    };
}

function createDashboardRoot() {
    const queryAllCache = new Map();
    const queryOneCache = new Map();

    return {
        innerHTML: '',
        querySelector(selector) {
            if (queryOneCache.has(selector)) {
                return queryOneCache.get(selector);
            }

            if (selector === '#dashboardRefreshBtn' || selector === '#dashboardSignOutBtn') {
                const element = createInteractiveElement();
                queryOneCache.set(selector, element);
                return element;
            }

            if (selector === '#dashboardCreateProjectForm' || selector === '#dashboardSignInForm') {
                const element = createFormElement();
                queryOneCache.set(selector, element);
                return element;
            }

            return null;
        },
        querySelectorAll(selector) {
            const attributeBySelector = {
                '[data-open-project]': 'data-open-project',
                '[data-toggle-project-menu]': 'data-toggle-project-menu',
                '[data-project-menu]': 'data-project-menu',
                '[data-duplicate-project]': 'data-duplicate-project',
                '[data-request-delete-project]': 'data-request-delete-project',
                '[data-cancel-delete-project]': 'data-cancel-delete-project',
                '[data-confirm-delete-project]': 'data-confirm-delete-project'
            };
            const attributeName = attributeBySelector[selector];
            if (!attributeName) return [];

            const regex = new RegExp(`${attributeName}="([^"]+)"`, 'g');
            const elements = [];
            let match = regex.exec(this.innerHTML);
            while (match) {
                elements.push(createInteractiveElement({
                    [attributeName]: match[1]
                }));
                match = regex.exec(this.innerHTML);
            }

            queryAllCache.set(selector, elements);
            return elements;
        },
        getButtons(selector) {
            return queryAllCache.get(selector) ?? [];
        },
        getButtonLabel(attributeName, projectId) {
            const regex = new RegExp(`${attributeName}="${projectId}"[^>]*>([^<]+)<`);
            const match = this.innerHTML.match(regex);
            return match?.[1]?.trim() ?? '';
        },
        hasMarkup(value) {
            return this.innerHTML.includes(value);
        }
    };
}

describe('ProjectShellController', () => {
    it('stores project shell state and emits immutable chrome snapshots', () => {
        const chromeUpdates = [];
        const controller = new ProjectShellController({
            getSportName: () => 'Soccer',
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        controller.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II',
            photoUrl: 'https://example.com/avatar.png'
        });
        controller.setProjectMetadata({
            id: 'project-1',
            name: '',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        });

        const lastChrome = chromeUpdates.at(-1);
        expect(lastChrome).toEqual({
            name: 'Soccer Study',
            metadata: {
                id: 'project-1',
                name: '',
                createdAt: '2026-03-15T00:00:00.000Z',
                updatedAt: '2026-03-15T01:00:00.000Z'
            },
            session: {
                userId: 'user-1',
                displayName: 'Pat Example',
                email: 'pat@example.com',
                jobTitle: 'Design Technology Specialist II',
                photoUrl: 'https://example.com/avatar.png'
            },
            canSave: true
        });

        lastChrome.metadata.id = 'mutated';
        lastChrome.session.displayName = 'Changed';
        lastChrome.session.jobTitle = 'Changed title';

        expect(controller.getProjectMetadata()).toEqual({
            id: 'project-1',
            name: '',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        });
        expect(controller.getProjectChrome().session.displayName).toBe('Pat Example');
        expect(controller.getProjectChrome().session.jobTitle).toBe('Design Technology Specialist II');
    });

    it('normalizes save names through state helpers and updates shell chrome', () => {
        const chromeUpdates = [];
        const controller = new ProjectShellController({
            getSportName: () => 'Baseball',
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        controller.setProjectMetadata({
            id: 'project-1',
            name: '   ',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        });

        expect(controller.getProjectChrome().name).toBe('');

        const saveRequest = controller.getProjectSaveRequest({ sport: 'Baseball' });

        expect(saveRequest).toEqual({
            name: 'Baseball Study',
            state: { sport: 'Baseball' }
        });
        expect(controller.getProjectMetadata().name).toBe('Baseball Study');
        expect(chromeUpdates.at(-1)).toMatchObject({
            name: 'Baseball Study',
            metadata: { name: 'Baseball Study' }
        });
    });

    it('normalizes status updates before emitting them', () => {
        const statuses = [];
        const controller = new ProjectShellController({
            onStatusChanged: (status) => statuses.push(status)
        });

        controller.setProjectStatus('', '');
        controller.setProjectStatus('Saved project', 'success');

        expect(statuses).toEqual([
            { message: 'Project persistence ready', tone: 'default' },
            { message: 'Saved project', tone: 'success' }
        ]);
    });
});

describe('ProjectDashboard', () => {
    it('opens via card click, uses an overflow menu, and keeps delete confirm inline', () => {
        const root = createDashboardRoot();
        const events = [];
        const dashboard = new ProjectDashboard({
            root: /** @type {any} */ (root),
            onOpenProject: (projectId) => events.push(['open', projectId]),
            onToggleProjectMenu: (projectId) => events.push(['toggle-menu', projectId]),
            onDuplicateProject: (projectId) => events.push(['duplicate', projectId]),
            onRequestDeleteProject: (projectId) => events.push(['request-delete', projectId]),
            onCancelDeleteProject: () => events.push(['cancel-delete']),
            onDeleteProject: (projectId) => events.push(['confirm-delete', projectId])
        });
        const model = {
            session: {
                displayName: 'Pat Example',
                email: 'pat@example.com'
            },
            projects: [
                {
                    id: 'project-1',
                    name: 'Lower Bowl Study',
                    sport: 'Football',
                    createdAt: '2026-03-15T00:00:00.000Z',
                    updatedAt: '2026-03-15T01:00:00.000Z'
                },
                {
                    id: 'project-2',
                    name: 'Upper Bowl Study',
                    sport: 'Soccer',
                    createdAt: '2026-03-15T00:00:00.000Z',
                    updatedAt: '2026-03-15T01:00:00.000Z'
                }
            ]
        };

        dashboard.render(model);

        expect(root.getButtons('[data-open-project]')).toHaveLength(2);
        expect(root.getButtons('[data-toggle-project-menu]')).toHaveLength(2);
        expect(root.getButtons('[data-duplicate-project]')).toHaveLength(0);
        expect(root.hasMarkup('aria-label="Open Lower Bowl Study"')).toBe(true);

        root.getButtons('[data-open-project]')[0].click();
        root.getButtons('[data-open-project]')[1].keydown('Enter');
        expect(events).toEqual([
            ['open', 'project-1'],
            ['open', 'project-2']
        ]);

        dashboard.render({
            ...model,
            openMenuProjectId: 'project-1'
        });

        expect(root.getButtons('[data-duplicate-project]')).toHaveLength(1);
        expect(root.getButtons('[data-request-delete-project]')).toHaveLength(1);
        expect(root.hasMarkup('Duplicate')).toBe(true);
        expect(root.hasMarkup('data-request-delete-project="project-2"')).toBe(false);

        root.getButtons('[data-toggle-project-menu]')[0].click();
        root.getButtons('[data-duplicate-project]')[0].click();
        root.getButtons('[data-request-delete-project]')[0].click();

        expect(events).toEqual([
            ['open', 'project-1'],
            ['open', 'project-2'],
            ['toggle-menu', 'project-1'],
            ['duplicate', 'project-1'],
            ['request-delete', 'project-1']
        ]);

        dashboard.render({
            ...model,
            openMenuProjectId: 'project-1',
            loading: true,
            busyAction: 'duplicate',
            busyProjectId: 'project-1'
        });

        expect(root.getButtonLabel('data-duplicate-project', 'project-1')).toBe('Duplicating...');

        dashboard.render({
            ...model,
            pendingDeleteProjectId: 'project-1',
            loading: true,
            busyAction: 'delete',
            busyProjectId: 'project-1'
        });

        expect(root.getButtons('[data-open-project]')).toHaveLength(2);
        expect(root.getButtonLabel('data-confirm-delete-project', 'project-1')).toBe('Deleting...');
        expect(root.getButtons('[data-confirm-delete-project]')[0]).toBeTruthy();
        expect(root.getButtons('[data-cancel-delete-project]')[0]).toBeTruthy();

        root.getButtons('[data-confirm-delete-project]')[0].click();
        root.getButtons('[data-cancel-delete-project]')[0].click();

        expect(events).toEqual([
            ['open', 'project-1'],
            ['open', 'project-2'],
            ['toggle-menu', 'project-1'],
            ['duplicate', 'project-1'],
            ['request-delete', 'project-1'],
            ['confirm-delete', 'project-1'],
            ['cancel-delete']
        ]);
    });
});

describe('DashboardPage', () => {
    it('duplicates a project by composing getProject and createProject while staying on the dashboard', async () => {
        const authService = {
            getSession: async () => ({
                displayName: 'Pat Example',
                email: 'pat@example.com'
            })
        };
        const sourceSummary = {
            id: 'project-1',
            name: 'Lower Bowl Study',
            sport: 'Football',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        };
        const projectsService = {
            listProjects: async () => [sourceSummary],
            getProject: async () => ({
                ...sourceSummary,
                state: { sport: 'Football', tiers: [] }
            }),
            createProject: async (payload) => ({
                id: 'project-2',
                name: payload.name,
                sport: payload.state.sport,
                createdAt: '2026-03-16T00:00:00.000Z',
                updatedAt: '2026-03-16T00:00:00.000Z',
                state: payload.state
            })
        };
        const page = new DashboardPage({
            root: /** @type {any} */ (Object.assign(createDashboardRoot(), { hidden: false })),
            authService: /** @type {any} */ (authService),
            projectsService: /** @type {any} */ (projectsService),
            onOpenProject: () => {}
        });

        await page.show();
        await page._handleDuplicateProject('project-1');

        expect(page.projects).toHaveLength(2);
        expect(page.projects[0]).toMatchObject({
            id: 'project-2',
            name: 'Lower Bowl Study Copy',
            sport: 'Football'
        });
        expect(page.openMenuProjectId).toBe('');
        expect(page.pendingDeleteProjectId).toBe('');
    });
});
