import { describe, expect, it } from 'vitest';

import { ProjectShellController } from '../../ui/project-shell-controller.js';

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
            email: 'pat@example.com'
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
                email: 'pat@example.com'
            },
            canSave: true
        });

        lastChrome.metadata.id = 'mutated';
        lastChrome.session.displayName = 'Changed';

        expect(controller.getProjectMetadata()).toEqual({
            id: 'project-1',
            name: '',
            createdAt: '2026-03-15T00:00:00.000Z',
            updatedAt: '2026-03-15T01:00:00.000Z'
        });
        expect(controller.getProjectChrome().session.displayName).toBe('Pat Example');
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
