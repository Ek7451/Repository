/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { SPORTS_TEMPLATES, getSportNames, getTemplate } from './core/sports-templates.js';
import { ProfileSolver } from './core/profile-solver.js?v=4';
import { FieldRenderer } from './viz/field-renderer.js?v=19';
import { ProfileRenderer } from './viz/profile-renderer.js?v=4';
import { DEFAULT_STARTUP_PROFILE } from './core/default-starting-profile.js?v=1';
import { buildPlanDxf, buildProfileDxf } from './export/dxf-exporter.js';
import { exportRhinoModel, getRhinoExportOffsetCorrection } from './export/rhino/rhino-exporter.js';
import { AppState } from './state/app-state.js';
import { CameraBookmarks } from './ui/camera-bookmarks.js?v=1';
import { renderStatsPanel } from './ui/stats-panel.js?v=1';
import { createAuthService } from './services/auth-service.js';
import { createProjectsService } from './services/projects-service.js';
import { DashboardPage } from './pages/dashboard-page.js';
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

class App {
    constructor() {
        this.state = AppState.reset();
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

        // Track tier count to implement progressive stacking
        this._lastTierCount = 1; // Default

        // Track if tiers have been initialized to prevent overwriting user changes on hide/show
        this._tier2Initialized = false;
        this._tier3Initialized = false;

        this._themeStorageKey = 'jlg-seating-theme';
        this._theme = 'light';
        this._session = null;
        this._projectMetadata = {
            id: null,
            name: '',
            createdAt: '',
            updatedAt: ''
        };
    }

    async init() {
        try {
            // Setup canvases
            this._setupCanvases();

            // Init 2D renderers
            this.fieldRenderer = new FieldRenderer(document.getElementById('fieldCanvas'));
            this.profileRenderer = new ProfileRenderer(document.getElementById('profileCanvas'));

            // Initialize theme state before first render
            this._initTheme();

            // Populate sport dropdown
            this._populateSports();

            // Wire up events (must happen before update)
            this._wireEvents();
            this._initCameraBookmarks();

            this.state.fromJSON(DEFAULT_STARTUP_PROFILE);
            this._syncTemplateFromState();
            this._applyStateToDom();
            this.cameraBookmarks?.render();
            this._refreshProjectChrome();
            this.setProjectStatus('Project persistence ready');

            // Initialize tooltips
            this._initTooltips();

            // Initial render
            this.update();

            // Sync internal state to DOM
            const tc = document.getElementById('tierCount');
            if (tc) this._lastTierCount = parseInt(tc.value) || 1;

            // Set initial view state (hides Field Setup on Profile tab)
            requestAnimationFrame(() => this._applyUrlViewOverride());

            // 3D scene is initialized lazily when user clicks the 3D tab

        } catch (err) {
            console.error('App init error:', err);
        }
    }

    setSession(session) {
        this._session = session && typeof session === 'object'
            ? { ...session }
            : null;
        this._refreshProjectChrome();
    }

    setProjectMetadata(project = null) {
        this._projectMetadata = {
            id: typeof project?.id === 'string' ? project.id : null,
            name: typeof project?.name === 'string' ? project.name : '',
            createdAt: typeof project?.createdAt === 'string' ? project.createdAt : '',
            updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : ''
        };
        this._refreshProjectChrome();
    }

    setProjectName(name = '') {
        this._projectMetadata.name = typeof name === 'string' ? name : '';
        this._refreshProjectChrome();
    }

    getProjectMetadata() {
        return { ...this._projectMetadata };
    }

    getProjectSaveRequest() {
        const name = (this._projectMetadata.name || this._deriveProjectName()).trim();
        this._projectMetadata.name = name;
        this._refreshProjectChrome();

        return {
            name,
            state: this.state.toJSON()
        };
    }

    setProjectStatus(message, tone = 'default') {
        const statusEl = document.getElementById('projectStatusMessage');
        if (!statusEl) return;

        statusEl.textContent = typeof message === 'string' && message.trim()
            ? message.trim()
            : 'Project persistence ready';
        statusEl.dataset.tone = tone;
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
        const nameInput = document.getElementById('projectNameInput');
        const nextName = (this._projectMetadata.name || this._deriveProjectName()).trim();
        if (nameInput && document.activeElement !== nameInput) {
            nameInput.value = nextName;
        }

        const metaEl = document.getElementById('editorProjectMeta');
        if (metaEl) {
            const updatedAt = this._projectMetadata.updatedAt
                ? new Date(this._projectMetadata.updatedAt).toLocaleString()
                : 'Not yet saved';
            metaEl.textContent = this._projectMetadata.id
                ? `Updated ${updatedAt}`
                : 'Create or open a project from the dashboard';
        }

        const sessionEl = document.getElementById('editorSessionLabel');
        if (sessionEl) {
            sessionEl.textContent = this._session?.displayName
                ? `Signed in as ${this._session.displayName}`
                : 'Signed out';
        }

        const saveBtn = document.getElementById('saveProjectBtn');
        if (saveBtn && saveBtn.dataset.busy !== 'true') {
            saveBtn.disabled = !this._projectMetadata.id || !this._session;
        }
    }

    _getSavedTheme() {
        try {
            const stored = localStorage.getItem(this._themeStorageKey);
            if (stored === 'dark' || stored === 'light') return stored;
        } catch (_) {
            // Ignore localStorage access errors (private mode / policy restrictions)
        }

        const domTheme = document.documentElement?.getAttribute('data-theme');
        return domTheme === 'dark' ? 'dark' : 'light';
    }

    _initTheme() {
        this._applyTheme(this._getSavedTheme(), { persist: false, rerender: false });

        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (!themeToggleBtn) return;

        themeToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleTheme();
        });
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
                this._export3DImage(this.state.bookmarks[index]?.name ?? fallbackName);
            },
            onLayoutChanged: () => {
                this._ensure3DContainerSize();
                this.scene3D?.forceResize();
            }
        });
    }

    _toggleTheme() {
        this._applyTheme(this._theme === 'dark' ? 'light' : 'dark');
    }

    _applyTheme(theme, { persist = true, rerender = true } = {}) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        this._theme = nextTheme;

        document.documentElement.setAttribute('data-theme', nextTheme);
        if (document.body) {
            document.body.classList.toggle('theme-dark', nextTheme === 'dark');
        }

        if (persist) {
            try {
                localStorage.setItem(this._themeStorageKey, nextTheme);
            } catch (_) {
                // Ignore localStorage access errors
            }
        }

        this._refreshThemeToggleButton();

        if (this.scene3D && typeof this.scene3D.applyTheme === 'function') {
            this.scene3D.applyTheme();
        }

        if (rerender && this.fieldRenderer && this.profileRenderer) {
            this.update();
        }
    }

    _refreshThemeToggleButton() {
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        if (!themeToggleBtn) return;

        const isDark = this._theme === 'dark';
        const nextModeLabel = isDark ? 'light' : 'dark';
        themeToggleBtn.setAttribute('aria-pressed', String(isDark));
        themeToggleBtn.setAttribute('aria-label', `Toggle dark mode (currently ${this._theme})`);
        themeToggleBtn.setAttribute('title', `Switch to ${nextModeLabel} mode`);

        const label = themeToggleBtn.querySelector('.theme-toggle-label');
        if (label) {
            label.textContent = `Switch to ${nextModeLabel} mode`;
        }
    }

    async _init3DAsync() {
        if (this._scene3dReady || this._scene3dLoading) return;
        this._scene3dLoading = true;

        const container3d = document.getElementById('scene3dContainer');
        this._ensure3DContainerSize();
        try {
            // Show loading indicator
            container3d.innerHTML = '<div class="loading-3d"><div class="spinner"></div><span>Loading 3D engine...</span></div>';

            // Dynamic import — if Three.js fails, only 3D breaks
            const { Scene3D } = await import('./viz/scene3d.js?v=25');

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
        const fieldCanvas = document.getElementById('fieldCanvas');
        const profileCanvas = document.getElementById('profileCanvas');

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
        const select = document.getElementById('sportSelect');
        const names = getSportNames();
        for (const name of names) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
    }

    _applyUrlViewOverride() {
        try {
            const params = new URLSearchParams(window.location.search);
            const view = params.get('view');
            if (!view) return;
            if (view === 'profile' || view === 'field' || view === 'scene3d') {
                this._switchViewTab(view);
            }
        } catch (err) {
            // Ignore malformed URLs in normal interactive use.
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

        const slider = document.getElementById(`${baseId}Slider`);
        const input = document.getElementById(`${baseId}Input`);

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
        const el = document.getElementById(id);
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
        const el = document.getElementById(id);
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
        const sportSelect = document.getElementById('sportSelect');
        if (sportSelect) {
            sportSelect.value = this.state.sport;
        }

        const runoffInput = document.getElementById('customRunoffInput');
        const runoffSlider = document.getElementById('customRunoffSlider');
        const runoffValue = this._getRunoffDistance();
        if (runoffInput) {
            runoffInput.value = this.state.setup.customRunoff ?? '';
        }
        if (runoffSlider) {
            runoffSlider.value = runoffValue;
        }

        Object.entries(NUMERIC_INPUT_STATE_PATHS).forEach(([baseId, path]) => {
            const value = this._getStateValue(path);
            if (value !== undefined && value !== null) {
                this._setInputValue(baseId, value);
            }
        });

        Object.entries(SELECT_STATE_PATHS).forEach(([id, path]) => {
            const el = document.getElementById(id);
            if (!el) return;
            const value = this._getStateValue(path);
            if (value !== undefined && value !== null) {
                el.value = value;
            }
        });

        Object.entries(CHECKBOX_STATE_PATHS).forEach(([id, path]) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = !!this._getStateValue(path);
        });

        const sideLengthRow = document.getElementById('sideLengthRow');
        if (sideLengthRow) {
            sideLengthRow.style.display = this.state.bowl.type.includes('Side') ? 'flex' : 'none';
        }

        const clipPlaneControls = document.getElementById('clipPlaneControls');
        if (clipPlaneControls) {
            clipPlaneControls.style.display = this.state.bowl.clipEnabled ? 'block' : 'none';
        }

        [1, 2, 3].forEach((tierNum) => {
            const section = document.getElementById(`tier${tierNum}Section`);
            if (!section) return;
            const enabled = !!this.state.tiers[tierNum - 1]?.enabled;
            section.classList.toggle('tier-disabled', !enabled);
        });

        this._switchViewTab(this.state.ui.activeViewTab);
        this._switchResultsTab(this.state.ui.activeResultsTab);
    }

    _wireEvents() {
        // Sport selector
        const sportSelect = document.getElementById('sportSelect');
        if (sportSelect) {
            sportSelect.addEventListener('change', () => {
                this.state.sport = sportSelect.value;
                this._onSportChange();
            });
        }

        // Custom runoff
        const runoffInput = document.getElementById('customRunoffInput');
        const runoffSlider = document.getElementById('customRunoffSlider');
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

        // View tab buttons
        document.querySelectorAll('.view-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._switchViewTab(btn.dataset.tab);
            });
        });

        document.querySelectorAll('.results-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._switchResultsTab(btn.dataset.target);
            });
        });

        const feedbackBtn = document.getElementById('feedbackBtn');
        if (feedbackBtn) {
            const feedbackEmail = 'eklinger@jlgarchitects.com';
            const baseLabel = feedbackBtn.textContent?.trim() || 'Feedback';
            const feedbackHref = feedbackBtn.getAttribute('href') || `mailto:${feedbackEmail}`;
            feedbackBtn.addEventListener('click', (e) => {
                // Force mailto navigation explicitly (some environments don't honor the anchor default reliably).
                e.preventDefault();
                try {
                    window.location.href = feedbackHref;
                } catch (_) {
                    // Ignore and continue to clipboard fallback below.
                }

                // Fallback: if no mail client took focus, copy the email address for manual paste.
                clearTimeout(this._feedbackBtnCopyFallbackTimer);
                this._feedbackBtnCopyFallbackTimer = setTimeout(async () => {
                    if (!document.hasFocus()) return;
                    let copied = false;
                    try {
                        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                            await navigator.clipboard.writeText(feedbackEmail);
                            copied = true;
                        }
                    } catch (_) {
                        copied = false;
                    }
                    if (!copied) return;
                    feedbackBtn.textContent = 'Email Copied';
                    clearTimeout(this._feedbackBtnResetTimer);
                    this._feedbackBtnResetTimer = setTimeout(() => {
                        feedbackBtn.textContent = baseLabel;
                    }, 1600);
                }, 700);
            });
        }

        window.addEventListener('resize', () => {
            const panel = document.getElementById('scene3dPanel');
            if (panel && panel.classList.contains('active') && this.scene3D) {
                this._ensure3DContainerSize();
                this.scene3D.forceResize();
            }
        });

        // Export buttons (now in export menu)
        const exportBtn = document.getElementById('exportBtn');
        const exportObjBtn = document.getElementById('exportObjBtn');
        const exportRhinoBtn = document.getElementById('exportRhinoBtn');
        const exportDxfBtn = document.getElementById('exportDxfBtn');
        const exportPlanDxfBtn = document.getElementById('exportPlanDxfBtn');
        const exportCsvBtn = document.getElementById('exportCsvBtn');
        const exportConfigBtn = document.getElementById('exportConfigBtn');
        const loadConfigBtn = document.getElementById('loadConfigBtn');
        const configFileInput = document.getElementById('configFileInput');

        if (exportBtn) exportBtn.addEventListener('click', () => this._exportJSON());
        if (exportObjBtn) exportObjBtn.addEventListener('click', () => this._exportOBJ());
        if (exportRhinoBtn) exportRhinoBtn.addEventListener('click', () => this._export3DM());
        if (exportDxfBtn) exportDxfBtn.addEventListener('click', () => this._exportDXF());
        if (exportPlanDxfBtn) exportPlanDxfBtn.addEventListener('click', () => this._exportPlanDXF());
        if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => this._exportCSV());
        if (exportConfigBtn) exportConfigBtn.addEventListener('click', () => this._exportConfig());
        if (loadConfigBtn) loadConfigBtn.addEventListener('click', () => configFileInput && configFileInput.click());
        if (configFileInput) configFileInput.addEventListener('change', (e) => this._loadConfig(e));

        const projectNameInput = document.getElementById('projectNameInput');
        if (projectNameInput) {
            projectNameInput.addEventListener('input', () => {
                this.setProjectName(projectNameInput.value);
            });
        }

        // Export menu toggle + auto-collapse behavior
        const exportMenuPanel = document.querySelector('.export-menu-panel');
        const exportMenuHeader = document.querySelector('.export-header-btn');
        if (exportMenuHeader && exportMenuPanel) {
            exportMenuHeader.addEventListener('click', (e) => {
                e.stopPropagation();
                exportMenuPanel.classList.toggle('collapsed');
            });

            // Auto-collapse when any export item is clicked
            exportMenuPanel.querySelectorAll('.export-item').forEach(item => {
                item.addEventListener('click', () => {
                    setTimeout(() => exportMenuPanel.classList.add('collapsed'), 150);
                });
            });

            // Auto-collapse when clicking outside the export menu
            document.addEventListener('click', (e) => {
                if (!exportMenuPanel.classList.contains('collapsed') &&
                    !exportMenuPanel.contains(e.target)) {
                    exportMenuPanel.classList.add('collapsed');
                }
            });

            // Prevent clicks inside menu body from bubbling to document
            exportMenuPanel.addEventListener('click', (e) => e.stopPropagation());
        }

        // Clip Plane controls
        this._bindCheckboxControl('enableClipPlane', (enabled) => {
            const controls = document.getElementById('clipPlaneControls');
            if (controls) controls.style.display = enabled ? 'block' : 'none';
        });
        ['clipAxis', 'clipSide'].forEach(id => this._bindSelectControl(id));

        // Bowl Configuration Change Events
        this._bindSelectControl('bowlType', (value) => {
            const sideRow = document.getElementById('sideLengthRow');
            if (sideRow) sideRow.style.display = value.includes('Side') ? 'flex' : 'none';
        });

        this._bindCheckboxControl('showSeatCubes3D');

        // Sightlines Toggle
        const sightlinesBtn = document.getElementById('toggleSightlinesBtn');
        const sightlinesBtnField = document.getElementById('toggleSightlinesBtnField');
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

        // Collapsible sections
        // Collapsible sections (Event Delegation to handle dynamic content)
        // Collapsible sections
        // Collapsible sections (Event Delegation to handle dynamic content)
        document.body.addEventListener('click', (e) => {
            // 1. If clicking the TOGGLE (checkbox) or LABEL, do NOT toggle collapse.
            if (e.target.closest('.header-toggle')) {
                return;
            }

            // 2. If clicking anywhere else in the HEADER, toggle collapse.
            const header = e.target.closest('.section-header');
            if (header && header.parentElement.classList.contains('collapsible')) {
                header.parentElement.classList.toggle('collapsed');
            }
        });
    }

    _initTooltips() {
        // Create container if missing
        let tooltip = document.getElementById('tooltip-container');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'tooltip-container';
            document.body.appendChild(tooltip);
        }

        let activeIcon = null;

        document.body.addEventListener('mouseover', (e) => {
            const icon = e.target.closest('.info-icon');
            if (!icon) return;

            const text = icon.getAttribute('data-tooltip');
            if (!text) return;

            activeIcon = icon;
            tooltip.innerHTML = text;
            tooltip.classList.add('visible');

            // Position it
            const rect = icon.getBoundingClientRect();
            const tipRect = tooltip.getBoundingClientRect();

            // Default: Top of icon
            let top = rect.top - tipRect.height - 8;
            let left = rect.left + (rect.width - tipRect.width) / 2;

            // Boundary checks
            // If top is off-screen, move to bottom
            if (top < 10) {
                top = rect.bottom + 8;
            }

            // If left is off-screen
            if (left < 10) {
                left = 10;
            } else if (left + tipRect.width > window.innerWidth - 10) {
                left = window.innerWidth - tipRect.width - 10;
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        });

        document.body.addEventListener('mouseout', (e) => {
            const icon = e.target.closest('.info-icon');
            if (icon && icon === activeIcon) {
                tooltip.classList.remove('visible');
                activeIcon = null;
            }
        });
    }

    /**
     * Sync a slider value to its paired number input.
     * Convention: slider id = "fooSlider", input id = "fooInput"
     */
    _syncSliderToInput(slider) {
        const inputId = slider.id.replace('Slider', 'Input');
        const input = document.getElementById(inputId);
        if (input) {
            input.value = slider.value;
        }
    }

    /**
     * Sync a number input value to its paired slider.
     */
    _syncInputToSlider(numInput) {
        const sliderId = numInput.id.replace('Input', 'Slider');
        const slider = document.getElementById(sliderId);
        if (slider) {
            slider.value = numInput.value;
        }
    }

    _onSportChange() {
        this.state.applySportDefaults({
            sport: this.state.sport,
            template: getTemplate(this.state.sport)
        });
        this._syncTemplateFromState();
        this._applyStateToDom();
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

    _switchViewTab(tab) {
        const nextTab = ['profile', 'field', 'scene3d'].includes(tab) ? tab : 'profile';
        this.state.ui.activeViewTab = nextTab;

        // Update tab buttons
        document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.view-tab-btn[data-tab="${nextTab}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Update panels
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        const activePanel = document.getElementById(`${nextTab}Panel`);
        if (activePanel) activePanel.classList.add('active');

        // Helper to toggle visibility
        const toggle = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? 'block' : 'none';
        };

        const set3DExportButtonState = (button) => {
            if (!button) return;
            button.disabled = nextTab !== 'scene3d';
            if (nextTab === 'scene3d') {
                button.style.opacity = '1';
                button.style.cursor = 'pointer';
            } else {
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
            }
        };
        set3DExportButtonState(document.getElementById('exportObjBtn'));
        set3DExportButtonState(document.getElementById('exportRhinoBtn'));

        // Context-sensitive controls
        if (nextTab === 'profile') {
            toggle('fieldSetupSection', true); // Show Field Setup!
            toggle('profileParamsSection', true);
            toggle('focalPointSection', true);
            toggle('additionalTiersSection', true);
            toggle('planViewControls', false);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        } else if (nextTab === 'field') {
            toggle('fieldSetupSection', true);
            toggle('profileParamsSection', false);
            toggle('focalPointSection', true);
            toggle('additionalTiersSection', false);
            toggle('planViewControls', true);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        } else if (nextTab === 'scene3d') {
            toggle('fieldSetupSection', true);
            toggle('profileParamsSection', false);
            toggle('focalPointSection', false);
            toggle('additionalTiersSection', false);
            toggle('planViewControls', false);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        }

        // After switching, resize canvas and re-render
        requestAnimationFrame(() => {
            if (nextTab === 'field') {
                const canvas = document.getElementById('fieldCanvas');
                const parent = canvas?.parentElement;
                const rect = parent?.getBoundingClientRect();
                if (canvas && rect) {
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                }
                this.update();
            } else if (nextTab === 'profile') {
                const canvas = document.getElementById('profileCanvas');
                const parent = canvas?.parentElement;
                const rect = parent?.getBoundingClientRect();
                if (canvas && rect) {
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                }
                this.update();
            } else if (nextTab === 'scene3d') {
                this._ensure3DContainerSize();
                // Lazy init: only load 3D when user first clicks the tab
                if (!this._scene3dReady) {
                    this._init3DAsync();
                } else if (this.scene3D) {
                    this.scene3D.forceResize();
                    this._update3D();
                }
            }
        });
    }

    _switchResultsTab(targetId) {
        const nextTarget = targetId === 'detailsTab' ? 'detailsTab' : 'statsTab';
        this.state.ui.activeResultsTab = nextTarget;

        const tabBtns = document.querySelectorAll('.results-tab-btn');
        const tabPanels = document.querySelectorAll('.results-tab-panel');

        tabBtns.forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-target') === nextTarget);
        });
        tabPanels.forEach((panel) => {
            panel.classList.toggle('active', panel.id === nextTarget);
            if (panel.id === nextTarget) {
                panel.scrollTop = 0;
            }
        });

        const rightSidebar = document.querySelector('.right-sidebar');
        if (rightSidebar && rightSidebar.classList.contains('collapsed')) {
            rightSidebar.classList.remove('collapsed');
            setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
        }
    }

    _ensure3DContainerSize() {
        const panel = document.getElementById('scene3dPanel');
        const container = document.getElementById('scene3dContainer');
        if (!panel || !container) return;
        const bar = document.getElementById('cameraBookmarksBar');
        const panelRect = panel.getBoundingClientRect();
        const barRect = bar ? bar.getBoundingClientRect() : null;
        const panelH = Math.floor(panelRect.height || 0);
        const barH = Math.ceil(barRect ? barRect.height : 0);
        const targetH = Math.max(120, panelH - barH);
        if (panelH > 50) {
            container.style.height = `${targetH}px`;
            return;
        }

        // Fallback when layout is not resolved yet.
        const viewContainer = document.querySelector('.view-container');
        const vr = viewContainer ? viewContainer.getBoundingClientRect() : null;
        const fallbackH = Math.floor((vr && vr.height) ? vr.height : window.innerHeight);
        const fallbackTarget = Math.max(120, fallbackH - barH);
        if (fallbackTarget > 50) container.style.height = `${fallbackTarget}px`;
    }

    _scheduleUpdate() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.update(), 25);
    }

    _setInputValue(id, val) {
        const input = document.getElementById(id + 'Input');
        const slider = document.getElementById(id + 'Slider');
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
                const egressParams = this._getEgressParams();
                const tierAisleLayouts = [];

                solvers.forEach((solver, idx) => {
                    if (!solver || !solver.rows || solver.rows.length === 0) return;
                    const tierIdx = solver.tierIndex !== undefined ? solver.tierIndex : idx;
                    const metrics = ProfileSolver.calculateTierMetrics(solver, bowlConfig, this.fieldRenderer, egressParams, offsetCorrection);
                    if (!metrics) return;

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
            this._updateStats();
        } catch (e) {
            console.error('Update error:', e);
        }
    }

    _update3D() {
        if (!this._scene3dReady || !this.scene3D) return;
        try {
            const panel = document.getElementById('scene3dPanel');
            if (panel && panel.classList.contains('active')) {
                this._ensure3DContainerSize();
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

    _updateStats() {
        renderStatsPanel({
            solvers: this._solvers || (this._solver ? [this._solver] : []),
            statsEl: document.getElementById('statsContent'),
            detailsEl: document.getElementById('detailsContent'),
            focalPointFt: this._getFocalPointFt(),
            egressParams: this._getEgressParams(),
            bowlConfig: this._getBowlConfig(),
            tierAisleLayouts: this._tierAisleLayouts || [],
            fieldRenderer: this.fieldRenderer,
            sportName: this.state.sport
        });
    }

    _exportJSON() {
        const solvers = (this._solvers && this._solvers.length ? this._solvers : (this._solver ? [this._solver] : []))
            .filter(s => s && Array.isArray(s.rows) && s.rows.length > 0);
        if (!solvers.length) {
            console.warn('No solver data to export');
            return;
        }

        const bowlConfig = this._getBowlConfig();
        const egressParams = this._getEgressParams();
        const offsetCorrection = getRhinoExportOffsetCorrection(
            bowlConfig,
            this.state.sport
        );
        const tierLayoutByIndex = new Map((this._tierAisleLayouts || []).map(layout => [
            Number.isInteger(Number(layout?.tierIndex)) ? Number(layout.tierIndex) : 0,
            layout
        ]));

        const ensureTierLayout = (solver, fallbackIndex) => {
            const tierIndex = Number.isInteger(Number(solver?.tierIndex)) ? Number(solver.tierIndex) : fallbackIndex;
            let layout = tierLayoutByIndex.get(tierIndex);
            if (layout || !this.fieldRenderer || !this._currentTemplate) return layout || null;
            try {
                const est = ProfileSolver.calculateTierMetrics(
                    solver,
                    bowlConfig,
                    this.fieldRenderer,
                    egressParams,
                    offsetCorrection
                );
                layout = this.fieldRenderer.generateTierAisleLayout(
                    solver,
                    bowlConfig,
                    est,
                    offsetCorrection,
                    egressParams
                );
                if (layout) {
                    layout.tierIndex = tierIndex;
                    tierLayoutByIndex.set(tierIndex, layout);
                }
            } catch (e) {
                console.warn('Failed to build tier aisle layout for JSON export', e);
            }
            return layout || null;
        };

        const buildTierExportRecord = (solver, fallbackIndex) => {
            const tierIndex = Number.isInteger(Number(solver?.tierIndex)) ? Number(solver.tierIndex) : fallbackIndex;
            const tierNumber = tierIndex + 1;
            const rows = Array.isArray(solver.rows) ? solver.rows : [];
            const tierLayout = ensureTierLayout(solver, fallbackIndex);
            const estMetrics = (this.fieldRenderer && this._currentTemplate)
                ? ProfileSolver.calculateTierMetrics(solver, bowlConfig, this.fieldRenderer, egressParams, offsetCorrection)
                : null;

            let overlay = { sectionLabels: [], rowSeatLabels: [] };
            if (tierLayout && this.fieldRenderer && typeof this.fieldRenderer.getTierSectionMetricsOverlayData === 'function') {
                try {
                    overlay = this.fieldRenderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, offsetCorrection) || overlay;
                } catch (e) {
                    console.warn(`Failed to build section metrics overlay data for tier ${tierNumber}`, e);
                }
            }

            const rowSeatLabels = Array.isArray(overlay.rowSeatLabels) ? overlay.rowSeatLabels.slice() : [];
            const sectionLabels = Array.isArray(overlay.sectionLabels) ? overlay.sectionLabels.slice() : [];
            rowSeatLabels.sort((a, b) =>
                (a.rowIndex - b.rowIndex) ||
                ((a.sectionNumber || 0) - (b.sectionNumber || 0)) ||
                (a.pathIndex - b.pathIndex) ||
                (a.slotIndex - b.slotIndex)
            );
            sectionLabels.sort((a, b) => (a.sectionNumber || 0) - (b.sectionNumber || 0));

            const rowsByIndex = new Map();
            rows.forEach((row, rowIndex) => {
                rowsByIndex.set(rowIndex, {
                    rowIndex,
                    rowNumber: Number(row.row_number ?? (rowIndex + 1)),
                    xFt: Number.isFinite(row.x) ? +row.x.toFixed(3) : null,
                    zFt: Number.isFinite(row.z) ? +row.z.toFixed(3) : null,
                    treadDepthIn: Number.isFinite(row.tread_depth) ? +(row.tread_depth * 12).toFixed(2) : null,
                    riserHeightIn: Number.isFinite(row.riser_height) ? +(row.riser_height * 12).toFixed(2) : null,
                    cValueIn: Number.isFinite(row.c_value) ? +row.c_value.toFixed(2) : null,
                    sightlineAngleDeg: Number.isFinite(row.sightline_angle) ? +row.sightline_angle.toFixed(3) : null,
                    linearLengthFt: Number.isFinite(row.computedLength) ? +row.computedLength.toFixed(3) : null,
                    estimatedLinearSeats: Number.isFinite(row.computedSeats) ? Math.round(row.computedSeats) : null,
                    seatsInRowActual: 0,
                    sectionsInRow: 0,
                    sectionSeatCounts: []
                });
            });

            const sectionsByKey = new Map();
            const getSectionKey = (pathIndex, slotIndex) => `${pathIndex}:${slotIndex}`;

            sectionLabels.forEach(label => {
                const key = getSectionKey(label.pathIndex, label.slotIndex);
                sectionsByKey.set(key, {
                    tierIndex,
                    tierNumber,
                    sectionNumber: Number.isFinite(label.sectionNumber) ? label.sectionNumber : null,
                    pathIndex: Number.isFinite(label.pathIndex) ? label.pathIndex : null,
                    slotIndex: Number.isFinite(label.slotIndex) ? label.slotIndex : null,
                    occupancy: 0,
                    rowsInSection: 0,
                    seatCountsByRow: [],
                    minSeatsPerRow: null,
                    maxSeatsPerRow: null,
                    avgSeatsPerRow: null,
                    frontRowSeats: null,
                    backRowSeats: null,
                    labelAnchorFt: (Number.isFinite(label.x) && Number.isFinite(label.y))
                        ? { x: +label.x.toFixed(3), y: +label.y.toFixed(3) }
                        : null
                });
            });

            rowSeatLabels.forEach(label => {
                const sectionKey = getSectionKey(label.pathIndex, label.slotIndex);
                if (!sectionsByKey.has(sectionKey)) {
                    sectionsByKey.set(sectionKey, {
                        tierIndex,
                        tierNumber,
                        sectionNumber: Number.isFinite(label.sectionNumber) ? label.sectionNumber : null,
                        pathIndex: Number.isFinite(label.pathIndex) ? label.pathIndex : null,
                        slotIndex: Number.isFinite(label.slotIndex) ? label.slotIndex : null,
                        occupancy: 0,
                        rowsInSection: 0,
                        seatCountsByRow: [],
                        minSeatsPerRow: null,
                        maxSeatsPerRow: null,
                        avgSeatsPerRow: null,
                        frontRowSeats: null,
                        backRowSeats: null,
                        labelAnchorFt: null
                    });
                }
                const section = sectionsByKey.get(sectionKey);
                const rowRec = rowsByIndex.get(label.rowIndex);
                const seatCount = Math.max(0, Math.round(Number(label.seatCount) || 0));
                if (rowRec && seatCount > 0) {
                    rowRec.sectionSeatCounts.push({
                        sectionNumber: section.sectionNumber,
                        pathIndex: Number.isFinite(label.pathIndex) ? label.pathIndex : null,
                        slotIndex: Number.isFinite(label.slotIndex) ? label.slotIndex : null,
                        seatCount
                    });
                    rowRec.seatsInRowActual += seatCount;
                }
                if (section && seatCount > 0) {
                    const rowNumber = rowRec ? rowRec.rowNumber : (Number(label.rowIndex) + 1);
                    section.seatCountsByRow.push({
                        rowIndex: Number.isFinite(label.rowIndex) ? label.rowIndex : null,
                        rowNumber,
                        seatCount
                    });
                    section.occupancy += seatCount;
                }
            });

            const rowRecords = Array.from(rowsByIndex.values()).sort((a, b) => a.rowIndex - b.rowIndex);
            rowRecords.forEach(rowRec => {
                rowRec.sectionSeatCounts.sort((a, b) =>
                    ((a.sectionNumber ?? 0) - (b.sectionNumber ?? 0)) ||
                    ((a.pathIndex ?? 0) - (b.pathIndex ?? 0)) ||
                    ((a.slotIndex ?? 0) - (b.slotIndex ?? 0))
                );
                rowRec.sectionsInRow = rowRec.sectionSeatCounts.length;
            });

            const seatWidthIn = Math.max(0, Number(tierLayout?.seatWidthIn) || Number(egressParams?.seatWidthIn) || 0);
            const aisleWidthIn = Math.max(0, (Number(tierLayout?.aisleWidthFt) || 0) * 12.0);

            const sectionRecords = Array.from(sectionsByKey.values())
                .sort((a, b) => (a.sectionNumber ?? 0) - (b.sectionNumber ?? 0))
                .map(section => {
                    section.seatCountsByRow.sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
                    section.rowsInSection = section.seatCountsByRow.length;
                    if (section.rowsInSection > 0) {
                        const seatCounts = section.seatCountsByRow.map(r => r.seatCount);
                        const sum = seatCounts.reduce((acc, n) => acc + n, 0);
                        section.occupancy = Math.max(section.occupancy, sum);
                        section.minSeatsPerRow = Math.min(...seatCounts);
                        section.maxSeatsPerRow = Math.max(...seatCounts);
                        section.avgSeatsPerRow = +(sum / section.rowsInSection).toFixed(2);
                        section.frontRowSeats = seatCounts[0];
                        section.backRowSeats = seatCounts[seatCounts.length - 1];
                        section.averageSeatBandWidthFt = seatWidthIn > 0 ? +((section.avgSeatsPerRow * seatWidthIn) / 12.0).toFixed(3) : null;
                        section.backRowSeatBandWidthFt = (seatWidthIn > 0 && Number.isFinite(section.backRowSeats))
                            ? +(((section.backRowSeats * seatWidthIn) / 12.0)).toFixed(3)
                            : null;
                    } else {
                        section.averageSeatBandWidthFt = null;
                        section.backRowSeatBandWidthFt = null;
                    }
                    section.seatWidthIn = seatWidthIn > 0 ? +seatWidthIn.toFixed(2) : null;
                    return section;
                });

            const totalOccupancy = sectionRecords.reduce((acc, s) => acc + (Number(s.occupancy) || 0), 0);
            const rowTotals = rowRecords.map(r => r.seatsInRowActual).filter(n => Number.isFinite(n));
            const sectionTotals = sectionRecords.map(s => s.occupancy).filter(n => Number.isFinite(n));
            const sectionsPerRowCounts = rowRecords.map(r => r.sectionsInRow).filter(n => Number.isFinite(n));
            const rowsPerSectionCounts = sectionRecords.map(s => s.rowsInSection).filter(n => Number.isFinite(n));
            const actualSectionCount = sectionRecords.length;
            const actualAisleCenterlines = Array.isArray(tierLayout?.aisles) ? tierLayout.aisles.length : 0;
            const sectionSummary = tierLayout?.sectionSummary || null;

            const summarizeList = (vals) => {
                if (!Array.isArray(vals) || !vals.length) return { min: 0, avg: 0, max: 0 };
                const sum = vals.reduce((a, b) => a + b, 0);
                return {
                    min: Math.min(...vals),
                    avg: +(sum / vals.length).toFixed(2),
                    max: Math.max(...vals)
                };
            };

            const rowSeatStats = summarizeList(rowTotals);
            const sectionSeatStats = summarizeList(sectionTotals);
            const sectionsPerRowStats = summarizeList(sectionsPerRowCounts);
            const rowsPerSectionStats = summarizeList(rowsPerSectionCounts);

            return {
                tierIndex,
                tierNumber,
                name: `Tier ${tierNumber}`,
                rowCount: rowRecords.length,
                totalOccupancy,
                egressInputs: {
                    seatWidthIn: seatWidthIn > 0 ? +seatWidthIn.toFixed(2) : null,
                    aisleWidthIn: aisleWidthIn > 0 ? +aisleWidthIn.toFixed(2) : null,
                    maxSeatsPerRow: Number.isFinite(egressParams?.seatsBetweenAisles) ? +egressParams.seatsBetweenAisles : null,
                    egressFactor: Number.isFinite(egressParams?.egressFactor) ? +egressParams.egressFactor : null
                },
                actualLayout: {
                    aisleCenterlineCount: actualAisleCenterlines,
                    aisleCountBySectionBoundaries: Number.isFinite(sectionSummary?.actualAisles) ? sectionSummary.actualAisles : actualAisleCenterlines,
                    sectionCount: Number.isFinite(sectionSummary?.actualSections) ? sectionSummary.actualSections : actualSectionCount,
                    forcedAislesAdded: Number.isFinite(tierLayout?.forcedCount) ? tierLayout.forcedCount : 0,
                    targetAislesRequested: Number.isFinite(tierLayout?.targetAisles) ? tierLayout.targetAisles : null
                },
                distributions: {
                    seatsPerRowActual: rowSeatStats,
                    seatsPerSection: sectionSeatStats,
                    sectionsPerRow: sectionsPerRowStats,
                    rowsPerSection: rowsPerSectionStats
                },
                egressEstimate: estMetrics ? {
                    requiredWidthIn: Number.isFinite(estMetrics.requiredWidth) ? +estMetrics.requiredWidth.toFixed(2) : null,
                    aisleWidthIn: Number.isFinite(estMetrics.aisleWidth) ? +estMetrics.aisleWidth.toFixed(2) : null,
                    estimatedNumAisles: Number.isFinite(estMetrics.numAisles) ? estMetrics.numAisles : null,
                    estimatedNumSections: Number.isFinite(estMetrics.numSections) ? estMetrics.numSections : null,
                    estimatedSeatsPerRowAvg: Number.isFinite(estMetrics.seatsPerRow) ? +estMetrics.seatsPerRow.toFixed(2) : null,
                    estimatedSeatsPerSectionAvg: Number.isFinite(estMetrics.occupantsPerSection) ? +estMetrics.occupantsPerSection.toFixed(2) : null
                } : null,
                rows: rowRecords,
                sections: sectionRecords
            };
        };

        const tierExports = solvers.map((solver, idx) => buildTierExportRecord(solver, idx));
        const totalOccupancyAllTiers = tierExports.reduce((acc, t) => acc + (Number(t.totalOccupancy) || 0), 0);
        const totalAislesAllTiers = tierExports.reduce((acc, t) => acc + (Number(t.actualLayout?.aisleCenterlineCount) || 0), 0);
        const totalSectionsAllTiers = tierExports.reduce((acc, t) => acc + (Number(t.actualLayout?.sectionCount) || 0), 0);

        const tier1Solver = solvers[0];

        const data = {
            exportVersion: 'phase6-multitier-metrics',
            exportedAt: new Date().toISOString(),
            sport: this.state.sport,
            profileType: this.state.tiers[0]?.profileType || 'Parabolic',
            template: this._currentTemplate ? {
                name: this._currentTemplate.name || null,
                shape: this._currentTemplate.shape || null,
                fieldLengthFt: Number.isFinite(this._currentTemplate.field_length) ? this._currentTemplate.field_length : null,
                fieldWidthFt: Number.isFinite(this._currentTemplate.field_width) ? this._currentTemplate.field_width : null,
                runoffDefaultFt: Number.isFinite(this._currentTemplate.runoff) ? this._currentTemplate.runoff : null
            } : null,
            bowlConfig,
            egressInputs: {
                seatWidthIn: egressParams.seatWidthIn,
                minAisleWidthIn: egressParams.minAisleWidthIn,
                maxAisleWidthIn: egressParams.maxAisleWidthIn,
                maxSeatsPerRow: egressParams.seatsBetweenAisles,
                egressFactor: egressParams.egressFactor
            },
            totals: {
                enabledTierCount: tierExports.length,
                totalOccupancy: totalOccupancyAllTiers,
                totalAisleCenterlines: totalAislesAllTiers,
                totalSections: totalSectionsAllTiers
            },
            parameters: {
                targetCValue: this.state.tiers[0]?.cValue ?? 0,
                firstRowDistance: this.state.tiers[0]?.firstRowDist ?? 0,
                firstRowElevation: this.state.tiers[0]?.firstRowElev ?? 0,
                treadDepth: this.state.tiers[0]?.treadDepth ?? 0,
                riserHeight: this.state.tiers[0]?.riserHeight ?? 0,
                numRows: Math.round(this.state.tiers[0]?.numRows ?? 0),
                eyeHeight: this.state.tiers[0]?.eyeHeight ?? 0,
                eyeSetback: this.state.tiers[0]?.eyeSetback ?? 0,
                focalX: 0,
                focalZ: this.state.setup.focalZ
            },
            rows: (tier1Solver?.rows || []).map(r => ({
                row: r.row_number,
                x: +r.x.toFixed(3),
                z: +r.z.toFixed(3),
                riser_in: +(r.riser_height * 12).toFixed(2),
                c_value_in: +r.c_value.toFixed(2),
                eye_x: +r.eye_x.toFixed(3),
                eye_z: +r.eye_z.toFixed(3)
            })),
            tiers: tierExports
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `seating - study - ${data.sport.toLowerCase().replace(/\s/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _exportOBJ() {
        if (!this.scene3D || !this.scene3D.bowlGroup || this.scene3D.bowlGroup.children.length === 0) {
            console.warn('No 3D data to export');
            return;
        }

        let output = '# Seating Bowl Study - OBJ Export\n';
        output += 'o SeatingBowl\n';
        let indexOffset = 1;

        this.scene3D.bowlGroup.children.forEach(mesh => {
            if (!mesh.geometry || mesh.type !== 'Mesh') return;
            const geom = mesh.geometry;
            const positions = geom.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                // ThreeJS mapping: Y is up, -Z is forward. Obj usually expects Y up.
                output += `v ${positions[i].toFixed(4)} ${positions[i + 1].toFixed(4)} ${positions[i + 2].toFixed(4)} \n`;
            }
            const indices = geom.index.array;
            for (let i = 0; i < indices.length; i += 3) {
                output += `f ${indices[i] + indexOffset} ${indices[i + 1] + indexOffset} ${indices[i + 2] + indexOffset} \n`;
            }
            indexOffset += (positions.length / 3);
        });

        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const sportName = this.state.sport;
        a.download = `seating - study - ${sportName.toLowerCase().replace(/\s/g, '-')}.obj`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async _export3DM() {
        if (!this.scene3D || !this.scene3D.bowlGroup || this.scene3D.bowlGroup.children.length === 0) {
            console.warn('No 3D data to export');
            return;
        }

        try {
            const rhino = await this._loadRhino3dm();
            const solvers = this._solvers || (this._solver ? [this._solver] : []);
            const bowlConfig = this._getBowlConfig();
            const sportName = this.state.sport;
            const result = await exportRhinoModel({
                rhino,
                solvers,
                bowlConfig,
                sportName,
                nativeSpectatorBlockLimit: Number(globalThis?.__SBS_RHINO_NATIVE_SPECTATOR_MAX_BLOCKS),
                scene3DAdapter: {
                    bowlMeshes: this.scene3D?.bowlGroup?.children ?? [],
                    aisleMeshes: this.scene3D?.aisleGroup?.children ?? [],
                    seatMeshes: this.scene3D?.seatGroup?.children ?? [],
                    THREE: this.scene3D?.THREE,
                    getBowlGeometrySegments: (config, offset) => this.scene3D._getBowlGeometrySegments(config, offset),
                    buildClosedStructuralProfile: (solver, depthFt, tierIndex) =>
                        this.scene3D?._buildClosedStructuralProfile?.(solver, depthFt, tierIndex)
                }
            });

            if (!result?.bytes || result.exportedCount === 0) {
                console.warn('No valid 3D geometry found for Rhino export');
                return;
            }

            const blob = new Blob([result.bytes], { type: 'model/vnd.rhino' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `seating - study - ${sportName.toLowerCase().replace(/\s/g, '-')}.3dm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Rhino export failed:', err);
            const reason = err && err.message ? err.message : String(err);
            alert(`Rhino export failed: ${reason}`);
        }
    }



    async _loadRhino3dm() {
        if (this._rhino3dmPromise) return this._rhino3dmPromise;

        const sources = [
            { script: './lib/rhino3dm.js', base: './lib/' },
            { script: 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/rhino3dm.js', base: 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/' },
            { script: 'https://unpkg.com/rhino3dm@8.17.0/rhino3dm.js', base: 'https://unpkg.com/rhino3dm@8.17.0/' }
        ];

        const initFromGlobal = async (wasmBase) => {
            const initRhino = window.rhino3dm;
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
            if (typeof window.rhino3dm === 'function') {
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

    _exportDXF() {
        if (!this._solvers || this._solvers.length === 0) {
            console.warn('No 2D profile data to export');
            return;
        }

        const dxf = buildProfileDxf({
            solvers: this._solvers,
            structuralDepthFt: (this.state.bowl.structuralDepth || 0) / 12.0,
            focalPointFt: this._getFocalPointFt()
        });

        const blob = new Blob([dxf], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const sportName = this.state.sport;
        a.download = `SeatingProfile_${sportName.toLowerCase().replace(/\\s/g, '-')}.dxf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _exportPlanDXF() {
        if (!this._solvers || this._solvers.length === 0 || !this._currentTemplate) {
            console.warn('No Plan data to export');
            return;
        }

        const sportName = this.state.sport;
        const runoffDist = this._getRunoffDistance();
        const dxf = buildPlanDxf({
            solvers: this._solvers,
            sportName,
            bowlConfig: this._getBowlConfig(),
            template: this._currentTemplate,
            runoffFt: runoffDist,
            visualFocalXFt: this._getFocalPointFt().x,
            enabledTiers: this.state.tiers.map((tier) => !!tier.enabled),
            tierAisleLayouts: this._tierAisleLayouts || [],
            fieldAdapter: {
                getBowlGeometry: (config, offset) => this.fieldRenderer?._getBowlGeometry(config, offset) || [],
                getTierAisleBandPolygons: (...args) => this.fieldRenderer?.getTierAisleBandPolygons(...args) || [],
                getTierSectionMetricsOverlayData: (...args) => this.fieldRenderer?.getTierSectionMetricsOverlayData(...args)
            }
        });

        const blob = new Blob([dxf], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SeatingPlan_${sportName.toLowerCase().replace(/\\s/g, '-')}.dxf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== CSV EXPORT ==========
    _exportCSV() {
        if (!this._solvers || this._solvers.length === 0) { console.warn('No data for CSV'); return; }
        const egressParams = this._getEgressParams();
        const bowlConfig = this._getBowlConfig();
        const sportName = this.state.sport;
        const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);

        const focalXForDetails = this._getFocalPointFt().x;
        let csv = 'Tier,Row,Riser (in),Elevation (ft),C-Value (in),Tread (in),Dist to Focal (ft),Sightline Angle (deg),Linear Length (ft),Seats\n';
        this._solvers.forEach((solver, ti) => {
            if (!solver.rows) return;
            const metrics = ProfileSolver.calculateTierMetrics(solver, bowlConfig, this.fieldRenderer, egressParams, offsetCorrection);
            solver.rows.forEach((row, idx) => {
                const isFirst = idx === 0;
                const isTier1FirstRow = ti === 0 && isFirst;
                const riserInches = isTier1FirstRow ? (row.z * 12) : (row.riser_height * 12);
                const cValDisplay = isFirst ? 'N/A' : row.c_value.toFixed(2);
                const treadInches = ((row.tread_depth || 0) * 12).toFixed(2);
                const distToFocalFt = ((row.x - row.tread_depth) - focalXForDetails).toFixed(2);
                const sightlineDeg = (row.sightline_angle || 0).toFixed(2);
                csv += `${ti + 1},${row.row_number},${riserInches.toFixed(2)},${row.z.toFixed(2)},${cValDisplay},${treadInches},${distToFocalFt},${sightlineDeg},${(row.computedLength || 0).toFixed(0)},${row.computedSeats || 0}\n`;
            });
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tier-metrics-${sportName.toLowerCase().replace(/\s/g, '-')}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== CONFIG SAVE/LOAD ==========
    _exportConfig() {
        const config = this.state.toJSON();
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bowl-config-${config.sport.toLowerCase().replace(/\s/g, '-')}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _loadConfig(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const config = JSON.parse(e.target.result);
                this._loadStateFromConfig(config, { logSuccess: true });
            } catch (err) { console.error('Failed to load config:', err); }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset
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
        const slider = document.getElementById('clipPositionSlider');
        const input = document.getElementById('clipPositionInput');
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
        const segments = this.fieldRenderer._getBowlGeometry(bowlConfig, offset);
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
        const cam = this.scene3D.camera;
        const ctrl = this.scene3D.controls;

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
        this.scene3D.camera.position.set(
            bookmark.position.x,
            bookmark.position.y,
            bookmark.position.z
        );
        this.scene3D.controls.target.set(
            bookmark.target.x,
            bookmark.target.y,
            bookmark.target.z
        );
        this.scene3D.controls.update();
    }

    _export3DImage(viewName = null) {
        if (!this.scene3D || !this.scene3D.renderer) return;
        this.scene3D.renderer.render(this.scene3D.scene, this.scene3D.camera);
        const dataUrl = this.scene3D.renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        const sportName = this.state.sport;
        const suffix = viewName ? `-${viewName.toLowerCase().replace(/\s/g, '-')}` : '';
        a.download = `3d-view-${sportName.toLowerCase().replace(/\s/g, '-')}${suffix}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
}

// --- Sidebar Interaction Logic ---

// 1. Right Sidebar Toggle
const rightSidebar = document.querySelector('.right-sidebar');
const toggleResultsBtn = document.getElementById('toggleResultsBtn');

if (toggleResultsBtn && rightSidebar) {
    // Mark the primary handler so the inline fallback script can avoid double-binding.
    toggleResultsBtn.dataset.resultsToggleBound = 'app';
    toggleResultsBtn.addEventListener('click', () => {
        rightSidebar.classList.toggle('collapsed');
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    });
}

// 1.5 Left Sidebar Toggle - See index.html script for toggle logic
const leftSidebar = document.querySelector('.left-sidebar');

// 2. Left Sidebar Resizer
const resizer = document.getElementById('leftSidebarResizer');

if (resizer && leftSidebar) {
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        let newWidth = e.clientX;
        // Min/Max constraints
        if (newWidth < 250) newWidth = 250;
        if (newWidth > 500) newWidth = 500;

        leftSidebar.style.width = `${newWidth}px`;
        leftSidebar.style.minWidth = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            // Trigger resize for canvas
            window.dispatchEvent(new Event('resize'));
        }
    });
}

// 3. Right Sidebar Resizer
const rightResizer = document.getElementById('rightSidebarResizer');

if (rightResizer) {
    let isRightResizing = false;
    const rightSidebar = document.querySelector('.right-sidebar');

    rightResizer.addEventListener('mousedown', (e) => {
        isRightResizing = true;
        rightResizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isRightResizing) return;
        if (!rightSidebar) return;

        let newWidth = window.innerWidth - e.clientX;
        if (newWidth < 250) newWidth = 250;
        if (newWidth > 1000) newWidth = 1000;

        // Automatically expand if collapsed
        if (newWidth > 250 && rightSidebar.classList.contains('collapsed')) {
            rightSidebar.classList.remove('collapsed');
        }

        rightSidebar.style.width = `${newWidth}px`;
        rightSidebar.style.minWidth = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
        if (isRightResizing) {
            isRightResizing = false;
            rightResizer.classList.remove('resizing');
            document.body.style.cursor = '';
            window.dispatchEvent(new Event('resize'));
        }
    });
}

function buildDashboardUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    return `${url.pathname}${url.search}${url.hash}`;
}

function buildEditorUrl(projectId) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('project', projectId);
    return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

function setShellMode(mode) {
    const dashboardShell = document.getElementById('dashboardShell');
    const editorShell = document.getElementById('editorShell');
    const showDashboard = mode === 'dashboard';

    if (dashboardShell) dashboardShell.hidden = !showDashboard;
    if (editorShell) editorShell.hidden = showDashboard;
    document.body.classList.toggle('dashboard-mode', showDashboard);
}

function setSaveButtonBusy(isBusy) {
    const saveBtn = document.getElementById('saveProjectBtn');
    if (!saveBtn) return;

    saveBtn.dataset.busy = isBusy ? 'true' : 'false';
    saveBtn.textContent = isBusy ? 'Saving...' : 'Save Project';
    if (isBusy) {
        saveBtn.disabled = true;
    }
}

function wireProjectShellControls(app, authService, projectsService) {
    const backBtn = document.getElementById('backToDashboardBtn');
    const saveBtn = document.getElementById('saveProjectBtn');
    const signOutBtn = document.getElementById('editorSignOutBtn');

    backBtn?.addEventListener('click', () => {
        window.location.assign(buildDashboardUrl());
    });

    signOutBtn?.addEventListener('click', async () => {
        try {
            await authService.signOut();
        } catch (error) {
            console.error('Sign-out failed:', error);
        } finally {
            window.location.assign(buildDashboardUrl());
        }
    });

    saveBtn?.addEventListener('click', async () => {
        const metadata = app.getProjectMetadata();
        if (!metadata.id) return;

        setSaveButtonBusy(true);
        app.setProjectStatus('Saving project...', 'pending');

        try {
            const savedProject = await projectsService.updateProject(
                metadata.id,
                app.getProjectSaveRequest()
            );
            app.setProjectMetadata(savedProject);
            app.setProjectStatus(`Saved ${savedProject.name}`, 'success');
        } catch (error) {
            console.error('Project save failed:', error);
            app.setProjectStatus(
                error instanceof Error ? error.message : 'Project save failed.',
                'error'
            );
        } finally {
            setSaveButtonBusy(false);
            app._refreshProjectChrome();
        }
    });
}

async function bootAppShell() {
    const authService = createAuthService();
    const projectsService = createProjectsService();
    const app = new App();
    const dashboardPage = new DashboardPage({
        root: document.getElementById('dashboardPageRoot'),
        authService,
        projectsService,
        onOpenProject: (projectId) => {
            window.location.assign(buildEditorUrl(projectId));
        }
    });

    const projectId = new URLSearchParams(window.location.search).get('project');

    if (!projectId) {
        setShellMode('dashboard');
        await dashboardPage.show();
        return;
    }

    const session = await authService.getSession();
    if (!session) {
        window.location.assign(buildDashboardUrl());
        return;
    }

    setShellMode('editor');
    app.setSession(session);
    wireProjectShellControls(app, authService, projectsService);
    await app.init();
    app.setProjectStatus('Loading project...', 'pending');

    try {
        const project = await projectsService.getProject(projectId);
        app.loadProject(project);
    } catch (error) {
        console.error('Project load failed:', error);
        app.setProjectStatus(
            error instanceof Error ? error.message : 'Project load failed.',
            'error'
        );
        window.setTimeout(() => {
            window.location.assign(buildDashboardUrl());
        }, 900);
    }
}

bootAppShell().catch((err) => console.error('App init failed:', err));
