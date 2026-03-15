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

    it('only normalizes whitespace-only project names when building a save request', () => {
        const app = new SeatingBowlApp();
        app.state.sport = 'Baseball';
        app.setProjectMetadata({
            id: 'project-1',
            name: '   ',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });

        expect(app.getProjectChrome().name).toBe('');

        const saveRequest = app.getProjectSaveRequest();
        expect(saveRequest.name).toBe('Baseball Study');
        expect(app.getProjectMetadata().name).toBe('Baseball Study');
    });

    it('builds export context DTOs through the render runtime public API', () => {
        const app = new SeatingBowlApp();

        app.state.setup.customRunoff = null;
        app.state.setup.focalZ = 9;
        app.state.bowl.type = 'Side1';
        app.state.bowl.cornerRad = 24;
        app.state.bowl.sideLength = 280;
        app.state.bowl.structuralDepth = 18;
        app.state.bowl.clipEnabled = true;
        app.state.bowl.clipAxis = 'Y';
        app.state.bowl.clipPosition = 42;
        app.state.bowl.clipSide = 'negative';
        app.state.occupancy.seatWidth = 22;
        app.state.occupancy.minAisle = 44;
        app.state.occupancy.maxAisle = 66;
        app.state.occupancy.seatsBetweenAisles = 18;
        app.state.occupancy.egressFactor = 0.3;

        const exportContext = app.renderRuntime.getExportContext(app.state);

        expect(exportContext.runoffDistance).toBe(25);
        expect(exportContext.focalPointFt).toEqual({ x: 0, z: 9 });
        expect(exportContext.egressParams).toEqual({
            seatWidthIn: 22,
            maxAisleWidthIn: 66,
            minAisleWidthIn: 44,
            egressFactor: 0.3,
            seatsBetweenAisles: 18
        });
        expect(exportContext.primaryTierParameters).toEqual({
            targetCValue: 4,
            firstRowDistance: 45,
            firstRowElevation: 6,
            treadDepth: 33,
            riserHeight: 10,
            numRows: 30,
            eyeHeight: 3.75,
            eyeSetback: 6
        });
        expect(exportContext.bowlConfig).toMatchObject({
            width: 160,
            length: 360,
            shape: 'rectangle',
            type: 'Side1',
            corner: 'Chamfer',
            radius: 24,
            sideLength: 280,
            structuralDepth: 18,
            clip: {
                enabled: true,
                axis: 'Y',
                position: 42,
                side: 'negative'
            }
        });
    });

    it('pushes explicit theme state into visualizers without requiring viz to read the DOM', () => {
        const app = new SeatingBowlApp();
        const fieldRenderer = { setTheme: vi.fn() };
        const profileRenderer = { setTheme: vi.fn() };
        const scene3DController = { applyTheme: vi.fn() };

        app.fieldRenderer = /** @type {any} */ (fieldRenderer);
        app.profileRenderer = /** @type {any} */ (profileRenderer);
        app.scene3DController = /** @type {any} */ (scene3DController);
        app.update = vi.fn();

        app.applyTheme('dark');

        expect(fieldRenderer.setTheme).toHaveBeenCalledWith('dark');
        expect(profileRenderer.setTheme).toHaveBeenCalledWith('dark');
        expect(scene3DController.applyTheme).toHaveBeenCalledWith('dark');
        expect(app.update).toHaveBeenCalledTimes(1);
    });

    it('routes view-tab canvas lookup through the shell viewport controller', () => {
        const app = new SeatingBowlApp();
        const fieldCanvas = { parentElement: { id: 'fieldParent' } };
        const profileCanvas = { parentElement: { id: 'profileParent' } };
        const update = vi.spyOn(app, 'update').mockImplementation(() => {});

        app.editorShell = /** @type {any} */ ({
            getViewCanvases: vi.fn(() => ({
                fieldCanvas,
                profileCanvas
            })),
            handleViewTabChanged: vi.fn((tab, handlers) => {
                handlers.onFieldActivated();
            })
        });

        app.setViewTab('field');

        expect(app.editorShell.getViewCanvases).toHaveBeenCalledTimes(1);
        expect(app.editorShell.handleViewTabChanged).toHaveBeenCalledWith('field', expect.objectContaining({
            fieldCanvas,
            profileCanvas
        }));
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('routes scene export access through the scene3d controller when building public export descriptors', async () => {
        const app = new SeatingBowlApp();
        const exportSceneData = {
            bowlMeshes: [
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                }
            ],
            aisleMeshes: [],
            seatMeshes: [],
            THREE: { Scene: function Scene() {} }
        };

        app.scene3DController = /** @type {any} */ ({
            getGeometryPort: vi.fn(() => ({
                getExportSceneData: vi.fn(() => exportSceneData),
                buildClosedStructuralProfile: vi.fn(),
                getBowlGeometrySegments: vi.fn()
            }))
        });

        const descriptor = await app.exportController.buildDescriptor('obj');

        expect(app.scene3DController.getGeometryPort).toHaveBeenCalledTimes(1);
        expect(descriptor).toMatchObject({
            filename: 'seating - study - football.obj',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('f 1 2 3');
    });

    it('delegates clip position control sync to editor controls instead of mutating the DOM directly', () => {
        const app = new SeatingBowlApp();
        const syncClipPositionRange = vi.fn();
        const getOffsetCorrection = vi.fn(() => 0);
        const renderField = vi.fn();
        const getClipPositionRange = vi.fn(() => ({
            min: -10,
            max: 80
        }));

        app.editorControls = /** @type {any} */ ({
            syncClipPositionRange
        });
        const geometryPort = {
            getOffsetCorrection,
            getClipPositionRange,
            getVisualFocalY: vi.fn(() => 0),
            buildTierAisleLayouts: vi.fn(() => []),
            calculateRowLength: vi.fn(() => 100)
        };
        app.fieldRenderer = /** @type {any} */ ({
            ...geometryPort,
            getGeometryPort: vi.fn(() => geometryPort),
            render: renderField
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: vi.fn()
        });
        app.statsPanel = /** @type {any} */ ({
            update: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive: vi.fn(() => false)
        });
        app.state.sport = 'Football';
        app.state.bowl.clipAxis = 'X';
        app.state.bowl.clipPosition = 200;

        app.update();

        expect(app.state.bowl.clipPosition).toBe(80);
        expect(getOffsetCorrection).toHaveBeenCalledWith(expect.objectContaining({ width: 160 }), 'Football');
        expect(getClipPositionRange).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ width: 160 }),
            'X',
            0
        );
        expect(renderField).toHaveBeenCalledTimes(1);
        expect(syncClipPositionRange).toHaveBeenCalledWith({
            min: -10,
            max: 80,
            value: 80
        });
    });

    it('does not initialize rhino when there is no scene export geometry', async () => {
        const app = new SeatingBowlApp();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        app.scene3DController = /** @type {any} */ ({
            getGeometryPort: vi.fn(() => ({
                getExportSceneData: () => null
            }))
        });

        await expect(app.exportController.buildDescriptor('rhino')).resolves.toBeNull();
        expect(app.scene3DController.getGeometryPort).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith('No 3D data to export');
    });

    it('uses shell visibility state when updating the scene3d controller', () => {
        const app = new SeatingBowlApp();
        const isScene3DActive = vi.fn(() => true);
        const updateScene3D = vi.fn();

        const geometryPort = {
            getClipPositionRange: vi.fn(() => ({ min: 0, max: 0 })),
            getOffsetCorrection: vi.fn(() => 0),
            getVisualFocalY: vi.fn(() => 12),
            buildTierAisleLayouts: vi.fn(() => []),
            calculateRowLength: vi.fn(() => 100)
        };
        app.fieldRenderer = /** @type {any} */ ({
            ...geometryPort,
            getGeometryPort: vi.fn(() => geometryPort),
            render: vi.fn()
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: vi.fn()
        });
        app.editorControls = /** @type {any} */ ({
            syncClipPositionRange: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive
        });
        app.scene3DController = /** @type {any} */ ({
            update: updateScene3D
        });
        app.statsPanel = /** @type {any} */ ({
            update: vi.fn()
        });

        app.update();

        expect(isScene3DActive).toHaveBeenCalledTimes(1);
        expect(updateScene3D).toHaveBeenCalledWith(
            expect.objectContaining({
                template: app.renderRuntime.getSnapshot()?.template,
                focalZ: app.state.setup.focalZ,
                bowlConfig: expect.objectContaining({
                    width: 160
                })
            }),
            { isActive: true }
        );
    });

    it('replays the scene3d side effects when restored state opens directly to the 3D tab', () => {
        const app = new SeatingBowlApp();
        app.editorControls = /** @type {any} */ ({
            applyImportedConfig: vi.fn(),
            syncFromState: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            syncFromState: vi.fn(),
            getViewCanvases: vi.fn(() => ({
                fieldCanvas: null,
                profileCanvas: null
            })),
            handleViewTabChanged: vi.fn((tab, handlers) => {
                handlers.onScene3DActivated();
            })
        });
        app.scene3DController = /** @type {any} */ ({
            activate: vi.fn().mockResolvedValue(),
            renderBookmarks: vi.fn()
        });

        app.loadState({
            ui: {
                activeViewTab: 'scene3d',
                activeResultsTab: 'statsTab'
            }
        });

        expect(app.editorShell.syncFromState).toHaveBeenCalledWith({
            activeViewTab: 'scene3d',
            activeResultsTab: 'statsTab'
        });
        expect(app.editorShell.handleViewTabChanged).toHaveBeenCalledWith('scene3d', expect.any(Object));
        expect(app.scene3DController.activate).toHaveBeenCalledTimes(1);
    });
});
