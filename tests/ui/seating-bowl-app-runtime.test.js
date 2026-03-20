import { afterEach, describe, expect, test, vi } from 'vitest';

import { getTemplate } from '../../core/sports-templates.js';
import { SeatingBowlApp } from '../../ui/app.js';

function createCanvas(id) {
    return {
        id,
        parentElement: { id: `${id}-parent` }
    };
}

function createTierLayout(tierIndex = 0) {
    return {
        tierIndex,
        aisleWidthFt: 4,
        seatWidthIn: 20,
        aisles: [
            {
                pathIndex: 0,
                forced: false,
                anchorType: 'segment_fraction',
                segmentIndex: 1,
                segmentT: 0.5,
                alignmentMode: 'perpendicular'
            }
        ],
        targetAisles: 3,
        forcedCount: 1,
        sectionBoundaries: [[
            {
                aisleIndex: 0,
                u: 0.25,
                forced: false
            }
        ]],
        axisExclusionFt: 2.25,
        sectionSummary: {
            actualAisles: 1,
            actualSections: 1,
            allSectionPathsClosed: true,
            backRowSectionSeatCounts: [18],
            sectionOccupancyTotals: [265],
            avgBackRowSeatsPerSection: 18,
            maxBackRowSeatsPerSection: 18,
            minBackRowSeatsPerSection: 18
        }
    };
}

function createInitialProject({
    id = 'project-1',
    name = 'Arena Study',
    sport = 'Soccer',
    customRunoff = 14,
    focalX = 6,
    focalZ = 7,
    activeViewTab = 'field',
    activeResultsTab = 'detailsTab',
    numRows = 18,
    firstRowDist = 28,
    firstRowElev = 4
} = {}) {
    return {
        id,
        name,
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-15T10:05:00.000Z',
        state: {
            _projectVersion: 'dashboard-cutover-v1',
            sport,
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-15T10:00:00.000Z',
                    updatedAt: '2026-03-15T10:05:00.000Z',
                    state: {
                        _version: 'phase6-app-state',
                        sport,
                        setup: {
                            customRunoff,
                            focalX,
                            focalZ,
                            sightlineVisuals: true,
                            sectionMetrics: false
                        },
                        bowl: {
                            type: 'Full',
                            cornerRad: 10,
                            sideLength: 300,
                            structuralDepth: 12,
                            structuralProfileMode: 'stepped',
                            straightAisleMode: 'perpendicular',
                            chamferAisleMode: 'radial'
                        },
                        occupancy: {
                            seatWidth: 20,
                            minAisle: 48,
                            maxAisle: 72,
                            seatsBetweenAisles: 20,
                            egressFactor: 0.2,
                            showSeatCubes3D: false
                        },
                        ui: {
                            activeViewTab,
                            activeResultsTab
                        },
                        tiers: [
                            {
                                enabled: true,
                                profileType: 'Parabolic',
                                cValue: 4,
                                numRows,
                                firstRowDist,
                                firstRowElev,
                                treadDepth: 33,
                                riserHeight: 10,
                                eyeHeight: 3.75,
                                eyeSetback: 6
                            },
                            {
                                enabled: false,
                                profileType: 'Parabolic',
                                cValue: 4,
                                numRows: 10,
                                firstRowDist: 10,
                                firstRowElev: 0,
                                treadDepth: 33,
                                riserHeight: 10,
                                eyeHeight: 3.75,
                                eyeSetback: 6
                            },
                            {
                                enabled: false,
                                profileType: 'Parabolic',
                                cValue: 4,
                                numRows: 10,
                                firstRowDist: 10,
                                firstRowElev: 0,
                                treadDepth: 33,
                                riserHeight: 10,
                                eyeHeight: 3.75,
                                eyeSetback: 6
                            }
                        ],
                        bookmarks: []
                    }
                }
            ]
        }
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SeatingBowlApp runtime seams', () => {
    test('rehydrates config state and replays the current load-side effects', () => {
        vi.useFakeTimers();
        const app = new SeatingBowlApp();
        const applyImportedConfig = vi.fn();
        const syncControlsFromState = vi.fn();
        const syncShellFromState = vi.fn();
        const renderBookmarks = vi.fn();
        const update = vi.spyOn(app, 'update').mockImplementation(() => {});
        const refreshProjectChrome = vi.spyOn(app.projectShell, 'refreshProjectChrome').mockImplementation(() => {});

        app.editorControls = /** @type {any} */ ({
            applyImportedConfig,
            syncFromState: syncControlsFromState
        });
        app.editorShell = /** @type {any} */ ({
            syncFromState: syncShellFromState
        });
        app.scene3DController = /** @type {any} */ ({
            renderBookmarks
        });

        app.loadState({
            sport: 'Soccer',
            setup: {
                customRunoff: 20,
                focalZ: 7
            },
            bowl: {
                type: 'Side1'
            },
            ui: {
                activeViewTab: 'field',
                activeResultsTab: 'detailsTab'
            },
            tiers: [
                {
                    enabled: true,
                    numRows: 18,
                    firstRowDist: 28
                },
                {},
                {}
            ],
            bookmarks: [{ name: 'View 1', position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } }]
        });
        vi.runAllTimers();

        expect(app.state.sport).toBe('Soccer');
        expect(app.state.setup.focalZ).toBe(7);
        expect(app.state.bowl.straightAisleMode).toBe('perpendicular');
        expect(app.state.bowl.chamferAisleMode).toBe('radial');
        expect(app.renderRuntime.getExportContext(app.state).template).toBe(getTemplate('Soccer'));
        expect(app.renderRuntime.getExportContext(app.state).bowlConfig).toEqual(expect.objectContaining({
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        }));
        expect(applyImportedConfig).toHaveBeenCalledWith(expect.objectContaining({
            sport: 'Soccer'
        }));
        expect(syncControlsFromState).toHaveBeenCalledTimes(1);
        expect(syncShellFromState).toHaveBeenCalledTimes(1);
        expect(renderBookmarks).toHaveBeenCalledTimes(1);
        expect(refreshProjectChrome).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledTimes(1);
    });

    test('applies project metadata before state load and emits the current success status', () => {
        const statuses = [];
        const app = new SeatingBowlApp({
            onStatusChanged: (status) => statuses.push(status)
        });
        const eventOrder = [];
        const replaceLiveStateSpy = vi.spyOn(app, 'replaceLiveState').mockImplementation(() => {
            eventOrder.push(`load:${app.getProjectMetadata().id}`);
        });

        app.loadProject({
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-15T10:00:00.000Z',
            updatedAt: '2026-03-15T10:05:00.000Z',
            state: {
                sport: 'Basketball'
            }
        });

        expect(app.getProjectMetadata()).toMatchObject({
            id: 'project-1',
            name: 'Arena Study'
        });
        expect(replaceLiveStateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ sport: 'Basketball' }),
            { logSuccess: true }
        );
        expect(eventOrder).toEqual(['load:project-1']);
        expect(statuses.at(-1)).toEqual({
            message: 'Loaded Arena Study',
            tone: 'success'
        });
    });

    test('primes constructor state from the initial project so the first update uses the saved study', () => {
        const app = new SeatingBowlApp({
            initialProject: createInitialProject()
        });
        const renderField = vi.fn();
        const renderProfile = vi.fn();
        const updateStats = vi.fn();
        const geometryPort = {
            getOffsetCorrection: vi.fn(() => 3),
            getVisualFocalY: vi.fn(() => 21),
            buildTierAisleLayouts: vi.fn(() => []),
            calculateRowLength: vi.fn(() => 100)
        };

        app.fieldRenderer = /** @type {any} */ ({
            ...geometryPort,
            getGeometryPort: vi.fn(() => geometryPort),
            render: renderField
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: renderProfile
        });
        app.statsPanel = /** @type {any} */ ({
            update: updateStats
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive: vi.fn(() => false),
            ensure3DContainerSize: vi.fn()
        });
        app.scene3DController = /** @type {any} */ ({
            update: vi.fn()
        });

        app.update();

        const snapshot = app.renderRuntime.getSnapshot();

        expect(app.getProjectMetadata()).toMatchObject({
            id: 'project-1',
            name: 'Arena Study'
        });
        expect(app.state.sport).toBe('Soccer');
        expect(app.state.ui).toEqual({
            activeViewTab: 'field',
            activeResultsTab: 'detailsTab'
        });
        expect(snapshot?.template).toBe(getTemplate('Soccer'));
        expect(snapshot?.focalPointFt).toEqual({ x: 6, z: 7 });
        expect(renderField).toHaveBeenCalledWith(
            snapshot?.template,
            14,
            snapshot?.solvers,
            expect.objectContaining({
                t1: true,
                t2: false,
                t3: false
            }),
            21,
            expect.objectContaining({
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            }),
            3,
            []
        );
        expect(renderProfile).toHaveBeenCalledWith(
            snapshot?.solvers,
            6,
            7,
            expect.objectContaining({
                showSightlines: true
            })
        );
        expect(updateStats).toHaveBeenCalledWith(snapshot?.statsViewModel);
    });

    test('assembles the current runtime snapshot for field, profile, stats, and 3d updates', () => {
        const app = new SeatingBowlApp();
        const renderField = vi.fn();
        const renderProfile = vi.fn();
        const updateStats = vi.fn();
        const getOffsetCorrection = vi.fn(() => 7);
        const buildTierAisleLayouts = vi.fn(() => ([createTierLayout(0)]));
        const geometryPort = {
            getOffsetCorrection,
            getVisualFocalY: vi.fn(() => 123),
            buildTierAisleLayouts,
            calculateRowLength: vi.fn(() => 150)
        };
        app.fieldRenderer = /** @type {any} */ ({
            ...geometryPort,
            getGeometryPort: vi.fn(() => geometryPort),
            render: renderField
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: renderProfile
        });
        app.statsPanel = /** @type {any} */ ({
            update: updateStats
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive: vi.fn(() => false),
            ensure3DContainerSize: vi.fn()
        });
        app.scene3DController = /** @type {any} */ ({
            update: vi.fn()
        });
        app.state.sport = 'Football';
        app.state.setup.focalX = 18;
        app.state.setup.focalZ = 9;
        app.state.setup.customRunoff = 30;
        app.state.bowl.structuralDepth = 18;
        app.state.bowl.structuralProfileMode = 'sloped';
        app.state.bowl.straightAisleMode = 'perpendicular';
        app.state.bowl.chamferAisleMode = 'radial';
        app.state.occupancy.showSeatCubes3D = true;
        app.state.occupancy.seatWidth = 22;

        app.update();

        const snapshot = app.renderRuntime.getSnapshot();

        expect(snapshot?.template).toBe(getTemplate('Football'));
        expect(snapshot?.solvers.length).toBeGreaterThan(0);
        expect(snapshot?.tierAisleLayouts[0]).toEqual(expect.objectContaining({
            tierIndex: 0,
            aisleWidthFt: 4,
            seatWidthIn: 20,
            targetAisles: 3,
            forcedCount: 1,
            axisExclusionFt: 2.25,
            sectionSummary: expect.objectContaining({
                actualAisles: 1,
                actualSections: 1,
                allSectionPathsClosed: true
            })
        }));
        expect(renderField).toHaveBeenCalledTimes(1);
        expect(renderField).toHaveBeenCalledWith(
            snapshot?.template,
            30,
            snapshot?.solvers,
            expect.objectContaining({
                t1: true,
                colorByCValue: true
            }),
            123,
            expect.objectContaining({
                width: 160,
                structuralDepth: 18,
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            }),
            7,
            snapshot?.tierAisleLayouts
        );
        expect(renderProfile).toHaveBeenCalledWith(
            snapshot?.solvers,
            18,
            9,
            {
                structuralDepth: 18,
                structuralProfileMode: 'sloped',
                showSightlines: true,
                showCLabels: true,
                tierRowCountControls: [
                    { min: 5, max: 80, step: 1 },
                    { min: 3, max: 60, step: 1 },
                    { min: 3, max: 60, step: 1 }
                ]
            }
        );
        expect(app.scene3DController.update).toHaveBeenCalledWith(
            snapshot?.scene3DInput,
            { isActive: false }
        );
        expect(updateStats).toHaveBeenCalledTimes(1);
        expect(updateStats).toHaveBeenCalledWith(snapshot?.statsViewModel);
        expect(getOffsetCorrection).toHaveBeenCalled();
        expect(buildTierAisleLayouts).toHaveBeenCalled();
    });

    test('delegates scene3d activation to the extracted controller', () => {
        const app = new SeatingBowlApp();
        const fieldCanvas = createCanvas('fieldCanvas');
        const profileCanvas = createCanvas('profileCanvas');

        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => {
                if (id === 'fieldCanvas') return fieldCanvas;
                if (id === 'profileCanvas') return profileCanvas;
                return null;
            })
        });

        app.editorShell = /** @type {any} */ ({
            handleViewTabChanged: vi.fn((tab, handlers) => {
                handlers.onScene3DActivated();
            })
        });

        app.scene3DController = /** @type {any} */ ({
            activate: vi.fn().mockResolvedValue()
        });

        app.setViewTab('scene3d');

        expect(app.state.ui.activeViewTab).toBe('scene3d');
        expect(app.scene3DController.activate).toHaveBeenCalled();

        app.setViewTab('scene3d');

        expect(app.state.ui.activeViewTab).toBe('scene3d');
        expect(app.scene3DController.activate).toHaveBeenCalled();
    });
});
