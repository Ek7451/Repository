import { getSportNames, getTemplate as getSportTemplate } from '../core/sports-templates.js';
import { buildNextTierDefaultsFromTiers } from '../core/profile-solver.js';
import {
    buildFocalPointFt,
    buildFocalXControlConfig,
    getRunoffDistance,
    resolveSportTemplate
} from '../state/app-state.js';

const NUMERIC_INPUT_STATE_PATHS = {
    focalX: ['setup', 'focalX'],
    focalZ: ['setup', 'focalZ'],
    bowlCornerRad: ['bowl', 'cornerRad'],
    bowlSideLength: ['bowl', 'sideLength'],
    structuralDepth: ['bowl', 'structuralDepth'],
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
    profileType: ['tiers', 0, 'profileType'],
    t2ProfileType: ['tiers', 1, 'profileType'],
    t3ProfileType: ['tiers', 2, 'profileType']
};
const CHECKBOX_STATE_PATHS = {
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

function clampValueToBounds(value, { min = value, max = value } = {}) {
    return Math.max(min, Math.min(max, value));
}

function syncNumericElementBounds(element, { min, max, step }) {
    if (!element) return;
    element.min = String(min);
    element.max = String(max);
    element.step = String(step);
}

function hasSectionBodyTarget(target) {
    return !!target && typeof target.closest === 'function' && target.closest('.section-body');
}

export class EditorControls {
    constructor(options = {}) {
        const settings = /** @type {{
            state?: object,
            onChange?: ((change: { reason: string, controlId: string }) => void)
        }} */ (options && typeof options === 'object' ? options : {});

        this.state = settings.state && typeof settings.state === 'object'
            ? settings.state
            : {};
        this._onChange = typeof settings.onChange === 'function'
            ? settings.onChange
            : () => {};

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
        const focalXControl = buildFocalXControlConfig(this.state);

        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            sportSelect.value = this.state.sport;
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        const runoffValue = this._resolveRunoffDistance();
        if (runoffInput) {
            runoffInput.value = String(this.state.setup?.customRunoff ?? '');
        }
        if (runoffSlider) {
            runoffSlider.value = String(runoffValue);
        }

        this._syncFocalXControlBounds(focalXControl);

        Object.entries(NUMERIC_INPUT_STATE_PATHS).forEach(([baseId, path]) => {
            const value = baseId === 'focalX'
                ? focalXControl.value
                : getValueAtPath(this.state, path);
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

        [1, 2, 3].forEach((tierNum) => {
            updateTierSectionState(
                getHtmlElement(`tier${tierNum}Section`),
                !!this.state.tiers?.[tierNum - 1]?.enabled
            );
        });
    }

    applyImportedConfig(config) {
        this._tier2Initialized = Array.isArray(config?.tiers) && config.tiers.length > 1;
        this._tier3Initialized = Array.isArray(config?.tiers) && config.tiers.length > 2;
    }

    hydrateTierInitialization(config) {
        this.applyImportedConfig(config);
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
                this._emitChange('sport', 'sportSelect');
            });
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        if (runoffInput && runoffSlider) {
            this._addListener(runoffInput, 'input', () => {
                if (runoffInput.value === '') {
                    this.state.setup.customRunoff = null;
                    runoffSlider.value = String(this._resolveRunoffDistance());
                    this._emitChange('state', 'customRunoffInput');
                    return;
                }

                const nextValue = Number(runoffInput.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffSlider.value = runoffInput.value;
                this._emitChange('state', 'customRunoffInput');
            });
            this._addListener(runoffSlider, 'input', () => {
                const nextValue = Number(runoffSlider.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffInput.value = runoffSlider.value;
                this._emitChange('state', 'customRunoffSlider');
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
            this._emitChange('state', sourceEl?.id || 'toggleSightlines');
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
        const getClampedValue = (rawValue) => {
            const nextValue = normalizeNumericControlValue(baseId, rawValue);
            if (nextValue === null) return null;
            if (baseId !== 'focalX') {
                return nextValue;
            }

            const focalXControl = buildFocalXControlConfig(this.state);
            this._syncFocalXControlBounds(focalXControl);
            return clampValueToBounds(nextValue, focalXControl);
        };

        if (slider) {
            this._addListener(slider, 'input', () => {
                const nextValue = getClampedValue(slider.value);
                if (nextValue === null) return;
                setValueAtPath(this.state, path, nextValue);
                slider.value = String(nextValue);
                if (input) input.value = String(nextValue);
                this._emitChange('state', `${baseId}Slider`);
            });
        }

        if (input) {
            this._addListener(input, 'input', () => {
                const nextValue = getClampedValue(input.value);
                if (nextValue === null) return;
                setValueAtPath(this.state, path, nextValue);
                input.value = String(nextValue);
                if (slider) slider.value = String(nextValue);
                this._emitChange('state', `${baseId}Input`);
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
            this._emitChange('state', id);
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
            this._emitChange('state', id);
        });
    }

    _handleTierToggle(tierNum) {
        const enabled = !!this.state.tiers?.[tierNum - 1]?.enabled;
        updateTierSectionState(getHtmlElement(`tier${tierNum}Section`), enabled);

        if (enabled && tierNum > 1) {
            const isInitialized = tierNum === 2 ? this._tier2Initialized : this._tier3Initialized;
            if (!isInitialized) {
                const tierState = this.state.tiers?.[tierNum - 1];
                const defaults = this._resolveTierDefaults(tierNum);
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

    _syncFocalXControlBounds(controlConfig) {
        syncNumericElementBounds(getInputElement('focalXSlider'), controlConfig);
        syncNumericElementBounds(getInputElement('focalXInput'), controlConfig);
    }

    _addListener(target, eventName, handler) {
        target.addEventListener(eventName, handler);
        this._cleanup.push(() => target.removeEventListener(eventName, handler));
    }

    _emitChange(reason, controlId) {
        this._onChange({
            reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'state',
            controlId: typeof controlId === 'string' && controlId.trim() ? controlId.trim() : 'unknown'
        });
    }

    _resolveRunoffDistance() {
        return getRunoffDistance(this.state, resolveSportTemplate(this.state));
    }

    _resolveTierDefaults(tierNum) {
        return buildNextTierDefaultsFromTiers(
            this.state?.tiers,
            buildFocalPointFt(this.state),
            tierNum
        );
    }
}
