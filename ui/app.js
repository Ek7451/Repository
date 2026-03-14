/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { getSportNames, getTemplate } from '../core/sports-templates.js';
import { ProfileSolver } from '../core/profile-solver.js';
import { FieldRenderer } from '../viz/field-renderer.js';
import { ProfileRenderer } from '../viz/profile-renderer.js';
import { DEFAULT_STARTUP_PROFILE } from '../core/default-starting-profile.js';
import { buildPlanDxf, buildProfileDxf } from '../export/dxf-exporter.js';
import { buildObjText, buildStudyResultsJsonPayload, buildTierMetricsCsv } from '../export/obj-csv-exporter.js';
import { exportRhinoModel } from '../export/rhino/rhino-exporter.js';
import { AppState } from '../state/app-state.js';
import { buildProjectSaveRequest, cloneProjectMetadata } from '../state/project.js';
import { CameraBookmarks } from './camera-bookmarks.js';
import { EditorShell } from './editor-shell.js';
import { buildStatsViewModel, StatsPanel } from './stats-panel.js';
// Scene3D is imported lazily in _init3DAsync to avoid blocking if Three.js CDN is unavailable

const EDGE_SPORTS = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
const NUMERIC_INPUT_STATE_PATHS = {
    focalZ: ['setup', 'focalZ'],
    bowlCornerRad: ['bowl', 'cornerRad'],
    bowlSideLength: ['bowl', 'sideLength'],
    structuralDepth: ['bowl', 'structuralDepth'],
    clipPosition: ['bowl', 'clipPosition'],
    seatWidth: ['occupancy', 'seatWidth'],
    minAisle: ['occupancy', 'minAisle'],
    maxAisle: ['occupancy', 'maxAisle'],
    seatsBetweenAisles: ['occupancy', 'seatsBetweenAisles'],
    egressFactor: ['occupancy', 'egressFactor'],
    cValue: ['tiers', 0, 'cValue'],
    numRows: ['tiers', 0, 'numRows'],
    firstRowDist: ['tiers', 0, 'firstRowDist'],
    firstRowElev: ['tiers', 0, 'firstRowElev'],
    treadDepth: ['tiers', 0, 'treadDepth'],
    riserHeight: ['tiers', 0, 'riserHeight'],
    eyeHeight: ['tiers', 0, 'eyeHeight'],
    eyeSetback: ['tiers', 0, 'eyeSetback'],
    t2CValue: ['tiers', 1, 'cValue'],
    t2NumRows: ['tiers', 1, 'numRows'],
    t2FirstRowDist: ['tiers', 1, 'firstRowDist'],
    t2FirstRowElev: ['tiers', 1, 'firstRowElev'],
    t2TreadDepth: ['tiers', 1, 'treadDepth'],
    t2RiserHeight: ['tiers', 1, 'riserHeight'],
    t2EyeHeight: ['tiers', 1, 'eyeHeight'],
    t2EyeSetback: ['tiers', 1, 'eyeSetback'],
    t3CValue: ['tiers', 2, 'cValue'],
    t3NumRows: ['tiers', 2, 'numRows'],
    t3FirstRowDist: ['tiers', 2, 'firstRowDist'],
    t3FirstRowElev: ['tiers', 2, 'firstRowElev'],
    t3TreadDepth: ['tiers', 2, 'treadDepth'],
    t3RiserHeight: ['tiers', 2, 'riserHeight'],
    t3EyeHeight: ['tiers', 2, 'eyeHeight'],
    t3EyeSetback: ['tiers', 2, 'eyeSetback']
};
const SELECT_STATE_PATHS = {
    sportSelect: ['sport'],
    bowlType: ['bowl', 'type'],
    clipAxis: ['bowl', 'clipAxis'],
    clipSide: ['bowl', 'clipSide'],
    profileType: ['tiers', 0, 'profileType'],
    t2ProfileType: ['tiers', 1, 'profileType'],
    t3ProfileType: ['tiers', 2, 'profileType']
};
const CHECKBOX_STATE_PATHS = {
    enableClipPlane: ['bowl', 'clipEnabled'],
    showSeatCubes3D: ['occupancy', 'showSeatCubes3D'],
    toggleSightlinesBtn: ['setup', 'sightlineVisuals'],
    toggleSightlinesBtnField: ['setup', 'sightlineVisuals'],
    toggleSectionMetricsBtn: ['setup', 'sectionMetrics'],
    enableTier1: ['tiers', 0, 'enabled'],
    enableTier2: ['tiers', 1, 'enabled'],
    enableTier3: ['tiers', 2, 'enabled']
};
const INTEGER_INPUT_IDS = new Set([
    'numRows',
    't2NumRows',
    't3NumRows',
    'minAisle',
    'maxAisle',
    'seatsBetweenAisles'
]);

function getValueAtPath(root, path) {
    return path.reduce((value, key) => value?.[key], root);
}

function setValueAtPath(root, path, nextValue) {
    let cursor = root;
    for (let index = 0; index < path.length - 1; index += 1) {
        cursor = cursor[path[index]];
        if (!cursor) return;
    }

    cursor[path[path.length - 1]] = nextValue;
}

function getHtmlElement(id) {
    return /** @type {HTMLElement | null} */ (document.getElementById(id));
}

function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
}

function getSelectElement(id) {
    return /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
}

function getCanvasElement(id) {
    return /** @type {HTMLCanvasElement | null} */ (document.getElementById(id));
}

function cloneSessionDto(session) {
    return session && typeof session === 'object'
        ? { ...session }
        : null;
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

function buildProjectChromeSnapshot(projectMetadata, session, deriveProjectName) {
    return {
        name: (projectMetadata.name || deriveProjectName()).trim(),
        metadata: cloneProjectMetadata(projectMetadata),
        session: cloneSessionDto(session),
        canSave: Boolean(projectMetadata.id && session)
    };
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
        this._solver = null;
        this._scene3dReady = false;
        this._tierAisleLayouts = [];
        this._rhino3dmPromise = null;
        this.cameraBookmarks = null;
        this.statsPanel = null;
        this.editorShell = null;

        // Track tier count to implement progressive stacking
        this._lastTierCount = 1; // Default

        // Track if tiers have been initialized to prevent overwriting user changes on hide/show
        this._tier2Initialized = false;
        this._tier3Initialized = false;

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
            // Setup canvases
            this._setupCanvases();

            // Init 2D renderers
            this.fieldRenderer = new FieldRenderer(getCanvasElement('fieldCanvas'));
            this.profileRenderer = new ProfileRenderer(getCanvasElement('profileCanvas'));

            // Populate sport dropdown
            this._populateSports();
            this._initEditorShell();

            // Wire up events (must happen before update)
            this._wireEvents();
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

            // Sync internal state to DOM
            const tc = getInputElement('tierCount');
            if (tc) this._lastTierCount = parseInt(tc.value) || 1;

            // Set initial view state (hides Field Setup on Profile tab)
            requestAnimationFrame(() => this.editorShell?.applyUrlViewOverride());

            // 3D scene is initialized lazily when user clicks the 3D tab

        } catch (err) {
            console.error('App init error:', err);
        }
    }

    destroy() {
        this.editorShell?.destroy();
        this.editorShell = null;
        this.cameraBookmarks?.destroy();
        this.cameraBookmarks = null;
        this.scene3D?.dispose?.();
        this.scene3D = null;
        this._scene3dReady = false;
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
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
        return buildProjectChromeSnapshot(
            this._projectMetadata,
            this._session,
            () => this._deriveProjectName()
        );
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
        void theme;
        if (this.scene3D && typeof this.scene3D.applyTheme === 'function') {
            this.scene3D.applyTheme();
        }
        if (rerender && this.fieldRenderer && this.profileRenderer) {
            this.update();
        }
    }

    _initCameraBookmarks() {
        this.cameraBookmarks?.destroy();
        this.cameraBookmarks = new CameraBookmarks({
            barEl: document.getElementById('cameraBookmarksBar'),
            listEl: document.getElementById('cameraBookmarksList'),
            saveBtnEl: document.getElementById('saveCameraViewBtn'),
            toggleBtnEl: document.getElementById('toggleBookmarksBtn'),
            getBookmarks: () => this.state.bookmarks,
            createCurrentBookmark: () => this._createCurrentCameraBookmark(),
            renameBookmark: (index, nextName) => {
                if (!this.state.bookmarks[index]) return;
                this.state.bookmarks[index].name = nextName;
            },
            removeBookmark: (index) => {
                if (!this.state.bookmarks[index]) return;
                this.state.bookmarks.splice(index, 1);
            },
            restoreBookmark: (index) => {
                this._restoreCameraBookmark(this.state.bookmarks[index]);
            },
            exportBookmarkImage: (index, fallbackName = null) => {
                const descriptor = this._build3DImageExportDescriptor(this.state.bookmarks[index]?.name ?? fallbackName);
                if (descriptor) {
                    this.editorShell?.download(descriptor);
                }
            },
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

            this.scene3D = new Scene3D(container3d);
            await this.scene3D.init();
            if (typeof this.scene3D.applyTheme === 'function') {
                this.scene3D.applyTheme();
            }
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

        const setCanvasSize = (canvas) => {
            const parent = canvas.parentElement;
            const rect = parent.getBoundingClientRect();
            // Only resize if the panel is visible (has dimensions)
            if (rect.width > 0 && rect.height > 0) {
                canvas.width = rect.width;
                canvas.height = rect.height;
            }
        };

        setCanvasSize(profileCanvas); // Profile starts visible

        // Resize handler
        this._resizeObserver = new ResizeObserver(() => {
            setCanvasSize(fieldCanvas);
            setCanvasSize(profileCanvas);
            this._scheduleUpdate();
        });
        this._resizeObserver.observe(fieldCanvas.parentElement);
        this._resizeObserver.observe(profileCanvas.parentElement);
    }

    _populateSports() {
        const select = getSelectElement('sportSelect');
        if (!select) return;
        const names = getSportNames();
        for (const name of names) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
    }

    _getStateValue(path) {
        return getValueAtPath(this.state, path);
    }

    _setStateValue(path, nextValue) {
        setValueAtPath(this.state, path, nextValue);
    }

    _normalizeNumericControlValue(baseId, rawValue) {
        if (rawValue === '' || rawValue === null || rawValue === undefined) return null;
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return null;
        if (INTEGER_INPUT_IDS.has(baseId)) {
            return Math.max(0, Math.round(numericValue));
        }
        return numericValue;
    }

    _syncTemplateFromState() {
        const resolvedSport = getTemplate(this.state.sport) ? this.state.sport : 'Football';
        if (resolvedSport !== this.state.sport) {
            this.state.sport = resolvedSport;
        }

        this._currentTemplate = getTemplate(this.state.sport);
        this._updateFieldDimensions();
    }

    _updateFieldDimensions() {
        const dimEl = document.getElementById('fieldDimensions');
        if (!dimEl || !this._currentTemplate) return;

        let text = '';
        if (this._currentTemplate.field_length) text += `${this._currentTemplate.field_length}' L`;
        if (this._currentTemplate.field_width) text += ` - ${this._currentTemplate.field_width}' W`;
        if (this._currentTemplate.field_radius) text += `Radius: ${this._currentTemplate.field_radius}'`;
        dimEl.textContent = text;
    }

    _bindPairedNumberControl(baseId) {
        const path = NUMERIC_INPUT_STATE_PATHS[baseId];
        if (!path) return;

        const slider = getInputElement(`${baseId}Slider`);
        const input = getInputElement(`${baseId}Input`);

        if (slider) {
            slider.addEventListener('input', () => {
                const nextValue = this._normalizeNumericControlValue(baseId, slider.value);
                if (nextValue === null) return;
                this._setStateValue(path, nextValue);
                if (input) input.value = slider.value;
                this._scheduleUpdate();
            });
        }

        if (input) {
            input.addEventListener('input', () => {
                const nextValue = this._normalizeNumericControlValue(baseId, input.value);
                if (nextValue === null) return;
                this._setStateValue(path, nextValue);
                if (slider) slider.value = input.value;
                this._scheduleUpdate();
            });
        }
    }

    _bindSelectControl(id, handler = null) {
        const path = SELECT_STATE_PATHS[id];
        const el = getSelectElement(id);
        if (!el || !path) return;

        el.addEventListener('change', () => {
            this._setStateValue(path, el.value);
            if (typeof handler === 'function') {
                handler(el.value);
            }
            this._scheduleUpdate();
        });
    }

    _bindCheckboxControl(id, handler = null) {
        const path = CHECKBOX_STATE_PATHS[id];
        const el = getInputElement(id);
        if (!el || !path) return;

        el.addEventListener('change', () => {
            this._setStateValue(path, !!el.checked);
            if (typeof handler === 'function') {
                handler(!!el.checked);
            }
            this._scheduleUpdate();
        });
    }

    _applyStateToDom() {
        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            sportSelect.value = this.state.sport;
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        const runoffValue = this._getRunoffDistance();
        if (runoffInput) {
            runoffInput.value = String(this.state.setup.customRunoff ?? '');
        }
        if (runoffSlider) {
            runoffSlider.value = String(runoffValue);
        }

        Object.entries(NUMERIC_INPUT_STATE_PATHS).forEach(([baseId, path]) => {
            const value = this._getStateValue(path);
            if (value !== undefined && value !== null) {
                this._setInputValue(baseId, value);
            }
        });

        Object.entries(SELECT_STATE_PATHS).forEach(([id, path]) => {
            const el = getSelectElement(id);
            if (!el) return;
            const value = this._getStateValue(path);
            if (value !== undefined && value !== null) {
                el.value = value;
            }
        });

        Object.entries(CHECKBOX_STATE_PATHS).forEach(([id, path]) => {
            const el = getInputElement(id);
            if (!el) return;
            el.checked = !!this._getStateValue(path);
        });

        const sideLengthRow = getHtmlElement('sideLengthRow');
        if (sideLengthRow) {
            sideLengthRow.style.display = this.state.bowl.type.includes('Side') ? 'flex' : 'none';
        }

        const clipPlaneControls = getHtmlElement('clipPlaneControls');
        if (clipPlaneControls) {
            clipPlaneControls.style.display = this.state.bowl.clipEnabled ? 'block' : 'none';
        }

        [1, 2, 3].forEach((tierNum) => {
            const section = document.getElementById(`tier${tierNum}Section`);
            if (!section) return;
            const enabled = !!this.state.tiers[tierNum - 1]?.enabled;
            section.classList.toggle('tier-disabled', !enabled);
        });

        this.editorShell?.syncFromState({
            activeViewTab: this.state.ui.activeViewTab,
            activeResultsTab: this.state.ui.activeResultsTab
        });
        if (this.state.ui.activeViewTab === 'scene3d') {
            this._handleViewTabChanged('scene3d');
        }
    }

    _wireEvents() {
        // Sport selector
        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            sportSelect.addEventListener('change', () => {
                this.state.sport = sportSelect.value;
                this._onSportChange();
            });
        }

        // Custom runoff
        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        if (runoffInput && runoffSlider) {
            runoffInput.addEventListener('input', () => {
                if (runoffInput.value === '') {
                    this.state.setup.customRunoff = null;
                    runoffSlider.value = this._getRunoffDistance();
                    this._scheduleUpdate();
                    return;
                }

                const nextValue = Number(runoffInput.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffSlider.value = runoffInput.value;
                this._scheduleUpdate();
            });
            runoffSlider.addEventListener('input', () => {
                const nextValue = Number(runoffSlider.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffInput.value = runoffSlider.value;
                this._scheduleUpdate();
            });
        }

        Object.keys(NUMERIC_INPUT_STATE_PATHS).forEach((baseId) => {
            this._bindPairedNumberControl(baseId);
        });

        // Tier toggles
        ['enableTier1', 'enableTier2', 'enableTier3'].forEach((id, index) => {
            this._bindCheckboxControl(id, () => this._onTierToggle(index + 1));
        });

        // Mark Tier 2/3 as initialized once the user edits any tier-specific parameter.
        // This prevents the tier enable toggle from re-applying auto-stack defaults later.
        [2, 3].forEach((tierNum) => {
            const sectionEl = document.getElementById(`tier${tierNum}Section`);
            if (!sectionEl) return;

            const markInitialized = (e) => {
                const target = e.target;
                if (!(target instanceof HTMLElement)) return;
                if (target.id === `enableTier${tierNum}`) return;
                if (!target.closest('.section-body')) return;
                if (tierNum === 2) this._tier2Initialized = true;
                if (tierNum === 3) this._tier3Initialized = true;
            };

            sectionEl.addEventListener('input', markInitialized);
            sectionEl.addEventListener('change', markInitialized);
        });

        // Profile type selects (main + tier-specific)
        ['profileType', 't2ProfileType', 't3ProfileType'].forEach(id => {
            this._bindSelectControl(id);
        });

        // Clip Plane controls
        this._bindCheckboxControl('enableClipPlane', (enabled) => {
            const controls = getHtmlElement('clipPlaneControls');
            if (controls) controls.style.display = enabled ? 'block' : 'none';
        });
        ['clipAxis', 'clipSide'].forEach(id => this._bindSelectControl(id));

        // Bowl Configuration Change Events
        this._bindSelectControl('bowlType', (value) => {
            const sideRow = getHtmlElement('sideLengthRow');
            if (sideRow) sideRow.style.display = value.includes('Side') ? 'flex' : 'none';
        });

        this._bindCheckboxControl('showSeatCubes3D');

        // Sightlines Toggle
        const sightlinesBtn = getInputElement('toggleSightlinesBtn');
        const sightlinesBtnField = getInputElement('toggleSightlinesBtnField');
        const syncSightlinesToggles = (sourceEl) => {
            const checked = !!sourceEl?.checked;
            this.state.setup.sightlineVisuals = checked;
            if (sightlinesBtn && sightlinesBtn !== sourceEl) sightlinesBtn.checked = checked;
            if (sightlinesBtnField && sightlinesBtnField !== sourceEl) sightlinesBtnField.checked = checked;
            this._scheduleUpdate();
        };
        if (sightlinesBtn) sightlinesBtn.addEventListener('change', () => syncSightlinesToggles(sightlinesBtn));
        if (sightlinesBtnField) sightlinesBtnField.addEventListener('change', () => syncSightlinesToggles(sightlinesBtnField));
        this._bindCheckboxControl('toggleSectionMetricsBtn');
    }

    _onSportChange() {
        this.state.applySportDefaults({
            sport: this.state.sport,
            template: getTemplate(this.state.sport)
        });
        this._syncTemplateFromState();
        this._applyStateToDom();
        this._refreshProjectChrome();
        this._scheduleUpdate();
    }

    _onTierToggle(tierNum) {
        const section = document.getElementById(`tier${tierNum}Section`);
        const enabled = !!this.state.tiers[tierNum - 1]?.enabled;

        if (section) {
            if (enabled) {
                section.classList.remove('tier-disabled');
            } else {
                section.classList.add('tier-disabled');
            }
        }

        if (enabled && tierNum > 1) {
            const isInit = tierNum === 2 ? this._tier2Initialized : this._tier3Initialized;
            if (!isInit && this._solvers && this._solvers.length >= tierNum - 1) {
                const prevTier = this._solvers[tierNum - 2];
                if (prevTier && prevTier.rows && prevTier.rows.length > 0) {
                    const lastRow = prevTier.rows[prevTier.rows.length - 1];
                    const tierState = this.state.tiers[tierNum - 1];
                    if (tierState) {
                        tierState.firstRowDist = Number(lastRow.x.toFixed(2));
                        tierState.firstRowElev = Number((lastRow.z + 20).toFixed(2));
                        tierState.riserHeight = 12;
                    }
                }
            }

            if (tierNum === 2) this._tier2Initialized = true;
            else this._tier3Initialized = true;
        }

        this._applyStateToDom();
    }

    _handleViewTabChanged(tab) {
        const nextTab = ['profile', 'field', 'scene3d'].includes(tab) ? tab : 'profile';
        this.state.ui.activeViewTab = nextTab;

        requestAnimationFrame(() => {
            if (nextTab === 'field') {
                const canvas = getCanvasElement('fieldCanvas');
                const parent = canvas?.parentElement;
                const rect = parent?.getBoundingClientRect();
                if (canvas && rect) {
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                }
                this.update();
                return;
            }

            if (nextTab === 'profile') {
                const canvas = getCanvasElement('profileCanvas');
                const parent = canvas?.parentElement;
                const rect = parent?.getBoundingClientRect();
                if (canvas && rect) {
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                }
                this.update();
                return;
            }

            this.editorShell?.ensure3DContainerSize();
            if (!this._scene3dReady) {
                void this._init3DAsync();
            } else if (this.scene3D) {
                this.scene3D.forceResize();
                this._update3D();
            }
        });
    }

    _scheduleUpdate() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.update(), 25);
    }

    _setInputValue(id, val) {
        const input = getInputElement(id + 'Input');
        const slider = getInputElement(id + 'Slider');
        if (input) input.value = val;
        if (slider) slider.value = val;
    }

    _getInputValue(id) {
        if (id === 'focalX') return 0;
        const path = NUMERIC_INPUT_STATE_PATHS[id];
        if (!path) return 0;
        const value = this._getStateValue(path);
        return Number.isFinite(Number(value)) ? Number(value) : 0;
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

    update() {
        try {
            this._syncTemplateFromState();
            const focalPointFt = this._getFocalPointFt();
            const structuralDepth = this.state.bowl.structuralDepth || 0;
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

            // Store for stats and 3D
            this._solvers = solvers;
            this._solver = solvers[0] || null; // Backward compat for 3D view

            const sportName = this.state.sport;
            const bowlConfig = this._getBowlConfig();
            const customRunoff = this._getCustomRunoff();
            const egressParams = this._getEgressParams();
            const tierMetricsByIndex = new Map();
            this._updateClipSliderRange(solvers, bowlConfig);

            // Render field
            if (this.fieldRenderer) {
                const visibility = {
                    showSeating: true,
                    t1: !!this.state.tiers[0]?.enabled,
                    t2: !!this.state.tiers[1]?.enabled,
                    t3: !!this.state.tiers[2]?.enabled,
                    colorByCValue: this.state.setup.sightlineVisuals,
                    showSectionMetrics: this.state.setup.sectionMetrics
                };

                // Calculate Visual Focal Y (Plan View) based on Sport Type
                let baseY = 0;
                if (EDGE_SPORTS.includes(sportName)) {
                    baseY = this._currentTemplate.focal_y || 0;
                }

                // Focal X input acts as an offset from the Base Y
                const visualFocalY = baseY + focalPointFt.x;
                const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);
                const tierAisleLayouts = [];

                solvers.forEach((solver, idx) => {
                    if (!solver || !solver.rows || solver.rows.length === 0) return;
                    const tierIdx = solver.tierIndex !== undefined ? solver.tierIndex : idx;
                    const metrics = ProfileSolver.calculateTierMetrics(solver, bowlConfig, this.fieldRenderer, egressParams, offsetCorrection);
                    if (!metrics) return;
                    tierMetricsByIndex.set(tierIdx, metrics);

                    const tierLayout = this.fieldRenderer.generateTierAisleLayout(
                        solver,
                        bowlConfig,
                        metrics,
                        offsetCorrection,
                        egressParams
                    );
                    if (!tierLayout) return;
                    tierLayout.tierIndex = tierIdx;
                    tierAisleLayouts.push(tierLayout);
                });

                this._tierAisleLayouts = tierAisleLayouts;
                this.fieldRenderer.render(
                    this._currentTemplate,
                    customRunoff,
                    solvers,
                    visibility,
                    visualFocalY,
                    bowlConfig,
                    offsetCorrection,
                    tierAisleLayouts
                );
            } else {
                this._tierAisleLayouts = [];
            }

            // Render profile — pass all solvers
            if (this.profileRenderer) {
                const showSightlines = this.state.setup.sightlineVisuals;
                this.profileRenderer.renderMulti(solvers, focalPointFt.x, focalPointFt.z, {
                    structuralDepth,
                    showSightlines,
                    showCLabels: showSightlines
                });
            }

            // Update 3D
            this._update3D();

            // Update stats
            this._updateStats(buildStatsViewModel({
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
            const panel = document.getElementById('scene3dPanel');
            if (panel && panel.classList.contains('active')) {
                this.editorShell?.ensure3DContainerSize();
                this.scene3D.forceResize();
            }

            const customRunoff = this._getCustomRunoff();
            this.scene3D.updateField(this._currentTemplate, customRunoff, this.state.setup.focalZ);

            const bowlConfig = this._getBowlConfig();
            const sportName = this.state.sport;
            const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);

            const solvers = this._solvers || (this._solver ? [this._solver] : []);
            if (this.scene3D) {
                this.scene3D.updateBowl(
                    solvers,
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

    _updateStats(viewModel = null) {
        this.statsPanel?.update(viewModel);
    }

    _getActiveSolvers() {
        return (this._solvers && this._solvers.length ? this._solvers : (this._solver ? [this._solver] : []))
            .filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
    }

    _getSceneExportData() {
        if (!this.scene3D) return null;
        if (typeof this.scene3D.getExportSceneData !== 'function') return null;
        return this.scene3D.getExportSceneData();
    }

    _buildTierRuntimeArtifacts(solvers, bowlConfig, egressParams) {
        if (!this.fieldRenderer) return [];

        const offsetCorrection = this._getOffsetCorrection(bowlConfig, this.state.sport);
        const tierLayoutMap = new Map(
            (this._tierAisleLayouts || []).map((layout, index) => [getSolverTierIndex(layout, index), layout])
        );

        return (solvers || []).map((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return null;

            const tierIndex = getSolverTierIndex(solver, index);
            const tierMetrics = ProfileSolver.calculateTierMetrics(
                solver,
                bowlConfig,
                this.fieldRenderer,
                egressParams,
                offsetCorrection
            );

            let tierLayout = tierLayoutMap.get(tierIndex) || null;
            if (!tierLayout && tierMetrics) {
                tierLayout = this.fieldRenderer.generateTierAisleLayout(
                    solver,
                    bowlConfig,
                    tierMetrics,
                    offsetCorrection,
                    egressParams
                );
                if (tierLayout) {
                    tierLayout.tierIndex = tierIndex;
                }
            }

            const overlayData = tierLayout
                ? this.fieldRenderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, offsetCorrection)
                : { sectionLabels: [], rowSeatLabels: [] };
            const aislePolygons = tierLayout
                ? this.fieldRenderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, offsetCorrection)
                : [];
            const rowGeometries = solver.rows.map((row) => {
                const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
                return this.fieldRenderer.getBowlGeometrySegments(bowlConfig, frontOffset);
            });

            return {
                tierIndex,
                tierMetrics,
                tierLayout,
                overlayData,
                aislePolygons,
                rowGeometries
            };
        }).filter(Boolean);
    }

    _buildRhinoTierArtifacts(solvers, bowlConfig, sportName) {
        if (!this.scene3D) return [];

        const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);
        const structuralDepthFt = Math.max(0, (Number(bowlConfig?.structuralDepth) || 0) / 12.0);

        return (solvers || []).map((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return null;

            const tierIndex = getSolverTierIndex(solver, index);
            const offsetSet = new Set();
            solver.rows.forEach((row) => {
                offsetSet.add((row.x - row.tread_depth) - offsetCorrection);
                offsetSet.add(row.x - offsetCorrection);
            });

            let structuralProfile = null;
            if (structuralDepthFt > 0 && typeof this.scene3D?.buildClosedStructuralProfile === 'function') {
                structuralProfile = this.scene3D.buildClosedStructuralProfile(solver, structuralDepthFt, tierIndex);
                if (Array.isArray(structuralProfile)) {
                    structuralProfile.forEach((point) => {
                        if (point && Number.isFinite(point.x)) {
                            offsetSet.add(point.x - offsetCorrection);
                        }
                    });
                }
            }

            const bowlGeometryByOffset = Array.from(offsetSet)
                .filter((offset) => Number.isFinite(offset))
                .map((offsetFt) => ({
                    offsetFt,
                    segments: this.scene3D.getBowlGeometrySegments(bowlConfig, offsetFt)
                }));

            return {
                tierIndex,
                structuralProfile: Array.isArray(structuralProfile) ? structuralProfile : null,
                bowlGeometryByOffset
            };
        }).filter(Boolean);
    }

    async _buildExportDescriptor(kind) {
        if (kind === 'json') return this._buildJsonExportDescriptor();
        if (kind === 'obj') return this._buildObjExportDescriptor();
        if (kind === 'rhino') return this._buildRhinoExportDescriptor();
        if (kind === 'profile-dxf') return this._buildProfileDxfExportDescriptor();
        if (kind === 'plan-dxf') return this._buildPlanDxfExportDescriptor();
        if (kind === 'csv') return this._buildCsvExportDescriptor();
        if (kind === 'config') return this._buildConfigExportDescriptor();
        return null;
    }

    _buildJsonExportDescriptor() {
        const solvers = this._getActiveSolvers();
        if (!solvers.length) {
            console.warn('No solver data to export');
            return null;
        }

        const bowlConfig = this._getBowlConfig();
        const egressParams = this._getEgressParams();
        const focalPointFt = this._getFocalPointFt();
        const tierArtifacts = this._buildTierRuntimeArtifacts(solvers, bowlConfig, egressParams);
        const payload = buildStudyResultsJsonPayload({
            solvers,
            sportName: this.state.sport,
            profileType: this.state.tiers[0]?.profileType || 'Parabolic',
            template: this._currentTemplate,
            bowlConfig,
            egressParams,
            focalPointFt,
            primaryTierParameters: {
                targetCValue: this.state.tiers[0]?.cValue ?? 0,
                firstRowDistance: this.state.tiers[0]?.firstRowDist ?? 0,
                firstRowElevation: this.state.tiers[0]?.firstRowElev ?? 0,
                treadDepth: this.state.tiers[0]?.treadDepth ?? 0,
                riserHeight: this.state.tiers[0]?.riserHeight ?? 0,
                numRows: this.state.tiers[0]?.numRows ?? 0,
                eyeHeight: this.state.tiers[0]?.eyeHeight ?? 0,
                eyeSetback: this.state.tiers[0]?.eyeSetback ?? 0
            },
            tierArtifacts
        });
        if (!payload) {
            console.warn('No solver data to export');
            return null;
        }

        return {
            filename: `seating - study - ${payload.sport.toLowerCase().replace(/\s/g, '-')}.json`,
            content: JSON.stringify(payload, null, 2),
            type: 'application/json'
        };
    }

    _buildObjExportDescriptor() {
        const sceneExportData = this._getSceneExportData();
        if (!sceneExportData?.bowlMeshes?.length) {
            console.warn('No 3D data to export');
            return null;
        }

        return {
            filename: `seating - study - ${this.state.sport.toLowerCase().replace(/\s/g, '-')}.obj`,
            content: buildObjText({
                bowlMeshes: sceneExportData.bowlMeshes,
                objectName: 'SeatingBowl'
            }),
            type: 'text/plain'
        };
    }

    async _buildRhinoExportDescriptor() {
        const sceneExportData = this._getSceneExportData();
        if (!sceneExportData?.bowlMeshes?.length) {
            console.warn('No 3D data to export');
            return null;
        }

        const rhino = await this._loadRhino3dm();
        const solvers = this._getActiveSolvers();
        const bowlConfig = this._getBowlConfig();
        const sportName = this.state.sport;
        const result = await exportRhinoModel({
            rhino,
            solvers,
            bowlConfig,
            sportName,
            nativeSpectatorBlockLimit: Number(globalThis?.__SBS_RHINO_NATIVE_SPECTATOR_MAX_BLOCKS),
            tierArtifacts: this._buildRhinoTierArtifacts(solvers, bowlConfig, sportName),
            sceneExportData
        });

        if (!result?.bytes || result.exportedCount === 0) {
            console.warn('No valid 3D geometry found for Rhino export');
            return null;
        }

        return {
            filename: `seating - study - ${sportName.toLowerCase().replace(/\s/g, '-')}.3dm`,
            blob: new Blob([result.bytes], { type: 'model/vnd.rhino' })
        };
    }



    async _loadRhino3dm() {
        if (this._rhino3dmPromise) return this._rhino3dmPromise;

        const sources = [
            { script: './lib/rhino3dm.js', base: './lib/' },
            { script: 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/rhino3dm.js', base: 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/' },
            { script: 'https://unpkg.com/rhino3dm@8.17.0/rhino3dm.js', base: 'https://unpkg.com/rhino3dm@8.17.0/' }
        ];

        const initFromGlobal = async (wasmBase) => {
            const initRhino = /** @type {any} */ (window).rhino3dm;
            if (typeof initRhino !== 'function') {
                throw new Error('rhino3dm.js did not expose window.rhino3dm');
            }
            const rhino = await initRhino({
                locateFile: (file) => `${wasmBase}${file}`
            });
            if (!rhino || typeof rhino.File3dm !== 'function') {
                throw new Error('rhino3dm initialization returned an invalid module');
            }
            return rhino;
        };

        this._rhino3dmPromise = (async () => {
            const errors = [];

            // If script was already loaded, try known WASM bases first.
            if (typeof /** @type {any} */ (window).rhino3dm === 'function') {
                for (const s of sources) {
                    try {
                        return await initFromGlobal(s.base);
                    } catch (err) {
                        errors.push(`init ${s.base}: ${err && err.message ? err.message : err}`);
                    }
                }
            }

            // Load script and initialize from each fallback source.
            for (const s of sources) {
                try {
                    await this._loadScriptOnce(s.script);
                    return await initFromGlobal(s.base);
                } catch (err) {
                    errors.push(`${s.script}: ${err && err.message ? err.message : err}`);
                }
            }

            throw new Error(`unable to load rhino3dm. ${errors.join(' | ')}`);
        })().catch((err) => {
            this._rhino3dmPromise = null;
            throw err;
        });

        return this._rhino3dmPromise;
    }

    _loadScriptOnce(src) {
        const absoluteSrc = new URL(src, window.location.href).href;
        const existing = Array.from(document.querySelectorAll('script')).find(s => s.src === absoluteSrc);
        if (existing) {
            if (existing.dataset && existing.dataset.loaded === 'true') return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load script ${absoluteSrc}`)), { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            if (/^https?:\/\//i.test(src)) {
                script.crossOrigin = 'anonymous';
                script.referrerPolicy = 'no-referrer';
            }
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            script.addEventListener('error', () => {
                reject(new Error(`Failed to load script ${src}`));
            }, { once: true });
            document.head.appendChild(script);
        });
    }

    _buildProfileDxfExportDescriptor() {
        const solvers = this._getActiveSolvers();
        if (!solvers.length) {
            console.warn('No 2D profile data to export');
            return null;
        }

        return {
            filename: `SeatingProfile_${this.state.sport.toLowerCase().replace(/\s/g, '-')}.dxf`,
            content: buildProfileDxf({
                solvers,
                structuralDepthFt: (this.state.bowl.structuralDepth || 0) / 12.0,
                focalPointFt: this._getFocalPointFt()
            }),
            type: 'text/plain'
        };
    }

    _buildPlanDxfExportDescriptor() {
        const solvers = this._getActiveSolvers();
        if (!solvers.length || !this._currentTemplate) {
            console.warn('No Plan data to export');
            return null;
        }

        const bowlConfig = this._getBowlConfig();
        const egressParams = this._getEgressParams();
        const tierPlanArtifacts = this._buildTierRuntimeArtifacts(solvers, bowlConfig, egressParams).map((artifact) => ({
            tierIndex: artifact.tierIndex,
            rowGeometries: artifact.rowGeometries,
            aislePolygons: artifact.aislePolygons,
            overlayData: artifact.overlayData
        }));

        return {
            filename: `SeatingPlan_${this.state.sport.toLowerCase().replace(/\s/g, '-')}.dxf`,
            content: buildPlanDxf({
                template: this._currentTemplate,
                runoffFt: this._getRunoffDistance(),
                visualFocalXFt: this._getFocalPointFt().x,
                tierPlanArtifacts
            }),
            type: 'text/plain'
        };
    }

    _buildCsvExportDescriptor() {
        const solvers = this._getActiveSolvers();
        if (!solvers.length) {
            console.warn('No data for CSV');
            return null;
        }

        return {
            filename: `tier-metrics-${this.state.sport.toLowerCase().replace(/\s/g, '-')}.csv`,
            content: buildTierMetricsCsv({
                solvers,
                focalPointFt: this._getFocalPointFt()
            }),
            type: 'text/csv'
        };
    }

    _buildConfigExportDescriptor() {
        const config = this.state.toJSON();
        return {
            filename: `bowl-config-${config.sport.toLowerCase().replace(/\s/g, '-')}.json`,
            content: JSON.stringify(config, null, 2),
            type: 'application/json'
        };
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
        this._tier2Initialized = Array.isArray(config.tiers) && config.tiers.length > 1;
        this._tier3Initialized = Array.isArray(config.tiers) && config.tiers.length > 2;
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
        const slider = getInputElement('clipPositionSlider');
        const input = getInputElement('clipPositionInput');
        if (!slider || !input || !this.fieldRenderer || !bowlConfig) return;

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

        slider.min = String(lo);
        slider.max = String(hi);
        input.min = String(lo);
        input.max = String(hi);

        let curr = this._getInputValue('clipPosition');
        if (!Number.isFinite(curr)) curr = 0;
        const clamped = Math.max(lo, Math.min(hi, curr));
        if (clamped !== curr) {
            this.state.bowl.clipPosition = clamped;
            this._setInputValue('clipPosition', clamped);
        }
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

    // ========== 3D VIEW CAMERA BOOKMARKS ==========
    _createCurrentCameraBookmark() {
        if (!this.scene3D || !this.scene3D.camera || !this.scene3D.controls || !this.scene3D.renderer) return;
        const cam = /** @type {any} */ (this.scene3D.camera);
        const ctrl = /** @type {any} */ (this.scene3D.controls);

        // Capture what the user currently sees as a 100x100 thumbnail.
        this.scene3D.renderer.render(this.scene3D.scene, this.scene3D.camera);
        const thumbnail = this._captureBookmarkThumbnail(150, 150);

        const bm = {
            name: `View ${this.state.bookmarks.length + 1}`,
            position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            target: { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z },
            thumbnail
        };
        this.state.bookmarks.push(bm);
        return bm;
    }

    _captureBookmarkThumbnail(width = 100, height = 100) {
        try {
            if (!this.scene3D || !this.scene3D.renderer) return '';
            const src = this.scene3D.renderer.domElement;
            const sw = src.width || src.clientWidth;
            const sh = src.height || src.clientHeight;
            if (!sw || !sh) return '';

            const crop = Math.min(sw, sh);
            const sx = Math.floor((sw - crop) / 2);
            const sy = Math.floor((sh - crop) / 2);

            const thumb = document.createElement('canvas');
            thumb.width = width;
            thumb.height = height;
            const ctx = thumb.getContext('2d');
            if (!ctx) return '';

            ctx.drawImage(src, sx, sy, crop, crop, 0, 0, width, height);
            return thumb.toDataURL('image/png');
        } catch (err) {
            console.warn('Failed to capture camera bookmark thumbnail:', err);
            return '';
        }
    }

    _restoreCameraBookmark(bookmark) {
        if (!bookmark || !this.scene3D || !this.scene3D.camera || !this.scene3D.controls) return;
        const camera = /** @type {any} */ (this.scene3D.camera);
        const controls = /** @type {any} */ (this.scene3D.controls);
        camera.position.set(
            bookmark.position.x,
            bookmark.position.y,
            bookmark.position.z
        );
        controls.target.set(
            bookmark.target.x,
            bookmark.target.y,
            bookmark.target.z
        );
        controls.update();
    }

    _build3DImageExportDescriptor(viewName = null) {
        if (!this.scene3D || !this.scene3D.renderer) return;
        this.scene3D.renderer.render(this.scene3D.scene, this.scene3D.camera);
        const dataUrl = this.scene3D.renderer.domElement.toDataURL('image/png');
        const sportName = this.state.sport;
        const suffix = viewName ? `-${viewName.toLowerCase().replace(/\s/g, '-')}` : '';
        return {
            filename: `3d-view-${sportName.toLowerCase().replace(/\s/g, '-')}${suffix}.png`,
            dataUrl
        };
    }
}
