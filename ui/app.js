/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { FieldRenderer } from '../viz/field-renderer.js';
import { ProfileRenderer } from '../viz/profile-renderer.js';
import { DEFAULT_STARTUP_PROFILE } from '../core/default-starting-profile.js';
import { AppState } from '../state/app-state.js';
import { EditorControls } from './editor-controls.js';
import { EditorExportController } from './editor-export-controller.js';
import { EditorShell } from './editor-shell.js';
import { ProjectShellController } from './project-shell-controller.js';
import { RenderRuntime } from './render-runtime.js';
import { Scene3DController } from './scene3d-controller.js';
import { StatsPanel } from './stats-panel.js';

function normalizeThemeName(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

export class SeatingBowlApp {
    constructor(options = {}) {
        const callbacks = /** @type {{
            onProjectChromeChanged?: ((chrome: {
                name: string,
                metadata: { id: string | null, name: string, createdAt: string, updatedAt: string },
                session: object | null,
                canSave: boolean
            }) => void),
            onStatusChanged?: ((status: { message: string, tone: string }) => void)
        }} */ (options && typeof options === 'object' ? options : {});
        /** @type {typeof AppState} */
        this.state = /** @type {typeof AppState} */ (AppState.reset());
        this.fieldRenderer = null;
        this.profileRenderer = null;
        this.scene3DController = null;
        this._debounceTimer = null;
        this.renderRuntime = new RenderRuntime();
        this.statsPanel = null;
        this.editorControls = new EditorControls({
            state: this.state,
            getTemplate: () => this.renderRuntime.getExportContext(this.state).template,
            getRunoffDistance: () => this.renderRuntime.getExportContext(this.state).runoffDistance,
            onStateChanged: () => this._scheduleUpdate(),
            onSportChanged: () => this._handleSportChanged(),
            getTierDefaults: (tierNum) => this.renderRuntime.getTierDefaults(tierNum)
        });
        this.exportController = new EditorExportController({
            getExportContext: () => this.renderRuntime.getExportContext(this.state),
            getFieldGeometryPort: () => {
                if (!this.fieldRenderer) return null;
                return {
                    calculateRowLength: this.fieldRenderer.calculateRowLength.bind(this.fieldRenderer),
                    generateTierAisleLayout: this.fieldRenderer.generateTierAisleLayout.bind(this.fieldRenderer),
                    getTierSectionMetricsOverlayData: this.fieldRenderer.getTierSectionMetricsOverlayData.bind(this.fieldRenderer),
                    getTierAisleBandPolygons: this.fieldRenderer.getTierAisleBandPolygons.bind(this.fieldRenderer),
                    getBowlGeometrySegments: this.fieldRenderer.getBowlGeometrySegments.bind(this.fieldRenderer),
                    getOffsetCorrection: this.fieldRenderer.getOffsetCorrection.bind(this.fieldRenderer)
                };
            },
            getSceneGeometryPort: () => this.scene3DController?.getGeometryPort() ?? null
        });
        this.editorShell = null;
        this.projectShell = new ProjectShellController({
            getSportName: () => this.state?.sport,
            onProjectChromeChanged: callbacks.onProjectChromeChanged,
            onStatusChanged: callbacks.onStatusChanged
        });
    }

    async init() {
        try {
            this._initEditorShell();
            this._setupCanvases();

            const activeTheme = this._getActiveThemeName();
            const { fieldCanvas, profileCanvas } = this.editorShell?.getViewCanvases?.() ?? {};

            // Init 2D renderers
            this.fieldRenderer = new FieldRenderer(fieldCanvas, { theme: activeTheme });
            this.profileRenderer = new ProfileRenderer(profileCanvas, { theme: activeTheme });

            this.editorControls?.init();
            this.scene3DController = new Scene3DController({
                containerEl: document.getElementById('scene3dContainer'),
                bookmarksBarEl: document.getElementById('cameraBookmarksBar'),
                bookmarksListEl: document.getElementById('cameraBookmarksList'),
                saveBookmarkBtnEl: document.getElementById('saveCameraViewBtn'),
                toggleBookmarksBtnEl: document.getElementById('toggleBookmarksBtn'),
                getTheme: () => this._getActiveThemeName(),
                getBookmarks: () => this.state.bookmarks,
                getSportName: () => this.state.sport,
                download: (descriptor) => this.editorShell?.download(descriptor),
                ensureContainerSize: () => this.editorShell?.ensure3DContainerSize(),
                onLayoutChanged: () => {
                    this.editorShell?.ensure3DContainerSize();
                }
            });
            this._initStatsPanel();

            this.state.fromJSON(DEFAULT_STARTUP_PROFILE);
            this.renderRuntime.getExportContext(this.state);
            this._applyStateToDom();
            this.scene3DController?.renderBookmarks();
            this.projectShell.refreshProjectChrome();
            this.setProjectStatus('Project persistence ready');

            // Initial render
            this.update();

            // Set initial view state (hides Field Setup on Profile tab)
            requestAnimationFrame(() => this.editorShell?.applyUrlViewOverride());

            // 3D scene is initialized lazily when user clicks the 3D tab

        } catch (err) {
            console.error('App init error:', err);
        }
    }

    destroy() {
        this.editorControls?.destroy();
        this.editorControls = null;
        this.editorShell?.destroy();
        this.editorShell = null;
        this.scene3DController?.destroy();
        this.scene3DController = null;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        this.renderRuntime?.reset();
        this.exportController = null;
        this.projectShell?.destroy();
        this.projectShell = null;
    }

    setSession(session) {
        this.projectShell.setSession(session);
    }

    setProjectMetadata(project = null) {
        this.projectShell.setProjectMetadata(project);
    }

    setProjectName(name = '') {
        this.projectShell.setProjectName(name);
    }

    getProjectMetadata() {
        return this.projectShell.getProjectMetadata();
    }

    getProjectChrome() {
        return this.projectShell.getProjectChrome();
    }

    getProjectStatus() {
        return this.projectShell.getProjectStatus();
    }

    getProjectSaveRequest() {
        return this.projectShell.getProjectSaveRequest(this.state.toJSON());
    }

    setProjectStatus(message, tone = 'default') {
        this.projectShell.setProjectStatus(message, tone);
    }

    loadProject(project) {
        if (!project || typeof project !== 'object') return;
        this.setProjectMetadata(project);
        this._loadStateFromConfig(project.state ?? {}, { logSuccess: true });
        this.setProjectStatus(
            `Loaded ${this.getProjectChrome().name}`,
            'success'
        );
    }

    _initEditorShell() {
        this.editorShell?.destroy();
        this.editorShell = new EditorShell({
            themeStorageKey: 'jlg-seating-theme',
            onThemeChanged: (theme, options = {}) => {
                this._handleThemeChanged(theme, options);
            },
            onViewTabChanged: (tab) => {
                this._handleViewTabChanged(tab);
            },
            onResultsTabChanged: (tab) => {
                this.state.ui.activeResultsTab = tab;
            },
            onExportRequested: (kind) => this.exportController?.buildDescriptor(kind) ?? null,
            onConfigImported: ({ text }) => {
                this._loadConfigText(text);
            },
            onScene3DResizeRequested: () => {
                this.scene3DController?.update(null, { isActive: true });
            }
        });
        this.editorShell.init();
    }

    _handleThemeChanged(theme, { rerender = true } = {}) {
        this._applyThemeToVisualizers(theme);
        if (rerender && this.fieldRenderer && this.profileRenderer) {
            this.update();
        }
    }

    _getActiveThemeName() {
        return normalizeThemeName(this.editorShell?.getTheme?.());
    }

    _applyThemeToVisualizers(theme = this._getActiveThemeName()) {
        const nextTheme = normalizeThemeName(theme);
        this.fieldRenderer?.setTheme?.(nextTheme);
        this.profileRenderer?.setTheme?.(nextTheme);
        this.scene3DController?.applyTheme(nextTheme);
        return nextTheme;
    }

    _initStatsPanel() {
        this.statsPanel = new StatsPanel({
            statsEl: document.getElementById('statsContent'),
            detailsEl: document.getElementById('detailsContent')
        });
    }

    _setupCanvases() {
        const { fieldCanvas, profileCanvas } = this.editorShell?.getViewCanvases?.() ?? {};
        if (!fieldCanvas || !profileCanvas) return;
        this.editorShell?.observeViewCanvases({
            fieldCanvas,
            profileCanvas,
            onResize: () => this._scheduleUpdate()
        });
    }

    _applyStateToDom() {
        this.editorControls?.syncFromState();
        this.editorShell?.syncFromState({
            activeViewTab: this.state.ui?.activeViewTab,
            activeResultsTab: this.state.ui?.activeResultsTab
        });
        if (this.state.ui?.activeViewTab === 'scene3d') {
            this._handleViewTabChanged('scene3d');
        }
    }

    _handleSportChanged() {
        this.state.applySportDefaults({
            sport: this.state.sport,
            template: this.renderRuntime.getExportContext(this.state).template
        });
        this.renderRuntime.getExportContext(this.state);
        this._applyStateToDom();
        this.projectShell.refreshProjectChrome();
        this._scheduleUpdate();
    }

    _handleViewTabChanged(tab) {
        const nextTab = ['profile', 'field', 'scene3d'].includes(tab) ? tab : 'profile';
        const { fieldCanvas, profileCanvas } = this.editorShell?.getViewCanvases?.() ?? {};
        this.state.ui.activeViewTab = nextTab;
        this.editorShell?.handleViewTabChanged(nextTab, {
            fieldCanvas,
            profileCanvas,
            onFieldActivated: () => this.update(),
            onProfileActivated: () => this.update(),
            onScene3DActivated: () => {
                void this.scene3DController?.activate();
            }
        });
    }

    _scheduleUpdate() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.update(), 25);
    }

    update() {
        try {
            const snapshot = this.renderRuntime.recompute({
                state: this.state,
                fieldRenderer: this.fieldRenderer
            });
            if (snapshot?.clipRange) {
                this.editorControls?.syncClipPositionRange(snapshot.clipRange);
            }
            if (this.fieldRenderer) {
                this.fieldRenderer.render(
                    snapshot.template,
                    snapshot.customRunoff,
                    snapshot.solvers,
                    snapshot.visibility,
                    snapshot.visualFocalY,
                    snapshot.bowlConfig,
                    snapshot.offsetCorrection,
                    snapshot.tierAisleLayouts
                );
            }
            if (this.profileRenderer) {
                const showSightlines = this.state.setup.sightlineVisuals;
                this.profileRenderer.renderMulti(snapshot.solvers, snapshot.focalPointFt.x, snapshot.focalPointFt.z, {
                    structuralDepth: snapshot.structuralDepth,
                    showSightlines,
                    showCLabels: showSightlines
                });
            }
            this.scene3DController?.update(snapshot.scene3DInput, {
                isActive: this.editorShell?.isScene3DActive() ?? false
            });
            this.statsPanel?.update(snapshot.statsViewModel);
        } catch (e) {
            console.error('Update error:', e);
        }
    }

    _loadConfigText(text) {
        try {
            const config = JSON.parse(text);
            this._loadStateFromConfig(config, { logSuccess: true });
        } catch (err) {
            console.error('Failed to load config:', err);
            throw err;
        }
    }

    _loadStateFromConfig(config, options = {}) {
        if (!config || typeof config !== 'object') return;
        const { logSuccess = false } = options;
        this.state.fromJSON(config);
        this.renderRuntime.getExportContext(this.state);
        this.editorControls?.hydrateTierInitialization(config);
        this._applyStateToDom();
        this.scene3DController?.renderBookmarks();
        this.projectShell.refreshProjectChrome();
        this._scheduleUpdate();

        if (logSuccess) {
            console.log('Configuration loaded successfully');
        }
    }
}
