/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { SPORTS_TEMPLATES, getSportNames, getTemplate } from './sports-templates.js';
import { ProfileSolver } from './profile-solver.js?v=4';
import { FieldRenderer } from './field-renderer.js?v=19';
import { ProfileRenderer } from './profile-renderer.js?v=4';
import { DEFAULT_STARTUP_PROFILE } from './default-starting-profile.js?v=1';
import { buildPlanDxf, buildProfileDxf } from './export/dxf-exporter.js';
import { exportRhinoModel, getRhinoExportOffsetCorrection } from './export/rhino/rhino-exporter.js';
import { renderStatsPanel } from './ui/stats-panel.js?v=1';
// Scene3D is imported lazily in _init3DAsync to avoid blocking if Three.js CDN is unavailable

class App {
    constructor() {
        this.fieldRenderer = null;
        this.profileRenderer = null;
        this.scene3D = null;
        this._debounceTimer = null;
        this._currentTemplate = null;
        this._solver = null;
        this._scene3dReady = false;
        this._tierAisleLayouts = [];
        this._rhino3dmPromise = null;

        // Track tier count to implement progressive stacking
        this._lastTierCount = 1; // Default

        // Track if tiers have been initialized to prevent overwriting user changes on hide/show
        this._tier2Initialized = false;
        this._tier3Initialized = false;

        // Track user-modified states for each sport
        this._sportStates = {};
        this._previousSport = null;
        this._didApplyStartupProfile = false;
        this._themeStorageKey = 'jlg-seating-theme';
        this._theme = 'light';
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

            // Apply built-in starting profile after controls are wired
            const startupProfileApplied = this._applyStartupProfile();

            // Initialize tooltips
            this._initTooltips();

            // Initial render
            this.update();

            // Sync internal state to DOM
            const tc = document.getElementById('tierCount');
            if (tc) this._lastTierCount = parseInt(tc.value) || 1;

            // Set initial view state (hides Field Setup on Profile tab)
            if (!startupProfileApplied) {
                this._switchViewTab('profile');
            }
            requestAnimationFrame(() => this._applyUrlViewOverride());

            // 3D scene is initialized lazily when user clicks the 3D tab

        } catch (err) {
            console.error('App init error:', err);
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
            const { Scene3D } = await import('./scene3d.js?v=25');

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
        select.value = 'Football'; // Default
        this._onSportChange();
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

    _wireEvents() {
        // Sport selector
        const sportSelect = document.getElementById('sportSelect');
        if (sportSelect) {
            sportSelect.addEventListener('change', () => {
                this._onSportChange();
                this._scheduleUpdate();
            });
        }

        // Custom runoff
        const runoffInput = document.getElementById('customRunoffInput');
        const runoffSlider = document.getElementById('customRunoffSlider');
        if (runoffInput && runoffSlider) {
            runoffInput.addEventListener('input', () => {
                runoffSlider.value = runoffInput.value;
                this._scheduleUpdate();
            });
            runoffSlider.addEventListener('input', () => {
                runoffInput.value = runoffSlider.value;
                this._scheduleUpdate();
            });
        }

        // All range sliders — sync to paired number input
        document.querySelectorAll('input[type="range"]').forEach(slider => {
            slider.addEventListener('input', () => {
                this._syncSliderToInput(slider);
                this._scheduleUpdate();
            });
        });

        // All number inputs — sync to paired slider
        document.querySelectorAll('.control-row input[type="number"]').forEach(numInput => {
            numInput.addEventListener('input', () => {
                this._syncInputToSlider(numInput);
                this._scheduleUpdate();
            });
        });

        // Tier toggles
        ['enableTier1', 'enableTier2', 'enableTier3'].forEach((id, index) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    this._onTierToggle(index + 1); // 1, 2 or 3
                    this._scheduleUpdate();
                });
            }
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
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => this._scheduleUpdate());
            }
        });

        // View tab buttons
        document.querySelectorAll('.view-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._switchViewTab(btn.dataset.tab);
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

        // Camera bookmarks (3D view)
        const saveCamBtn = document.getElementById('saveCameraViewBtn');
        const toggleBookmarksBtn = document.getElementById('toggleBookmarksBtn');
        const cameraBookmarksBar = document.getElementById('cameraBookmarksBar');

        if (saveCamBtn) {
            saveCamBtn.addEventListener('click', () => {
                if (cameraBookmarksBar && cameraBookmarksBar.classList.contains('collapsed')) {
                    cameraBookmarksBar.classList.remove('collapsed');
                }
                this._saveCameraBookmark();
            });
        }

        if (toggleBookmarksBtn && cameraBookmarksBar) {
            toggleBookmarksBtn.addEventListener('click', () => {
                cameraBookmarksBar.classList.toggle('collapsed');
            });
        }

        this._cameraBookmarks = [];

        // Clip Plane controls
        const enableClip = document.getElementById('enableClipPlane');
        if (enableClip) {
            enableClip.addEventListener('change', () => {
                const controls = document.getElementById('clipPlaneControls');
                if (controls) controls.style.display = enableClip.checked ? 'block' : 'none';
                this._scheduleUpdate();
            });
        }
        ['clipAxis', 'clipSide'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => this._scheduleUpdate());
        });
        ['clipPosition'].forEach(baseId => {
            const slider = document.getElementById(baseId + 'Slider');
            const input = document.getElementById(baseId + 'Input');
            if (slider) { slider.addEventListener('input', () => { this._syncSliderToInput(slider); this._scheduleUpdate(); }); }
            if (input) { input.addEventListener('input', () => { this._syncInputToSlider(input); this._scheduleUpdate(); }); }
        });

        // Structural Depth slider/input
        ['structuralDepth'].forEach(baseId => {
            const slider = document.getElementById(baseId + 'Slider');
            const input = document.getElementById(baseId + 'Input');
            if (slider) { slider.addEventListener('input', () => { this._syncSliderToInput(slider); this._scheduleUpdate(); }); }
            if (input) { input.addEventListener('input', () => { this._syncInputToSlider(input); this._scheduleUpdate(); }); }
        });

        // Bowl Configuration Change Events
        ['bowlType'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    if (id === 'bowlType') {
                        const sideRow = document.getElementById('sideLengthRow');
                        if (sideRow) sideRow.style.display = e.target.value.includes('Side') ? 'flex' : 'none';
                    }
                    this._scheduleUpdate();
                });
            }
        });

        // Bowl Configuration Sliders/Inputs
        ['bowlCornerRad', 'bowlSideLength'].forEach(baseId => {
            const slider = document.getElementById(baseId + 'Slider');
            const input = document.getElementById(baseId + 'Input');

            if (slider) {
                slider.addEventListener('input', () => {
                    this._syncSliderToInput(slider);
                    this._scheduleUpdate();
                });
            }
            if (input) {
                input.addEventListener('input', () => {
                    this._syncInputToSlider(input);
                    this._scheduleUpdate();
                });
            }
        });

        // Occupancy & Egress Inputs
        ['seatWidth', 'seatsBetweenAisles', 'egressFactor'].forEach(baseId => {
            const slider = document.getElementById(baseId + 'Slider');
            const input = document.getElementById(baseId + 'Input');
            if (slider) {
                slider.addEventListener('input', () => {
                    this._syncSliderToInput(slider);
                    this._scheduleUpdate();
                });
            }
            if (input) {
                input.addEventListener('input', () => {
                    this._syncInputToSlider(input);
                    this._scheduleUpdate();
                });
            }
        });

        ['minAisleInput', 'maxAisleInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this._scheduleUpdate());
        });

        const showSeatCubes3D = document.getElementById('showSeatCubes3D');
        if (showSeatCubes3D) showSeatCubes3D.addEventListener('change', () => this._scheduleUpdate());

        // Sightlines Toggle
        const sightlinesBtn = document.getElementById('toggleSightlinesBtn');
        const sightlinesBtnField = document.getElementById('toggleSightlinesBtnField');
        const syncSightlinesToggles = (sourceEl) => {
            const checked = !!sourceEl?.checked;
            if (sightlinesBtn && sightlinesBtn !== sourceEl) sightlinesBtn.checked = checked;
            if (sightlinesBtnField && sightlinesBtnField !== sourceEl) sightlinesBtnField.checked = checked;
            this._scheduleUpdate();
        };
        if (sightlinesBtn) sightlinesBtn.addEventListener('change', () => syncSightlinesToggles(sightlinesBtn));
        if (sightlinesBtnField) sightlinesBtnField.addEventListener('change', () => syncSightlinesToggles(sightlinesBtnField));
        if (sightlinesBtn && sightlinesBtnField) sightlinesBtnField.checked = !!sightlinesBtn.checked;
        const sectionMetricsBtn = document.getElementById('toggleSectionMetricsBtn');
        if (sectionMetricsBtn) sectionMetricsBtn.addEventListener('change', () => this._scheduleUpdate());

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
        const sportSelect = document.getElementById('sportSelect');
        const newSport = sportSelect.value;

        // 1. Save state of the PREVIOUS sport (if exists)
        if (this._previousSport && this._previousSport !== newSport) {
            this._saveSportState(this._previousSport);
        }

        // 2. Load state for the NEW sport
        const template = getTemplate(newSport);
        this._currentTemplate = template;
        this._previousSport = newSport;

        if (template) {
            // Update Dimensions Text
            const dimEl = document.getElementById('fieldDimensions');
            if (dimEl) {
                let text = '';
                if (template.field_length) text += `${template.field_length}' L`;
                if (template.field_width) text += ` - ${template.field_width}' W`;
                if (template.field_radius) text += `Radius: ${template.field_radius}'`;
                dimEl.textContent = text;
            }

            // check if we have a saved state
            if (this._sportStates[newSport]) {
                this._loadSportState(this._sportStates[newSport]);
            } else if (template.defaults) {
                // Load defaults from template
                this._loadSportState(template.defaults);
            } else {
                // Fallback / Legecy logic if no defaults defined
                this._boxLegacyDefaults(newSport, template);
            }

            // Trigger update
            this._scheduleUpdate();
        }
    }

    _saveSportState(sportName) {
        // Capture current values of Tier 1 and Setup
        const state = {
            setup: {
                customRunoff: this._getCustomRunoff() !== null ? this._getCustomRunoff() : 0,
                // Note: _getCustomRunoff returns null if empty, we want value. 
                // Actually, the input might be "Auto" (empty). If empty, we store null or 0? 
                // Let's grab the raw value from input if we want to persist "Auto" state vs explicit value.
                // But for simplicity, let's persist the numeric values.
                focalZ: this._getInputValue('focalZ')
            },
            tier1: {
                targetCValue: this._getInputValue('cValue'),
                numRows: Math.round(this._getInputValue('numRows')),
                firstRowDist: this._getInputValue('firstRowDist'),
                firstRowElev: this._getInputValue('firstRowElev'),
                treadDepth: this._getInputValue('treadDepth'),
                riserHeight: this._getInputValue('riserHeight'),
                eyeHeight: this._getInputValue('eyeHeight'),
                eyeSetback: this._getInputValue('eyeSetback'),
                profileType: document.getElementById('profileType').value
            },
            bowl: {
                type: document.getElementById('bowlType').value,
                corner: 'Chamfer',
                radius: this._getInputValue('bowlCornerRad'),
                sideLength: this._getInputValue('bowlSideLength'),
                structuralDepth: this._getInputValue('structuralDepth')
            }
        };

        // Handle Runoff "Auto" case
        const runoffInput = document.getElementById('customRunoffInput');
        if (runoffInput && runoffInput.value === '') {
            state.setup.customRunoff = null; // Auto
        } else {
            state.setup.customRunoff = parseFloat(runoffInput.value);
        }

        this._sportStates[sportName] = state;
    }

    _loadSportState(state) {
        if (!state) return;

        // Setup
        if (state.setup) {
            this._setInputValue('focalZ', state.setup.focalZ);

            const runoffInput = document.getElementById('customRunoffInput');
            const runoffSlider = document.getElementById('customRunoffSlider');
            if (state.setup.customRunoff !== null && state.setup.customRunoff !== undefined) {
                runoffInput.value = state.setup.customRunoff;
                runoffSlider.value = state.setup.customRunoff;
            } else {
                runoffInput.value = ''; // Auto
                // Slider usually follows, but for auto it might be 0 or template default
                if (this._currentTemplate) runoffSlider.value = this._currentTemplate.runoff || 0;
            }
        }

        // Bowl Config
        if (state.bowl) {
            const normalizedBowlType = state.bowl.type === 'Side2' ? 'Side1' : state.bowl.type;
            if (normalizedBowlType) document.getElementById('bowlType').value = normalizedBowlType;
            const sideLengthRow = document.getElementById('sideLengthRow');
            if (sideLengthRow) {
                if (normalizedBowlType && normalizedBowlType.includes('Side')) {
                    sideLengthRow.style.display = 'flex';
                } else {
                    sideLengthRow.style.display = 'none';
                }
            }
            this._setInputValue('bowlCornerRad', state.bowl.radius);
            if (state.bowl.sideLength !== undefined) {
                this._setInputValue('bowlSideLength', state.bowl.sideLength);
            }
            if (state.bowl.structuralDepth !== undefined) {
                this._setInputValue('structuralDepth', state.bowl.structuralDepth);
            }
        } else {
            // Defaults if not saved?
            document.getElementById('bowlType').value = 'Full';
            const sideLengthRow = document.getElementById('sideLengthRow');
            if (sideLengthRow) sideLengthRow.style.display = 'none';
            this._setInputValue('bowlCornerRad', 10);
            this._setInputValue('bowlSideLength', this._currentTemplate ? this._currentTemplate.field_length : 300);
        }

        // Tier 1
        if (state.tier1) {
            this._setInputValue('cValue', state.tier1.targetCValue);
            this._setInputValue('numRows', state.tier1.numRows);
            this._setInputValue('firstRowDist', state.tier1.firstRowDist);
            this._setInputValue('firstRowElev', state.tier1.firstRowElev);
            this._setInputValue('treadDepth', state.tier1.treadDepth);
            this._setInputValue('riserHeight', state.tier1.riserHeight);
            this._setInputValue('eyeHeight', state.tier1.eyeHeight);
            this._setInputValue('eyeSetback', state.tier1.eyeSetback);

            if (state.tier1.profileType) {
                document.getElementById('profileType').value = state.tier1.profileType;
            }
        }
    }

    _boxLegacyDefaults(sportName, template) {
        // Fallback to previous logic if no defaults found
        this._setInputValue('focalX', 0);

        if (sportName === 'Concert') {
            this._setInputValue('focalZ', 5.0);
        } else {
            this._setInputValue('focalZ', 0);
        }

        const runoffInput = document.getElementById('customRunoffInput');
        if (runoffInput) runoffInput.value = template.runoff || 0;
    }

    _onTierToggle(tierNum) {
        const checkbox = document.getElementById(`enableTier${tierNum}`);
        const section = document.getElementById(`tier${tierNum}Section`);
        const enabled = checkbox && checkbox.checked;

        if (section) {
            if (enabled) {
                section.classList.remove('tier-disabled');
                // Auto-expand if enabling? User didn't explicitly ask, but it's good UX.
                // section.classList.remove('collapsed'); 
            } else {
                section.classList.add('tier-disabled');
            }
        }

        // Auto-stack logic: When enabling a tier, start it at the end of the previous tier
        // Note: solvers array might not be up to date with the *current* toggle yet until update() runs,
        // but we can check the *previous* tier which should exist if we are enabling tier N (assuming N-1 is enabled/solved)

        // However, we need to run update() to generate solvers. 
        // Logic: if we are enabling, checking if we should auto-stack happens *after* we have some data? 
        // Actually, we can just check if we have data for the *previous* tier right now.

        // Conservative approach: We can't rely on `this._solvers` having the new tier yet. 
        // But we rely on `this._solvers` having the *previous* tier.

        if (enabled && tierNum > 1) {
            const isInit = tierNum === 2 ? this._tier2Initialized : this._tier3Initialized;
            if (!isInit && this._solvers && this._solvers.length >= tierNum - 1) {
                const prevTier = this._solvers[tierNum - 2]; // index 0 for Tier 2, 1 for Tier 3
                if (prevTier && prevTier.rows && prevTier.rows.length > 0) {
                    const lastRow = prevTier.rows[prevTier.rows.length - 1];

                    // Set defaults for New Tier to start where Prev Tier ends
                    const prefix = tierNum === 2 ? 't2' : 't3';
                    this._setInputValue(`${prefix}FirstRowDist`, lastRow.x.toFixed(2));
                    this._setInputValue(`${prefix}FirstRowElev`, (lastRow.z + 20).toFixed(2));
                    this._setInputValue(`${prefix}RiserHeight`, 12);

                }
            }

            // Preserve user values on subsequent off/on toggles even if auto-stack couldn't run this time.
            if (tierNum === 2) this._tier2Initialized = true;
            else this._tier3Initialized = true;
        }
    }

    _switchViewTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.view-tab-btn[data-tab="${tab}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Update panels
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        const activePanel = document.getElementById(`${tab}Panel`);
        if (activePanel) activePanel.classList.add('active');

        // Helper to toggle visibility
        const toggle = (id, show) => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? 'block' : 'none';
        };

        const set3DExportButtonState = (button) => {
            if (!button) return;
            button.disabled = tab !== 'scene3d';
            if (tab === 'scene3d') {
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
        if (tab === 'profile') {
            toggle('fieldSetupSection', true); // Show Field Setup!
            toggle('profileParamsSection', true);
            toggle('focalPointSection', true);
            toggle('additionalTiersSection', true);
            toggle('planViewControls', false);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        } else if (tab === 'field') {
            toggle('fieldSetupSection', true);
            toggle('profileParamsSection', false);
            toggle('focalPointSection', true);
            toggle('additionalTiersSection', false);
            toggle('planViewControls', true);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        } else if (tab === 'scene3d') {
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
            if (tab === 'field') {
                const canvas = document.getElementById('fieldCanvas');
                const parent = canvas.parentElement;
                const rect = parent.getBoundingClientRect();
                canvas.width = rect.width;
                canvas.height = rect.height;
                if (this.fieldRenderer) {
                    const runoff = this._getCustomRunoff();
                    const fx = this._getInputValue('focalX');

                    // Construct Bowl Config on tab switch
                    const clipEnabled = document.getElementById('enableClipPlane')?.checked || false;
                    const clipCfg = clipEnabled ? { enabled: true, axis: document.getElementById('clipAxis')?.value || 'X', position: this._getInputValue('clipPosition') || 0, side: document.getElementById('clipSide')?.value || 'positive' } : { enabled: false };
                    const bowlConfig = {
                        width: this._currentTemplate.field_width,
                        length: this._currentTemplate.field_length,
                        shape: this._currentTemplate.shape,
                        radius_arc: this._currentTemplate.field_radius,
                        arc_angle: this._currentTemplate.arc_angle,
                        type: document.getElementById('bowlType').value,
                        corner: 'Chamfer',
                        radius: this._getInputValue('bowlCornerRad'),
                        sideLength: this._getInputValue('bowlSideLength'),
                        clip: clipCfg
                    };

                    const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
                    const isEdgeSport = edgeSports.includes(document.getElementById('sportSelect').value);
                    const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
                    const offsetCorrection = isEdgeSport ? 0 : (safeWidth / 2);

                    // Ensure signature matches: render(template, runoff, solvers, visibility, visualFocalX, bowlConfig, offsetCorrection)
                    const sightlineVisualsEnabled = document.getElementById('toggleSightlinesBtn')?.checked ?? true;
                    const vis = {
                        showSeating: true,
                        t1: document.getElementById('enableTier1').checked,
                        t2: document.getElementById('enableTier2').checked,
                        t3: document.getElementById('enableTier3').checked,
                        colorByCValue: sightlineVisualsEnabled,
                        showSectionMetrics: document.getElementById('toggleSectionMetricsBtn')?.checked ?? false
                    };
                    this.fieldRenderer.render(this._currentTemplate, runoff, this._solvers, vis, fx, bowlConfig, offsetCorrection, this._tierAisleLayouts || []);
                }
            } else if (tab === 'profile') {
                const canvas = document.getElementById('profileCanvas');
                const parent = canvas.parentElement;
                const rect = parent.getBoundingClientRect();
                canvas.width = rect.width;
                canvas.height = rect.height;
                if (this.profileRenderer && this._solver) {
                    this.profileRenderer.render(
                        this._solver,
                        this._getInputValue('focalX'),
                        this._getInputValue('focalZ')
                    );
                }
            } else if (tab === 'scene3d') {
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
        // Try number input first, fall back to slider
        const input = document.getElementById(id + 'Input');
        if (input && input.value !== '') return parseFloat(input.value);
        const slider = document.getElementById(id + 'Slider');
        if (slider) return parseFloat(slider.value);
        return 0;
    }

    _getCustomRunoff() {
        const el = document.getElementById('customRunoffInput');
        if (el && el.value !== '') return parseFloat(el.value);
        return null; // null means "use template default"
    }

    update() {
        try {
            // CONSTANTS / DEPRECATED
            const focalX = 0; // Removed control, always 0 (relative to field edge/center)
            const focalZ = this._getInputValue('focalZ');
            const structuralDepth = this._getInputValue('structuralDepth') || 0; // inches

            // Clip Plane config
            const clipEnabled = document.getElementById('enableClipPlane')?.checked || false;
            const clipConfig = clipEnabled ? {
                enabled: true,
                axis: document.getElementById('clipAxis')?.value || 'X',
                position: this._getInputValue('clipPosition') || 0,
                side: document.getElementById('clipSide')?.value || 'positive'
            } : { enabled: false };

            // Tier 1 params (main controls)
            const tier1Params = {
                targetCValue: this._getInputValue('cValue'),
                firstRowDistance: this._getInputValue('firstRowDist'),
                firstRowElevation: this._getInputValue('firstRowElev'),
                treadDepth: this._getInputValue('treadDepth'),
                defaultRiser: this._getInputValue('riserHeight'),
                numRows: Math.round(this._getInputValue('numRows')),
                eyeHeight: this._getInputValue('eyeHeight'),
                eyeSetback: this._getInputValue('eyeSetback'),
                focalX, focalZ
            };
            const tier1Type = document.getElementById('profileType').value;

            // Solve tier 1
            const solvers = [];
            const t1Enabled = document.getElementById('enableTier1').checked;

            if (t1Enabled) {
                const solver1 = new ProfileSolver(tier1Params);
                solver1.solve(tier1Type);
                solver1.tierIndex = 0; // Explicit Color Index
                solvers.push(solver1);
            }

            // Solve tier 2
            const t2Enabled = document.getElementById('enableTier2').checked;
            if (t2Enabled) {
                const t2Params = {
                    targetCValue: this._getInputValue('t2CValue'),
                    firstRowDistance: this._getInputValue('t2FirstRowDist'),
                    firstRowElevation: this._getInputValue('t2FirstRowElev'),
                    treadDepth: this._getInputValue('t2TreadDepth'),
                    defaultRiser: this._getInputValue('t2RiserHeight'),
                    numRows: Math.round(this._getInputValue('t2NumRows')),
                    eyeHeight: this._getInputValue('t2EyeHeight'),
                    eyeSetback: this._getInputValue('t2EyeSetback'),
                    focalX, focalZ
                };
                const t2Type = document.getElementById('t2ProfileType').value;
                const solver2 = new ProfileSolver(t2Params);
                solver2.solve(t2Type);
                solver2.tierIndex = 1; // Explicit Color Index
                solvers.push(solver2);
            }

            // Solve tier 3
            const t3Enabled = document.getElementById('enableTier3').checked;
            if (t3Enabled) {
                const t3Params = {
                    targetCValue: this._getInputValue('t3CValue'),
                    firstRowDistance: this._getInputValue('t3FirstRowDist'),
                    firstRowElevation: this._getInputValue('t3FirstRowElev'),
                    treadDepth: this._getInputValue('t3TreadDepth'),
                    defaultRiser: this._getInputValue('t3RiserHeight'),
                    numRows: Math.round(this._getInputValue('t3NumRows')),
                    eyeHeight: this._getInputValue('t3EyeHeight'),
                    eyeSetback: this._getInputValue('t3EyeSetback'),
                    focalX, focalZ
                };
                const t3Type = document.getElementById('t3ProfileType').value;
                const solver3 = new ProfileSolver(t3Params);
                solver3.solve(t3Type);
                solver3.tierIndex = 2; // Explicit Color Index
                solvers.push(solver3);
            }

            // Store for stats and 3D
            this._solvers = solvers;
            this._solver = solvers[0] || null; // Backward compat for 3D view

            // Get template
            const sportName = document.getElementById('sportSelect').value;
            this._currentTemplate = getTemplate(sportName);
            const customRunoff = this._getCustomRunoff();
            this._updateClipSliderRange(solvers, this._getBowlConfig());

            // Render field
            if (this.fieldRenderer) {
                const sightlineVisualsEnabled = document.getElementById('toggleSightlinesBtn')?.checked ?? true;
                const visibility = {
                    showSeating: true,
                    t1: document.getElementById('enableTier1').checked,
                    t2: document.getElementById('enableTier2').checked,
                    t3: document.getElementById('enableTier3').checked,
                    colorByCValue: sightlineVisualsEnabled,
                    showSectionMetrics: document.getElementById('toggleSectionMetricsBtn')?.checked ?? false
                };

                // Calculate Visual Focal Y (Plan View) based on Sport Type
                // Group 1 (Edge): Hockey, Football, Concert, Soccer -> Base = template.focal_y
                // Group 2 (Center): Others -> Base = 0
                const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
                let baseY = 0;
                if (edgeSports.includes(sportName)) {
                    baseY = this._currentTemplate.focal_y || 0;
                }

                // Focal X input acts as an offset from the Base Y
                const visualFocalY = baseY + focalX;

                // Bowl Configuration
                const bowlConfig = {
                    width: this._currentTemplate.field_width,
                    length: this._currentTemplate.field_length,
                    shape: this._currentTemplate.shape,
                    radius_arc: this._currentTemplate.field_radius,
                    arc_angle: this._currentTemplate.arc_angle,
                    type: document.getElementById('bowlType').value,
                    corner: 'Chamfer',
                    radius: this._getInputValue('bowlCornerRad'),
                    sideLength: this._getInputValue('bowlSideLength'),
                    structuralDepth,
                    clip: clipConfig
                };

                const isEdgeSport = edgeSports.includes(sportName);
                const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
                const offsetCorrection = isEdgeSport ? 0 : (safeWidth / 2);
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
                const sightlinesEl = document.getElementById('toggleSightlinesBtn');
                const showSightlines = sightlinesEl ? sightlinesEl.checked : true;
                this.profileRenderer.renderMulti(solvers, focalX, focalZ, {
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
            const focalZ = this._getInputValue('focalZ');
            this.scene3D.updateField(this._currentTemplate, customRunoff, focalZ);

            const clipEnabled = document.getElementById('enableClipPlane')?.checked || false;
            const clipConfig = clipEnabled ? {
                enabled: true,
                axis: document.getElementById('clipAxis')?.value || 'X',
                position: this._getInputValue('clipPosition') || 0,
                side: document.getElementById('clipSide')?.value || 'positive'
            } : { enabled: false };

            const bowlConfig = {
                width: this._currentTemplate.field_width,
                length: this._currentTemplate.field_length,
                shape: this._currentTemplate.shape,
                radius_arc: this._currentTemplate.field_radius,
                arc_angle: this._currentTemplate.arc_angle,
                type: document.getElementById('bowlType').value,
                corner: 'Chamfer',
                radius: this._getInputValue('bowlCornerRad'),
                sideLength: this._getInputValue('bowlSideLength'),
                structuralDepth: this._getInputValue('structuralDepth') || 0,
                clip: clipConfig
            };

            // Recalculate offsetCorrection for 3D update
            const sportName = document.getElementById('sportSelect').value;
            const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
            const isEdgeSport = edgeSports.includes(sportName);
            const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
            const offsetCorrection = isEdgeSport ? 0 : (safeWidth / 2);

            const solvers = this._solvers || (this._solver ? [this._solver] : []);
            if (this.scene3D) {
                this.scene3D.updateBowl(
                    solvers,
                    bowlConfig,
                    this._currentTemplate,
                    offsetCorrection,
                    this._tierAisleLayouts || [],
                    {
                        showSeatCubes: document.getElementById('showSeatCubes3D')?.checked || false,
                        seatWidthIn: parseFloat(document.getElementById('seatWidthInput')?.value) || 20
                    }
                );
            }
        } catch (e) {
            console.warn('3D update error:', e);
        }
    }

    _getEgressParams() {
        return {
            seatWidthIn: parseFloat(document.getElementById('seatWidthInput').value) || 20,
            maxAisleWidthIn: parseFloat(document.getElementById('maxAisleInput').value) || 72,
            minAisleWidthIn: parseFloat(document.getElementById('minAisleInput').value) || 48,
            egressFactor: parseFloat(document.getElementById('egressFactorInput').value) || 0.2,
            seatsBetweenAisles: parseFloat(document.getElementById('seatsBetweenAislesInput').value) || 20
        };
    }

    _updateStats() {
        renderStatsPanel({
            solvers: this._solvers || (this._solver ? [this._solver] : []),
            statsEl: document.getElementById('statsContent'),
            detailsEl: document.getElementById('detailsContent'),
            getInputValue: (id) => this._getInputValue(id),
            getEgressParams: () => this._getEgressParams(),
            getBowlConfig: () => this._getBowlConfig(),
            tierAisleLayouts: this._tierAisleLayouts || [],
            fieldRenderer: this.fieldRenderer,
            sportName: document.getElementById('sportSelect')?.value || ''
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
            document.getElementById('sportSelect')?.value || ''
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
            sport: document.getElementById('sportSelect').value,
            profileType: document.getElementById('profileType').value,
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
                targetCValue: this._getInputValue('cValue'),
                firstRowDistance: this._getInputValue('firstRowDist'),
                firstRowElevation: this._getInputValue('firstRowElev'),
                treadDepth: this._getInputValue('treadDepth'),
                riserHeight: this._getInputValue('riserHeight'),
                numRows: Math.round(this._getInputValue('numRows')),
                eyeHeight: this._getInputValue('eyeHeight'),
                eyeSetback: this._getInputValue('eyeSetback'),
                focalX: this._getInputValue('focalX'),
                focalZ: this._getInputValue('focalZ')
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
        const sportName = document.getElementById('sportSelect').value;
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
            const sportName = document.getElementById('sportSelect')?.value || '';
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
            structuralDepthFt: (this._getInputValue('structuralDepth') || 0) / 12.0,
            focalPointFt: {
                x: this._getInputValue('focalX') || 0,
                z: this._getInputValue('focalZ') || 0
            }
        });

        const blob = new Blob([dxf], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const sportName = document.getElementById('sportSelect').value;
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

        const sportName = document.getElementById('sportSelect')?.value || '';
        const runoffDist = this._getCustomRunoff() !== null ? this._getCustomRunoff() : (this._currentTemplate.runoff || 0);
        const dxf = buildPlanDxf({
            solvers: this._solvers,
            sportName,
            bowlConfig: this._getBowlConfig(),
            template: this._currentTemplate,
            runoffFt: runoffDist,
            visualFocalXFt: this._getInputValue('focalX'),
            enabledTiers: [
                !!document.getElementById('enableTier1')?.checked,
                !!document.getElementById('enableTier2')?.checked,
                !!document.getElementById('enableTier3')?.checked
            ],
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
        const sportName = document.getElementById('sportSelect').value;
        const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
        const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
        const offsetCorrection = edgeSports.includes(sportName) ? 0 : (safeWidth / 2);

        const focalXForDetails = this._getInputValue('focalX') || 0;
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
        const config = {
            _version: 'phase5',
            sport: document.getElementById('sportSelect').value,
            setup: {
                customRunoff: this._getCustomRunoff(),
                focalZ: this._getInputValue('focalZ'),
                sightlineVisuals: document.getElementById('toggleSightlinesBtn')?.checked ?? true,
                sectionMetrics: document.getElementById('toggleSectionMetricsBtn')?.checked ?? false
            },
            bowl: {
                type: document.getElementById('bowlType').value,
                cornerRad: this._getInputValue('bowlCornerRad'),
                sideLength: this._getInputValue('bowlSideLength'),
                structuralDepth: this._getInputValue('structuralDepth'),
                clipEnabled: document.getElementById('enableClipPlane')?.checked || false,
                clipAxis: document.getElementById('clipAxis')?.value || 'X',
                clipPosition: this._getInputValue('clipPosition'),
                clipSide: document.getElementById('clipSide')?.value || 'positive'
            },
            occupancy: {
                seatWidth: this._getInputValue('seatWidth'),
                minAisle: parseFloat(document.getElementById('minAisleInput')?.value) || 48,
                maxAisle: parseFloat(document.getElementById('maxAisleInput')?.value) || 72,
                seatsBetweenAisles: this._getInputValue('seatsBetweenAisles'),
                egressFactor: this._getInputValue('egressFactor'),
                showSeatCubes3D: document.getElementById('showSeatCubes3D')?.checked || false
            },
            ui: {
                activeViewTab: document.querySelector('.view-tab-btn.active')?.dataset?.tab || 'profile',
                activeResultsTab: document.querySelector('.results-tab-btn.active')?.dataset?.target || 'statsTab'
            },
            tiers: []
        };
        const tierPrefixes = [['', 'enableTier1', 'profileType'], ['t2', 'enableTier2', 't2ProfileType'], ['t3', 'enableTier3', 't3ProfileType']];
        tierPrefixes.forEach(([prefix, enableId, profileId], i) => {
            const p = prefix || '';
            const pCap = p ? p : '';
            config.tiers.push({
                enabled: document.getElementById(enableId)?.checked || false,
                profileType: document.getElementById(profileId)?.value || 'Parabolic',
                cValue: this._getInputValue(p ? `${p}CValue` : 'cValue'),
                numRows: Math.round(this._getInputValue(p ? `${p}NumRows` : 'numRows')),
                firstRowDist: this._getInputValue(p ? `${p}FirstRowDist` : 'firstRowDist'),
                firstRowElev: this._getInputValue(p ? `${p}FirstRowElev` : 'firstRowElev'),
                treadDepth: this._getInputValue(p ? `${p}TreadDepth` : 'treadDepth'),
                riserHeight: this._getInputValue(p ? `${p}RiserHeight` : 'riserHeight'),
                eyeHeight: this._getInputValue(p ? `${p}EyeHeight` : 'eyeHeight'),
                eyeSetback: this._getInputValue(p ? `${p}EyeSetback` : 'eyeSetback')
            });
        });

        config.bookmarks = this._cameraBookmarks || [];
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
                this._applyConfigObject(config, { logSuccess: true });
            } catch (err) { console.error('Failed to load config:', err); }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset
    }

    _applyStartupProfile() {
        if (this._didApplyStartupProfile || !DEFAULT_STARTUP_PROFILE) return false;
        try {
            const cloned = (typeof structuredClone === 'function')
                ? structuredClone(DEFAULT_STARTUP_PROFILE)
                : JSON.parse(JSON.stringify(DEFAULT_STARTUP_PROFILE));
            this._applyConfigObject(cloned, { logSuccess: false });
            this._didApplyStartupProfile = true;
            return true;
        } catch (err) {
            console.error('Failed to apply startup profile:', err);
            return false;
        }
    }

    _applyConfigObject(config, options = {}) {
        if (!config || typeof config !== 'object') return;
        const { logSuccess = false } = options;

        if (config.sport) {
            document.getElementById('sportSelect').value = config.sport;
            this._onSportChange();
        }
        if (config.setup) {
            if (config.setup.focalZ !== undefined) this._setInputValue('focalZ', config.setup.focalZ);
            if (config.setup.customRunoff !== null && config.setup.customRunoff !== undefined) {
                document.getElementById('customRunoffInput').value = config.setup.customRunoff;
                document.getElementById('customRunoffSlider').value = config.setup.customRunoff;
            } else {
                const runoffInput = document.getElementById('customRunoffInput');
                const runoffSlider = document.getElementById('customRunoffSlider');
                if (runoffInput) runoffInput.value = '';
                if (runoffSlider && this._currentTemplate) runoffSlider.value = this._currentTemplate.runoff || 0;
            }
            const sightlinesEl = document.getElementById('toggleSightlinesBtn');
            if (sightlinesEl && config.setup.sightlineVisuals !== undefined) {
                sightlinesEl.checked = !!config.setup.sightlineVisuals;
                const sightlinesElField = document.getElementById('toggleSightlinesBtnField');
                if (sightlinesElField) sightlinesElField.checked = sightlinesEl.checked;
            }
            const sectionMetricsEl = document.getElementById('toggleSectionMetricsBtn');
            if (sectionMetricsEl && config.setup.sectionMetrics !== undefined) {
                sectionMetricsEl.checked = !!config.setup.sectionMetrics;
            }
        }
        if (config.bowl) {
            if (config.bowl.type) {
                const normalizedBowlType = config.bowl.type === 'Side2' ? 'Side1' : config.bowl.type;
                const bowlTypeEl = document.getElementById('bowlType');
                if (bowlTypeEl) {
                    bowlTypeEl.value = normalizedBowlType;
                    const sideRow = document.getElementById('sideLengthRow');
                    if (sideRow) sideRow.style.display = normalizedBowlType.includes('Side') ? 'flex' : 'none';
                }
            }
            if (config.bowl.cornerRad !== undefined) this._setInputValue('bowlCornerRad', config.bowl.cornerRad);
            if (config.bowl.sideLength !== undefined) this._setInputValue('bowlSideLength', config.bowl.sideLength);
            if (config.bowl.structuralDepth !== undefined) this._setInputValue('structuralDepth', config.bowl.structuralDepth);
            const clipEl = document.getElementById('enableClipPlane');
            if (clipEl && config.bowl.clipEnabled !== undefined) {
                clipEl.checked = config.bowl.clipEnabled;
                document.getElementById('clipPlaneControls').style.display = config.bowl.clipEnabled ? 'block' : 'none';
            }
            if (config.bowl.clipAxis) document.getElementById('clipAxis').value = config.bowl.clipAxis;
            if (config.bowl.clipPosition !== undefined) this._setInputValue('clipPosition', config.bowl.clipPosition);
            if (config.bowl.clipSide) document.getElementById('clipSide').value = config.bowl.clipSide;
        }
        if (config.occupancy) {
            if (config.occupancy.seatWidth !== undefined) this._setInputValue('seatWidth', config.occupancy.seatWidth);
            if (config.occupancy.minAisle !== undefined) this._setInputValue('minAisle', config.occupancy.minAisle);
            if (config.occupancy.maxAisle !== undefined) this._setInputValue('maxAisle', config.occupancy.maxAisle);
            if (config.occupancy.seatsBetweenAisles !== undefined) this._setInputValue('seatsBetweenAisles', config.occupancy.seatsBetweenAisles);
            if (config.occupancy.egressFactor !== undefined) this._setInputValue('egressFactor', config.occupancy.egressFactor);
            if (config.occupancy.showSeatCubes3D !== undefined) {
                const showSeatCubes3D = document.getElementById('showSeatCubes3D');
                if (showSeatCubes3D) showSeatCubes3D.checked = !!config.occupancy.showSeatCubes3D;
            }
        }
        if (config.tiers && config.tiers.length) {
            // Loaded tier values should be treated as user-defined and preserved across enable/disable toggles.
            this._tier2Initialized = false;
            this._tier3Initialized = false;
            const prefixes = ['', 't2', 't3'];
            const enableIds = ['enableTier1', 'enableTier2', 'enableTier3'];
            const profileIds = ['profileType', 't2ProfileType', 't3ProfileType'];
            config.tiers.forEach((t, i) => {
                if (i >= 3) return;
                const p = prefixes[i];
                document.getElementById(enableIds[i]).checked = t.enabled;
                document.getElementById(profileIds[i]).value = t.profileType || 'Parabolic';
                this._setInputValue(p ? `${p}CValue` : 'cValue', t.cValue);
                this._setInputValue(p ? `${p}NumRows` : 'numRows', t.numRows);
                this._setInputValue(p ? `${p}FirstRowDist` : 'firstRowDist', t.firstRowDist);
                this._setInputValue(p ? `${p}FirstRowElev` : 'firstRowElev', t.firstRowElev);
                this._setInputValue(p ? `${p}TreadDepth` : 'treadDepth', t.treadDepth);
                this._setInputValue(p ? `${p}RiserHeight` : 'riserHeight', t.riserHeight);
                this._setInputValue(p ? `${p}EyeHeight` : 'eyeHeight', t.eyeHeight);
                this._setInputValue(p ? `${p}EyeSetback` : 'eyeSetback', t.eyeSetback);

                if (i === 1) this._tier2Initialized = true;
                if (i === 2) this._tier3Initialized = true;
            });
        }

        if (config.bookmarks && Array.isArray(config.bookmarks)) {
            this._cameraBookmarks = config.bookmarks;
            if (typeof this._renderCameraBookmarks === 'function') {
                this._renderCameraBookmarks();
            }
        }

        this._scheduleUpdate();
        if (config.ui) {
            const { activeViewTab, activeResultsTab } = config.ui;
            requestAnimationFrame(() => {
                if (activeViewTab && ['profile', 'field', 'scene3d'].includes(activeViewTab)) {
                    this._switchViewTab(activeViewTab);
                }
                if (activeResultsTab) {
                    const btn = document.querySelector(`.results-tab-btn[data-target="${activeResultsTab}"]`);
                    if (btn) btn.click();
                }
            });
        }

        if (logSuccess) {
            console.log('Configuration loaded successfully');
        }
    }

    // ========== HELPER: Get standard bowl config ==========
    _getBowlConfig() {
        const clipEnabled = document.getElementById('enableClipPlane')?.checked || false;
        const clipCfg = clipEnabled ? { enabled: true, axis: document.getElementById('clipAxis')?.value || 'X', position: this._getInputValue('clipPosition') || 0, side: document.getElementById('clipSide')?.value || 'positive' } : { enabled: false };
        return {
            width: this._currentTemplate.field_width,
            length: this._currentTemplate.field_length,
            shape: this._currentTemplate.shape,
            radius_arc: this._currentTemplate.field_radius,
            arc_angle: this._currentTemplate.arc_angle,
            type: document.getElementById('bowlType').value,
            corner: 'Chamfer',
            radius: this._getInputValue('bowlCornerRad'),
            sideLength: this._getInputValue('bowlSideLength'),
            structuralDepth: this._getInputValue('structuralDepth') || 0,
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

        const sportName = document.getElementById('sportSelect')?.value || '';
        const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
        const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
        const offsetCorrection = edgeSports.includes(sportName) ? 0 : (safeWidth / 2);
        const outerOffset = maxRowX - offsetCorrection;

        const cfgNoClip = { ...bowlConfig, clip: { enabled: false } };
        const bounds = this._computeBowlBounds(cfgNoClip, outerOffset);
        if (!bounds) return;

        const axis = (document.getElementById('clipAxis')?.value || 'X').toUpperCase();
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
        if (clamped !== curr) this._setInputValue('clipPosition', clamped);
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
    _saveCameraBookmark() {
        if (!this.scene3D || !this.scene3D.camera || !this.scene3D.controls || !this.scene3D.renderer) return;
        const cam = this.scene3D.camera;
        const ctrl = this.scene3D.controls;

        // Capture what the user currently sees as a 100x100 thumbnail.
        this.scene3D.renderer.render(this.scene3D.scene, this.scene3D.camera);
        const thumbnail = this._captureBookmarkThumbnail(150, 150);

        const bm = {
            name: `View ${this._cameraBookmarks.length + 1}`,
            position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            target: { x: ctrl.target.x, y: ctrl.target.y, z: ctrl.target.z },
            thumbnail
        };
        this._cameraBookmarks.push(bm);
        this._renderCameraBookmarks();
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

    _renderCameraBookmarks() {
        // Clean up any orphaned dropdowns attached to the body
        document.querySelectorAll('body > .cam-bookmark-dropdown').forEach(d => d.remove());

        const list = document.getElementById('cameraBookmarksList');
        if (!list) return;
        list.innerHTML = '';

        this._cameraBookmarks.forEach((bm, i) => {
            const card = document.createElement('div');
            card.className = 'cam-bookmark-card';
            card.setAttribute('role', 'button');
            card.tabIndex = 0; card.innerHTML = `
                <img class="cam-bookmark-image" src="${bm.thumbnail || ''}" alt="${bm.name}">
                <div class="cam-bookmark-label">${bm.name}</div>
                <div class="cam-bookmark-menu-wrapper">
                    <button type="button" class="cam-bookmark-menu-btn" title="Options">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="5" r="1.5"></circle>
                            <circle cx="12" cy="12" r="1.5"></circle>
                            <circle cx="12" cy="19" r="1.5"></circle>
                        </svg>
                    </button>
                    <div class="cam-bookmark-dropdown" style="display:none;">
                        <button type="button" class="cam-bookmark-rename">Rename</button>
                        <button type="button" class="cam-bookmark-export">Export Image</button>
                        <button type="button" class="cam-bookmark-remove">Delete</button>
                    </div>
                </div>
            `;

            const menuBtn = card.querySelector('.cam-bookmark-menu-btn');
            const dropdown = card.querySelector('.cam-bookmark-dropdown');
            const renameBtn = card.querySelector('.cam-bookmark-rename');
            const exportBtn = card.querySelector('.cam-bookmark-export');
            const deleteBtn = card.querySelector('.cam-bookmark-remove');

            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.cam-bookmark-dropdown').forEach(d => {
                    if (d !== dropdown) d.style.display = 'none';
                });
                if (dropdown.style.display === 'none') {
                    // Start rendering so we can get its dimensions
                    dropdown.style.visibility = 'hidden';
                    dropdown.style.display = 'flex';

                    // Temporarily move the dropdown to the document body to escape the card's CSS transform bounds
                    document.body.appendChild(dropdown);

                    const cardRect = card.getBoundingClientRect();
                    const dropWidth = dropdown.offsetWidth;

                    // Push the menu up above the thumbnail, centered horizontally with the card's left/right boundaries
                    const alignLeft = cardRect.left + (cardRect.width / 2) - (dropWidth / 2);

                    dropdown.style.bottom = (window.innerHeight - cardRect.top + 8) + 'px';
                    dropdown.style.left = alignLeft + 'px';

                    dropdown.style.top = 'auto'; // ensure it uses bottom alignment
                    dropdown.style.right = 'auto'; // ensure it uses left alignment

                    dropdown.style.visibility = 'visible';
                } else {
                    dropdown.style.display = 'none';
                }
            });

            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                const newName = prompt("Rename view:", bm.name);
                if (newName && newName.trim() !== "") {
                    bm.name = newName.trim();
                    this._renderCameraBookmarks();
                }
            });

            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                restore();
                setTimeout(() => {
                    this._export3DImage(bm.name);
                }, 50);
            });

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                this._cameraBookmarks.splice(i, 1);
                this._renderCameraBookmarks();
            });


            const restore = () => {
                if (!this.scene3D) return;
                this.scene3D.camera.position.set(bm.position.x, bm.position.y, bm.position.z);
                this.scene3D.controls.target.set(bm.target.x, bm.target.y, bm.target.z);
                this.scene3D.controls.update();
            };

            card.addEventListener('click', (e) => {
                if (e.target.closest('.cam-bookmark-menu-wrapper')) return;
                restore();
            });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    restore();
                }
            });

            list.appendChild(card);
        });

        const closeDropdowns = () => {
            document.querySelectorAll('.cam-bookmark-dropdown').forEach(d => {
                d.style.display = 'none';
            });
        };
        document.removeEventListener('click', this._globalBookmarkMenuCloser);
        this._globalBookmarkMenuCloser = closeDropdowns;
        document.addEventListener('click', this._globalBookmarkMenuCloser);
    }

    _export3DImage(viewName = null) {
        if (!this.scene3D || !this.scene3D.renderer) return;
        this.scene3D.renderer.render(this.scene3D.scene, this.scene3D.camera);
        const dataUrl = this.scene3D.renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        const sportName = document.getElementById('sportSelect').value;
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

// 3. Results Panel Tabs
document.addEventListener('DOMContentLoaded', () => {
    const tabBtns = document.querySelectorAll('.results-tab-btn');
    const tabPanels = document.querySelectorAll('.results-tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            // Add active class to clicked button and target panel
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            const targetPanel = document.getElementById(targetId);
            if (targetPanel) {
                targetPanel.classList.add('active');
                targetPanel.scrollTop = 0;
            }

            // Expand the sidebar if it was collapsed
            const rightSidebar = document.querySelector('.right-sidebar');
            if (rightSidebar && rightSidebar.classList.contains('collapsed')) {
                rightSidebar.classList.remove('collapsed');
                setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
            }
        });
    });
});

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

// Boot
const app = new App();
app.init().catch(err => console.error('App init failed:', err));
