import { describe, expect, it } from 'vitest';

import { ProjectShellController } from '../../ui/project-shell-controller.js';

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

describe('ProjectShellController', () => {
    it('stores project shell state and emits immutable chrome snapshots', () => {
        const chromeUpdates = [];
        const optionChromeUpdates = [];
        const controller = new ProjectShellController({
            getSportName: () => 'Soccer',
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome),
            onProjectOptionChromeChanged: (chrome) => optionChromeUpdates.push(chrome)
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
        controller.setProjectStateDocument({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball',
            activeOptionId: 'option-2',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-15T00:00:00.000Z',
                    updatedAt: '2026-03-15T00:00:00.000Z',
                    state: { sport: 'Soccer' }
                },
                {
                    id: 'option-2',
                    name: 'Option 2',
                    color: '#37996e',
                    createdAt: '2026-03-15T00:30:00.000Z',
                    updatedAt: '2026-03-15T00:30:00.000Z',
                    state: { sport: 'Basketball' }
                }
            ]
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
            authStatus: 'authenticated',
            authReason: '',
            capabilities: createExpectedCapabilities(true),
            session: {
                userId: 'user-1',
                displayName: 'Pat Example',
                email: 'pat@example.com',
                jobTitle: 'Design Technology Specialist II',
                photoUrl: 'https://example.com/avatar.png'
            },
            canSave: true,
            activeOptionId: 'option-2',
            options: [
                {
                    id: 'option-1',
                    label: 'Option 1',
                    color: '#7aae1a',
                    isActive: false
                },
                {
                    id: 'option-2',
                    label: 'Option 2',
                    color: '#37996e',
                    isActive: true
                }
            ],
            canCreateOption: true,
            canManageOptions: true,
            canDeleteOption: true
        });
        expect(optionChromeUpdates.at(-1)).toEqual({
            activeOptionId: 'option-2',
            activeLabel: 'Option 2',
            activeColor: '#37996e',
            items: [
                {
                    id: 'option-1',
                    label: 'Option 1',
                    color: '#7aae1a',
                    isActive: false,
                    canDelete: true
                },
                {
                    id: 'option-2',
                    label: 'Option 2',
                    color: '#37996e',
                    isActive: true,
                    canDelete: true
                }
            ],
            canCreate: true,
            canManage: true,
            canDelete: true
        });

        lastChrome.metadata.id = 'mutated';
        lastChrome.session.displayName = 'Changed';
        optionChromeUpdates.at(-1).items[0].label = 'Changed';

        expect(controller.getProjectMetadata()).toEqual({
            id: 'project-1',
            name: '',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        });
        expect(controller.getProjectChrome().session.displayName).toBe('Pat Example');
        expect(controller.getProjectOptionChrome().items[0].label).toBe('Option 1');
    });

    it('honors auth capabilities in project chrome and preserves revision in save requests', () => {
        const controller = new ProjectShellController({
            getSportName: () => 'Baseball'
        });

        controller.setAuthContext({
            status: 'authenticated',
            session: {
                userId: 'user-1',
                displayName: 'Pat Example',
                email: 'pat@example.com'
            },
            capabilities: {
                canSaveProject: false,
                canManageProjectOptions: false
            }
        });
        controller.setProjectMetadata({
            id: 'project-1',
            name: '   ',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z',
            revision: 'rev-9'
        });
        controller.setProjectStateDocument({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-15T00:00:00.000Z',
                    updatedAt: '2026-03-15T00:00:00.000Z',
                    state: { sport: 'Basketball' }
                }
            ]
        });

        expect(controller.getProjectChrome()).toMatchObject({
            authStatus: 'authenticated',
            authReason: '',
            capabilities: {
                ...createExpectedCapabilities(true),
                canSaveProject: false,
                canManageProjectOptions: false
            },
            canSave: false,
            canCreateOption: false,
            canManageOptions: false,
            canDeleteOption: false
        });
        expect(controller.getProjectOptionChrome()).toMatchObject({
            canCreate: false,
            canManage: false,
            canDelete: false
        });
        expect(controller.getProjectSaveRequest()).toEqual({
            name: 'Baseball Study',
            state: {
                _projectVersion: 'dashboard-cutover-v1',
                sport: 'Basketball',
                activeOptionId: 'option-1',
                options: [
                    {
                        id: 'option-1',
                        name: 'Option 1',
                        color: '#7aae1a',
                        createdAt: '2026-03-15T00:00:00.000Z',
                        updatedAt: '2026-03-15T00:00:00.000Z',
                        state: expect.objectContaining({
                            sport: 'Basketball'
                        })
                    }
                ]
            },
            revision: 'rev-9'
        });
    });

    it('builds save requests from project metadata plus the current project state document', () => {
        const controller = new ProjectShellController({
            getSportName: () => 'Baseball'
        });

        controller.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });
        controller.setProjectMetadata({
            id: 'project-1',
            name: '   ',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        });
        controller.setProjectStateDocument({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-15T00:00:00.000Z',
                    updatedAt: '2026-03-15T00:00:00.000Z',
                    state: { sport: 'Basketball' }
                }
            ]
        });

        const saveRequest = controller.getProjectSaveRequest();

        expect(saveRequest).toEqual({
            name: 'Baseball Study',
            state: {
                _projectVersion: 'dashboard-cutover-v1',
                sport: 'Basketball',
                activeOptionId: 'option-1',
                options: [
                    {
                        id: 'option-1',
                        name: 'Option 1',
                        color: '#7aae1a',
                        createdAt: '2026-03-15T00:00:00.000Z',
                        updatedAt: '2026-03-15T00:00:00.000Z',
                        state: expect.objectContaining({
                            sport: 'Basketball'
                        })
                    }
                ]
            }
        });
        expect(controller.getProjectMetadata().name).toBe('Baseball Study');
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
