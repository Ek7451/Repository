/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { getTemplate } from '../core/sports-templates.js';
import { ProfileSolver } from '../core/profile-solver.js';
import { FieldRenderer } from '../viz/field-renderer.js';
import { ProfileRenderer } from '../viz/profile-renderer.js';
import { DEFAULT_STARTUP_PROFILE } from '../core/default-starting-profile.js';
import { AppState } from '../state/app-state.js';
import {
    buildProjectChromeSnapshot,
    buildProjectSaveRequest,
    cloneProjectMetadata,
    cloneSessionDto
} from '../state/project.js';
import { CameraBookmarks } from './camera-bookmarks.js';
import { EditorControls } from './editor-controls.js';
import { EditorExportController } from './editor-export-controller.js';
import { EditorShell } from './editor-shell.js';
import { buildStatsViewModel, StatsPanel } from './stats-panel.js';
// Scene3D is imported lazily in _init3DAsync to avoid blocking if Three.js CDN is unavailable

const EDGE_SPORTS = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];

function getCanvasElement(id) {
    return /** @type {HTMLCanvasElement | null} */ (document.getElementById(id));
}

function normalizeThemeName(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

function normalizeProjectStatus(message, tone = 'default') {
    return {
        message: typeof message === 'string' && message.trim()
            ? message.trim()
            : 'Project persistence ready',
        tone: typeof tone === 'string' && tone.trim()
            ? tone.trim()
            : 'default'
    };
}

function getSolverTierIndex(solver, fallbackIndex = 0) {
    const tierIndex = Number(solver?.tierIndex);
    return Number.isInteger(tierIndex) ? tierIndex : fallbackIndex;
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
        this.scene3D = null;
        this._debounceTimer = null;
        this._currentTemplate = null;
        this._solvers = [];
        this._scene3dReady = false;
        this._tierAisleLayouts = [];
        this.cameraBookmarks = null;
        this.statsPanel = null;
        this.editorControls = new EditorControls({
            state: this.state,
            getTemplate: () => this._currentTemplate,
            getRunoffDistance: () => this._getRunoffDistance(),
            syncShellState: (uiState) => this.editorShell?.syncFromState(uiState),
            onScene3DTabRestored: (tab) => this._handleViewTabChanged(tab),
            onStateChanged: () => this._scheduleUpdate(),
            onSportChanged: () => this._handleSportChanged(),
            getTierDefaults: (tierNum) => this._getTierDefaultsForEnabledTier(tierNum)
        });
        this.exportController = new EditorExportController({
            getActiveSolvers: () => this._getActiveSolvers(),
            getBowlConfig: () => this._getBowlConfig(),
            getCurrentTemplate: () => this._currentTemplate,
            getEgressParams: () => this._getEgressParams(),
            getFieldRenderer: () => this.fieldRenderer,
            getFocalPointFt: () => this._getFocalPointFt(),
            getOffsetCorrection: (bowlConfig, sportName) => this._getOffsetCorrection(bowlConfig, sportName),
            getPrimaryTierParameters: () => this._buildPrimaryTierParameters(),
            getRunoffDistance: () => this._getRunoffDistance(),
            getScene3D: () => this.scene3D,
            getSceneExportData: () => this._getSceneExportData(),
            getSportName: () => this.state.sport,
            getState: () => this.state,
            getTierAisleLayouts: () => this._tierAisleLayouts || []
        });
        this.editorShell = null;

        this._session = null;
        this._projectMetadata = cloneProjectMetadata();
        this._projectStatus = normalizeProjectStatus();
        this._onProjectChromeChanged = typeof callbacks.onProjectChromeChanged === 'function'
            ? callbacks.onProjectChromeChanged
            : null;
        this._onStatusChanged = typeof callbacks.onStatusChanged === 'function'
            ? callbacks.onStatusChanged
            : null;
    }

    async init() {
        try {
            this._initEditorShell();
            this._setupCanvases();

            const activeTheme = this._getActiveThemeName();

            // Init 2D renderers
            this.fieldRenderer = new FieldRenderer(getCanvasElement('fieldCanvas'), { theme: activeTheme });
            this.profileRenderer = new ProfileRenderer(getCanvasElement('profileCanvas'), { theme: activeTheme });

            this.editorControls?.init();
            this._initCameraBookmarks();
            this._initStatsPanel();

            this.state.fromJSON(DEFAULT_STARTUP_PROFILE);
            this._syncTemplateFromState();
            this._applyStateToDom();
            this.cameraBookmarks?.render();
            this._refreshProjectChrome();
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
        this.cameraBookmarks?.destroy();
        this.cameraBookmarks = null;
        this.scene3D?.dispose?.();
        this.scene3D = null;
        this._scene3dReady = false;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        this._solvers = [];
        this.exportController = null;
        this._onProjectChromeChanged = null;
        this._onStatusChanged = null;
    }

    setSession(session) {
        this._session = cloneSessionDto(session);
        this._refreshProjectChrome();
    }

    setProjectMetadata(project = null) {
        this._projectMetadata = cloneProjectMetadata(project);
        this._refreshProjectChrome();
    }

    setProjectName(name = '') {
        this._projectMetadata.name = typeof name === 'string' ? name : '';
        this._refreshProjectChrome();
    }

    getProjectMetadata() {
        return cloneProjectMetadata(this._projectMetadata);
    }

    getProjectChrome() {
        return buildProjectChromeSnapshot({
            name: this._projectMetadata.name || this._deriveProjectName(),
            projectMetadata: this._projectMetadata,
            session: this._session
        });
    }

    getProjectStatus() {
        return { ...this._projectStatus };
    }

    getProjectSaveRequest() {
        const name = (this._projectMetadata.name || this._deriveProjectName()).trim();
        this._projectMetadata.name = name;
        this._refreshProjectChrome();

        return buildProjectSaveRequest({
            name,
            state: this.state.toJSON()
        });
    }

    setProjectStatus(message, tone = 'default') {
        this._projectStatus = normalizeProjectStatus(message, tone);
        this._emitStatusChanged();
    }

    loadProject(project) {
        if (!project || typeof project !== 'object') return;
        this.setProjectMetadata(project);
        this._loadStateFromConfig(project.state ?? {}, { logSuccess: true });
        this.setProjectStatus(`Loaded ${this._projectMetadata.name || this._deriveProjectName()}`, 'success');
    }

    _deriveProjectName() {
        const sportName = typeof this.state?.sport === 'string' && this.state.sport.trim()
            ? this.state.sport.trim()
            : 'Seating';
        return `${sportName} Study`;
    }

    _refreshProjectChrome() {
        this._emitProjectChromeChanged();
    }

    _emitProjectChromeChanged() {
        this._onProjectChromeChanged?.(this.getProjectChrome());
    }

    _emitStatusChanged() {
        this._onStatusChanged?.(this.getProjectStatus());
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
            onExportRequested: (kind) => this._buildExportDescriptor(kind),
            onConfigImported: ({ text }) => {
                this._loadConfigText(text);
            },
            onScene3DResizeRequested: () => {
                this.scene3D?.forceResize();
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
        this.scene3D?.applyTheme?.(nextTheme);
        return nextTheme;
    }

    _initCameraBookmarks() {
        this.cameraBookmarks?.destroy();
        this.cameraBookmarks = new CameraBookmarks({
            barEl: document.getElementById('cameraBookmarksBar'),
            listEl: document.getElementById('cameraBookmarksList'),
            saveBtnEl: document.getElementById('saveCameraViewBtn'),
            toggleBtnEl: document.getElementById('toggleBookmarksBtn'),
            getBookmarks: () => this.state.bookmarks,
            getScene3D: () => this.scene3D,
            getSportName: () => this.state.sport,
            download: (descriptor) => this.editorShell?.download(descriptor),
            onLayoutChanged: () => {
                this.editorShell?.ensure3DContainerSize();
                this.scene3D?.forceResize();
            }
        });
    }

    _initStatsPanel() {
        this.statsPanel = new StatsPanel({
            statsEl: document.getElementById('statsContent'),
            detailsEl: document.getElementById('detailsContent')
        });
    }

    async _init3DAsync() {
        if (this._scene3dReady || this._scene3dLoading) return;
        this._scene3dLoading = true;

        const container3d = document.getElementById('scene3dContainer');
        this.editorShell?.ensure3DContainerSize();
        try {
            // Show loading indicator
            container3d.innerHTML = '<div class="loading-3d"><div class="spinner"></div><span>Loading 3D engine...</span></div>';

            // Dynamic import — if Three.js fails, only 3D breaks
            const { Scene3D } = await import('../viz/scene3d.js');

            // Clear loading indicator BEFORE Scene3D creates its canvas
            container3d.innerHTML = '';

            this.scene3D = new Scene3D(container3d, { theme: this._getActiveThemeName() });
            await this.scene3D.init();
            this._applyThemeToVisualizers();
            this._scene3dReady = true;

            // Render 3D now that it's ready
            this._update3D();
            console.log('3D scene initialized successfully');
        } catch (err) {
            console.warn('3D view unavailable:', err.message);
            container3d.innerHTML = '<div class="loading-3d"><span>3D view could not load: ' + err.message + '</span></div>';
        } finally {
            this._scene3dLoading = false;
        }
    }

    _setupCanvases() {
        const fieldCanvas = getCanvasElement('fieldCanvas');
        const profileCanvas = getCanvasElement('profileCanvas');
        if (!fieldCanvas || !profileCanvas) return;
        this.editorShell?.observeViewCanvases({
            fieldCanvas,
            profileCanvas,
            onResize: () => this._scheduleUpdate()
        });
    }

    _syncTemplateFromState() {
        const resolvedSport = getTemplate(this.state.sport) ? this.state.sport : 'Football';
        if (resolvedSport !== this.state.sport) {
            this.state.sport = resolvedSport;
        }

        this._currentTemplate = getTemplate(this.state.sport);
    }

    _applyStateToDom() {
        this.editorControls?.syncFromState();
    }

    _handleSportChanged() {
        this.state.applySportDefaults({
            sport: this.state.sport,
            template: getTemplate(this.state.sport)
        });
        this._syncTemplateFromState();
        this._applyStateToDom();
        this._refreshProjectChrome();
        this._scheduleUpdate();
    }

    _getTierDefaultsForEnabledTier(tierNum) {
        if (tierNum <= 1 || this._solvers.length < tierNum - 1) return null;

        const prevTier = this._solvers[tierNum - 2];
        if (!prevTier?.rows?.length) return null;

        const lastRow = prevTier.rows[prevTier.rows.length - 1];
        return {
            firstRowDist: Number(lastRow.x.toFixed(2)),
            firstRowElev: Number((lastRow.z + 20).toFixed(2)),
            riserHeight: 12
        };
    }

    _handleViewTabChanged(tab) {
        const nextTab = ['profile', 'field', 'scene3d'].includes(tab) ? tab : 'profile';
        this.state.ui.activeViewTab = nextTab;
        this.editorShell?.handleViewTabChanged(nextTab, {
            fieldCanvas: getCanvasElement('fieldCanvas'),
            profileCanvas: getCanvasElement('profileCanvas'),
            onFieldActivated: () => this.update(),
            onProfileActivated: () => this.update(),
            onScene3DActivated: () => {
                if (!this._scene3dReady) {
                    void this._init3DAsync();
                } else if (this.scene3D) {
                    this.scene3D.forceResize();
                    this._update3D();
                }
            }
        });
    }

    _scheduleUpdate() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.update(), 25);
    }

    _getCustomRunoff() {
        return this.state.setup.customRunoff;
    }

    _getRunoffDistance() {
        const customRunoff = this._getCustomRunoff();
        return customRunoff !== null ? customRunoff : (this._currentTemplate?.runoff || 0);
    }

    _getFocalPointFt() {
        return {
            x: 0,
            z: this.state.setup.focalZ
        };
    }

    _getOffsetCorrection(bowlConfig, sportName = this.state.sport) {
        const safeWidth = Number.isFinite(bowlConfig?.width) ? bowlConfig.width : 0;
        return EDGE_SPORTS.includes(sportName) ? 0 : (safeWidth / 2);
    }

    _solveActiveTiers(focalPointFt) {
        const solvers = [];

        this.state.tiers.forEach((tierState, tierIndex) => {
            if (!tierState?.enabled) return;

            const solver = new ProfileSolver({
                targetCValue: tierState.cValue,
                firstRowDistance: tierState.firstRowDist,
                firstRowElevation: tierState.firstRowElev,
                treadDepth: tierState.treadDepth,
                defaultRiser: tierState.riserHeight,
                numRows: Math.round(tierState.numRows),
                eyeHeight: tierState.eyeHeight,
                eyeSetback: tierState.eyeSetback,
                focalX: focalPointFt.x,
                focalZ: focalPointFt.z
            });
            solver.solve(tierState.profileType);
            solver.tierIndex = tierIndex;
            solvers.push(solver);
        });

        return solvers;
    }

    _renderFieldView({ solvers, focalPointFt, bowlConfig, egressParams }) {
        const tierMetricsByIndex = new Map();

        if (!this.fieldRenderer) {
            this._tierAisleLayouts = [];
            return tierMetricsByIndex;
        }

        const sportName = this.state.sport;
        const visibility = {
            showSeating: true,
            t1: !!this.state.tiers[0]?.enabled,
            t2: !!this.state.tiers[1]?.enabled,
            t3: !!this.state.tiers[2]?.enabled,
            colorByCValue: this.state.setup.sightlineVisuals,
            showSectionMetrics: this.state.setup.sectionMetrics
        };
        const baseY = EDGE_SPORTS.includes(sportName)
            ? (this._currentTemplate.focal_y || 0)
            : 0;
        const visualFocalY = baseY + focalPointFt.x;
        const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);
        const tierAisleLayouts = [];

        solvers.forEach((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return;

            const tierIndex = getSolverTierIndex(solver, index);
            const metrics = ProfileSolver.calculateTierMetrics(
                solver,
                bowlConfig,
                this.fieldRenderer,
                egressParams,
                offsetCorrection
            );
            if (!metrics) return;

            tierMetricsByIndex.set(tierIndex, metrics);
            const tierLayout = this.fieldRenderer.generateTierAisleLayout(
                solver,
                bowlConfig,
                metrics,
                offsetCorrection,
                egressParams
            );
            if (!tierLayout) return;

            tierLayout.tierIndex = tierIndex;
            tierAisleLayouts.push(tierLayout);
        });

        this._tierAisleLayouts = tierAisleLayouts;
        this.fieldRenderer.render(
            this._currentTemplate,
            this._getCustomRunoff(),
            solvers,
            visibility,
            visualFocalY,
            bowlConfig,
            offsetCorrection,
            tierAisleLayouts
        );

        return tierMetricsByIndex;
    }

    _renderProfileView({ solvers, focalPointFt, structuralDepth }) {
        if (!this.profileRenderer) return;

        const showSightlines = this.state.setup.sightlineVisuals;
        this.profileRenderer.renderMulti(solvers, focalPointFt.x, focalPointFt.z, {
            structuralDepth,
            showSightlines,
            showCLabels: showSightlines
        });
    }

    update() {
        try {
            this._syncTemplateFromState();
            const focalPointFt = this._getFocalPointFt();
            const structuralDepth = this.state.bowl.structuralDepth || 0;
            const solvers = this._solveActiveTiers(focalPointFt);
            this._solvers = solvers;
            const bowlConfig = this._getBowlConfig();
            const egressParams = this._getEgressParams();
            this._updateClipSliderRange(solvers, bowlConfig);
            const tierMetricsByIndex = this._renderFieldView({
                solvers,
                focalPointFt,
                bowlConfig,
                egressParams
            });
            this._renderProfileView({ solvers, focalPointFt, structuralDepth });
            this._update3D();
            this.statsPanel?.update(buildStatsViewModel({
                solvers,
                focalPointFt,
                bowlConfig,
                egressParams,
                tierMetricsByIndex,
                tierAisleLayouts: this._tierAisleLayouts || []
            }));
        } catch (e) {
            console.error('Update error:', e);
        }
    }

    _update3D() {
        if (!this._scene3dReady || !this.scene3D) return;
        try {
            if (this.editorShell?.isScene3DActive()) {
                this.editorShell?.ensure3DContainerSize();
                this.scene3D.forceResize();
            }

            const customRunoff = this._getCustomRunoff();
            this.scene3D.updateField(this._currentTemplate, customRunoff, this.state.setup.focalZ);

            const bowlConfig = this._getBowlConfig();
            const sportName = this.state.sport;
            const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);

            if (this.scene3D) {
                this.scene3D.updateBowl(
                    this._solvers,
                    bowlConfig,
                    this._currentTemplate,
                    offsetCorrection,
                    this._tierAisleLayouts || [],
                    {
                        showSeatCubes: this.state.occupancy.showSeatCubes3D,
                        seatWidthIn: this.state.occupancy.seatWidth
                    }
                );
            }
        } catch (e) {
            console.warn('3D update error:', e);
        }
    }

    _getEgressParams() {
        return {
            seatWidthIn: this.state.occupancy.seatWidth,
            maxAisleWidthIn: this.state.occupancy.maxAisle,
            minAisleWidthIn: this.state.occupancy.minAisle,
            egressFactor: this.state.occupancy.egressFactor,
            seatsBetweenAisles: this.state.occupancy.seatsBetweenAisles
        };
    }

    _getActiveSolvers() {
        return this._solvers
            .filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
    }

    _getSceneExportData() {
        if (!this.scene3D) return null;
        if (typeof this.scene3D.getExportSceneData !== 'function') return null;
        return this.scene3D.getExportSceneData();
    }

    _buildPrimaryTierParameters() {
        const primaryTier = this.state.tiers[0];

        return {
            targetCValue: primaryTier?.cValue ?? 0,
            firstRowDistance: primaryTier?.firstRowDist ?? 0,
            firstRowElevation: primaryTier?.firstRowElev ?? 0,
            treadDepth: primaryTier?.treadDepth ?? 0,
            riserHeight: primaryTier?.riserHeight ?? 0,
            numRows: primaryTier?.numRows ?? 0,
            eyeHeight: primaryTier?.eyeHeight ?? 0,
            eyeSetback: primaryTier?.eyeSetback ?? 0
        };
    }

    async _buildExportDescriptor(kind) {
        return this.exportController?.buildDescriptor(kind) ?? null;
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
        this._syncTemplateFromState();
        this.editorControls?.hydrateTierInitialization(config);
        this._applyStateToDom();
        this.cameraBookmarks?.render();
        this._refreshProjectChrome();
        this._scheduleUpdate();

        if (logSuccess) {
            console.log('Configuration loaded successfully');
        }
    }

    // ========== HELPER: Get standard bowl config ==========
    _getBowlConfig() {
        const clipCfg = this.state.bowl.clipEnabled ? {
            enabled: true,
            axis: this.state.bowl.clipAxis,
            position: this.state.bowl.clipPosition,
            side: this.state.bowl.clipSide
        } : { enabled: false };

        return {
            width: this._currentTemplate.field_width,
            length: this._currentTemplate.field_length,
            shape: this._currentTemplate.shape,
            radius_arc: this._currentTemplate.field_radius,
            arc_angle: this._currentTemplate.arc_angle,
            type: this.state.bowl.type,
            corner: 'Chamfer',
            radius: this.state.bowl.cornerRad,
            sideLength: this.state.bowl.sideLength,
            structuralDepth: this.state.bowl.structuralDepth || 0,
            clip: clipCfg
        };
    }

    _updateClipSliderRange(solvers, bowlConfig) {
        if (!this.fieldRenderer || !bowlConfig) return;

        // Use current solved bowl outer edge to derive dynamic clip extents.
        let maxRowX = 0;
        (solvers || []).forEach(s => {
            if (!s || !s.rows || s.rows.length === 0) return;
            const last = s.rows[s.rows.length - 1];
            if (last && Number.isFinite(last.x)) maxRowX = Math.max(maxRowX, last.x);
        });

        const offsetCorrection = this._getOffsetCorrection(bowlConfig, this.state.sport);
        const outerOffset = maxRowX - offsetCorrection;

        const cfgNoClip = { ...bowlConfig, clip: { enabled: false } };
        const bounds = this._computeBowlBounds(cfgNoClip, outerOffset);
        if (!bounds) return;

        const axis = (this.state.bowl.clipAxis || 'X').toUpperCase();
        const minVal = Math.floor(axis === 'X' ? bounds.minX : bounds.minY);
        const maxVal = Math.ceil(axis === 'X' ? bounds.maxX : bounds.maxY);
        const lo = Math.min(minVal, maxVal - 1);
        const hi = Math.max(maxVal, minVal + 1);

        let curr = Number(this.state.bowl.clipPosition);
        if (!Number.isFinite(curr)) curr = 0;
        const clamped = Math.max(lo, Math.min(hi, curr));
        if (clamped !== curr) {
            this.state.bowl.clipPosition = clamped;
        }

        this.editorControls?.syncClipPositionRange({
            min: lo,
            max: hi,
            value: clamped
        });
    }

    _computeBowlBounds(bowlConfig, offset) {
        const segments = this.fieldRenderer?.getBowlGeometrySegments(bowlConfig, offset) || [];
        if (!segments || !segments.length) return null;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const addPt = (x, y) => {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        };

        segments.forEach(s => {
            if (s.cmd === 'moveTo' || s.cmd === 'lineTo') {
                addPt(s.x, s.y);
            } else if (s.cmd === 'arc') {
                const steps = 96;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const a = s.sa + (s.ea - s.sa) * t;
                    addPt(s.x + s.r * Math.cos(a), s.y + s.r * Math.sin(a));
                }
            }
        });

        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return null;
        }
        return { minX, minY, maxX, maxY };
    }

}
