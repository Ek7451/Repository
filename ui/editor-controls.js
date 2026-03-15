import { getSportNames, getTemplate as getSportTemplate } from '../core/sports-templates.js';

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

function formatSportOptionLabel(name, template) {
    if (!template) return name;

    if (template.field_length && template.field_width) {
        return `${name} (${template.field_length}' L - ${template.field_width}' W)`;
    }

    if (template.straight_length && template.field_width) {
        return `${name} (${template.straight_length}' L - ${template.field_width}' W)`;
    }

    if (template.field_radius) {
        return `${name} (${template.field_radius}' Radius)`;
    }

    return name;
}

function getValueAtPath(root, path) {
    return path.reduce((value, key) => value?.[key], root);
}

function setValueAtPath(root, path, nextValue) {
    let cursor = root;
    for (let index = 0; index < path.length - 1; index += 1) {
        cursor = cursor?.[path[index]];
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

function updateTierSectionState(sectionEl, enabled) {
    if (!sectionEl) return;
    sectionEl.classList.toggle('tier-disabled', !enabled);
}

function normalizeNumericControlValue(baseId, rawValue) {
    if (rawValue === '' || rawValue === null || rawValue === undefined) return null;
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return null;
    if (INTEGER_INPUT_IDS.has(baseId)) {
        return Math.max(0, Math.round(numericValue));
    }
    return numericValue;
}

function hasSectionBodyTarget(target) {
    return !!target && typeof target.closest === 'function' && target.closest('.section-body');
}

export class EditorControls {
    constructor(options = {}) {
        const settings = /** @type {{
            state?: object,
            getTemplate?: (() => object | null),
            getRunoffDistance?: (() => number),
            onStateChanged?: (() => void),
            onSportChanged?: (() => void),
            getTierDefaults?: ((tierNum: number) => object | null)
        }} */ (options && typeof options === 'object' ? options : {});

        this.state = settings.state && typeof settings.state === 'object'
            ? settings.state
            : {};
        this._getTemplate = typeof settings.getTemplate === 'function'
            ? settings.getTemplate
            : () => null;
        this._getRunoffDistance = typeof settings.getRunoffDistance === 'function'
            ? settings.getRunoffDistance
            : () => 0;
        this._onStateChanged = typeof settings.onStateChanged === 'function'
            ? settings.onStateChanged
            : () => {};
        this._onSportChanged = typeof settings.onSportChanged === 'function'
            ? settings.onSportChanged
            : () => {};
        this._getTierDefaults = typeof settings.getTierDefaults === 'function'
            ? settings.getTierDefaults
            : () => null;

        this._cleanup = [];
        this._initialized = false;
        this._tier2Initialized = false;
        this._tier3Initialized = false;
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this._populateSports();
        this._wireEvents();
    }

    destroy() {
        this._cleanup.forEach((dispose) => dispose());
        this._cleanup = [];
        this._initialized = false;
    }

    syncFromState() {
        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            sportSelect.value = this.state.sport;
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        const runoffValue = this._getRunoffDistance();
        if (runoffInput) {
            runoffInput.value = String(this.state.setup?.customRunoff ?? '');
        }
        if (runoffSlider) {
            runoffSlider.value = String(runoffValue);
        }

        Object.entries(NUMERIC_INPUT_STATE_PATHS).forEach(([baseId, path]) => {
            const value = getValueAtPath(this.state, path);
            if (value !== undefined && value !== null) {
                this._setInputValue(baseId, value);
            }
        });

        Object.entries(SELECT_STATE_PATHS).forEach(([id, path]) => {
            const el = getSelectElement(id);
            if (!el) return;
            const value = getValueAtPath(this.state, path);
            if (value !== undefined && value !== null) {
                el.value = value;
            }
        });

        Object.entries(CHECKBOX_STATE_PATHS).forEach(([id, path]) => {
            const el = getInputElement(id);
            if (!el) return;
            el.checked = !!getValueAtPath(this.state, path);
        });

        const sideLengthRow = getHtmlElement('sideLengthRow');
        if (sideLengthRow) {
            sideLengthRow.style.display = String(this.state.bowl?.type || '').includes('Side') ? 'flex' : 'none';
        }

        const clipPlaneControls = getHtmlElement('clipPlaneControls');
        if (clipPlaneControls) {
            clipPlaneControls.style.display = this.state.bowl?.clipEnabled ? 'block' : 'none';
        }

        [1, 2, 3].forEach((tierNum) => {
            updateTierSectionState(
                getHtmlElement(`tier${tierNum}Section`),
                !!this.state.tiers?.[tierNum - 1]?.enabled
            );
        });
    }

    syncClipPositionRange({ min = 0, max = 1, value = 0 } = {}) {
        const slider = getInputElement('clipPositionSlider');
        const input = getInputElement('clipPositionInput');
        if (!slider || !input) return;

        const nextMin = Number.isFinite(min) ? min : 0;
        const nextMax = Number.isFinite(max) ? max : (nextMin + 1);
        const nextValue = Number.isFinite(value) ? value : nextMin;

        slider.min = String(nextMin);
        slider.max = String(nextMax);
        input.min = String(nextMin);
        input.max = String(nextMax);
        slider.value = String(nextValue);
        input.value = String(nextValue);
    }

    hydrateTierInitialization(config) {
        this._tier2Initialized = Array.isArray(config?.tiers) && config.tiers.length > 1;
        this._tier3Initialized = Array.isArray(config?.tiers) && config.tiers.length > 2;
    }

    _populateSports() {
        const select = getSelectElement('sportSelect');
        if (!select) return;

        const names = getSportNames();
        names.forEach((name) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = formatSportOptionLabel(name, getSportTemplate(name));
            select.appendChild(option);
        });
    }

    _wireEvents() {
        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            this._addListener(sportSelect, 'change', () => {
                this.state.sport = sportSelect.value;
                this._onSportChanged();
            });
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        if (runoffInput && runoffSlider) {
            this._addListener(runoffInput, 'input', () => {
                if (runoffInput.value === '') {
                    this.state.setup.customRunoff = null;
                    runoffSlider.value = String(this._getRunoffDistance());
                    this._onStateChanged();
                    return;
                }

                const nextValue = Number(runoffInput.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffSlider.value = runoffInput.value;
                this._onStateChanged();
            });
            this._addListener(runoffSlider, 'input', () => {
                const nextValue = Number(runoffSlider.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffInput.value = runoffSlider.value;
                this._onStateChanged();
            });
        }

        Object.keys(NUMERIC_INPUT_STATE_PATHS).forEach((baseId) => {
            this._bindPairedNumberControl(baseId);
        });

        ['enableTier1', 'enableTier2', 'enableTier3'].forEach((id, index) => {
            this._bindCheckboxControl(id, () => this._handleTierToggle(index + 1));
        });

        [2, 3].forEach((tierNum) => {
            const sectionEl = getHtmlElement(`tier${tierNum}Section`);
            if (!sectionEl) return;

            const markInitialized = (event) => {
                const target = event?.target;
                if (!target || target.id === `enableTier${tierNum}` || !hasSectionBodyTarget(target)) return;
                if (tierNum === 2) this._tier2Initialized = true;
                if (tierNum === 3) this._tier3Initialized = true;
            };

            this._addListener(sectionEl, 'input', markInitialized);
            this._addListener(sectionEl, 'change', markInitialized);
        });

        ['profileType', 't2ProfileType', 't3ProfileType'].forEach((id) => {
            this._bindSelectControl(id);
        });

        this._bindCheckboxControl('enableClipPlane', (enabled) => {
            const controls = getHtmlElement('clipPlaneControls');
            if (controls) controls.style.display = enabled ? 'block' : 'none';
        });
        ['clipAxis', 'clipSide'].forEach((id) => this._bindSelectControl(id));

        this._bindSelectControl('bowlType', (value) => {
            const sideRow = getHtmlElement('sideLengthRow');
            if (sideRow) sideRow.style.display = String(value || '').includes('Side') ? 'flex' : 'none';
        });

        this._bindCheckboxControl('showSeatCubes3D');

        const sightlinesBtn = getInputElement('toggleSightlinesBtn');
        const sightlinesBtnField = getInputElement('toggleSightlinesBtnField');
        const syncSightlinesToggles = (sourceEl) => {
            const checked = !!sourceEl?.checked;
            this.state.setup.sightlineVisuals = checked;
            if (sightlinesBtn && sightlinesBtn !== sourceEl) sightlinesBtn.checked = checked;
            if (sightlinesBtnField && sightlinesBtnField !== sourceEl) sightlinesBtnField.checked = checked;
            this._onStateChanged();
        };
        if (sightlinesBtn) {
            this._addListener(sightlinesBtn, 'change', () => syncSightlinesToggles(sightlinesBtn));
        }
        if (sightlinesBtnField) {
            this._addListener(sightlinesBtnField, 'change', () => syncSightlinesToggles(sightlinesBtnField));
        }

        this._bindCheckboxControl('toggleSectionMetricsBtn');
    }

    _bindPairedNumberControl(baseId) {
        const path = NUMERIC_INPUT_STATE_PATHS[baseId];
        if (!path) return;

        const slider = getInputElement(`${baseId}Slider`);
        const input = getInputElement(`${baseId}Input`);

        if (slider) {
            this._addListener(slider, 'input', () => {
                const nextValue = normalizeNumericControlValue(baseId, slider.value);
                if (nextValue === null) return;
                setValueAtPath(this.state, path, nextValue);
                if (input) input.value = slider.value;
                this._onStateChanged();
            });
        }

        if (input) {
            this._addListener(input, 'input', () => {
                const nextValue = normalizeNumericControlValue(baseId, input.value);
                if (nextValue === null) return;
                setValueAtPath(this.state, path, nextValue);
                if (slider) slider.value = input.value;
                this._onStateChanged();
            });
        }
    }

    _bindSelectControl(id, handler = null) {
        const path = SELECT_STATE_PATHS[id];
        const el = getSelectElement(id);
        if (!el || !path) return;

        this._addListener(el, 'change', () => {
            setValueAtPath(this.state, path, el.value);
            if (typeof handler === 'function') {
                handler(el.value);
            }
            this._onStateChanged();
        });
    }

    _bindCheckboxControl(id, handler = null) {
        const path = CHECKBOX_STATE_PATHS[id];
        const el = getInputElement(id);
        if (!el || !path) return;

        this._addListener(el, 'change', () => {
            setValueAtPath(this.state, path, !!el.checked);
            if (typeof handler === 'function') {
                handler(!!el.checked);
            }
            this._onStateChanged();
        });
    }

    _handleTierToggle(tierNum) {
        const enabled = !!this.state.tiers?.[tierNum - 1]?.enabled;
        updateTierSectionState(getHtmlElement(`tier${tierNum}Section`), enabled);

        if (enabled && tierNum > 1) {
            const isInitialized = tierNum === 2 ? this._tier2Initialized : this._tier3Initialized;
            if (!isInitialized) {
                const tierState = this.state.tiers?.[tierNum - 1];
                const defaults = this._getTierDefaults(tierNum);
                if (tierState && defaults && typeof defaults === 'object') {
                    Object.assign(tierState, defaults);
                }
            }

            if (tierNum === 2) this._tier2Initialized = true;
            if (tierNum === 3) this._tier3Initialized = true;
        }

        this.syncFromState();
    }

    _setInputValue(id, value) {
        const input = getInputElement(`${id}Input`);
        const slider = getInputElement(`${id}Slider`);
        if (input) input.value = String(value);
        if (slider) slider.value = String(value);
    }

    _addListener(target, eventName, handler) {
        target.addEventListener(eventName, handler);
        this._cleanup.push(() => target.removeEventListener(eventName, handler));
    }
}
