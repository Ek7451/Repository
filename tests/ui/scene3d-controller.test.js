import { afterEach, describe, expect, it, vi } from 'vitest';

const { scene3DFactory, cameraBookmarkInstances } = vi.hoisted(() => ({
    scene3DFactory: vi.fn(),
    cameraBookmarkInstances: []
}));

vi.mock('../../viz/scene3d.js', () => ({
    Scene3D: vi.fn((...args) => scene3DFactory(...args))
}));

vi.mock('../../ui/camera-bookmarks.js', () => ({
    CameraBookmarks: vi.fn().mockImplementation((options = {}) => {
        const instance = {
            options,
            render: vi.fn(),
            destroy: vi.fn()
        };
        cameraBookmarkInstances.push(instance);
        return instance;
    })
}));

import { Scene3DController } from '../../ui/scene3d-controller.js';

function createElements() {
    return {
        containerEl: { innerHTML: '' },
        bookmarksBarEl: {},
        bookmarksListEl: {},
        saveBookmarkBtnEl: {},
        toggleBookmarksBtnEl: {}
    };
}

function createSnapshot() {
    return {
        template: { shape: 'rectangle', field_width: 160, field_length: 360 },
        customRunoff: 18,
        focalPointFt: { x: 18, z: 9 },
        focalZ: 9,
        solvers: [{ rows: [{ x: 10, tread_depth: 3 }] }],
        bowlConfig: { width: 160, length: 360, structuralDepth: 18 },
        offsetCorrection: 7,
        tierAisleLayouts: [{ tierIndex: 0, aisles: [] }],
        seatPreviewOptions: { showSeatCubes: true, seatWidthIn: 22 }
    };
}

afterEach(() => {
    vi.clearAllMocks();
    scene3DFactory.mockReset();
    cameraBookmarkInstances.length = 0;
});

describe('Scene3DController', () => {
    it('activate performs lazy init once only and reuses the stored snapshot', async () => {
        const ensureContainerSize = vi.fn();
        const scene3D = {
            init: vi.fn().mockResolvedValue(),
            applyTheme: vi.fn(),
            forceResize: vi.fn(),
            updateField: vi.fn(),
            updateBowl: vi.fn(),
            getExportSceneData: vi.fn(() => ({ bowlMeshes: [] })),
            getBowlGeometrySegments: vi.fn(),
            dispose: vi.fn()
        };
        scene3DFactory.mockImplementation(() => scene3D);
        const controller = new Scene3DController({
            ...createElements(),
            getTheme: () => 'dark',
            getBookmarks: () => [],
            getSportName: () => 'Football',
            ensureContainerSize
        });
        const snapshot = createSnapshot();

        controller.update(snapshot, { isActive: false });
        await controller.activate();

        expect(scene3DFactory).toHaveBeenCalledTimes(1);
        expect(scene3D.init).toHaveBeenCalledTimes(1);
        expect(scene3D.applyTheme).toHaveBeenCalledWith('dark');
        expect(scene3D.updateField).toHaveBeenCalledWith(snapshot.template, 18, 9, 18);
        expect(scene3D.updateBowl).toHaveBeenCalledWith(
            snapshot.solvers,
            snapshot.bowlConfig,
            snapshot.template,
            7,
            snapshot.tierAisleLayouts,
            snapshot.seatPreviewOptions
        );
        expect(controller.getGeometryPort()).toEqual({
            getExportSceneData: expect.any(Function),
            getBowlGeometrySegments: expect.any(Function)
        });

        scene3D.updateField.mockClear();
        scene3D.updateBowl.mockClear();
        await controller.activate();

        expect(scene3DFactory).toHaveBeenCalledTimes(1);
        expect(scene3D.init).toHaveBeenCalledTimes(1);
        expect(scene3D.updateField).toHaveBeenCalledWith(snapshot.template, 18, 9, 18);
        expect(scene3D.updateBowl).toHaveBeenCalledWith(
            snapshot.solvers,
            snapshot.bowlConfig,
            snapshot.template,
            7,
            snapshot.tierAisleLayouts,
            snapshot.seatPreviewOptions
        );

        controller.destroy();
    });

    it('renders failure markup when scene initialization fails', async () => {
        scene3DFactory.mockImplementation(() => ({
            init: vi.fn().mockRejectedValue(new Error('<broken>')),
            dispose: vi.fn()
        }));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const elements = createElements();
        const controller = new Scene3DController({
            ...elements,
            getTheme: () => 'light',
            getBookmarks: () => []
        });

        await controller.activate();

        expect(warnSpy).toHaveBeenCalledWith('3D view unavailable:', '<broken>');
        expect(elements.containerEl.innerHTML).toContain('3D view could not load: &lt;broken&gt;');

        controller.destroy();
    });

    it('fires bookmark layout callbacks through the controller', () => {
        const ensureContainerSize = vi.fn();
        const onLayoutChanged = vi.fn();
        const controller = new Scene3DController({
            ...createElements(),
            getBookmarks: () => [],
            ensureContainerSize,
            onLayoutChanged
        });

        controller.scene3D = /** @type {any} */ ({
            forceResize: vi.fn()
        });
        cameraBookmarkInstances.at(-1).options.onLayoutChanged();

        expect(onLayoutChanged).toHaveBeenCalledTimes(1);
        expect(ensureContainerSize).toHaveBeenCalledTimes(1);
        expect(controller.scene3D.forceResize).toHaveBeenCalledTimes(1);

        controller.destroy();
    });

    it('forces resize before updating when the 3d tab is active', async () => {
        const ensureContainerSize = vi.fn();
        const scene3D = {
            init: vi.fn().mockResolvedValue(),
            applyTheme: vi.fn(),
            forceResize: vi.fn(),
            updateField: vi.fn(),
            updateBowl: vi.fn(),
            dispose: vi.fn()
        };
        scene3DFactory.mockImplementation(() => scene3D);
        const controller = new Scene3DController({
            ...createElements(),
            getBookmarks: () => [],
            ensureContainerSize
        });
        const snapshot = createSnapshot();

        controller.update(snapshot, { isActive: false });
        await controller.activate();
        ensureContainerSize.mockClear();
        scene3D.forceResize.mockClear();
        scene3D.updateField.mockClear();
        scene3D.updateBowl.mockClear();

        controller.update(snapshot, { isActive: true });

        expect(ensureContainerSize).toHaveBeenCalledTimes(1);
        expect(scene3D.forceResize).toHaveBeenCalledTimes(1);
        expect(scene3D.forceResize.mock.invocationCallOrder[0]).toBeLessThan(scene3D.updateField.mock.invocationCallOrder[0]);
        expect(scene3D.updateField).toHaveBeenCalledWith(snapshot.template, 18, 9, 18);
        expect(scene3D.updateBowl).toHaveBeenCalledWith(
            snapshot.solvers,
            snapshot.bowlConfig,
            snapshot.template,
            7,
            snapshot.tierAisleLayouts,
            snapshot.seatPreviewOptions
        );

        controller.destroy();
    });

    it('forwards metrics hover targets to the live scene and reapplies them after bowl updates', async () => {
        const scene3D = {
            init: vi.fn().mockResolvedValue(),
            applyTheme: vi.fn(),
            forceResize: vi.fn(),
            updateField: vi.fn(),
            updateBowl: vi.fn(),
            setMetricsHoverTarget: vi.fn(),
            dispose: vi.fn()
        };
        scene3DFactory.mockImplementation(() => scene3D);
        const controller = new Scene3DController({
            ...createElements(),
            getBookmarks: () => []
        });
        const snapshot = createSnapshot();

        controller.setMetricsHoverTarget({ type: 'row', tierIndex: 0, rowIndex: 2 });
        controller.update(snapshot, { isActive: false });
        await controller.activate();

        expect(scene3D.setMetricsHoverTarget).toHaveBeenCalledWith({
            type: 'row',
            tierIndex: 0,
            rowIndex: 2
        });

        scene3D.setMetricsHoverTarget.mockClear();
        controller.setMetricsHoverTarget({ type: 'section', tierIndex: 0, sectionNumber: 101 });

        expect(scene3D.setMetricsHoverTarget).toHaveBeenCalledWith({
            type: 'section',
            tierIndex: 0,
            sectionNumber: 101
        });

        controller.destroy();
    });
});
