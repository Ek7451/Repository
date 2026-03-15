import { afterEach, describe, expect, test, vi } from 'vitest';

import { getTemplate } from '../../core/sports-templates.js';
import { SeatingBowlApp } from '../../ui/app.js';

function createCanvas(id) {
    return {
        id,
        parentElement: { id: `${id}-parent` }
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('SeatingBowlApp runtime seams', () => {
    test('rehydrates config state and replays the current load-side effects', () => {
        const app = new SeatingBowlApp();
        const hydrateTierInitialization = vi.fn();
        const syncFromState = vi.fn();
        const renderBookmarks = vi.fn();
        const refreshProjectChrome = vi.spyOn(app.projectShell, 'refreshProjectChrome').mockImplementation(() => {});
        const scheduleUpdate = vi.spyOn(app, '_scheduleUpdate').mockImplementation(() => {});

        app.editorControls = /** @type {any} */ ({
            hydrateTierInitialization,
            syncFromState
        });
        app.scene3DController = /** @type {any} */ ({
            renderBookmarks
        });

        app._loadStateFromConfig({
            sport: 'Soccer',
            setup: {
                customRunoff: 20,
                focalZ: 7
            },
            bowl: {
                type: 'Side1',
                clipEnabled: true,
                clipAxis: 'Y',
                clipPosition: 14
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

        expect(app.state.sport).toBe('Soccer');
        expect(app.state.setup.focalZ).toBe(7);
        expect(app.renderRuntime.getExportContext(app.state).template).toBe(getTemplate('Soccer'));
        expect(hydrateTierInitialization).toHaveBeenCalledWith(expect.objectContaining({
            sport: 'Soccer'
        }));
        expect(syncFromState).toHaveBeenCalledTimes(1);
        expect(renderBookmarks).toHaveBeenCalledTimes(1);
        expect(refreshProjectChrome).toHaveBeenCalledTimes(1);
        expect(scheduleUpdate).toHaveBeenCalledTimes(1);
    });

    test('applies project metadata before state load and emits the current success status', () => {
        const statuses = [];
        const app = new SeatingBowlApp({
            onStatusChanged: (status) => statuses.push(status)
        });
        const eventOrder = [];
        const loadStateSpy = vi.spyOn(app, '_loadStateFromConfig').mockImplementation(() => {
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
        expect(loadStateSpy).toHaveBeenCalledWith({ sport: 'Basketball' }, { logSuccess: true });
        expect(eventOrder).toEqual(['load:project-1']);
        expect(statuses.at(-1)).toEqual({
            message: 'Loaded Arena Study',
            tone: 'success'
        });
    });

    test('assembles the current runtime snapshot for field, profile, stats, and 3d updates', () => {
        const app = new SeatingBowlApp();
        const renderField = vi.fn();
        const renderProfile = vi.fn();
        const updateStats = vi.fn();
        const getOffsetCorrection = vi.fn(() => 7);
        const buildTierAisleLayouts = vi.fn(() => ([
            {
                tierIndex: 0,
                aisles: [],
                sectionSummary: {
                    actualAisles: 0,
                    actualSections: 0
                }
            }
        ]));

        app.fieldRenderer = /** @type {any} */ ({
            getClipPositionRange: vi.fn(() => ({ min: -5, max: 60 })),
            getOffsetCorrection,
            getVisualFocalY: vi.fn(() => 123),
            buildTierAisleLayouts,
            calculateRowLength: vi.fn(() => 150),
            render: renderField
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: renderProfile
        });
        app.statsPanel = /** @type {any} */ ({
            update: updateStats
        });
        app.editorControls = /** @type {any} */ ({
            syncClipPositionRange: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive: vi.fn(() => false),
            ensure3DContainerSize: vi.fn()
        });
        app.scene3DController = /** @type {any} */ ({
            update: vi.fn()
        });
        app.state.setup.focalZ = 9;
        app.state.setup.customRunoff = 30;
        app.state.bowl.structuralDepth = 18;
        app.state.occupancy.showSeatCubes3D = true;
        app.state.occupancy.seatWidth = 22;

        app.update();

        const snapshot = app.renderRuntime.getSnapshot();

        expect(snapshot?.template).toBe(getTemplate('Football'));
        expect(snapshot?.solvers.length).toBeGreaterThan(0);
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
                structuralDepth: 18
            }),
            7,
            snapshot?.tierAisleLayouts
        );
        expect(renderProfile).toHaveBeenCalledWith(
            snapshot?.solvers,
            0,
            9,
            {
                structuralDepth: 18,
                showSightlines: true,
                showCLabels: true
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

        app._handleViewTabChanged('scene3d');

        expect(app.state.ui.activeViewTab).toBe('scene3d');
        expect(app.scene3DController.activate).toHaveBeenCalledTimes(1);

        app._handleViewTabChanged('scene3d');

        expect(app.scene3DController.activate).toHaveBeenCalledTimes(2);
    });
});
