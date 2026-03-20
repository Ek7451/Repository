import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeatingBowlApp } from '../../ui/app.js';
import * as editorShellModule from '../../ui/editor-shell.js';
import * as scene3DControllerModule from '../../ui/scene3d-controller.js';
import * as statsPanelModule from '../../ui/stats-panel.js';
import * as fieldRendererModule from '../../viz/field-renderer.js';
import * as profileRendererModule from '../../viz/profile-renderer.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function createInitialProject({
    sport = 'Football',
    activeViewTab = 'profile',
    activeResultsTab = 'statsTab'
} = {}) {
    return {
        id: 'project-1',
        name: 'Arena Study',
        createdAt: '2026-03-15T00:00:00.000Z',
        updatedAt: '2026-03-15T01:00:00.000Z',
        state: {
            _projectVersion: 'dashboard-cutover-v1',
            sport,
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-15T00:00:00.000Z',
                    updatedAt: '2026-03-15T01:00:00.000Z',
                    state: {
                        sport,
                        ui: {
                            activeViewTab,
                            activeResultsTab
                        }
                    }
                }
            ]
        }
    };
}

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
            name: 'Ice Hockey Study',
            metadata: {
                id: null,
                name: '',
                createdAt: '',
                updatedAt: ''
            },
            session: null,
            canSave: false,
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    label: 'Option 1',
                    color: '#7aae1a',
                    isActive: true
                }
            ],
            canCreateOption: false,
            canManageOptions: false,
            canDeleteOption: false
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

    it('routes project chrome, status, and save-busy updates through the editor shell API', () => {
        const renderProjectChrome = vi.fn();
        const renderOptionChrome = vi.fn();
        const renderProjectStatus = vi.fn();
        const setProjectSaveBusy = vi.fn();
        const app = new SeatingBowlApp();

        app.editorShell = /** @type {any} */ ({
            renderProjectChrome,
            renderOptionChrome,
            renderProjectStatus,
            setProjectSaveBusy
        });

        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        });
        app.setProjectMetadata({
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });
        app.setProjectStatus('Saved project', 'success');
        app.setProjectSaveBusy(true);

        expect(renderProjectChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                session: expect.objectContaining({
                    displayName: 'Pat Example',
                    jobTitle: 'Design Technology Specialist II'
                })
            }),
            expect.objectContaining({ isSaveBusy: false })
        );
        expect(renderProjectStatus).toHaveBeenCalledWith({
            message: 'Saved project',
            tone: 'success'
        });
        expect(setProjectSaveBusy).toHaveBeenCalledWith(true);
    });

    it('forwards the structured project action port into the editor shell constructor', async () => {
        const projectActions = {
            saveCurrentProject: vi.fn()
        };
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas: { id: 'fieldCanvas' },
                profileCanvas: { id: 'profileCanvas' }
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ ({
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        }));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));

        const app = new SeatingBowlApp({ projectActions });
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn()
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        await app.init();

        expect(editorShellModule.EditorShell).toHaveBeenCalledWith(expect.objectContaining({
            projectActions
        }));
        expect(mockShell.applyUrlViewOverride).toHaveBeenCalledWith({ notify: false });
    });

    it('replays pre-init session chrome into the editor shell during init', async () => {
        const renderProjectChrome = vi.fn();
        const renderOptionChrome = vi.fn();
        const renderProjectStatus = vi.fn();
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas: { id: 'fieldCanvas' },
                profileCanvas: { id: 'profileCanvas' }
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome,
            renderOptionChrome,
            renderProjectStatus,
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        const mockScene3DController = {
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        };

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ (mockScene3DController));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));

        const app = new SeatingBowlApp();
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn()
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        });

        await app.init();

        expect(renderProjectChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                session: expect.objectContaining({
                    displayName: 'Pat Example',
                    jobTitle: 'Design Technology Specialist II'
                })
            }),
            expect.objectContaining({ isSaveBusy: false })
        );
        expect(renderProjectStatus).toHaveBeenCalledWith({
            message: 'Project persistence ready',
            tone: 'default'
        });
        expect(mockShell.applyUrlViewOverride).toHaveBeenCalledWith({ notify: false });
    });

    it('awaits the initial 3d activation when a preloaded project restores directly to scene3d', async () => {
        const activateCalls = [];
        /** @type {((value?: unknown) => void) | null} */
        let resolveActivate = null;
        const activate = vi.fn(() => new Promise((resolve) => {
            resolveActivate = resolve;
            activateCalls.push('pending');
        }));
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas: { id: 'fieldCanvas' },
                profileCanvas: { id: 'profileCanvas' }
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(() => null),
            ensure3DContainerSize: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        const mockScene3DController = {
            activate,
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        };

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ (mockScene3DController));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));

        const app = new SeatingBowlApp({
            initialProject: createInitialProject({
                activeViewTab: 'scene3d'
            })
        });
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn()
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        let initResolved = false;
        const initPromise = app.init().then(() => {
            initResolved = true;
        });

        await Promise.resolve();

        expect(mockShell.applyUrlViewOverride).toHaveBeenCalledWith({ notify: false });
        expect(mockShell.ensure3DContainerSize).toHaveBeenCalledTimes(1);
        expect(activate).toHaveBeenCalledTimes(1);
        expect(initResolved).toBe(false);

        if (!resolveActivate) {
            throw new Error('Initial scene3d activation was not captured');
        }
        resolveActivate();
        await initPromise;

        expect(initResolved).toBe(true);
        expect(activateCalls).toEqual(['pending']);
        expect(mockShell.renderProjectStatus).toHaveBeenCalledWith({
            message: 'Loaded Arena Study',
            tone: 'success'
        });
    });

    it('wires the profile renderer drag callback through editor controls only', async () => {
        const fieldCanvas = { id: 'fieldCanvas' };
        const profileCanvas = { id: 'profileCanvas' };
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas,
                profileCanvas
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        const profileRendererInstance = {};
        /** @type {{
         *   onTierPositionChanged: (payload: { tierIndex: number, firstRowDist: number, firstRowElev: number }) => unknown,
         *   onTierRowCountChanged: (payload: { tierIndex: number, numRows: number }) => unknown
         * } | null} */
        let receivedOptions = null;

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation((_canvas, options) => {
            receivedOptions = /** @type {any} */ (options);
            return /** @type {any} */ (profileRendererInstance);
        });
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ ({
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        }));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const app = new SeatingBowlApp();
        const applyTierCanvasPosition = vi.fn(() => true);
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn(),
            applyTierCanvasPosition
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        await app.init();

        expect(profileRendererModule.ProfileRenderer).toHaveBeenCalledWith(
            profileCanvas,
            expect.objectContaining({
                theme: 'light',
                onTierPositionChanged: expect.any(Function)
            })
        );
        if (!receivedOptions) {
            throw new Error('ProfileRenderer options were not captured');
        }

        receivedOptions.onTierPositionChanged({
            tierIndex: 1,
            firstRowDist: 88,
            firstRowElev: 24
        });

        expect(applyTierCanvasPosition).toHaveBeenCalledWith({
            tierIndex: 1,
            firstRowDist: 88,
            firstRowElev: 24
        });
    });

    it('wires the profile renderer row-count callback through editor controls only', async () => {
        const fieldCanvas = { id: 'fieldCanvas' };
        const profileCanvas = { id: 'profileCanvas' };
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas,
                profileCanvas
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        /** @type {{
         *   onTierPositionChanged: (payload: { tierIndex: number, firstRowDist: number, firstRowElev: number }) => unknown,
         *   onTierRowCountChanged: (payload: { tierIndex: number, numRows: number }) => unknown
         * } | null} */
        let receivedOptions = null;

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation((_canvas, options) => {
            receivedOptions = /** @type {any} */ (options);
            return /** @type {any} */ ({});
        });
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ ({
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        }));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const app = new SeatingBowlApp();
        const applyTierCanvasPosition = vi.fn(() => true);
        const applyTierCanvasRowCount = vi.fn(() => true);
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn(),
            applyTierCanvasPosition,
            applyTierCanvasRowCount
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        await app.init();

        expect(profileRendererModule.ProfileRenderer).toHaveBeenCalledWith(
            profileCanvas,
            expect.objectContaining({
                theme: 'light',
                onTierRowCountChanged: expect.any(Function)
            })
        );
        if (!receivedOptions) {
            throw new Error('ProfileRenderer options were not captured');
        }

        receivedOptions.onTierRowCountChanged({
            tierIndex: 1,
            numRows: 18
        });

        expect(applyTierCanvasRowCount).toHaveBeenCalledWith({
            tierIndex: 1,
            numRows: 18
        });
        expect(applyTierCanvasPosition).not.toHaveBeenCalled();
    });

    it('captures live AppState snapshots separately from project save requests', () => {
        const chromeUpdates = [];
        const app = new SeatingBowlApp({
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        app.state.sport = 'Basketball';
        const saveRequest = app.getProjectSaveRequest({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-16T00:00:00.000Z',
                    updatedAt: '2026-03-16T00:00:00.000Z',
                    state: { sport: 'Basketball' }
                }
            ]
        });

        expect(saveRequest.name).toBe('Basketball Study');
        expect(saveRequest.state).toMatchObject({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball'
        });
        expect(app.captureStateSnapshot().sport).toBe('Basketball');
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

        const saveRequest = app.getProjectSaveRequest({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Baseball',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-16T00:00:00.000Z',
                    updatedAt: '2026-03-16T00:00:00.000Z',
                    state: { sport: 'Baseball' }
                }
            ]
        });
        expect(saveRequest.name).toBe('Baseball Study');
        expect(app.getProjectMetadata().name).toBe('Baseball Study');
    });

    it('builds export context DTOs through the render runtime public API', () => {
        const app = new SeatingBowlApp();

        app.state.sport = 'Football';
        app.state.setup.customRunoff = null;
        app.state.setup.focalX = 18;
        app.state.setup.focalZ = 9;
        app.state.bowl.type = 'Side1';
        app.state.bowl.cornerRad = 24;
        app.state.bowl.sideLength = 280;
        app.state.bowl.structuralDepth = 18;
        app.state.occupancy.seatWidth = 22;
        app.state.occupancy.minAisle = 44;
        app.state.occupancy.maxAisle = 66;
        app.state.occupancy.seatsBetweenAisles = 18;
        app.state.occupancy.egressFactor = 0.3;

        const exportContext = app.renderRuntime.getExportContext(app.state);

        expect(exportContext.runoffDistance).toBe(25);
        expect(exportContext.focalPointFt).toEqual({ x: 18, z: 9 });
        expect(exportContext.egressParams).toEqual({
            seatWidthIn: 22,
            maxAisleWidthIn: 66,
            minAisleWidthIn: 44,
            egressFactor: 0.3,
            seatsBetweenAisles: 18
        });
        expect(exportContext.primaryTierParameters).toEqual({
            targetCValue: 3.5,
            firstRowDistance: 0,
            firstRowElevation: 2,
            treadDepth: 33,
            riserHeight: 12,
            numRows: 15,
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
            structuralDepth: 18
        });
        expect(exportContext.bowlConfig).not.toHaveProperty('clip');
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
        app.state.sport = 'Football';
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

    it('renders field updates without clip control sync side effects', () => {
        const app = new SeatingBowlApp();
        const getOffsetCorrection = vi.fn(() => 0);
        const renderField = vi.fn();
        const geometryPort = {
            getOffsetCorrection,
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

        app.update();

        expect(getOffsetCorrection).toHaveBeenCalledWith(expect.objectContaining({ width: 160 }), 'Football');
        expect(renderField).toHaveBeenCalledTimes(1);
        expect(app.renderRuntime.getSnapshot()).not.toHaveProperty('clipRange');
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
        app.editorShell = /** @type {any} */ ({
            isScene3DActive
        });
        app.scene3DController = /** @type {any} */ ({
            update: updateScene3D
        });
        app.statsPanel = /** @type {any} */ ({
            update: vi.fn()
        });
        app.state.sport = 'Football';

        app.update();

        expect(isScene3DActive).toHaveBeenCalledTimes(1);
        expect(updateScene3D).toHaveBeenCalledWith(
            expect.objectContaining({
                template: app.renderRuntime.getSnapshot()?.template,
                focalPointFt: app.renderRuntime.getSnapshot()?.focalPointFt,
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
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            isScene3DActive: vi.fn(() => false),
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
            renderBookmarks: vi.fn(),
            update: vi.fn()
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
