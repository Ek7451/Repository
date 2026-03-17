/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { FieldRenderer } from '../viz/field-renderer.js';
import { ProfileRenderer } from '../viz/profile-renderer.js';
import { DEFAULT_STARTUP_PROFILE } from '../core/default-starting-profile.js';
import { createAppState, resolveSportName, resolveSportTemplate } from '../state/app-state.js';
import {
    getActiveProjectStateSnapshot,
    normalizeProjectEnvelope
} from '../state/project.js';
import { EditorControls } from './editor-controls.js';
import { EditorExportController } from './editor-export-controller.js';
import { EditorShell } from './editor-shell.js';
import { ProjectShellController } from './project-shell-controller.js';
import { RenderRuntime } from './render-runtime.js';
import { Scene3DController } from './scene3d-controller.js';
import { StatsPanel } from './stats-panel.js';

export class SeatingBowlApp {
    constructor(options = {}) {
        const callbacks = /** @type {{
            onProjectChromeChanged?: ((chrome: {
                name: string,
                metadata: { id: string | null, name: string, createdAt: string, updatedAt: string },
                session: object | null,
                canSave: boolean
            }) => void),
            onStatusChanged?: ((status: { message: string, tone: string }) => void),
            projectActions?: object | null
        }} */ (options && typeof options === 'object' ? options : {});
        this.state = createAppState();
        this.fieldRenderer = null;
        this.profileRenderer = null;
        this.scene3DController = null;
        this._debounceTimer = null;
        this._projectSaveBusy = false;
        this.renderRuntime = new RenderRuntime();
        this.statsPanel = null;
        this.editorControls = new EditorControls({
            state: this.state,
            onChange: ({ reason }) => {
                if (reason === 'sport') {
                    this._handleSportChanged();
                    return;
                }
                this._scheduleUpdate();
            }
        });
        this.exportController = new EditorExportController({
            getExportContext: () => this.renderRuntime.getExportContext(this.state),
            getFieldGeometryPort: () => this.fieldRenderer?.getGeometryPort?.() ?? null,
            getSceneGeometryPort: () => this.scene3DController?.getGeometryPort() ?? null
        });
        this._projectActions = callbacks.projectActions ?? null;
        this.editorShell = null;
        this.projectShell = new ProjectShellController({
            getSportName: () => resolveSportName(this.state),
            onProjectChromeChanged: (chrome) => {
                this.editorShell?.renderProjectChrome(chrome, { isSaveBusy: this._projectSaveBusy });
                callbacks.onProjectChromeChanged?.(chrome);
            },
            onProjectOptionChromeChanged: (optionChrome) => {
                this.editorShell?.renderOptionChrome(optionChrome);
            },
            onStatusChanged: (status) => {
                this.editorShell?.renderProjectStatus(status);
                callbacks.onStatusChanged?.(status);
            }
        });
    }

    async init() {
        try {
            this._initEditorShell();
            const { fieldCanvas, profileCanvas } = this.editorShell?.connectViewCanvases?.({
                onResize: () => this._scheduleUpdate()
            }) ?? {};
            const activeTheme = this.editorShell?.getTheme?.() ?? 'light';
            const handleTierPositionChanged = (payload) => (
                this.editorControls?.applyTierCanvasPosition(payload) ?? false
            );
            const handleTierRowCountChanged = (payload) => (
                this.editorControls?.applyTierCanvasRowCount(payload) ?? false
            );

            // Init 2D renderers
            this.fieldRenderer = new FieldRenderer(fieldCanvas, { theme: activeTheme });
            this.profileRenderer = new ProfileRenderer(profileCanvas, {
                theme: activeTheme,
                onTierPositionChanged: handleTierPositionChanged,
                onTierRowCountChanged: handleTierRowCountChanged
            });

            this.editorControls?.init();
            this.scene3DController = new Scene3DController({
                getTheme: () => this.editorShell?.getTheme?.() ?? 'light',
                getBookmarks: () => this.state.bookmarks,
                getSportName: () => resolveSportName(this.state),
                download: (descriptor) => this.editorShell?.download(descriptor),
                ensureContainerSize: () => this.editorShell?.ensure3DContainerSize(),
                onLayoutChanged: () => {
                    this.editorShell?.ensure3DContainerSize();
                }
            });
            this.statsPanel = new StatsPanel();

            this.state.fromJSON(DEFAULT_STARTUP_PROFILE);
            this.syncShellFromState();
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
        this._projectSaveBusy = false;
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

    getProjectStateDocument() {
        return this.projectShell.getProjectStateDocument();
    }

    getProjectSaveRequest(projectState = this.getProjectStateDocument()) {
        return this.projectShell.getProjectSaveRequest(projectState);
    }

    setProjectStatus(message, tone = 'default') {
        this.projectShell.setProjectStatus(message, tone);
    }

    setProjectSaveBusy(isBusy = false) {
        this._projectSaveBusy = Boolean(isBusy);
        this.editorShell?.setProjectSaveBusy(this._projectSaveBusy);
    }

    setProjectStateDocument(projectState = null) {
        this.projectShell.setProjectStateDocument(projectState);
    }

    captureStateSnapshot() {
        return this.state.toJSON();
    }

    loadProject(project) {
        if (!project || typeof project !== 'object') return;
        const normalizedProject = normalizeProjectEnvelope(project, this.captureStateSnapshot());
        this.setProjectMetadata(normalizedProject);
        this.setProjectStateDocument(normalizedProject.state);
        this.replaceLiveState(
            getActiveProjectStateSnapshot(normalizedProject.state, this.captureStateSnapshot()),
            { logSuccess: true }
        );
        this.setProjectStatus(
            `Loaded ${this.getProjectChrome().name}`,
            'success'
        );
    }

    _initEditorShell() {
        this.editorShell?.destroy();
        this.editorShell = new EditorShell({
            themeStorageKey: 'jlg-seating-theme',
            projectActions: this._projectActions,
            onThemeChanged: (theme, options = {}) => {
                this.applyTheme(theme, options);
            },
            onViewTabChanged: (tab) => {
                this.setViewTab(tab);
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
        this.editorShell.renderProjectChrome(this.projectShell.getProjectChrome(), {
            isSaveBusy: this._projectSaveBusy
        });
        this.editorShell.renderOptionChrome(this.projectShell.getProjectOptionChrome());
        this.editorShell.renderProjectStatus(this.projectShell.getProjectStatus());
    }

    applyTheme(theme, { rerender = true } = {}) {
        this._applyThemeToVisualizers(theme);
        if (rerender && this.fieldRenderer && this.profileRenderer) {
            this.update();
        }
    }

    _applyThemeToVisualizers(theme = this.editorShell?.getTheme?.() ?? 'light') {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        this.fieldRenderer?.setTheme?.(nextTheme);
        this.profileRenderer?.setTheme?.(nextTheme);
        this.scene3DController?.applyTheme(nextTheme);
        return nextTheme;
    }

    syncShellFromState() {
        this.editorControls?.syncFromState();
        this.editorShell?.syncFromState({
            activeViewTab: this.state.ui?.activeViewTab,
            activeResultsTab: this.state.ui?.activeResultsTab
        });
        if (this.state.ui?.activeViewTab === 'scene3d') {
            this.setViewTab('scene3d');
        }
    }

    _handleSportChanged() {
        const sportName = resolveSportName(this.state);
        const template = resolveSportTemplate(sportName);
        this.state.applySportDefaults({
            sport: sportName,
            template
        });
        this.syncShellFromState();
        this.projectShell.refreshProjectChrome();
        this._scheduleUpdate();
    }

    setViewTab(tab) {
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
                fieldGeometryPort: this.fieldRenderer?.getGeometryPort?.() ?? null
            });
            if (this.fieldRenderer && snapshot?.fieldRenderInput) {
                const fieldRenderInput = snapshot.fieldRenderInput;
                this.fieldRenderer.render(
                    fieldRenderInput.template,
                    fieldRenderInput.customRunoff,
                    fieldRenderInput.solvers,
                    fieldRenderInput.visibility,
                    fieldRenderInput.visualFocalY,
                    fieldRenderInput.bowlConfig,
                    fieldRenderInput.offsetCorrection,
                    fieldRenderInput.tierAisleLayouts
                );
            }
            if (this.profileRenderer && snapshot?.profileRenderInput) {
                const profileRenderInput = snapshot.profileRenderInput;
                this.profileRenderer.renderMulti(
                    profileRenderInput.solvers,
                    profileRenderInput.focalPointFt.x,
                    profileRenderInput.focalPointFt.z,
                    profileRenderInput.options
                );
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
            this.replaceLiveState(config, { logSuccess: true });
        } catch (err) {
            console.error('Failed to load config:', err);
            throw err;
        }
    }

    loadState(config, options = {}) {
        this.replaceLiveState(config, options);
    }

    replaceLiveState(config, options = {}) {
        if (!config || typeof config !== 'object') return;
        const { logSuccess = false } = options;
        this.state.fromJSON(config);
        this.editorControls?.applyImportedConfig(config);
        this.syncShellFromState();
        this.scene3DController?.renderBookmarks();
        this.projectShell.refreshProjectChrome();
        this._scheduleUpdate();

        if (logSuccess) {
            console.log('Configuration loaded successfully');
        }
    }
}
