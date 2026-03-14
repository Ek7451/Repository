import { describe, expect, it } from 'vitest';

import { SeatingBowlApp } from '../../ui/app.js';

describe('SeatingBowlApp shell callbacks', () => {
    it('emits project chrome updates as plain data', () => {
        const chromeUpdates = [];
        const app = new SeatingBowlApp({
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        app.state.sport = 'Soccer';
        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });
        app.setProjectMetadata({
            id: 'project-1',
            name: '',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });

        const lastUpdate = chromeUpdates.at(-1);
        expect(lastUpdate).toMatchObject({
            name: 'Soccer Study',
            canSave: true,
            metadata: { id: 'project-1' },
            session: { displayName: 'Pat Example' }
        });

        lastUpdate.metadata.id = 'mutated';
        lastUpdate.session.displayName = 'Changed';
        expect(app.getProjectMetadata().id).toBe('project-1');
    });

    it('exposes shell-facing chrome and status snapshots through explicit getters', () => {
        const app = new SeatingBowlApp();

        expect(app.getProjectChrome()).toEqual({
            name: 'Football Study',
            metadata: {
                id: null,
                name: '',
                createdAt: '',
                updatedAt: ''
            },
            session: null,
            canSave: false
        });
        expect(app.getProjectStatus()).toEqual({
            message: 'Project persistence ready',
            tone: 'default'
        });

        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });
        app.setProjectMetadata({
            id: 'project-1',
            name: 'Custom Study',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });
        app.setProjectStatus('Saved project', 'success');

        const chrome = app.getProjectChrome();
        const status = app.getProjectStatus();

        expect(chrome).toMatchObject({
            name: 'Custom Study',
            metadata: { id: 'project-1', name: 'Custom Study' },
            session: { displayName: 'Pat Example' },
            canSave: true
        });
        expect(status).toEqual({
            message: 'Saved project',
            tone: 'success'
        });

        chrome.metadata.name = 'Mutated';
        status.message = 'Changed';
        expect(app.getProjectChrome().metadata.name).toBe('Custom Study');
        expect(app.getProjectStatus().message).toBe('Saved project');
    });

    it('emits normalized status updates', () => {
        const statusUpdates = [];
        const app = new SeatingBowlApp({
            onStatusChanged: (status) => statusUpdates.push(status)
        });

        app.setProjectStatus('', '');
        app.setProjectStatus('Saved project', 'success');

        expect(statusUpdates).toEqual([
            { message: 'Project persistence ready', tone: 'default' },
            { message: 'Saved project', tone: 'success' }
        ]);
    });

    it('builds save requests from the single live AppState', () => {
        const chromeUpdates = [];
        const app = new SeatingBowlApp({
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        app.state.sport = 'Basketball';
        const saveRequest = app.getProjectSaveRequest();

        expect(saveRequest.name).toBe('Basketball Study');
        expect(saveRequest.state.sport).toBe('Basketball');
        expect(chromeUpdates.at(-1)?.name).toBe('Basketball Study');
    });
});
