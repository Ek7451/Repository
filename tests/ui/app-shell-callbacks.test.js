import { describe, expect, it, vi } from 'vitest';

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

    it('pushes explicit theme state into visualizers without requiring viz to read the DOM', () => {
        const app = new SeatingBowlApp();
        const fieldRenderer = { setTheme: vi.fn() };
        const profileRenderer = { setTheme: vi.fn() };
        const scene3D = { applyTheme: vi.fn() };

        app.fieldRenderer = /** @type {any} */ (fieldRenderer);
        app.profileRenderer = /** @type {any} */ (profileRenderer);
        app.scene3D = /** @type {any} */ (scene3D);
        app.update = vi.fn();

        app._handleThemeChanged('dark');

        expect(fieldRenderer.setTheme).toHaveBeenCalledWith('dark');
        expect(profileRenderer.setTheme).toHaveBeenCalledWith('dark');
        expect(scene3D.applyTheme).toHaveBeenCalledWith('dark');
        expect(app.update).toHaveBeenCalledTimes(1);
    });

    it('delegates canvas observation to the shell viewport controller', () => {
        const app = new SeatingBowlApp();
        const scheduleUpdate = vi.spyOn(app, '_scheduleUpdate').mockImplementation(() => {});
        const fieldCanvas = { parentElement: { id: 'fieldParent' } };
        const profileCanvas = { parentElement: { id: 'profileParent' } };
        const observeViewCanvases = vi.fn();

        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => {
                if (id === 'fieldCanvas') return fieldCanvas;
                if (id === 'profileCanvas') return profileCanvas;
                return null;
            })
        });

        app.editorShell = /** @type {any} */ ({
            observeViewCanvases
        });

        app._setupCanvases();

        expect(observeViewCanvases).toHaveBeenCalledTimes(1);
        const args = observeViewCanvases.mock.calls[0][0];
        expect(args.fieldCanvas).toBe(fieldCanvas);
        expect(args.profileCanvas).toBe(profileCanvas);
        args.onResize();
        expect(scheduleUpdate).toHaveBeenCalledTimes(1);

        vi.unstubAllGlobals();
    });

    it('uses the explicit scene export accessor without falling back to scene internals', () => {
        const app = new SeatingBowlApp();
        const exportSceneData = {
            bowlMeshes: [{ id: 'bowl' }],
            aisleMeshes: [{ id: 'aisle' }],
            seatMeshes: [{ id: 'seat' }],
            THREE: { Scene: function Scene() {} }
        };
        const getExportSceneData = vi.fn(() => exportSceneData);

        app.scene3D = /** @type {any} */ ({
            getExportSceneData,
            bowlGroup: { children: ['private-bowl'] },
            aisleGroup: { children: ['private-aisle'] },
            seatGroup: { children: ['private-seat'] },
            THREE: { Private: true }
        });

        expect(app._getSceneExportData()).toBe(exportSceneData);
        expect(getExportSceneData).toHaveBeenCalledTimes(1);

        app.scene3D = /** @type {any} */ ({
            bowlGroup: { children: ['private-bowl'] },
            aisleGroup: { children: ['private-aisle'] },
            seatGroup: { children: ['private-seat'] },
            THREE: { Private: true }
        });

        expect(app._getSceneExportData()).toBeNull();
    });

    it('does not initialize rhino when there is no scene export geometry', async () => {
        const app = new SeatingBowlApp();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const loadRhino3dm = vi.spyOn(app, '_loadRhino3dm').mockResolvedValue(/** @type {any} */ ({}));

        await expect(app._buildExportDescriptor('rhino')).resolves.toBeNull();
        expect(loadRhino3dm).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith('No 3D data to export');
    });

    it('uses shell visibility state when resizing the 3D scene', () => {
        const app = new SeatingBowlApp();
        const ensure3DContainerSize = vi.fn();
        const isScene3DActive = vi.fn(() => true);
        const forceResize = vi.fn();
        const updateField = vi.fn();
        const updateBowl = vi.fn();

        app.editorShell = /** @type {any} */ ({
            ensure3DContainerSize,
            isScene3DActive
        });
        app.scene3D = /** @type {any} */ ({
            forceResize,
            updateField,
            updateBowl
        });
        app._scene3dReady = true;
        app._currentTemplate = {
            field_width: 160,
            field_length: 360,
            shape: 'rectangle',
            field_radius: 0,
            arc_angle: 0
        };
        app._solvers = [];
        app._tierAisleLayouts = [];

        app._update3D();

        expect(isScene3DActive).toHaveBeenCalledTimes(1);
        expect(ensure3DContainerSize).toHaveBeenCalledTimes(1);
        expect(forceResize).toHaveBeenCalledTimes(1);
        expect(updateField).toHaveBeenCalledTimes(1);
        expect(updateBowl).toHaveBeenCalledTimes(1);
    });

    it('replays the scene3d side effects when restored state opens directly to the 3D tab', () => {
        const app = new SeatingBowlApp();
        vi.stubGlobal('document', {
            getElementById: () => null
        });
        app.editorShell = /** @type {any} */ ({
            syncFromState: vi.fn()
        });
        app.state.ui.activeViewTab = 'scene3d';
        app.state.ui.activeResultsTab = 'statsTab';

        const handleViewTabChanged = vi
            .spyOn(app, '_handleViewTabChanged')
            .mockImplementation(() => {});

        app._applyStateToDom();

        expect(app.editorShell.syncFromState).toHaveBeenCalledWith({
            activeViewTab: 'scene3d',
            activeResultsTab: 'statsTab'
        });
        expect(handleViewTabChanged).toHaveBeenCalledWith('scene3d');

        vi.unstubAllGlobals();
    });
});
