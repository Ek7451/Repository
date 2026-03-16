import { CameraBookmarks } from './camera-bookmarks.js';

function normalizeThemeName(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getErrorMessage(error) {
    if (error && typeof error === 'object' && typeof error.message === 'string') {
        return error.message;
    }
    return String(error);
}

function getDefaultElement(id) {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') {
        return null;
    }
    return document.getElementById(id);
}

export class Scene3DController {
    constructor(options = {}) {
        const settings = /** @type {{
            containerEl?: HTMLElement | null,
            bookmarksBarEl?: HTMLElement | null,
            bookmarksListEl?: HTMLElement | null,
            saveBookmarkBtnEl?: HTMLElement | null,
            toggleBookmarksBtnEl?: HTMLElement | null,
            getTheme?: (() => string),
            getBookmarks?: (() => Array<object>),
            getSportName?: (() => string),
            download?: ((descriptor: object) => boolean | void),
            ensureContainerSize?: (() => void),
            onLayoutChanged?: (() => void)
        }} */ (options && typeof options === 'object' ? options : {});

        this.containerEl = settings.containerEl ?? getDefaultElement('scene3dContainer');
        this.bookmarksBarEl = settings.bookmarksBarEl ?? getDefaultElement('cameraBookmarksBar');
        this.bookmarksListEl = settings.bookmarksListEl ?? getDefaultElement('cameraBookmarksList');
        this.saveBookmarkBtnEl = settings.saveBookmarkBtnEl ?? getDefaultElement('saveCameraViewBtn');
        this.toggleBookmarksBtnEl = settings.toggleBookmarksBtnEl ?? getDefaultElement('toggleBookmarksBtn');
        this.getTheme = typeof settings.getTheme === 'function'
            ? settings.getTheme
            : () => 'light';
        this.getBookmarks = typeof settings.getBookmarks === 'function'
            ? settings.getBookmarks
            : () => [];
        this.getSportName = typeof settings.getSportName === 'function'
            ? settings.getSportName
            : () => '';
        this.download = typeof settings.download === 'function'
            ? settings.download
            : () => false;
        this.ensureContainerSize = typeof settings.ensureContainerSize === 'function'
            ? settings.ensureContainerSize
            : () => {};
        this.onLayoutChanged = typeof settings.onLayoutChanged === 'function'
            ? settings.onLayoutChanged
            : () => {};

        this.scene3D = null;
        this._scene3dReady = false;
        this._scene3dLoading = false;
        this._lastSnapshot = null;
        this.cameraBookmarks = new CameraBookmarks({
            barEl: this.bookmarksBarEl,
            listEl: this.bookmarksListEl,
            saveBtnEl: this.saveBookmarkBtnEl,
            toggleBtnEl: this.toggleBookmarksBtnEl,
            getBookmarks: this.getBookmarks,
            getScene3D: () => this.scene3D,
            getSportName: this.getSportName,
            download: this.download,
            onLayoutChanged: () => {
                this.onLayoutChanged();
                this.ensureContainerSize();
                this.scene3D?.forceResize?.();
            }
        });
    }

    async activate() {
        if (!this._scene3dReady) {
            await this._initScene3DAsync();
            return;
        }

        this.update(null, { isActive: true });
    }

    applyTheme(theme) {
        const nextTheme = normalizeThemeName(theme);
        this.scene3D?.applyTheme?.(nextTheme);
        return nextTheme;
    }

    update(snapshot = null, { isActive = false } = {}) {
        if (snapshot) {
            this._lastSnapshot = snapshot;
        }
        if (!this._scene3dReady || !this.scene3D || !this._lastSnapshot) return;

        try {
            if (isActive) {
                this.ensureContainerSize();
                this.scene3D.forceResize?.();
            }

            this.scene3D.updateField(
                this._lastSnapshot.template,
                this._lastSnapshot.customRunoff,
                this._lastSnapshot.focalZ,
                this._lastSnapshot.focalPointFt?.x
            );
            this.scene3D.updateBowl(
                this._lastSnapshot.solvers,
                this._lastSnapshot.bowlConfig,
                this._lastSnapshot.template,
                this._lastSnapshot.offsetCorrection,
                this._lastSnapshot.tierAisleLayouts || [],
                this._lastSnapshot.seatPreviewOptions
            );
        } catch (error) {
            console.warn('3D update error:', error);
        }
    }

    renderBookmarks() {
        this.cameraBookmarks?.render();
    }

    getExportSceneData() {
        if (!this.scene3D || typeof this.scene3D.getExportSceneData !== 'function') return null;
        return this.scene3D.getExportSceneData();
    }

    getGeometryPort() {
        if (!this.scene3D) return null;

        return {
            getExportSceneData: typeof this.scene3D.getExportSceneData === 'function'
                ? this.scene3D.getExportSceneData.bind(this.scene3D)
                : null,
            buildClosedStructuralProfile: typeof this.scene3D.buildClosedStructuralProfile === 'function'
                ? this.scene3D.buildClosedStructuralProfile.bind(this.scene3D)
                : null,
            getBowlGeometrySegments: typeof this.scene3D.getBowlGeometrySegments === 'function'
                ? this.scene3D.getBowlGeometrySegments.bind(this.scene3D)
                : null
        };
    }

    destroy() {
        this.cameraBookmarks?.destroy();
        this.cameraBookmarks = null;
        this.scene3D?.dispose?.();
        this.scene3D = null;
        this._scene3dReady = false;
        this._scene3dLoading = false;
        this._lastSnapshot = null;
    }

    async _initScene3DAsync() {
        if (this._scene3dReady || this._scene3dLoading) return;
        if (!this.containerEl) return;

        this._scene3dLoading = true;
        this.ensureContainerSize();

        try {
            this.containerEl.innerHTML = '<div class="loading-3d"><div class="spinner"></div><span>Loading 3D engine...</span></div>';

            const { Scene3D } = await import('../viz/scene3d.js');

            this.containerEl.innerHTML = '';
            this.scene3D = new Scene3D(this.containerEl, {
                theme: normalizeThemeName(this.getTheme())
            });
            await this.scene3D.init();
            this.applyTheme(this.getTheme());
            this._scene3dReady = true;
            this.update(null, { isActive: true });
            console.log('3D scene initialized successfully');
        } catch (error) {
            const message = getErrorMessage(error);
            console.warn('3D view unavailable:', message);
            this.containerEl.innerHTML = `<div class="loading-3d"><span>3D view could not load: ${escapeHtml(message)}</span></div>`;
        } finally {
            this._scene3dLoading = false;
        }
    }
}
