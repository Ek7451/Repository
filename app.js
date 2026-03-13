/**
 * App Controller - Main application logic
 * Wires inputs to solvers → renderers with debounced updates.
 */

import { SPORTS_TEMPLATES, getSportNames, getTemplate } from './sports-templates.js';
import { ProfileSolver } from './profile-solver.js?v=4';
import { SightlineAnalyzer, getCValueQuality } from './sightline-calc.js';
import { FieldRenderer } from './field-renderer.js?v=19';
import { ProfileRenderer } from './profile-renderer.js?v=4';
import { DEFAULT_STARTUP_PROFILE } from './default-starting-profile.js?v=1';
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
        const solvers = this._solvers || (this._solver ? [this._solver] : []);
        if (!solvers.length || !solvers[0].rows || solvers[0].rows.length === 0) return;

        // Aggregate rows for STATISTICS (excluding first row of each tier)
        const rowsForStats = [];
        // Only include rows from Tiers that actually have rows
        for (const s of solvers) {
            if (s.rows && s.rows.length > 0) {
                // For statistics, we might want to include the first row?
                // Original logic excluded index 0. Let's keep that for now.
                if (s.rows.length > 1) rowsForStats.push(...s.rows.slice(1));
                else rowsForStats.push(s.rows[0]); // If only 1 row, use it?
            }
        }

        let stats = null;
        let dist = { Excellent: 0, Good: 0, Acceptable: 0, Poor: 0 };
        let totalRows = 0;
        let minC_Display = "0.00";
        let maxC_Display = "0.00";
        let avgC_Display = "0.00";

        // Only analyze if we have valid rows
        if (rowsForStats.length > 0) {
            const analyzer = new SightlineAnalyzer(
                rowsForStats,
                this._getInputValue('focalX'),
                this._getInputValue('focalZ')
            );
            analyzer.analyze();
            stats = analyzer.getStatistics();

            if (stats) {
                dist = stats.qualityDistribution;
                totalRows = stats.totalRows;
                minC_Display = stats.minC.toFixed(2);
                maxC_Display = stats.maxC.toFixed(2);
                avgC_Display = stats.avgC.toFixed(2);
            }
        }

        const statsEl = document.getElementById('statsContent');
        const detailsEl = document.getElementById('detailsContent');
        if (!statsEl) return;

        let openTiers = [];
        if (detailsEl) {
            detailsEl.querySelectorAll('.results-details:not(.collapsed)').forEach(el => {
                const tc = Array.from(el.classList).find(c => c.startsWith('tier-section-'));
                if (tc) openTiers.push(tc);
            });
        }

        // Calculate percentages
        const pExc = totalRows > 0 ? (dist.Excellent / totalRows) * 100 : 0;
        const pGood = totalRows > 0 ? (dist.Good / totalRows) * 100 : 0;
        const pAcc = totalRows > 0 ? (dist.Acceptable / totalRows) * 100 : 0;
        const pPoor = totalRows > 0 ? (dist.Poor / totalRows) * 100 : 0;

        // Cumulative for gradient
        const c1 = pExc;
        const c2 = c1 + pGood;
        const c3 = c2 + pAcc;

        const gradient = `conic-gradient(
            #7aae1a 0% ${c1}%,
            #37996e ${c1}% ${c2}%,
            #de850a ${c2}% ${c3}%,
            #d1433d ${c3}% 100%
        )`;
        // Compute total rise/depth across all solvers
        let maxZ = 0, minX = Infinity, maxX = -Infinity;

        for (const s of solvers) {
            if (!s.rows || s.rows.length === 0) continue;
            const last = s.rows[s.rows.length - 1];
            const first = s.rows[0];
            maxZ = Math.max(maxZ, last.z);
            minX = Math.min(minX, first.x - s.treadDepthFt);
            maxX = Math.max(maxX, last.x);
        }
        const totalHeight = maxZ.toFixed(1);
        const totalDistVal = (maxX > -Infinity) ? maxX.toFixed(1) : "0.0";

        // --- Occupancy Logic ---
        const egressParams = this._getEgressParams();
        const bowlConfig = this._getBowlConfig();

        // Base Offset Logic removed in favor of offsetCorrection
        const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
        const sportName = document.getElementById('sportSelect').value;
        const isEdgeSport = edgeSports.includes(sportName);
        const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
        const offsetCorrection = isEdgeSport ? 0 : (safeWidth / 2);
        const tierLayoutByIndex = new Map((this._tierAisleLayouts || []).map(layout => [
            Math.max(0, Math.floor(Number(layout && layout.tierIndex) || 0)),
            layout
        ]));

        const reconcileTierMetricsForDisplay = (solver, loopIndex, metrics) => {
            if (!metrics) return metrics;
            const tierIdx = solver && solver.tierIndex !== undefined ? solver.tierIndex : loopIndex;
            const layout = tierLayoutByIndex.get(Math.max(0, Math.floor(Number(tierIdx) || 0)));
            const summary = layout && layout.sectionSummary;
            if (!summary) return metrics;

            const out = { ...metrics };
            const actualSections = Math.max(0, Math.floor(Number(summary.actualSections) || 0));
            const actualAisles = Math.max(0, Math.floor(Number(summary.actualAisles) || 0));
            const avgBackRowSeats = Number(summary.avgBackRowSeatsPerSection);
            const egressFactorVal = Number(egressParams && egressParams.egressFactor);
            const totalCapacity = Math.max(0, Number(metrics.capacity) || 0);
            const useClosedLoopReconcile = summary.allSectionPathsClosed === true;

            if (useClosedLoopReconcile && actualSections > 0) {
                out.numSections = actualSections;
                // Closed bowl paths produce one section per aisle strip in the plan layout.
                out.numAisles = actualAisles > 0 ? actualAisles : actualSections;

                if (Number.isFinite(avgBackRowSeats)) {
                    out.seatsPerBlock = avgBackRowSeats.toFixed(1);
                }

                const avgOccupantsPerSection = totalCapacity / actualSections;
                out.occupantsPerSection = Math.round(avgOccupantsPerSection);
                const aisleLoad = actualSections <= 1 ? (avgOccupantsPerSection * 0.5) : avgOccupantsPerSection;
                out.occupantsPerAisleLine = Math.round(aisleLoad);

                if (Number.isFinite(egressFactorVal)) {
                    out.capacityWidth = (aisleLoad * egressFactorVal).toFixed(1);
                }
            }

            return out;
        };

        let totalOcc = 0;
        let tierData = [];

        solvers.forEach((s, i) => {
            try {
                const baseMetrics = ProfileSolver.calculateTierMetrics(s, bowlConfig, this.fieldRenderer, egressParams, offsetCorrection);
                const metrics = reconcileTierMetricsForDisplay(s, i, baseMetrics);

                if (metrics) {
                    totalOcc += metrics.capacity;
                    const label = `Tier ${i + 1}`;
                    const color = i === 0 ? 'var(--accent-blue)' : (i === 1 ? 'var(--accent-cyan)' : 'var(--accent-purple)');

                    tierData.push({ label, capacity: metrics.capacity, color });
                }
            } catch (e) {
                console.error('Error in occupancy calc:', e);
            }
        });

        let occSegments = '';
        let occLegends = '';

        if (totalOcc > 0) {
            tierData.forEach(tier => {
                const pct = (tier.capacity / totalOcc) * 100;
                occSegments += `<div style="width:${pct}%; background:${tier.color}; height:100%;"></div>`;
                occLegends += `<div class="occ-legend-item"><span style="color:${tier.color}; font-size: 14px; margin-right: 4px;">&#9679;</span>${tier.label}: <strong>${tier.capacity.toLocaleString()}</strong></div>`;
            });
        }

        const occBreakdownHTML = `
            <div class="occupancy-bar-container">
                <div class="occupancy-stacked-bar">
                    ${occSegments}
                </div>
                <div class="occupancy-legend-row">
                    ${occLegends}
                </div>
            </div>
        `;

        // --- SVG Pie Chart Generation ---
        const chartData = [
            { label: 'Excellent', count: dist.Excellent, color: '#7aae1a' },
            { label: 'Good', count: dist.Good, color: '#37996e' },
            { label: 'Acceptable', count: dist.Acceptable, color: '#de850a' },
            { label: 'Poor', count: dist.Poor, color: '#d1433d' }
        ];

        let totalPoints = (dist.Excellent || 0) + (dist.Good || 0) + (dist.Acceptable || 0) + (dist.Poor || 0);
        let cumulativePercent = 0;
        let svgPaths = '';

        const fullSegment = chartData.find(s => totalPoints > 0 && (s.count / totalPoints) > 0.999);

        if (fullSegment) {
            svgPaths = `<circle cx="50" cy="50" r="41" fill="none" stroke="${fullSegment.color}" stroke-width="18" class="chart-segment">
                            <title>${fullSegment.label}: ${fullSegment.count} (100.0%)</title>
                         </circle>`;

        } else if (totalPoints > 0) {
            chartData.forEach(segment => {
                if (segment.count === 0) return;
                const percent = segment.count / totalPoints;
                if (percent >= 0.999) return;

                const startPercent = cumulativePercent;
                const endPercent = cumulativePercent + percent;
                cumulativePercent += percent;

                const x1 = Math.cos(2 * Math.PI * startPercent);
                const y1 = Math.sin(2 * Math.PI * startPercent);
                const x2 = Math.cos(2 * Math.PI * endPercent);
                const y2 = Math.sin(2 * Math.PI * endPercent);

                const largeArcFlag = percent > 0.5 ? 1 : 0;
                const r = 50; const cx = 50; const cy = 50; const rIn = 32;

                const sx = cx + r * x1; const sy = cy + r * y1;
                const ex = cx + r * x2; const ey = cy + r * y2;
                const sxIn = cx + rIn * x1; const syIn = cy + rIn * y1;
                const exIn = cx + rIn * x2; const eyIn = cy + rIn * y2;

                const d = [
                    `M ${sx} ${sy}`,
                    `A ${r} ${r} 0 ${largeArcFlag} 1 ${ex} ${ey}`,
                    `L ${exIn} ${eyIn}`,
                    `A ${rIn} ${rIn} 0 ${largeArcFlag} 0 ${sxIn} ${syIn}`,
                    `Z`
                ].join(' ');

                svgPaths += `<path d="${d}" fill="${segment.color}" class="chart-segment" stroke="white" stroke-width="1">
                                <title>${segment.label}: ${segment.count} (${(percent * 100).toFixed(1)}%)</title>
                             </path>`;
            });
        } else {
            svgPaths = `<circle cx="50" cy="50" r="41" stroke="#e2e8f0" stroke-width="18" fill="none" />`;
        }

        const pieChartSVG = `
            <div class="pie-chart-container">
                <svg viewBox="0 0 100 100" class="pie-chart-svg">
                    ${svgPaths}
                </svg>
                <div class="chart-center-text">
                    <div class="chart-center-value">${avgC_Display}</div>
                    <div class="chart-center-label">Avg C</div>
                </div>
            </div>
            
            <div class="chart-legend">
                <div class="legend-item">
                    <div class="legend-color" style="background:#7aae1a"></div>
                    <div class="legend-text">
                        <span class="legend-label">Excellent</span>
                        <span class="legend-range">≥ 4.75"</span>
                    </div>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background:#37996e"></div>
                    <div class="legend-text">
                        <span class="legend-label">Good</span>
                        <span class="legend-range">3.5 - 4.71"</span>
                    </div>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background:#de850a"></div>
                    <div class="legend-text">
                        <span class="legend-label">Acceptable</span>
                        <span class="legend-range">2.4 - 3.5"</span>
                    </div>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background:#d1433d"></div>
                    <div class="legend-text">
                        <span class="legend-label">Poor</span>
                        <span class="legend-range">< 2.4"</span>
                    </div>
                </div>
            </div>
        `;


        // Build per-tier row tables
        let rowTableHTML = '';
        const focalXForDetails = this._getInputValue('focalX') || 0;
        const isMirroredSidesMode = String(bowlConfig && bowlConfig.type ? bowlConfig.type : '').toLowerCase() === 'sides';
        for (let t = 0; t < solvers.length; t++) {
            const s = solvers[t];
            if (!s.rows) continue;

            const tierIdx = (s.tierIndex !== undefined) ? s.tierIndex : t;
            const title = `Tier ${tierIdx + 1} Details`;
            // tier-section class for color consistency
            const tierClass = `tier-section-${tierIdx + 1}`;

            // Add 'results-details' class 
            const isColl = openTiers.includes(tierClass) ? '' : 'collapsed';
            rowTableHTML += `<div class="collapsible ${isColl} ${tierClass} results-details">
                <div class="section-header">
                    ${title}
                </div>
                <div class="section-body">
                    <div class="row-table-header">
                        <span>Row</span><span>Riser</span><span>Elev</span><span>C-Value</span><span>Tread</span><span>Dist→Focal</span><span>Angle</span><span>Length</span><span>Seats</span>
                    </div>`;

            rowTableHTML += s.rows.map((row, idx) => {
                const isFirst = idx === 0;
                let cValDisplay = "N/A";
                let colorStyle = "";

                if (!isFirst) {
                    const q = getCValueQuality(row.c_value);
                    cValDisplay = `${row.c_value.toFixed(2)}"`;
                    colorStyle = `style="color:${q.color}"`;
                } else {
                    colorStyle = `style="color:var(--text-muted)"`;
                }

                const isTier1FirstRow = tierIdx === 0 && isFirst;
                const riserInches = isTier1FirstRow ? (row.z * 12) : (row.riser_height * 12);
                let riserStyle = "";
                if (!isTier1FirstRow && riserInches >= 22) {
                    riserStyle = `style="color: #ef4444; font-weight: bold;" title="Riser is 22 inches or greater!"`;
                }
                const treadInches = (row.tread_depth || 0) * 12;
                const distToFocalFt = (row.x - row.tread_depth) - focalXForDetails;
                const sightlineDeg = row.sightline_angle || 0;
                const rowLengthDisplay = isMirroredSidesMode && Number.isFinite(row.computedLengthPerSide)
                    ? `${(row.computedLength || 0).toFixed(0)}' (${(row.computedLengthPerSide || 0).toFixed(0)}'/side)`
                    : `${(row.computedLength || 0).toFixed(0)}'`;
                const rowSeatsDisplay = isMirroredSidesMode && Number.isFinite(row.computedSeatsPerSide)
                    ? `${(row.computedSeats || 0).toLocaleString()} (${(row.computedSeatsPerSide || 0).toLocaleString()}/side)`
                    : `${(row.computedSeats || 0).toLocaleString()}`;

                return `<div class="row-table-row">
                    <span>${row.row_number}</span>
                    <span ${riserStyle}>${riserInches.toFixed(2)}"</span>
                    <span>${row.z.toFixed(2)}'</span>
                    <span ${colorStyle}>${cValDisplay}</span>
                    <span>${treadInches.toFixed(2)}"</span>
                    <span>${distToFocalFt.toFixed(2)}'</span>
                    <span>${sightlineDeg.toFixed(2)}°</span>
                    <span style="color:var(--text-secondary)">${rowLengthDisplay}</span>
                    <span style="color:var(--text-secondary)">${rowSeatsDisplay}</span>
                </div>`;
            }).join('');

            rowTableHTML += `</div></div>`;
        }

        statsEl.innerHTML = `
            <div class="results-summary-container">
            
                <div class="total-occupancy-label" style="text-align: center; margin-bottom: 4px; margin-top: 0;">C-VALUE ANALYSIS</div>
                <!-- 1. SVG Pie Chart -->
                <div class="visuals-col-chart">
                    ${pieChartSVG}
                </div>
                
                <!-- 2. Occupancy -->
                <div class="occupancy-section">
                    <div class="total-occupancy-label">TOTAL OCCUPANCY</div>
                    <div class="total-occupancy">${totalOcc.toLocaleString()}</div>
                    <div class="occupancy-breakdown">
                        ${occBreakdownHTML}
                    </div>

                    <div class="results-divider" style="margin: 24px 0;"></div>

                    <!-- Egress / Linear Stats (New) -->
                    <div class="total-occupancy-label" style="margin-bottom: 16px;">EGRESS ANALYSIS</div>
                    <div class="egress-metrics-container">
                        ${(() => {
                let html = '';
                let originalEgressHtml = '';
                solvers.forEach((s, i) => {
                    const baseMetrics = ProfileSolver.calculateTierMetrics(s, bowlConfig, this.fieldRenderer, egressParams, offsetCorrection);
                    const metrics = reconcileTierMetricsForDisplay(s, i, baseMetrics);
                    if (!metrics) return;

                    const tierLabel = `TIER ${i + 1}`;

                    const aislesIcon = `<svg class="tier-metric-icon icon-aisles" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 10,2 10,20 6,22"/><polygon points="14,2 18,4 18,22 14,20"/></svg>`;
                    const widthIcon = `<svg class="tier-metric-icon icon-width" viewBox="0 0 24 24" fill="currentColor"><path d="M8 8l-4 4 4 4v-3h8v3l4-4-4-4v3H8V8z M4 4v16h2V4H4z M18 4v16h2V4h-2z"/></svg>`;
                    const sectionsIcon = `<svg class="tier-metric-icon icon-sections" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v16H4z M12 4h8v7h-8z M12 13h8v7h-8z" /></svg>`;
                    const seatsIcon = `<svg class="tier-metric-icon icon-seats" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 012-2h6a2 2 0 012 2v10H7V4z"/><rect x="3" y="14" width="18" height="5" rx="2.5"/></svg>`;
                    const avgSeatsIcon = `<svg class="tier-metric-icon icon-avg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M1 12h8v2H1z M9.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M8 12h8v2H8z M16.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M15 12h8v2h-8z"/></svg>`;
                    const loadIcon = `<svg class="tier-metric-icon icon-load" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>`;
                    const totalLen = parseFloat(metrics.totalRowLength) || 0;
                    const seatLen = parseFloat(metrics.totalSeatingLength) || 0;
                    const aisleLen = parseFloat(metrics.totalAisleLength) || 0;
                    const isMirroredSides = Math.max(1, Math.floor(Number(metrics.mirroredSideRuns) || 1)) > 1;
                    const mirrorRuns = Math.max(1, Math.floor(Number(metrics.mirroredSideRuns) || 1));
                    const displayAisles = isMirroredSides ? ((Math.max(0, Number(metrics.numAisles) || 0)) * mirrorRuns) : metrics.numAisles;
                    const displaySections = isMirroredSides ? ((Math.max(0, Number(metrics.numSections) || 0)) * mirrorRuns) : metrics.numSections;
                    const displayTotalLen = isMirroredSides ? (totalLen * mirrorRuns) : totalLen;
                    const displaySeatLen = isMirroredSides ? (seatLen * mirrorRuns) : seatLen;
                    const displayAisleLen = isMirroredSides ? (aisleLen * mirrorRuns) : aisleLen;
                    const displaySeatsPerRow = isMirroredSides
                        ? Math.round((Number(metrics.seatsPerRow) || 0) * mirrorRuns)
                        : Math.round(Number(metrics.seatsPerRow) || 0);
                    const perSideTag = '';
                    const countsTag = isMirroredSides ? ' (both sides)' : '';
                    const perSideMirrorNote = isMirroredSides ? ' Counts and linear quantities shown combined for both sides. Width/load checks remain per aisle.' : '';

                    let warningHTML = '';
                    if (metrics.blocksAddedForEgress > 0) {
                        const warnText = `Limit Forced: Clamped to Max Aisle (${metrics.maximumWidth}")`;
                        warningHTML = `<div class="tier-metrics-warning">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                            ${warnText}
                        </div>`;
                    } else if (!metrics.converged) {
                        warningHTML = `<div class="tier-metrics-warning">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                             Warning: Layout did not converge.
                         </div>`;
                    }

                    html += `
                        <div class="tier-metrics-card tier-${i + 1}">
                            <div class="tier-metrics-header tier-${i + 1}">${tierLabel}${isMirroredSides ? ' • Both Sides' : ''}</div>
                            
                            <div class="tier-metrics-grid">
                                <div class="tier-metric-item">
                                    <div class="tier-metric-label">Aisles${countsTag}</div>
                                    <div class="tier-metric-content">
                                        ${aislesIcon}
                                        <div class="tier-metric-value">${displayAisles}</div>
                                    </div>
                                </div>
                                <div class="tier-metric-item">
                                    <div class="tier-metric-label">Required Width</div>
                                    <div class="tier-metric-content">
                                        ${widthIcon}
                                        <div class="tier-metric-value">${metrics.capacityWidth}<span class="small-text">"</span></div>
                                    </div>
                                </div>
                                <div class="tier-metric-item">
                                    <div class="tier-metric-label">Sections${countsTag}</div>
                                    <div class="tier-metric-content">
                                        ${sectionsIcon}
                                        <div class="tier-metric-value">${displaySections}</div>
                                    </div>
                                </div>
                                <div class="tier-metric-item">
                                    <div class="tier-metric-label">Seats/Section${perSideTag}</div>
                                    <div class="tier-metric-content">
                                        ${seatsIcon}
                                        <div class="tier-metric-value">${metrics.occupantsPerSection}</div>
                                    </div>
                                </div>
                                <div class="tier-metric-item">
                                    <div class="tier-metric-label">Avg. Seats/Row${perSideTag}</div>
                                    <div class="tier-metric-content">
                                        ${avgSeatsIcon}
                                        <div class="tier-metric-value">${metrics.seatsPerBlock}</div>
                                    </div>
                                </div>
                                <div class="tier-metric-item">
                                    <div class="tier-metric-label">Max Load/Aisle${perSideTag}</div>
                                    <div class="tier-metric-content">
                                        ${loadIcon}
                                        <div class="tier-metric-value">${metrics.occupantsPerAisleLine} <span class="small-text">occ</span></div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="tier-capacity-check">
                                Aisle Egress Capacity (per aisle): ${metrics.occupantsPerAisleLine} occ &times; ${egressParams.egressFactor}"/occ = ${metrics.capacityWidth}" Req.${perSideMirrorNote}
                            </div>
                            ${warningHTML}
                        </div>`;

                    originalEgressHtml += `
                        <div class="collapsible collapsed results-details" style="margin-top: 6px; margin-bottom: 12px;">
                            <div class="section-header" style="font-size: 10px; padding: 6px 8px; font-weight: 500;">
                                Original Egress Calc (${tierLabel}${isMirroredSides ? ' • Both Sides (Combined Counts)' : ''})
                            </div>
                            <div class="section-body" style="padding: 8px;">
                                <div class="egress-tier-row compact">
                                    <div class="egress-row-top">
                                        <div class="tier-label-group">
                                            <span class="tier-label">${tierLabel}</span>
                                            <span class="tier-pct" style="color:var(--accent-green)">${totalLen > 0 ? ((seatLen / totalLen) * 100).toFixed(0) : 0}% Seating</span>
                                            <span class="tier-pct-sep">/</span>
                                            <span class="tier-pct" style="color:var(--accent-red)">${totalLen > 0 ? ((aisleLen / totalLen) * 100).toFixed(0) : 0}% Egress</span>
                                        </div>
                                    </div>
                                    <div class="egress-bar-compact">
                                        <div class="bar-segment-seat" style="width:${totalLen > 0 ? (seatLen / totalLen) * 100 : 0}%"></div>
                                        <div class="bar-segment-aisle" style="width:${totalLen > 0 ? (aisleLen / totalLen) * 100 : 0}%"></div>
                                    </div>
                                    <div class="egress-row-details">
                                        <strong>${displayAisles} Aisles${countsTag}</strong> (Width: ${metrics.aisleWidth}") &bull; ${displaySeatLen.toLocaleString()}' Linear Seating vs ${displayAisleLen.toLocaleString()}' Linear Aisles${isMirroredSides ? ' (combined both sides)' : ''}
                                        <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 4px; line-height: 1.4;">
                                            &#8627; Total Linear Seating${countsTag}: ${displayTotalLen.toLocaleString()}' (averaging ${displaySeatsPerRow} seats/row)<br/>
                                            &#8627; Sections${countsTag}: ${displaySections} (avg ${metrics.seatsPerBlock} seats/row, ${metrics.occupantsPerSection} seats/section)<br/>
                                            &#8627; Max Load/Aisle (per aisle): ${metrics.occupantsPerAisleLine} occ (50/50 section split)<br/>
                                            &#8627; Aisle Egress Capacity Check (per aisle): ${metrics.occupantsPerAisleLine} occ &times; ${egressParams.egressFactor}"/occ = ${metrics.capacityWidth}" required<br/>
                                            ${`&#8627; Aisle Sizing: Max of Min Allowed (${metrics.minimumWidth}") vs Required (${metrics.capacityWidth}") &rarr; <strong style="color:var(--text-primary)">Governing Width = ${metrics.governingWidth}"</strong>` +
                            (metrics.blocksAddedForEgress > 0 ? `<br/><span style="color:var(--accent-orange); display:inline-block; max-width:100%; word-wrap:break-word; padding-top:2px;">&#8627; <strong>Max Width Limit Forced:</strong> Clamped to Max Aisle Width (${metrics.maximumWidth}"). Automatically added ${metrics.blocksAddedForEgress} section(s) to maintain code compliance!</span>` : '')
                        }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                });

                return html + `
                    </div >
                    
                    <div class="collapsible collapsed results-details" style="margin-top: 12px; margin-bottom: 8px;">
                        <div class="section-header" style="font-size: 10px; padding: 6px 8px; font-weight: 500; color: var(--text-muted);">
                            * Code Scope Disclaimer
                        </div>
                        <div class="section-body" style="font-size: 0.75rem; color: var(--text-muted); padding: 8px; line-height: 1.3;">
                            Early stage geometric simplification only. The following code egress requirements are EXCLUDED from current results and must be evaluated in later phases:<br />
                            &bull; 30 ft rules and dead end row access conditions<br />
                            &bull; Vomitory, concourse, door bank, exit stair, discharge capacity and merging flows<br />
                            &bull; Exit loss checks and exit separation<br />
                            &bull; Accessibility and wheelchair locations affecting seating blocks and aisle widths<br />
                            &bull; Handrail and guard encroachment rules
                        </div>
                    </div>
                ` + originalEgressHtml + `
                </div >`;
            })()}
            </div >
        `;

        if (detailsEl) {
            detailsEl.innerHTML = `
                <div class="results-summary-container">
                    <div class="total-occupancy-label" style="text-align: center; margin-bottom: 16px; margin-top: 0;">TIER ROW DETAILS</div>
                    ${rowTableHTML}
                </div>
            `;
        }

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
        const offsetCorrection = this._getRhinoExportOffsetCorrection(bowlConfig);
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
            const model = new rhino.File3dm();
            model.applicationName = 'Seating Bowl Study';
            model.applicationDetails = 'Generated from Seating Bowl Study';

            const settings = model.settings();
            if (settings) {
                settings.modelUnitSystem = rhino.UnitSystem.Feet;
                settings.pageUnitSystem = rhino.UnitSystem.Feet;
                settings.modelAbsoluteTolerance = 0.01;
                settings.modelAngleToleranceRadians = 0.0174533; // 1 degree
                settings.modelRelativeTolerance = 0.01;
            }

            const solvers = this._solvers || (this._solver ? [this._solver] : []);
            const bowlConfig = this._getBowlConfig();
            const offsetCorrection = this._getRhinoExportOffsetCorrection(bowlConfig);
            const tierLayerSets = this._ensureRhinoTierCategoryRhinoLayers(rhino, model, solvers);
            const bowlTierLayerIndices = Array.isArray(tierLayerSets?.bowl) ? tierLayerSets.bowl : [];

            let bowlExportedCount = this._exportRhinoBrepBowl(
                rhino,
                model,
                solvers,
                bowlConfig,
                offsetCorrection,
                bowlTierLayerIndices
            );
            let exportedCount = bowlExportedCount;
            exportedCount += this._exportRhinoAisleBreps(rhino, model, tierLayerSets);
            exportedCount += this._exportRhinoSpectatorsAdaptive(rhino, model, tierLayerSets);

            // Fallback to mesh export only if Brep generation produced nothing.
            // This preserves reliability for unusual configurations while keeping
            // the primary path focused on direct Brep generation from solver data.
            if (bowlExportedCount === 0) {
                console.warn('Direct Brep export produced no geometry, falling back to Rhino mesh export');
                this.scene3D.bowlGroup.children.forEach((mesh, meshIndex) => {
                    const rhinoMesh = this._createRhinoMeshFromThreeMesh(rhino, mesh);
                    if (!rhinoMesh) return;
                    const tierIndex = this._getRhinoTierIndexFromObject(mesh, meshIndex);
                    const layerIndex = this._getRhinoTierLayerIndex(tierLayerSets, 'bowl', tierIndex, meshIndex);
                    const added = this._addRhinoModelObject(rhino, model, rhinoMesh, '', layerIndex);
                    bowlExportedCount += added;
                    exportedCount += added;
                    if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                });
            }

            if (exportedCount === 0) {
                console.warn('No valid 3D geometry found for Rhino export');
                if (typeof model.destroy === 'function') model.destroy();
                return;
            }

            const bytes = model.toByteArray();
            if (typeof model.destroy === 'function') model.destroy();
            const blob = new Blob([bytes], { type: 'model/vnd.rhino' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const sportName = document.getElementById('sportSelect').value;
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

    _getRhinoExportOffsetCorrection(bowlConfig) {
        const sportName = document.getElementById('sportSelect')?.value || '';
        const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
        const safeWidth = Number.isFinite(bowlConfig?.width) ? bowlConfig.width : 0;
        return edgeSports.includes(sportName) ? 0 : (safeWidth / 2);
    }

    _ensureRhinoTierCategoryRhinoLayers(rhino, model, solvers) {
        const empty = {
            bowl: [],
            aisles: [],
            spectators: [],
            bowlByTierIndex: new Map(),
            aislesByTierIndex: new Map(),
            spectatorsByTierIndex: new Map()
        };

        if (!rhino || !model || typeof model.layers !== 'function') return empty;
        if (!Array.isArray(solvers) || solvers.length === 0) return empty;

        const layerTable = model.layers();
        if (!layerTable || typeof layerTable.add !== 'function') return empty;

        const addLayer = (name) => {
            let layer = null;
            try {
                if (typeof rhino.Layer !== 'function') return undefined;
                layer = new rhino.Layer();
                layer.name = name;
                const idx = layerTable.add(layer);
                const num = Number(idx);
                return Number.isFinite(num) ? num : undefined;
            } catch (_) {
                return undefined;
            } finally {
                if (typeof layer?.destroy === 'function') layer.destroy();
            }
        };

        for (let i = 0; i < solvers.length; i++) {
            const solver = solvers[i];
            const rawTierIndex = Number(solver?.tierIndex);
            const tierIndex = Number.isInteger(rawTierIndex) ? rawTierIndex : i;
            const tierLabel = tierIndex + 1;

            const bowlLayerIndex = addLayer(`Tier ${tierLabel} - Bowl`);
            const aisleLayerIndex = addLayer(`Tier ${tierLabel} - Aisles`);
            const spectatorLayerIndex = addLayer(`Tier ${tierLabel} - Spectators`);

            empty.bowl.push(bowlLayerIndex);
            empty.aisles.push(aisleLayerIndex);
            empty.spectators.push(spectatorLayerIndex);

            empty.bowlByTierIndex.set(tierIndex, bowlLayerIndex);
            empty.aislesByTierIndex.set(tierIndex, aisleLayerIndex);
            empty.spectatorsByTierIndex.set(tierIndex, spectatorLayerIndex);
        }

        return empty;
    }

    _ensureRhinoTierRhinoLayers(rhino, model, solvers) {
        const layers = this._ensureRhinoTierCategoryRhinoLayers(rhino, model, solvers);
        return Array.isArray(layers?.bowl) ? layers.bowl : [];
    }

    _exportRhinoBrepBowl(rhino, model, solvers, bowlConfig, offsetCorrection, tierLayerIndices = []) {
        if (!this.scene3D || typeof this.scene3D._getBowlGeometrySegments !== 'function') {
            throw new Error('3D bowl segment generator is unavailable');
        }
        if (!Array.isArray(solvers) || solvers.length === 0) return 0;

        let count = 0;
        const structuralDepthFt = Math.max(0, (Number(bowlConfig?.structuralDepth) || 0) / 12.0);

        solvers.forEach((solver, idx) => {
            if (!solver || !solver.rows || solver.rows.length === 0) return;
            const tierLayerIndex = Array.isArray(tierLayerIndices) ? tierLayerIndices[idx] : undefined;
            const rawTierIndex = Number(solver?.tierIndex);
            const solverTierIndex = Number.isInteger(rawTierIndex) ? rawTierIndex : idx;

            if (structuralDepthFt > 0 && typeof this.scene3D._buildClosedStructuralProfile === 'function') {
                count += this._exportRhinoTierStructuralBreps(
                    rhino,
                    model,
                    solver,
                    bowlConfig,
                    offsetCorrection,
                    structuralDepthFt,
                    solverTierIndex,
                    tierLayerIndex
                );
                return;
            }

            count += this._exportRhinoTierSeatBreps(
                rhino,
                model,
                solver,
                bowlConfig,
                offsetCorrection,
                solverTierIndex,
                tierLayerIndex
            );
        });

        return count;
    }

    _exportRhinoTierSeatBreps(rhino, model, solver, bowlConfig, offsetCorrection = 0, tierIndex = 0, layerIndex) {
        if (!solver || !solver.rows || solver.rows.length === 0) return 0;

        const pathCache = new Map();
        const getSubpathsForOffset = (offset) => {
            const key = Number(offset).toFixed(6);
            if (!pathCache.has(key)) {
                const raw = this.scene3D._getBowlGeometrySegments(bowlConfig, offset);
                pathCache.set(key, this._parseBowlGeometrySubpaths(raw));
            }
            return pathCache.get(key);
        };

        let count = 0;
        solver.rows.forEach((row) => {
            const zBottom = row.z - row.riser_height;
            const zTop = row.z;
            const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
            const backOffset = row.x - offsetCorrection;

            count += this._addRhinoRuledBrepsBetweenOffsets(
                rhino,
                model,
                getSubpathsForOffset,
                frontOffset,
                zBottom,
                frontOffset,
                zTop,
                `Tier ${tierIndex + 1} Riser`,
                layerIndex
            );

            count += this._addRhinoRuledBrepsBetweenOffsets(
                rhino,
                model,
                getSubpathsForOffset,
                frontOffset,
                zTop,
                backOffset,
                zTop,
                `Tier ${tierIndex + 1} Tread`,
                layerIndex
            );
        });

        return count;
    }

    _exportRhinoTierStructuralBreps(rhino, model, solver, bowlConfig, offsetCorrection = 0, structuralDepthFt = 0, tierIndex = 0, layerIndex) {
        if (!solver || !solver.rows || solver.rows.length === 0) return 0;
        const profile = this.scene3D._buildClosedStructuralProfile(solver, structuralDepthFt, tierIndex);
        if (!Array.isArray(profile) || profile.length < 2) return 0;

        const pathCache = new Map();
        const getSubpathsForOffset = (offset) => {
            const key = Number(offset).toFixed(6);
            if (!pathCache.has(key)) {
                const raw = this.scene3D._getBowlGeometrySegments(bowlConfig, offset);
                pathCache.set(key, this._parseBowlGeometrySubpaths(raw));
            }
            return pathCache.get(key);
        };

        let count = 0;
        for (let i = 0; i < profile.length - 1; i++) {
            const a = profile[i];
            const b = profile[i + 1];
            if (!a || !b) continue;
            if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) continue;

            count += this._addRhinoRuledBrepsBetweenOffsets(
                rhino,
                model,
                getSubpathsForOffset,
                a.x - offsetCorrection,
                a.z,
                b.x - offsetCorrection,
                b.z,
                `Tier ${tierIndex + 1} Structure`,
                layerIndex
            );
        }

        return count;
    }

    _addRhinoRuledBrepsBetweenOffsets(rhino, model, getSubpathsForOffset, offsetA, elevA, offsetB, elevB, objectName = '', layerIndex) {
        const subpathsA = getSubpathsForOffset(offsetA) || [];
        const subpathsB = getSubpathsForOffset(offsetB) || [];
        if (!subpathsA.length || !subpathsB.length) return 0;

        let count = 0;
        const pathCount = Math.min(subpathsA.length, subpathsB.length);
        for (let p = 0; p < pathCount; p++) {
            const pathA = subpathsA[p];
            const pathB = subpathsB[p];
            if (!Array.isArray(pathA) || !Array.isArray(pathB)) continue;

            const segCount = Math.min(pathA.length, pathB.length);
            for (let i = 0; i < segCount; i++) {
                const segA = pathA[i];
                const segB = pathB[i];
                if (!segA || !segB) continue;
                if (!Number.isFinite(segA.x1) || !Number.isFinite(segA.y1) || !Number.isFinite(segA.x2) || !Number.isFinite(segA.y2)) continue;
                if (!Number.isFinite(segB.x1) || !Number.isFinite(segB.y1) || !Number.isFinite(segB.x2) || !Number.isFinite(segB.y2)) continue;

                // Skip zero-area strips.
                const sameStart = Math.abs(segA.x1 - segB.x1) < 1e-9 && Math.abs(segA.y1 - segB.y1) < 1e-9 && Math.abs(elevA - elevB) < 1e-9;
                const sameEnd = Math.abs(segA.x2 - segB.x2) < 1e-9 && Math.abs(segA.y2 - segB.y2) < 1e-9 && Math.abs(elevA - elevB) < 1e-9;
                if (sameStart && sameEnd) continue;

                const curveA = this._createRhinoCurveFromPlanSegment(rhino, segA, elevA);
                const curveB = this._createRhinoCurveFromPlanSegment(rhino, segB, elevB);
                if (!curveA || !curveB) {
                    if (typeof curveA?.destroy === 'function') curveA.destroy();
                    if (typeof curveB?.destroy === 'function') curveB.destroy();
                    continue;
                }

                count += this._addRhinoRuledSurfaceBrep(rhino, model, curveA, curveB, objectName, layerIndex);

                if (typeof curveA.destroy === 'function') curveA.destroy();
                if (typeof curveB.destroy === 'function') curveB.destroy();
            }
        }

        return count;
    }

    _addRhinoRuledSurfaceBrep(rhino, model, curveA, curveB, objectName = '', layerIndex) {
        if (!curveA || !curveB) return 0;

        let surface = null;
        let brep = null;
        try {
            surface = rhino.NurbsSurface.createRuledSurface(curveA, curveB);
            if (!surface) return 0;
            brep = rhino.Brep.createFromSurface(surface);
            if (!brep) return 0;
            return this._addRhinoModelObject(rhino, model, brep, objectName, layerIndex);
        } catch (e) {
            return 0;
        } finally {
            if (typeof surface?.destroy === 'function') surface.destroy();
            if (typeof brep?.destroy === 'function') brep.destroy();
        }
    }

    _addRhinoModelObject(rhino, model, geometry, objectName = '', layerIndex) {
        if (!geometry || !model || typeof model.objects !== 'function') return 0;
        const objectTable = model.objects();
        if (!objectTable) return 0;

        const attrs = (typeof rhino.ObjectAttributes === 'function') ? new rhino.ObjectAttributes() : null;
        if (attrs && objectName) {
            try { attrs.name = objectName; } catch (_) { /* no-op */ }
        }
        if (attrs && Number.isInteger(layerIndex) && layerIndex >= 0) {
            try { attrs.layerIndex = layerIndex; } catch (_) { /* no-op */ }
        }

        try {
            if (typeof objectTable.add === 'function' && attrs) {
                objectTable.add(geometry, attrs);
            } else if (typeof objectTable.add === 'function') {
                objectTable.add(geometry, attrs);
            } else if (typeof objectTable.addBrep === 'function') {
                objectTable.addBrep(geometry, attrs);
            } else if (typeof objectTable.addMesh === 'function') {
                objectTable.addMesh(geometry, attrs);
            } else {
                return 0;
            }
            return 1;
        } finally {
            if (typeof attrs?.destroy === 'function') attrs.destroy();
        }
    }

    _createRhinoCurveFromPlanSegment(rhino, segment, elevationFt = 0) {
        if (!segment) return null;
        const start = [segment.x1, segment.y1, elevationFt];
        const end = [segment.x2, segment.y2, elevationFt];

        if (segment.kind !== 'arc' || !Number.isFinite(segment.r) || Math.abs(segment.r) < 1e-9) {
            return new rhino.LineCurve(start, end);
        }

        let startAngle = Number(segment.sa);
        let endAngle = Number(segment.ea);
        if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
            return new rhino.LineCurve(start, end);
        }

        if (segment.ccw) {
            while (endAngle < startAngle) endAngle += Math.PI * 2;
        } else {
            while (endAngle > startAngle) endAngle -= Math.PI * 2;
        }

        const midAngle = startAngle + (endAngle - startAngle) * 0.5;
        const mid = [
            segment.cx + segment.r * Math.cos(midAngle),
            segment.cy + segment.r * Math.sin(midAngle),
            elevationFt
        ];

        try {
            const arc = rhino.Arc.createFromPoints(start, mid, end);
            if (!arc) return new rhino.LineCurve(start, end);
            const curve = rhino.ArcCurve.createFromArc(arc);
            if (typeof arc?.destroy === 'function') arc.destroy();
            return curve || new rhino.LineCurve(start, end);
        } catch (_) {
            return new rhino.LineCurve(start, end);
        }
    }

    _parseBowlGeometrySubpaths(segments) {
        if (!Array.isArray(segments) || segments.length === 0) return [];

        const EPS = 1e-9;
        const subpaths = [];
        let currentPath = null;
        let currentPoint = null;
        let pathStart = null;

        const samePoint = (a, b) => {
            if (!a || !b) return false;
            return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
        };

        const ensurePath = () => {
            if (!currentPath) {
                currentPath = [];
                subpaths.push(currentPath);
            }
        };

        const pushLine = (x1, y1, x2, y2) => {
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
            if (Math.abs(x1 - x2) <= EPS && Math.abs(y1 - y2) <= EPS) return;
            ensurePath();
            currentPath.push({ kind: 'line', x1, y1, x2, y2 });
            currentPoint = { x: x2, y: y2 };
        };

        const pushArc = (cmd) => {
            if (!currentPoint) return;
            const x2 = cmd.x + cmd.r * Math.cos(cmd.ea);
            const y2 = cmd.y + cmd.r * Math.sin(cmd.ea);
            if (!Number.isFinite(x2) || !Number.isFinite(y2)) return;
            ensurePath();
            currentPath.push({
                kind: 'arc',
                x1: currentPoint.x,
                y1: currentPoint.y,
                x2,
                y2,
                cx: cmd.x,
                cy: cmd.y,
                r: cmd.r,
                sa: cmd.sa,
                ea: cmd.ea,
                ccw: !!cmd.ccw
            });
            currentPoint = { x: x2, y: y2 };
        };

        for (const cmd of segments) {
            if (!cmd) continue;
            if (cmd.cmd === 'moveTo') {
                currentPath = [];
                subpaths.push(currentPath);
                currentPoint = { x: cmd.x, y: cmd.y };
                pathStart = { x: cmd.x, y: cmd.y };
                continue;
            }

            if (cmd.cmd === 'lineTo') {
                if (!currentPoint) {
                    currentPoint = { x: cmd.x, y: cmd.y };
                    pathStart = { x: cmd.x, y: cmd.y };
                    currentPath = [];
                    subpaths.push(currentPath);
                    continue;
                }
                pushLine(currentPoint.x, currentPoint.y, cmd.x, cmd.y);
                continue;
            }

            if (cmd.cmd === 'arc') {
                if (!currentPoint) {
                    const x1 = cmd.x + cmd.r * Math.cos(cmd.sa);
                    const y1 = cmd.y + cmd.r * Math.sin(cmd.sa);
                    currentPoint = { x: x1, y: y1 };
                    pathStart = { x: x1, y: y1 };
                    currentPath = [];
                    subpaths.push(currentPath);
                }
                pushArc(cmd);
                continue;
            }

            if (cmd.cmd === 'closePath') {
                if (currentPoint && pathStart && !samePoint(currentPoint, pathStart)) {
                    pushLine(currentPoint.x, currentPoint.y, pathStart.x, pathStart.y);
                }
                continue;
            }
        }

        return subpaths.filter(path => Array.isArray(path) && path.length > 0);
    }

    _getRhinoTierIndexFromObject(object3D, fallbackIndex = 0) {
        const direct = Number(object3D?.userData?.tierIndex);
        if (Number.isInteger(direct)) return direct;
        const nested = Number(object3D?.userData?.seatPreview?.tierIndex);
        if (Number.isInteger(nested)) return nested;
        return Number.isInteger(fallbackIndex) ? fallbackIndex : 0;
    }

    _getRhinoTierLabel(tierIndex, fallbackIndex = 0) {
        const idx = Number.isInteger(tierIndex) ? tierIndex : (Number.isInteger(fallbackIndex) ? fallbackIndex : 0);
        return idx + 1;
    }

    _getRhinoTierLayerIndex(layerSets, category, tierIndex, fallbackIndex = 0) {
        if (!layerSets || !category) return undefined;

        const mapKey = `${category}ByTierIndex`;
        const map = layerSets[mapKey];
        if (map instanceof Map && Number.isInteger(tierIndex) && map.has(tierIndex)) {
            const mapped = map.get(tierIndex);
            if (Number.isInteger(mapped) && mapped >= 0) return mapped;
        }

        const arr = Array.isArray(layerSets[category]) ? layerSets[category] : [];
        const fallback = arr[fallbackIndex];
        return (Number.isInteger(fallback) && fallback >= 0) ? fallback : undefined;
    }

    _getThreeObjectWorldMatrixElements(object3D) {
        if (!object3D) return null;
        if (typeof object3D.updateWorldMatrix === 'function') object3D.updateWorldMatrix(true, false);
        else if (typeof object3D.updateMatrixWorld === 'function') object3D.updateMatrixWorld(true);
        return object3D.matrixWorld && object3D.matrixWorld.elements ? object3D.matrixWorld.elements : null;
    }

    _transformThreePointByMatrixElements(matrixElements, x, y, z) {
        if (!matrixElements) return { x, y, z };
        return {
            x: (matrixElements[0] * x) + (matrixElements[4] * y) + (matrixElements[8] * z) + matrixElements[12],
            y: (matrixElements[1] * x) + (matrixElements[5] * y) + (matrixElements[9] * z) + matrixElements[13],
            z: (matrixElements[2] * x) + (matrixElements[6] * y) + (matrixElements[10] * z) + matrixElements[14]
        };
    }

    _toRhinoPointFromThree(x, y, z) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
        // Convert Three.js coordinates (Y up, Z depth) to Rhino (Z up, XY plan).
        return [x, -z, y];
    }

    _rhinoPointsAlmostEqual(a, b, eps = 1e-9) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        return Math.abs(a[0] - b[0]) <= eps
            && Math.abs(a[1] - b[1]) <= eps
            && Math.abs(a[2] - b[2]) <= eps;
    }

    _rhinoPointDistance(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];
        return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    }

    _rhinoTriangleArea(a, b, c) {
        if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) return 0;
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const abz = b[2] - a[2];
        const acx = c[0] - a[0];
        const acy = c[1] - a[1];
        const acz = c[2] - a[2];
        const cx = (aby * acz) - (abz * acy);
        const cy = (abz * acx) - (abx * acz);
        const cz = (abx * acy) - (aby * acx);
        return 0.5 * Math.sqrt((cx * cx) + (cy * cy) + (cz * cz));
    }

    _isRhinoRuledQuadDegenerate(a0, a1, b0, b1) {
        // Conservative guards to avoid rhino3dm WASM aborts on collapsed/tiny strips.
        const lenEps = 1e-5;   // feet
        const spanEps = 1e-5;  // feet
        const areaEps = 1e-8;  // sq ft

        if (!a0 || !a1 || !b0 || !b1) return true;
        if (this._rhinoPointDistance(a0, a1) <= lenEps) return true;
        if (this._rhinoPointDistance(b0, b1) <= lenEps) return true;
        if (this._rhinoPointDistance(a0, b0) <= spanEps) return true;
        if (this._rhinoPointDistance(a1, b1) <= spanEps) return true;

        const area1 = this._rhinoTriangleArea(a0, a1, b1);
        const area2 = this._rhinoTriangleArea(a0, b1, b0);
        if ((area1 + area2) <= areaEps) return true;

        return false;
    }

    _addRhinoRuledSurfaceBrepFromPointPairs(rhino, model, a0, a1, b0, b1, objectName = '', layerIndex) {
        if (!a0 || !a1 || !b0 || !b1) return 0;
        if (this._rhinoPointsAlmostEqual(a0, a1) || this._rhinoPointsAlmostEqual(b0, b1)) return 0;
        if (this._isRhinoRuledQuadDegenerate(a0, a1, b0, b1)) return 0;

        let curveA = null;
        let curveB = null;
        try {
            curveA = new rhino.LineCurve(a0, a1);
            curveB = new rhino.LineCurve(b0, b1);
            return this._addRhinoRuledSurfaceBrep(rhino, model, curveA, curveB, objectName, layerIndex);
        } catch (_) {
            return 0;
        } finally {
            if (typeof curveA?.destroy === 'function') curveA.destroy();
            if (typeof curveB?.destroy === 'function') curveB.destroy();
        }
    }

    _exportRhinoAisleBreps(rhino, model, tierLayerSets) {
        const aisleMeshes = this.scene3D?.aisleGroup?.children;
        if (!Array.isArray(aisleMeshes) || aisleMeshes.length === 0) return 0;

        let count = 0;
        aisleMeshes.forEach((mesh, meshIndex) => {
            if (!mesh || mesh.type !== 'Mesh') return;

            const tierIndex = this._getRhinoTierIndexFromObject(mesh, meshIndex);
            const layerIndex = this._getRhinoTierLayerIndex(tierLayerSets, 'aisles', tierIndex, meshIndex);
            const tierLabel = this._getRhinoTierLabel(tierIndex, meshIndex);

            count += this._exportRhinoQuadPatchBrepsFromMesh(
                rhino,
                model,
                mesh,
                `Tier ${tierLabel} Aisle`,
                layerIndex
            );
        });

        return count;
    }

    _getRhinoNativeSpectatorBlockLimit() {
        const override = Number(window?.__SBS_RHINO_NATIVE_SPECTATOR_MAX_BLOCKS);
        if (Number.isFinite(override) && override >= 0) return Math.floor(override);
        // Browser rhino3dm can abort when exporting very large spectator counts as Breps.
        return 750;
    }

    _countRhinoSpectatorBlocksForExport() {
        const seatMeshes = this.scene3D?.seatGroup?.children;
        if (!Array.isArray(seatMeshes) || seatMeshes.length === 0) return 0;

        let count = 0;
        seatMeshes.forEach(mesh => {
            if (!mesh || !mesh.isInstancedMesh) return;
            count += Math.max(0, Number(mesh.count) || 0);
        });
        return count;
    }

    _exportRhinoSpectatorsAdaptive(rhino, model, tierLayerSets) {
        const blockCount = this._countRhinoSpectatorBlocksForExport();
        if (blockCount <= 0) return 0;

        const nativeLimit = this._getRhinoNativeSpectatorBlockLimit();
        if (blockCount > nativeLimit) {
            console.warn(
                `Rhino spectator export: ${blockCount} blocks exceeds native Brep safe limit (${nativeLimit}); ` +
                'exporting spectators as Rhino mesh by tier to avoid rhino3dm abort.'
            );
            return this._exportRhinoSpectatorMeshes(rhino, model, tierLayerSets);
        }

        return this._exportRhinoSpectatorBreps(rhino, model, tierLayerSets);
    }

    _exportRhinoQuadPatchBrepsFromMesh(rhino, model, mesh, objectName = '', layerIndex) {
        if (!mesh || !mesh.geometry || !mesh.geometry.attributes?.position) return 0;

        const positions = mesh.geometry.attributes.position.array;
        if (!positions || positions.length < 12) return 0;

        const worldMatrix = this._getThreeObjectWorldMatrixElements(mesh);
        let count = 0;

        for (let i = 0; i + 11 < positions.length; i += 12) {
            const p0w = this._transformThreePointByMatrixElements(worldMatrix, positions[i], positions[i + 1], positions[i + 2]);
            const p1w = this._transformThreePointByMatrixElements(worldMatrix, positions[i + 3], positions[i + 4], positions[i + 5]);
            const p2w = this._transformThreePointByMatrixElements(worldMatrix, positions[i + 6], positions[i + 7], positions[i + 8]);
            const p3w = this._transformThreePointByMatrixElements(worldMatrix, positions[i + 9], positions[i + 10], positions[i + 11]);

            const p0 = this._toRhinoPointFromThree(p0w.x, p0w.y, p0w.z);
            const p1 = this._toRhinoPointFromThree(p1w.x, p1w.y, p1w.z);
            const p2 = this._toRhinoPointFromThree(p2w.x, p2w.y, p2w.z);
            const p3 = this._toRhinoPointFromThree(p3w.x, p3w.y, p3w.z);

            if (!p0 || !p1 || !p2 || !p3) continue;

            // The aisle mesh generator writes one quad at a time as vertices [a, b, c, d].
            // Export a native ruled Brep using the two side edges (a-d and b-c).
            count += this._addRhinoRuledSurfaceBrepFromPointPairs(
                rhino,
                model,
                p0,
                p3,
                p1,
                p2,
                objectName,
                layerIndex
            );
        }

        return count;
    }

    _exportRhinoSpectatorBreps(rhino, model, tierLayerSets) {
        const seatMeshes = this.scene3D?.seatGroup?.children;
        if (!Array.isArray(seatMeshes) || seatMeshes.length === 0) return 0;

        let count = 0;
        seatMeshes.forEach((mesh, meshIndex) => {
            if (!mesh || !mesh.isInstancedMesh || typeof mesh.getMatrixAt !== 'function') return;

            const tierIndex = this._getRhinoTierIndexFromObject(mesh, meshIndex);
            const layerIndex = this._getRhinoTierLayerIndex(tierLayerSets, 'spectators', tierIndex, meshIndex);
            const tierLabel = this._getRhinoTierLabel(tierIndex, meshIndex);

            count += this._exportRhinoSpectatorBlocksFromInstancedMesh(
                rhino,
                model,
                mesh,
                `Tier ${tierLabel} Spectator`,
                layerIndex
            );
        });

        return count;
    }

    _exportRhinoSpectatorMeshes(rhino, model, tierLayerSets) {
        const seatMeshes = this.scene3D?.seatGroup?.children;
        if (!Array.isArray(seatMeshes) || seatMeshes.length === 0) return 0;

        let count = 0;
        seatMeshes.forEach((mesh, meshIndex) => {
            if (!mesh || !mesh.isInstancedMesh || typeof mesh.getMatrixAt !== 'function') return;

            const tierIndex = this._getRhinoTierIndexFromObject(mesh, meshIndex);
            const layerIndex = this._getRhinoTierLayerIndex(tierLayerSets, 'spectators', tierIndex, meshIndex);
            const tierLabel = this._getRhinoTierLabel(tierIndex, meshIndex);
            const instanceCount = Math.max(0, Number(mesh.count) || 0);
            for (let instIdx = 0; instIdx < instanceCount; instIdx++) {
                const rhinoMesh = this._createRhinoMeshFromThreeInstancedMeshInstance(rhino, mesh, instIdx);
                if (!rhinoMesh) continue;
                const objectName = `Tier ${tierLabel} Spectator ${instIdx + 1}`;
                count += this._addRhinoModelObject(rhino, model, rhinoMesh, objectName, layerIndex);
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
            }
        });

        return count;
    }

    _exportRhinoSpectatorBlocksFromInstancedMesh(rhino, model, instancedMesh, objectName = '', layerIndex) {
        const THREE = this.scene3D?.THREE;
        if (!THREE || !instancedMesh || typeof instancedMesh.getMatrixAt !== 'function') return 0;
        if (!instancedMesh.geometry || !instancedMesh.geometry.attributes?.position) return 0;

        const geometry = instancedMesh.geometry;
        if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') {
            geometry.computeBoundingBox();
        }
        const bbox = geometry.boundingBox;
        if (!bbox) return 0;

        if (typeof instancedMesh.updateWorldMatrix === 'function') instancedMesh.updateWorldMatrix(true, false);
        else if (typeof instancedMesh.updateMatrixWorld === 'function') instancedMesh.updateMatrixWorld(true);

        const min = bbox.min;
        const max = bbox.max;
        const localCorners = [
            new THREE.Vector3(min.x, min.y, min.z), // 0
            new THREE.Vector3(max.x, min.y, min.z), // 1
            new THREE.Vector3(max.x, max.y, min.z), // 2
            new THREE.Vector3(min.x, max.y, min.z), // 3
            new THREE.Vector3(min.x, min.y, max.z), // 4
            new THREE.Vector3(max.x, min.y, max.z), // 5
            new THREE.Vector3(max.x, max.y, max.z), // 6
            new THREE.Vector3(min.x, max.y, max.z)  // 7
        ];

        const worldMatrix = new THREE.Matrix4();
        worldMatrix.copy(instancedMesh.matrixWorld);
        const instanceMatrix = new THREE.Matrix4();
        const combinedMatrix = new THREE.Matrix4();
        const temp = new THREE.Vector3();

        // Each tuple defines two rail edges for one planar face.
        const faceRails = [
            [0, 4, 1, 5], // bottom
            [3, 7, 2, 6], // top
            [0, 3, 4, 7], // side
            [1, 2, 5, 6], // side
            [0, 3, 1, 2], // front
            [4, 7, 5, 6]  // back
        ];

        const instanceCount = Math.max(0, Number(instancedMesh.count) || 0);
        let count = 0;
        for (let i = 0; i < instanceCount; i++) {
            instancedMesh.getMatrixAt(i, instanceMatrix);
            combinedMatrix.multiplyMatrices(worldMatrix, instanceMatrix);

            const corners = new Array(8);
            for (let c = 0; c < 8; c++) {
                temp.copy(localCorners[c]).applyMatrix4(combinedMatrix);
                corners[c] = this._toRhinoPointFromThree(temp.x, temp.y, temp.z);
            }

            for (let f = 0; f < faceRails.length; f++) {
                const rails = faceRails[f];
                count += this._addRhinoRuledSurfaceBrepFromPointPairs(
                    rhino,
                    model,
                    corners[rails[0]],
                    corners[rails[1]],
                    corners[rails[2]],
                    corners[rails[3]],
                    objectName,
                    layerIndex
                );
            }
        }

        return count;
    }

    _createRhinoMeshFromThreeInstancedMeshInstance(rhino, instancedMesh, instanceIndex) {
        const THREE = this.scene3D?.THREE;
        if (!THREE || !instancedMesh || !instancedMesh.isInstancedMesh || typeof instancedMesh.getMatrixAt !== 'function') return null;

        const geometry = instancedMesh.geometry;
        const positions = geometry?.attributes?.position?.array;
        if (!positions || positions.length < 9) return null;

        const instIdx = Math.floor(Number(instanceIndex));
        if (!Number.isInteger(instIdx) || instIdx < 0 || instIdx >= (Number(instancedMesh.count) || 0)) return null;

        if (typeof instancedMesh.updateWorldMatrix === 'function') instancedMesh.updateWorldMatrix(true, false);
        else if (typeof instancedMesh.updateMatrixWorld === 'function') instancedMesh.updateMatrixWorld(true);

        const rhinoMesh = new rhino.Mesh();
        const vertices = rhinoMesh.vertices();
        const faces = rhinoMesh.faces();

        const worldMatrix = new THREE.Matrix4();
        worldMatrix.copy(instancedMesh.matrixWorld);
        const instanceMatrix = new THREE.Matrix4();
        const combinedMatrix = new THREE.Matrix4();
        const temp = new THREE.Vector3();

        try {
            instancedMesh.getMatrixAt(instIdx, instanceMatrix);
            combinedMatrix.multiplyMatrices(worldMatrix, instanceMatrix);

            for (let i = 0; i < positions.length; i += 3) {
                temp.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(combinedMatrix);
                const rp = this._toRhinoPointFromThree(temp.x, temp.y, temp.z);
                if (!rp) {
                    if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                    return null;
                }
                vertices.add(rp[0], rp[1], rp[2]);
            }

            if (geometry.index && geometry.index.array && geometry.index.array.length >= 3) {
                const idx = geometry.index.array;
                for (let i = 0; i < idx.length; i += 3) {
                    const a = Number(idx[i]);
                    const b = Number(idx[i + 1]);
                    const c = Number(idx[i + 2]);
                    if (typeof faces.addTriFace === 'function') {
                        faces.addTriFace(a, b, c);
                    } else if (typeof faces.addFace === 'function') {
                        faces.addFace(a, b, c, c);
                    } else {
                        throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                    }
                }
            } else {
                const vertexCount = Math.floor(positions.length / 3);
                for (let v = 0; v + 2 < vertexCount; v += 3) {
                    if (typeof faces.addTriFace === 'function') {
                        faces.addTriFace(v, v + 1, v + 2);
                    } else if (typeof faces.addFace === 'function') {
                        faces.addFace(v, v + 1, v + 2, v + 2);
                    } else {
                        throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                    }
                }
            }

            if (typeof rhinoMesh.compact === 'function') rhinoMesh.compact();
            return rhinoMesh;
        } catch (_) {
            if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
            return null;
        }
    }

    _createRhinoMeshFromThreeInstancedMesh(rhino, instancedMesh) {
        const THREE = this.scene3D?.THREE;
        if (!THREE || !instancedMesh || !instancedMesh.isInstancedMesh || typeof instancedMesh.getMatrixAt !== 'function') return null;

        const geometry = instancedMesh.geometry;
        const positions = geometry?.attributes?.position?.array;
        if (!positions || positions.length < 9) return null;

        if (typeof instancedMesh.updateWorldMatrix === 'function') instancedMesh.updateWorldMatrix(true, false);
        else if (typeof instancedMesh.updateMatrixWorld === 'function') instancedMesh.updateMatrixWorld(true);

        const baseVertexCount = Math.floor(positions.length / 3);
        if (baseVertexCount <= 0) return null;

        const rhinoMesh = new rhino.Mesh();
        const vertices = rhinoMesh.vertices();
        const faces = rhinoMesh.faces();

        const worldMatrix = new THREE.Matrix4();
        worldMatrix.copy(instancedMesh.matrixWorld);
        const instanceMatrix = new THREE.Matrix4();
        const combinedMatrix = new THREE.Matrix4();
        const temp = new THREE.Vector3();

        const instanceCount = Math.max(0, Number(instancedMesh.count) || 0);
        try {
            for (let instIdx = 0; instIdx < instanceCount; instIdx++) {
                instancedMesh.getMatrixAt(instIdx, instanceMatrix);
                combinedMatrix.multiplyMatrices(worldMatrix, instanceMatrix);

                for (let i = 0; i < positions.length; i += 3) {
                    temp.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(combinedMatrix);
                    const rp = this._toRhinoPointFromThree(temp.x, temp.y, temp.z);
                    if (!rp) {
                        if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                        return null;
                    }
                    vertices.add(rp[0], rp[1], rp[2]);
                }

                const vertexOffset = instIdx * baseVertexCount;
                if (geometry.index && geometry.index.array && geometry.index.array.length >= 3) {
                    const idx = geometry.index.array;
                    for (let i = 0; i < idx.length; i += 3) {
                        const a = vertexOffset + Number(idx[i]);
                        const b = vertexOffset + Number(idx[i + 1]);
                        const c = vertexOffset + Number(idx[i + 2]);
                        if (typeof faces.addTriFace === 'function') {
                            faces.addTriFace(a, b, c);
                        } else if (typeof faces.addFace === 'function') {
                            faces.addFace(a, b, c, c);
                        } else {
                            throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                        }
                    }
                } else {
                    for (let v = 0; v + 2 < baseVertexCount; v += 3) {
                        const a = vertexOffset + v;
                        const b = vertexOffset + v + 1;
                        const c = vertexOffset + v + 2;
                        if (typeof faces.addTriFace === 'function') {
                            faces.addTriFace(a, b, c);
                        } else if (typeof faces.addFace === 'function') {
                            faces.addFace(a, b, c, c);
                        } else {
                            throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                        }
                    }
                }
            }

            if (typeof rhinoMesh.compact === 'function') rhinoMesh.compact();
            return rhinoMesh;
        } catch (e) {
            if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
            return null;
        }
    }

    _createRhinoMeshFromThreeMesh(rhino, mesh) {
        if (!mesh || mesh.type !== 'Mesh' || !mesh.geometry || !mesh.geometry.attributes?.position) return null;

        const geometry = mesh.geometry;
        const positions = geometry.attributes.position.array;
        if (!positions || positions.length < 9) return null;

        const worldMatrix = this._getThreeObjectWorldMatrixElements(mesh);

        const rhinoMesh = new rhino.Mesh();
        const vertices = rhinoMesh.vertices();
        const faces = rhinoMesh.faces();

        for (let i = 0; i < positions.length; i += 3) {
            const worldPos = this._transformThreePointByMatrixElements(worldMatrix, positions[i], positions[i + 1], positions[i + 2]);
            if (!Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.y) || !Number.isFinite(worldPos.z)) {
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                return null;
            }
            const rp = this._toRhinoPointFromThree(worldPos.x, worldPos.y, worldPos.z);
            if (!rp) {
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                return null;
            }
            vertices.add(rp[0], rp[1], rp[2]);
        }

        if (geometry.index && geometry.index.array && geometry.index.array.length >= 3) {
            const idx = geometry.index.array;
            for (let i = 0; i < idx.length; i += 3) {
                const a = Number(idx[i]);
                const b = Number(idx[i + 1]);
                const c = Number(idx[i + 2]);
                if (typeof faces.addTriFace === 'function') {
                    faces.addTriFace(a, b, c);
                } else if (typeof faces.addFace === 'function') {
                    faces.addFace(a, b, c, c);
                } else {
                    if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                    throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                }
            }
        } else {
            const vertexCount = Math.floor(positions.length / 3);
            for (let i = 0; i + 2 < vertexCount; i += 3) {
                if (typeof faces.addTriFace === 'function') {
                    faces.addTriFace(i, i + 1, i + 2);
                } else if (typeof faces.addFace === 'function') {
                    faces.addFace(i, i + 1, i + 2, i + 2);
                } else {
                    if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                    throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                }
            }
        }

        if (typeof rhinoMesh.compact === 'function') rhinoMesh.compact();
        return rhinoMesh;
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

        let dxf = "0\nSECTION\n2\nENTITIES\n";
        const structuralDepth = (this._getInputValue('structuralDepth') || 0) / 12.0; // convert inches to feet

        // Focal Point
        const fX = (this._getInputValue('focalX') || 0) * 12;
        const fZ = (this._getInputValue('focalZ') || 0) * 12;
        dxf += `0\nPOINT\n8\nFocal_Point\n10\n${fX} \n20\n${fZ} \n30\n0.0\n`;

        // Helper: add a DXF LINE entity
        const addLine = (layer, x1, y1, x2, y2) => {
            dxf += `0\nLINE\n8\n${layer} \n`;
            dxf += `10\n${x1.toFixed(4)} \n20\n${y1.toFixed(4)} \n30\n0.0\n`;
            dxf += `11\n${x2.toFixed(4)} \n21\n${y2.toFixed(4)} \n31\n0.0\n`;
        };

        this._solvers.forEach((solver, tierIndex) => {
            if (!solver.rows || solver.rows.length === 0) return;
            const segments = solver.getStepGeometry();
            const profLayer = `Tier_${tierIndex + 1} _Profile`;
            const sightLayer = `Tier_${tierIndex + 1} _Sightlines`;
            const headLayer = `Tier_${tierIndex + 1} _Heads`;
            const textLayer = `Tier_${tierIndex + 1} _Metrics`;

            const firstRow = solver.rows[0];
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : tierIndex;

            // Determine the base Z for first riser
            let baseZ;
            if (tIdx === 0) {
                baseZ = 0; // Tier 1: full riser down to ground
            } else {
                baseZ = firstRow.z - firstRow.riser_height;
            }

            // === FIRST RISER (full length from base to first tread) ===
            const startX = firstRow.x - solver.treadDepthFt;
            addLine(profLayer, startX * 12, baseZ * 12, startX * 12, firstRow.z * 12);

            // === STEP PROFILE (treads + risers between rows) ===
            for (const [start, end] of segments) {
                addLine(profLayer, start.x * 12, start.z * 12, end.x * 12, end.z * 12);
            }

            // === STRUCTURAL DEPTH OFFSET PROFILE ===
            if (structuralDepth > 0) {
                const d = structuralDepth;
                const depthLayer = profLayer; // Same layer, same line style

                // Connection at start: horizontal line from base of first riser to offset start
                addLine(depthLayer, startX * 12, baseZ * 12, (startX + d) * 12, baseZ * 12);

                // Build the bottom offset profile points
                const bottomPts = [];
                bottomPts.push({ x: startX + d, z: baseZ });

                for (let i = 0; i < solver.rows.length; i++) {
                    const row = solver.rows[i];
                    const treadStartX = row.x - solver.treadDepthFt;
                    const treadEndX = row.x;

                    bottomPts.push({ x: treadStartX + d, z: row.z - d });
                    if (i < solver.rows.length - 1) {
                        bottomPts.push({ x: treadEndX + d, z: row.z - d });
                        const nextRow = solver.rows[i + 1];
                        bottomPts.push({ x: treadEndX + d, z: nextRow.z - d });
                    } else {
                        // Last row: end at original tread X (no extension)
                        bottomPts.push({ x: treadEndX, z: row.z - d });
                    }
                }

                // Draw lines connecting consecutive bottom profile points
                for (let i = 0; i < bottomPts.length - 1; i++) {
                    addLine(depthLayer,
                        bottomPts[i].x * 12, bottomPts[i].z * 12,
                        bottomPts[i + 1].x * 12, bottomPts[i + 1].z * 12);
                }

                // Connection at end: vertical line from last tread end down to offset
                const lastRow = solver.rows[solver.rows.length - 1];
                addLine(depthLayer, lastRow.x * 12, lastRow.z * 12, lastRow.x * 12, (lastRow.z - d) * 12);
            }

            // === SIGHTLINES, HEADS, METRICS ===
            solver.rows.forEach(row => {
                const ex = (row.eye_x * 12).toFixed(4);
                const ez = (row.eye_z * 12).toFixed(4);

                // Sightline
                dxf += `0\nLINE\n8\n${sightLayer} \n`;
                dxf += `10\n${ex} \n20\n${ez} \n30\n0.0\n`;
                dxf += `11\n${fX} \n21\n${fZ} \n31\n0.0\n`;

                // Eye Point
                dxf += `0\nPOINT\n8\n${headLayer} \n10\n${ex} \n20\n${ez} \n30\n0.0\n`;

                // Spectator Head (4.5 inch radius approx)
                const headCenterX = (row.eye_x * 12) + (4.5 * 0.3);
                const headCenterZ = (row.eye_z * 12);
                dxf += `0\nCIRCLE\n8\n${headLayer} \n10\n${headCenterX.toFixed(4)} \n20\n${headCenterZ.toFixed(4)} \n30\n0.0\n40\n4.5\n`;

                // Row Text Metric (C-Value and Row num)
                const tX = ((row.x - solver.treadDepthFt / 2) * 12).toFixed(4);
                const tY = (row.z * 12 + 12).toFixed(4); // 1 foot above tread
                dxf += `0\nTEXT\n8\n${textLayer} \n10\n${tX} \n20\n${tY} \n30\n0.0\n40\n4.0\n1\n${row.c_value.toFixed(2)} \" C-Val\n`;
            });
        });

        dxf += "0\nENDSEC\n0\nEOF\n";

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

    _addDXFShape(dxf, template, runoff, layer) {
        let out = dxf;
        const shape = template.shape || 'rectangle'; // Fallback
        const addLine = (x1, y1, x2, y2) => {
            out += `0\nLINE\n8\n${layer}\n10\n${(x1 * 12).toFixed(4)}\n20\n${(y1 * 12).toFixed(4)}\n30\n0.0\n11\n${(x2 * 12).toFixed(4)}\n21\n${(y2 * 12).toFixed(4)}\n31\n0.0\n`;
        };
        const addArc = (x, y, r, sa, ea) => {
            let degSa = ((sa * 180 / Math.PI) % 360 + 360) % 360;
            let degEa = ((ea * 180 / Math.PI) % 360 + 360) % 360;
            out += `0\nARC\n8\n${layer}\n10\n${(x * 12).toFixed(4)}\n20\n${(y * 12).toFixed(4)}\n30\n0.0\n40\n${(r * 12).toFixed(4)}\n50\n${degSa.toFixed(4)}\n51\n${degEa.toFixed(4)}\n`;
        };

        if (shape === 'rectangle') {
            const halfL = ((template.field_length || 0) / 2) + runoff;
            const halfW = ((template.field_width || 0) / 2) + runoff;
            addLine(-halfL, -halfW, halfL, -halfW);
            addLine(halfL, -halfW, halfL, halfW);
            addLine(halfL, halfW, -halfL, halfW);
            addLine(-halfL, halfW, -halfL, -halfW);
        } else if (shape === 'rounded_rect') {
            const halfL = ((template.field_length || 0) / 2) + runoff;
            const halfW = ((template.field_width || 0) / 2) + runoff;
            const r = (template.corner_radius || 0) + runoff;
            const rx = halfL - r;
            const ry = halfW - r;
            addLine(-rx, -halfW, rx, -halfW);
            addArc(rx, -ry, r, -Math.PI / 2, 0);
            addLine(halfL, -ry, halfL, ry);
            addArc(rx, ry, r, 0, Math.PI / 2);
            addLine(rx, halfW, -rx, halfW);
            addArc(-rx, ry, r, Math.PI / 2, Math.PI);
            addLine(-halfL, ry, -halfL, -ry);
            addArc(-rx, -ry, r, Math.PI, 3 * Math.PI / 2);
        } else if (shape === 'oval') {
            const halfStraight = ((template.straight_length || 0) / 2) - (template.corner_radius || 0) + runoff;
            const halfW = ((template.field_width || 0) / 2) + runoff;
            addLine(-halfStraight, halfW, halfStraight, halfW);
            addArc(halfStraight, 0, halfW, -Math.PI / 2, Math.PI / 2);
            addLine(halfStraight, -halfW, -halfStraight, -halfW);
            addArc(-halfStraight, 0, halfW, Math.PI / 2, 3 * Math.PI / 2);
        } else if (shape === 'arc') {
            const radius = (template.field_radius || 0) + runoff;
            const halfAngle = ((template.arc_angle || 90) / 2) * Math.PI / 180;
            const startAngle = Math.PI / 2 - halfAngle;
            const endAngle = Math.PI / 2 + halfAngle;
            addLine(0, 0, radius * Math.cos(startAngle), radius * Math.sin(startAngle));
            addArc(0, 0, radius, startAngle, endAngle);
            addLine(radius * Math.cos(endAngle), radius * Math.sin(endAngle), 0, 0);
        }
        return out;
    }

    _exportPlanDXF() {
        if (!this._solvers || this._solvers.length === 0 || !this._currentTemplate) {
            console.warn('No Plan data to export');
            return;
        }

        let dxf = "0\nSECTION\n2\nENTITIES\n";
        const tierAisleLayoutMap = new Map((this._tierAisleLayouts || []).map(layout => [layout.tierIndex, layout]));

        const appendLineFt = (layer, x1Ft, y1Ft, x2Ft, y2Ft) => {
            if (![x1Ft, y1Ft, x2Ft, y2Ft].every(Number.isFinite)) return;
            dxf += `0\nLINE\n8\n${layer}\n`;
            dxf += `10\n${(x1Ft * 12).toFixed(4)}\n20\n${(y1Ft * 12).toFixed(4)}\n30\n0.0\n`;
            dxf += `11\n${(x2Ft * 12).toFixed(4)}\n21\n${(y2Ft * 12).toFixed(4)}\n31\n0.0\n`;
        };

        const appendTextFt = (layer, xFt, yFt, text, heightIn = 10) => {
            if (!Number.isFinite(xFt) || !Number.isFinite(yFt)) return;
            const safeText = String(text ?? '').replace(/\r?\n/g, ' ').trim();
            if (!safeText) return;
            const xIn = (xFt * 12).toFixed(4);
            const yIn = (yFt * 12).toFixed(4);
            dxf += `0\nTEXT\n8\n${layer}\n`;
            dxf += `10\n${xIn}\n20\n${yIn}\n30\n0.0\n`;
            dxf += `40\n${Number(heightIn).toFixed(4)}\n1\n${safeText}\n`;
            dxf += `72\n1\n73\n2\n11\n${xIn}\n21\n${yIn}\n31\n0.0\n`;
        };

        const sportName = document.getElementById('sportSelect').value;
        const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];

        // Render Field Object Geometry
        const runoffDist = this._getCustomRunoff() !== null ? this._getCustomRunoff() : (this._currentTemplate.runoff || 0);
        dxf = this._addDXFShape(dxf, this._currentTemplate, 0, 'Field_Edge');
        dxf = this._addDXFShape(dxf, this._currentTemplate, runoffDist, 'Runoff');

        // Add Focal Point marker to plan DXF
        const fpX = (this._currentTemplate.focal_x || 0) * 12;

        let visualFocalX = this._getInputValue('focalX');
        // Visual focalX maps to Y offset in the plan viewer!
        let fpY = (visualFocalX !== null ? visualFocalX : (this._currentTemplate.focal_y || 0)) * 12;

        // Point
        dxf += `0\nPOINT\n8\nFocal_Point\n10\n${fpX}\n20\n${fpY}\n30\n0.0\n`;
        // Cross lines (24 inch arms)
        dxf += `0\nLINE\n8\nFocal_Point\n10\n${fpX - 24}\n20\n${fpY}\n30\n0.0\n11\n${fpX + 24}\n21\n${fpY}\n31\n0.0\n`;
        dxf += `0\nLINE\n8\nFocal_Point\n10\n${fpX}\n20\n${fpY - 24}\n30\n0.0\n11\n${fpX}\n21\n${fpY + 24}\n31\n0.0\n`;
        // Circle
        dxf += `0\nCIRCLE\n8\nFocal_Point\n10\n${fpX}\n20\n${fpY}\n30\n0.0\n40\n18\n`;

        const bowlConfig = this._getBowlConfig();

        const isEdgeSport = edgeSports.includes(sportName);
        const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
        const offsetCorrection = isEdgeSport ? 0 : (safeWidth / 2);

        this._solvers.forEach((solver, tierIndex) => {
            if (tierIndex === 0 && !document.getElementById('enableTier1')?.checked) return;
            if (tierIndex === 1 && !document.getElementById('enableTier2')?.checked) return;
            if (tierIndex === 2 && !document.getElementById('enableTier3')?.checked) return;
            if (!solver.rows) return;
            const layer = `Tier_${tierIndex + 1}_Plan`;
            const aisleLayer = `Tier_${tierIndex + 1}_Aisles`;
            const sectionLabelLayer = `Tier_${tierIndex + 1}_Section_Labels`;
            const rowLabelLayer = `Tier_${tierIndex + 1}_Row_Seat_Counts`;

            solver.rows.forEach(row => {
                const offset = (row.x - row.tread_depth) - offsetCorrection;
                const segments = this.fieldRenderer._getBowlGeometry(bowlConfig, offset);

                let lastX = 0, lastY = 0;
                let startX = 0, startY = 0;

                segments.forEach(s => {
                    if (s.cmd === 'moveTo') {
                        lastX = s.x; lastY = s.y;
                        startX = s.x; startY = s.y;
                    } else if (s.cmd === 'lineTo') {
                        dxf += `0\nLINE\n8\n${layer}\n`;
                        dxf += `10\n${(lastX * 12).toFixed(4)}\n20\n${(lastY * 12).toFixed(4)}\n30\n0.0\n`;
                        dxf += `11\n${(s.x * 12).toFixed(4)}\n21\n${(s.y * 12).toFixed(4)}\n31\n0.0\n`;
                        lastX = s.x; lastY = s.y;
                    } else if (s.cmd === 'arc') {
                        let dxfSa = s.ccw ? s.ea : s.sa;
                        let dxfEa = s.ccw ? s.sa : s.ea;

                        let degSa = dxfSa * 180 / Math.PI;
                        let degEa = dxfEa * 180 / Math.PI;
                        degSa = ((degSa % 360) + 360) % 360;
                        degEa = ((degEa % 360) + 360) % 360;

                        dxf += `0\nARC\n8\n${layer}\n`;
                        dxf += `10\n${(s.x * 12).toFixed(4)}\n20\n${(s.y * 12).toFixed(4)}\n30\n0.0\n`;
                        dxf += `40\n${(s.r * 12).toFixed(4)}\n`;
                        dxf += `50\n${degSa.toFixed(4)}\n51\n${degEa.toFixed(4)}\n`;

                        lastX = s.x + s.r * Math.cos(s.ea);
                        lastY = s.y + s.r * Math.sin(s.ea);
                    } else if (s.cmd === 'closePath') {
                        dxf += `0\nLINE\n8\n${layer}\n`;
                        dxf += `10\n${(lastX * 12).toFixed(4)}\n20\n${(lastY * 12).toFixed(4)}\n30\n0.0\n`;
                        dxf += `11\n${(startX * 12).toFixed(4)}\n21\n${(startY * 12).toFixed(4)}\n31\n0.0\n`;
                        lastX = startX; lastY = startY;
                    }
                });
            });

            const tierAisleLayout = tierAisleLayoutMap.get(tierIndex);
            if (this.fieldRenderer && tierAisleLayout) {
                const aislePolygons = this.fieldRenderer.getTierAisleBandPolygons(solver, bowlConfig, tierAisleLayout, offsetCorrection);
                aislePolygons.forEach(poly => {
                    const pts = Array.isArray(poly.points) ? poly.points : [];
                    if (pts.length < 2) return;
                    for (let i = 0; i < pts.length; i++) {
                        const a = pts[i];
                        const b = pts[(i + 1) % pts.length];
                        appendLineFt(aisleLayer, a.x, a.y, b.x, b.y);
                    }
                });

                const overlay = this.fieldRenderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierAisleLayout, offsetCorrection);
                const rowSeatLabels = Array.isArray(overlay?.rowSeatLabels) ? overlay.rowSeatLabels : [];
                const sectionLabels = Array.isArray(overlay?.sectionLabels) ? overlay.sectionLabels : [];

                rowSeatLabels.forEach(label => {
                    appendTextFt(rowLabelLayer, label.x, label.y, label.text, 8);
                });

                const stackOffsetFt = 1.0;
                sectionLabels.forEach(label => {
                    const hasOcc = !!label.occText;
                    appendTextFt(
                        sectionLabelLayer,
                        label.x,
                        label.y + (hasOcc ? stackOffsetFt : 0),
                        label.text,
                        hasOcc ? 12 : 13
                    );
                    if (hasOcc) {
                        appendTextFt(sectionLabelLayer, label.x, label.y - stackOffsetFt, label.occText, 9);
                    }
                });
            }
        });

        dxf += "0\nENDSEC\n0\nEOF\n";

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

