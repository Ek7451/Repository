import { afterEach, describe, expect, test, vi } from 'vitest';

import { CameraBookmarks } from '../../ui/camera-bookmarks.js';

function createClassList() {
    return {
        contains: vi.fn(() => false),
        add: vi.fn(),
        remove: vi.fn(),
        toggle: vi.fn(() => false)
    };
}

function createElementStub(overrides = {}) {
    return {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        appendChild: vi.fn(),
        remove: vi.fn(),
        querySelectorAll: vi.fn(() => []),
        getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 120, height: 48 })),
        closest: vi.fn(() => null),
        setAttribute: vi.fn(),
        classList: createClassList(),
        style: {},
        dataset: {},
        innerHTML: '',
        offsetWidth: 160,
        ...overrides
    };
}

function createCanvasStub() {
    return {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
            drawImage: vi.fn()
        })),
        toDataURL: vi.fn(() => 'data:image/png;base64,thumb'),
        style: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        remove: vi.fn()
    };
}

function createDocumentStub() {
    return {
        body: {
            appendChild: vi.fn()
        },
        documentElement: {
            clientWidth: 1440
        },
        createElement: vi.fn((tagName) => (
            tagName === 'canvas'
                ? createCanvasStub()
                : createElementStub()
        )),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
    };
}

function createScene3D() {
    const positionSet = vi.fn();
    const targetSet = vi.fn();
    const updateControls = vi.fn();

    return {
        scene: {},
        camera: {
            position: {
                x: 12,
                y: 24,
                z: 36,
                set: positionSet
            }
        },
        controls: {
            target: {
                x: 3,
                y: 6,
                z: 9,
                set: targetSet
            },
            update: updateControls
        },
        renderer: {
            render: vi.fn(),
            domElement: {
                width: 300,
                height: 200,
                clientWidth: 300,
                clientHeight: 200,
                toDataURL: vi.fn(() => 'data:image/png;base64,full')
            }
        }
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('CameraBookmarks', () => {
    test('owns bookmark creation, restore, export, and mutation against the live bookmark array', () => {
        vi.stubGlobal('document', createDocumentStub());
        vi.stubGlobal('window', {
            innerWidth: 1440,
            innerHeight: 900,
            setTimeout: vi.fn((callback) => callback()),
            prompt: vi.fn()
        });

        const bookmarks = [];
        const scene3D = createScene3D();
        const downloads = [];
        const cameraBookmarks = new CameraBookmarks({
            barEl: createElementStub(),
            listEl: createElementStub(),
            saveBtnEl: createElementStub(),
            toggleBtnEl: createElementStub(),
            getBookmarks: () => bookmarks,
            getScene3D: () => scene3D,
            getSportName: () => 'Soccer',
            download: (descriptor) => downloads.push(descriptor)
        });

        const bookmark = cameraBookmarks.createCurrentBookmark();
        expect(bookmark).toMatchObject({
            name: 'View 1',
            position: { x: 12, y: 24, z: 36 },
            target: { x: 3, y: 6, z: 9 },
            thumbnail: 'data:image/png;base64,thumb'
        });
        expect(bookmarks).toEqual([bookmark]);

        cameraBookmarks.renameBookmark(0, 'Corner View');
        expect(bookmarks[0].name).toBe('Corner View');

        cameraBookmarks.restoreBookmark(0);
        expect(scene3D.camera.position.set).toHaveBeenCalledWith(12, 24, 36);
        expect(scene3D.controls.target.set).toHaveBeenCalledWith(3, 6, 9);
        expect(scene3D.controls.update).toHaveBeenCalledTimes(1);

        cameraBookmarks.exportBookmarkImage(0);
        expect(downloads).toEqual([{
            filename: '3d-view-soccer-corner-view.png',
            dataUrl: 'data:image/png;base64,full'
        }]);

        cameraBookmarks.removeBookmark(0);
        expect(bookmarks).toEqual([]);

        cameraBookmarks.destroy();
    });
});
