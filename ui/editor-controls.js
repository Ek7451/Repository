import { getSportNames, getTemplate as getSportTemplate } from '../core/sports-templates.js';
import { buildNextTierDefaultsFromTiers } from '../core/profile-solver.js';
import {
    buildTierInitializationFlags,
    buildFocalPointFt,
    buildFocalXControlConfig,
    buildTierRowCountControlConfigs,
    getRunoffDistance,
    resolveSportTemplate
} from '../state/app-state.js';

const NUMERIC_INPUT_STATE_PATHS = {
    focalX: ['setup', 'focalX'],
    focalZ: ['setup', 'focalZ'],
    bowlCornerRad: ['bowl', 'cornerRad'],
    bowlSideLength: ['bowl', 'sideLength'],
    bowlEndLength: ['bowl', 'endLength'],
    structuralDepth: ['bowl', 'structuralDepth'],
    seatWidth: ['occupancy', 'seatWidth'],
    minAisle: ['occupancy', 'minAisle'],
    maxAisle: ['occupancy', 'maxAisle'],
    seatsBetweenAisles: ['occupancy', 'seatsBetweenAisles'],
    egressFactor: ['occupancy', 'egressFactor'],
    accessibilityCompanionRatio: ['accessibility', 'companionSeatsPerWheelchair'],
    accessibilityWheelchairArea: ['accessibility', 'wheelchairAreaSqFt'],
    accessibilityCompanionArea: ['accessibility', 'companionAreaSqFt'],
    accessibilitySpacesUpTo25: ['accessibility', 'wheelchairSpaceRequirements', 'upto25'],
    accessibilitySpacesUpTo50: ['accessibility', 'wheelchairSpaceRequirements', 'upto50'],
    accessibilitySpacesUpTo150: ['accessibility', 'wheelchairSpaceRequirements', 'upto150'],
    accessibilitySpacesUpTo300: ['accessibility', 'wheelchairSpaceRequirements', 'upto300'],
    accessibilitySpacesUpTo500: ['accessibility', 'wheelchairSpaceRequirements', 'upto500'],
    accessibilitySpacesOver500Base: ['accessibility', 'wheelchairSpaceRequirements', 'over500Base'],
    accessibilitySpacesOver500StepOccupants: ['accessibility', 'wheelchairSpaceRequirements', 'over500StepOccupants'],
    accessibilitySpacesOver500StepSpaces: ['accessibility', 'wheelchairSpaceRequirements', 'over500StepSpaces'],
    accessibilitySpacesOver5000Base: ['accessibility', 'wheelchairSpaceRequirements', 'over5000Base'],
    accessibilitySpacesOver5000StepOccupants: ['accessibility', 'wheelchairSpaceRequirements', 'over5000StepOccupants'],
    accessibilitySpacesOver5000StepSpaces: ['accessibility', 'wheelchairSpaceRequirements', 'over5000StepSpaces'],
    accessibilityZonesUpTo1Space: ['accessibility', 'wheelchairZoneRequirements', 'upto1Space'],
    accessibilityZonesUpTo4Spaces: ['accessibility', 'wheelchairZoneRequirements', 'upto4Spaces'],
    accessibilityZonesUpTo8Spaces: ['accessibility', 'wheelchairZoneRequirements', 'upto8Spaces'],
    accessibilityZonesUpTo16Spaces: ['accessibility', 'wheelchairZoneRequirements', 'upto16Spaces'],
    accessibilityZonesOver16Base: ['accessibility', 'wheelchairZoneRequirements', 'over16Base'],
    accessibilityZonesOver16StepSpaces: ['accessibility', 'wheelchairZoneRequirements', 'over16StepSpaces'],
    accessibilityZonesOver16StepZones: ['accessibility', 'wheelchairZoneRequirements', 'over16StepZones'],
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
    structuralProfileMode: ['bowl', 'structuralProfileMode'],
    straightAisleMode: ['bowl', 'straightAisleMode'],
    chamferAisleMode: ['bowl', 'chamferAisleMode'],
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
    'seatsBetweenAisles',
    'accessibilitySpacesUpTo25',
    'accessibilitySpacesUpTo50',
    'accessibilitySpacesUpTo150',
    'accessibilitySpacesUpTo300',
    'accessibilitySpacesUpTo500',
    'accessibilitySpacesOver500Base',
    'accessibilitySpacesOver500StepOccupants',
    'accessibilitySpacesOver500StepSpaces',
    'accessibilitySpacesOver5000Base',
    'accessibilitySpacesOver5000StepOccupants',
    'accessibilitySpacesOver5000StepSpaces',
    'accessibilityZonesUpTo1Space',
    'accessibilityZonesUpTo4Spaces',
    'accessibilityZonesUpTo8Spaces',
    'accessibilityZonesUpTo16Spaces',
    'accessibilityZonesOver16Base',
    'accessibilityZonesOver16StepSpaces',
    'accessibilityZonesOver16StepZones'
]);
const DEFAULT_BOWL_TYPE_OPTIONS = [
    { value: 'Full', label: 'Full Bowl' },
    { value: 'U-End1', label: 'C-Shape' },
    { value: 'U-End2', label: 'U-Shape' },
    { value: 'Side1', label: '1-Sided' },
    { value: 'Sides', label: '2-Sided' },
    { value: 'Sides3', label: '3-Sided' },
    { value: 'Sides4', label: '4-Sided' }
];
const TIER_POSITION_CONTROL_IDS = [
    {
        distance: 'firstRowDist',
        elevation: 'firstRowElev'
    },
    {
        distance: 't2FirstRowDist',
        elevation: 't2FirstRowElev'
    },
    {
        distance: 't3FirstRowDist',
        elevation: 't3FirstRowElev'
    }
];
const TIER_ROW_COUNT_CONTROL_IDS = [
    'numRows',
    't2NumRows',
    't3NumRows'
];

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

function normalizeBowlType(value) {
    if (typeof value !== 'string' || !value.trim()) return 'Full';

    const normalized = value.trim();
    if (normalized === 'Side3') return 'Sides3';
    if (normalized === 'Side4') return 'Sides4';
    if (normalized === 'Side2') return 'Sides';
    return normalized;
}

function formatBowlTypeLabel(value, fallbackLabel = null) {
    const normalized = normalizeBowlType(value);
    const fallback = typeof fallbackLabel === 'string' && fallbackLabel.trim()
        ? fallbackLabel.trim()
        : null;
    const labelMap = {
        Full: 'Full Bowl',
        'U-End1': 'C-Shape',
        'U-End2': 'U-Shape',
        Side1: '1-Sided',
        Side2: '2-Sided',
        Sides: '2-Sided',
        Sides3: '3-Sided',
        Sides4: '4-Sided',
        Side3: '3-Sided',
        Side4: '4-Sided'
    };

    return fallback || labelMap[normalized] || normalized;
}

function normalizeBowlTypeOption(option) {
    if (typeof option === 'string') {
        const value = normalizeBowlType(option);
        return { value, label: formatBowlTypeLabel(value) };
    }

    if (!option || typeof option !== 'object') return null;

    const value = normalizeBowlType(option.value ?? option.id ?? option.name ?? option.type);
    return {
        value,
        label: formatBowlTypeLabel(value, option.label ?? option.text ?? option.title),
        hidden: !!option.hidden
    };
}

function normalizeBowlTypeOptions(rawOptions) {
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
        return DEFAULT_BOWL_TYPE_OPTIONS.slice();
    }

    const seen = new Set();
    const normalized = [];
    rawOptions.forEach((option) => {
        const nextOption = normalizeBowlTypeOption(option);
        if (!nextOption || seen.has(nextOption.value)) return;
        seen.add(nextOption.value);
        normalized.push(nextOption);
    });

    return normalized.length > 0 ? normalized : DEFAULT_BOWL_TYPE_OPTIONS.slice();
}

function resolveBowlTypeOptionsFromTemplate(template) {
    const bowlDefaults = template?.defaults?.bowl && typeof template.defaults.bowl === 'object'
        ? template.defaults.bowl
        : {};
    const rawOptions = bowlDefaults.typeOptions
        ?? bowlDefaults.bowlTypeOptions
        ?? bowlDefaults.types
        ?? template?.bowlTypeOptions
        ?? template?.bowlTypes
        ?? template?.types
        ?? null;
    return normalizeBowlTypeOptions(rawOptions);
}

function shouldShowPrimarySideLengthRow(type) {
    return ['Side1', 'Side2', 'Sides', 'Sides3', 'Sides4'].includes(normalizeBowlType(type));
}

function shouldShowSecondarySideLengthRow(type) {
    return ['Sides3', 'Sides4', 'U-End1', 'U-End2', 'U-Shape', 'C-Shape'].includes(normalizeBowlType(type));
}

function resolveSideLengthRowLabels(type) {
    const normalized = normalizeBowlType(type);
    return {
        primary: ['Sides3', 'Sides4'].includes(normalized) ? 'Sides Length 1/2' : 'Sides Length 1/2',
        secondary: ['U-End1', 'U-End2', 'U-Shape', 'C-Shape'].includes(normalized)
            ? 'Open Ends Length'
            : 'Sides Length 3/4'
    };
}

function clearSelectOptions(select) {
    if (!select) return;
    if (typeof select.replaceChildren === 'function') {
        select.replaceChildren();
        return;
    }

    if (Array.isArray(select.children)) {
        select.children.length = 0;
    }
    if (typeof select.innerHTML === 'string') {
        select.innerHTML = '';
    }
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

function isFractionalStepValue(rawStep) {
    const step = Number(rawStep);
    return Number.isFinite(step) && step > 0 && !Number.isInteger(step);
}

function shouldPreserveFractionalInputString(input, slider) {
    return isFractionalStepValue(input?.step) || isFractionalStepValue(slider?.step);
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
        this._pendingManualCommitIds = new Set();
        this._immediateManualCommitIds = new Set();
        this._manualCommitRegistrations = new Map();
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
        this._pendingManualCommitIds.clear();
        this._immediateManualCommitIds.clear();
        this._manualCommitRegistrations.clear();
    }

    syncFromState() {
        const focalXControl = buildFocalXControlConfig(this.state);
        const tierRowCountControls = buildTierRowCountControlConfigs(this.state);
        const template = resolveSportTemplate(this.state);
        if (this.state?.bowl && typeof this.state.bowl === 'object') {
            this.state.bowl.type = normalizeBowlType(this.state.bowl.type);
        }

        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            sportSelect.value = this.state.sport;
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        const runoffValue = this._resolveRunoffDistance();
        if (runoffInput) {
            runoffInput.value = String(this.state.setup?.customRunoff ?? '');
            this._clearPendingManualCommit('customRunoffInput');
            this._clearImmediateManualCommit('customRunoffInput');
        }
        if (runoffSlider) {
            runoffSlider.value = String(runoffValue);
        }

        this._populateBowlTypes(template);
        this._syncFocalXControlBounds(focalXControl);
        this._syncTierRowCountControlBounds(tierRowCountControls);

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
                el.value = id === 'bowlType' ? normalizeBowlType(value) : value;
            }
        });

        this._syncBowlLengthControls(template);

        Object.entries(CHECKBOX_STATE_PATHS).forEach(([id, path]) => {
            const el = getInputElement(id);
            if (!el) return;
            el.checked = !!getValueAtPath(this.state, path);
        });

        this._syncBowlLengthVisibility(this.state.bowl?.type);

        [1, 2, 3].forEach((tierNum) => {
            updateTierSectionState(
                getHtmlElement(`tier${tierNum}Section`),
                !!this.state.tiers?.[tierNum - 1]?.enabled
            );
        });
    }

    applyImportedConfig(_config) {
        const { tier2Initialized, tier3Initialized } = buildTierInitializationFlags(this.state);
        this._tier2Initialized = tier2Initialized;
        this._tier3Initialized = tier3Initialized;
    }

    hydrateTierInitialization(config) {
        this.applyImportedConfig(config);
    }

    /**
     * @param {{
     *   tierIndex?: number,
     *   firstRowDist?: number,
     *   firstRowElev?: number
     * }} [payload]
     */
    applyTierCanvasPosition({ tierIndex, firstRowDist, firstRowElev } = {}) {
        const nextTierIndex = Number(tierIndex);
        if (!Number.isInteger(nextTierIndex) || nextTierIndex < 0 || nextTierIndex > 2) {
            return false;
        }

        const tierState = this.state?.tiers?.[nextTierIndex];
        if (!tierState || typeof tierState !== 'object' || !tierState.enabled) {
            return false;
        }

        const controlIds = TIER_POSITION_CONTROL_IDS[nextTierIndex];
        if (!controlIds) return false;

        const nextDistance = this._normalizeCanvasTierValue(controlIds.distance, firstRowDist);
        const nextElevation = this._normalizeCanvasTierValue(controlIds.elevation, firstRowElev);
        if (nextDistance === null || nextElevation === null) {
            return false;
        }

        if (
            tierState.firstRowDist === nextDistance &&
            tierState.firstRowElev === nextElevation
        ) {
            return false;
        }

        tierState.firstRowDist = nextDistance;
        tierState.firstRowElev = nextElevation;
        this._markTierInitialized(nextTierIndex + 1);
        this._setInputValue(controlIds.distance, nextDistance);
        this._setInputValue(controlIds.elevation, nextElevation);
        this._emitChange('state', 'profileCanvasTierDrag');
        return true;
    }

    /**
     * @param {{
     *   tierIndex?: number,
     *   numRows?: number
     * }} [payload]
     */
    applyTierCanvasRowCount({ tierIndex, numRows } = {}) {
        const nextTierIndex = Number(tierIndex);
        if (!Number.isInteger(nextTierIndex) || nextTierIndex < 0 || nextTierIndex > 2) {
            return false;
        }

        const tierState = this.state?.tiers?.[nextTierIndex];
        if (!tierState || typeof tierState !== 'object' || !tierState.enabled) {
            return false;
        }

        const controlId = TIER_ROW_COUNT_CONTROL_IDS[nextTierIndex];
        if (!controlId) return false;

        const nextNumRows = this._normalizeCanvasTierValue(controlId, numRows);
        if (nextNumRows === null || tierState.numRows === nextNumRows) {
            return false;
        }

        tierState.numRows = nextNumRows;
        this._markTierInitialized(nextTierIndex + 1);
        this._setInputValue(controlId, nextNumRows);
        this._emitChange('state', 'profileCanvasTierRowCountDrag');
        return true;
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

    _populateBowlTypes(template = resolveSportTemplate(this.state)) {
        const select = getSelectElement('bowlType');
        if (!select) return;

        const options = resolveBowlTypeOptionsFromTemplate(template);
        const currentValue = normalizeBowlType(this.state?.bowl?.type);
        const nextValue = options.some((option) => option.value === currentValue)
            ? currentValue
            : (options[0]?.value || 'Full');

        clearSelectOptions(select);
        options.forEach((option) => {
            const el = document.createElement('option');
            el.value = option.value;
            el.textContent = option.label;
            if (option.hidden) {
                el.hidden = true;
            }
            select.appendChild(el);
        });

        select.value = nextValue;
    }

    _syncBowlLengthControls(template = resolveSportTemplate(this.state)) {
        const bowlDefaults = template?.defaults?.bowl && typeof template.defaults.bowl === 'object'
            ? template.defaults.bowl
            : {};
        const primaryValue = this.state?.bowl?.sideLength
            ?? bowlDefaults.sideLength
            ?? bowlDefaults.sideLength12
            ?? bowlDefaults.sideLength1
            ?? bowlDefaults.sideLength2
            ?? '';
        const secondaryValue = this.state?.bowl?.endLength
            ?? bowlDefaults.endLength
            ?? bowlDefaults.sideLength34
            ?? bowlDefaults.sideLength3
            ?? bowlDefaults.sideLength4
            ?? bowlDefaults.openEndLength
            ?? bowlDefaults.sideLength
            ?? primaryValue
            ?? '';

        this._setInputValue('bowlSideLength', primaryValue);
        this._setInputValue('bowlEndLength', secondaryValue);
        this._syncBowlLengthVisibility(this.state?.bowl?.type);
    }

    _syncBowlLengthVisibility(bowlType) {
        const type = normalizeBowlType(bowlType);
        const primaryRow = getHtmlElement('sideLengthRow');
        const secondaryRow = getHtmlElement('sideLength34Row');
        const labels = resolveSideLengthRowLabels(type);

        if (primaryRow) {
            primaryRow.hidden = !shouldShowPrimarySideLengthRow(type);
        }
        if (secondaryRow) {
            secondaryRow.hidden = !shouldShowSecondarySideLengthRow(type);
        }

        const primaryLabel = getHtmlElement('sideLengthRowLabel');
        if (primaryLabel) {
            primaryLabel.textContent = labels.primary;
        }

        const secondaryLabel = getHtmlElement('sideLength34RowLabel');
        if (secondaryLabel) {
            secondaryLabel.textContent = labels.secondary;
        }
    }

    _wireEvents() {
        this._addListener(document, 'pointerdown', (event) => {
            this._handleDocumentPointerDown(event);
        });

        const sportSelect = getSelectElement('sportSelect');
        if (sportSelect) {
            this._addListener(sportSelect, 'change', () => {
                this.state.sport = sportSelect.value;
                this._populateBowlTypes();
                this._syncBowlLengthControls();
                this._emitChange('sport', 'sportSelect');
            });
        }

        const runoffInput = getInputElement('customRunoffInput');
        const runoffSlider = getInputElement('customRunoffSlider');
        if (runoffInput && runoffSlider) {
            const commitRunoffInput = () => {
                this._commitManualInput('customRunoffInput', () => {
                    if (runoffInput.value === '') {
                        this.state.setup.customRunoff = null;
                        runoffInput.value = '';
                        runoffSlider.value = String(this._resolveRunoffDistance());
                        return;
                    }

                    const nextValue = Number(runoffInput.value);
                    if (!Number.isFinite(nextValue)) {
                        const currentValue = this.state.setup?.customRunoff;
                        runoffInput.value = currentValue === undefined || currentValue === null
                            ? ''
                            : String(currentValue);
                        runoffSlider.value = String(this._resolveRunoffDistance());
                        return;
                    }

                    this.state.setup.customRunoff = nextValue;
                    runoffInput.value = String(nextValue);
                    runoffSlider.value = String(nextValue);
                });
            };
            this._registerManualCommitHandler('customRunoffInput', runoffInput, commitRunoffInput);
            this._addListener(runoffInput, 'pointerdown', () => {
                this._markImmediateManualCommit('customRunoffInput');
            });
            this._addListener(runoffInput, 'input', () => {
                this._markManualInputPending('customRunoffInput');
                if (runoffInput.value === '') {
                    this.state.setup.customRunoff = null;
                    runoffSlider.value = String(this._resolveRunoffDistance());
                    if (this._consumeImmediateManualCommit('customRunoffInput')) {
                        commitRunoffInput();
                    }
                    return;
                }

                const nextValue = Number(runoffInput.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                runoffSlider.value = runoffInput.value;
                if (this._consumeImmediateManualCommit('customRunoffInput')) {
                    commitRunoffInput();
                }
            });
            this._addListener(runoffInput, 'blur', () => {
                commitRunoffInput();
            });
            this._addListener(runoffInput, 'keydown', (event) => {
                if (event?.key === 'ArrowUp' || event?.key === 'ArrowDown') {
                    this._markImmediateManualCommit('customRunoffInput');
                    return;
                }
                this._clearImmediateManualCommit('customRunoffInput');
                if (event?.key !== 'Enter') return;
                event.preventDefault?.();
                commitRunoffInput();
            });
            this._addListener(runoffSlider, 'input', () => {
                const nextValue = Number(runoffSlider.value);
                if (!Number.isFinite(nextValue)) return;
                this.state.setup.customRunoff = nextValue;
                this._clearPendingManualCommit('customRunoffInput');
                this._clearImmediateManualCommit('customRunoffInput');
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

        [
            'structuralProfileMode',
            'straightAisleMode',
            'chamferAisleMode',
            'profileType',
            't2ProfileType',
            't3ProfileType'
        ].forEach((id) => {
            this._bindSelectControl(id);
        });

        this._bindSelectControl('bowlType', (value) => {
            this.state.bowl.type = normalizeBowlType(value);
            this._syncBowlLengthVisibility(value);
            this._syncBowlLengthControls();
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
        const preservesFractionalInputString = shouldPreserveFractionalInputString(input, slider);
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
                this._clearPendingManualCommit(`${baseId}Input`);
                this._clearImmediateManualCommit(`${baseId}Input`);
                slider.value = String(nextValue);
                if (input) input.value = String(nextValue);
                this._emitChange('state', `${baseId}Slider`);
            });
        }

        if (input) {
            const commitManualInput = () => {
                this._commitManualInput(`${baseId}Input`, () => {
                    const nextValue = getClampedValue(input.value);
                    if (nextValue === null) {
                        const currentValue = baseId === 'focalX'
                            ? buildFocalXControlConfig(this.state).value
                            : getValueAtPath(this.state, path);
                        input.value = currentValue === undefined || currentValue === null
                            ? ''
                            : String(currentValue);
                        if (slider && currentValue !== undefined && currentValue !== null) {
                            slider.value = String(currentValue);
                        }
                        return;
                    }

                    input.value = String(nextValue);
                    if (slider) slider.value = String(nextValue);
                });
            };
            this._registerManualCommitHandler(`${baseId}Input`, input, commitManualInput);
            this._addListener(input, 'pointerdown', () => {
                this._markImmediateManualCommit(`${baseId}Input`);
            });
            this._addListener(input, 'input', () => {
                const controlId = `${baseId}Input`;
                this._markManualInputPending(controlId);
                const nextValue = getClampedValue(input.value);
                if (nextValue === null) return;
                setValueAtPath(this.state, path, nextValue);
                if (!preservesFractionalInputString) {
                    input.value = String(nextValue);
                }
                if (slider) slider.value = String(nextValue);
                if (this._consumeImmediateManualCommit(controlId)) {
                    commitManualInput();
                }
            });

            this._addListener(input, 'blur', () => {
                commitManualInput();
            });
            this._addListener(input, 'keydown', (event) => {
                if (event?.key === 'ArrowUp' || event?.key === 'ArrowDown') {
                    this._markImmediateManualCommit(`${baseId}Input`);
                    return;
                }
                this._clearImmediateManualCommit(`${baseId}Input`);
                if (event?.key !== 'Enter') return;
                event.preventDefault?.();
                commitManualInput();
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

            this._markTierInitialized(tierNum);
        }

        this.syncFromState();
    }

    _setInputValue(id, value) {
        const input = getInputElement(`${id}Input`);
        const slider = getInputElement(`${id}Slider`);
        if (input) {
            input.value = String(value);
            this._clearPendingManualCommit(`${id}Input`);
            this._clearImmediateManualCommit(`${id}Input`);
        }
        if (slider) slider.value = String(value);
    }

    _syncFocalXControlBounds(controlConfig) {
        syncNumericElementBounds(getInputElement('focalXSlider'), controlConfig);
        syncNumericElementBounds(getInputElement('focalXInput'), controlConfig);
    }

    _syncTierRowCountControlBounds(controlConfigs = []) {
        TIER_ROW_COUNT_CONTROL_IDS.forEach((baseId, tierIndex) => {
            const controlConfig = controlConfigs[tierIndex];
            if (!controlConfig) return;
            syncNumericElementBounds(getInputElement(`${baseId}Slider`), controlConfig);
            syncNumericElementBounds(getInputElement(`${baseId}Input`), controlConfig);
        });
    }

    _normalizeCanvasTierValue(baseId, rawValue) {
        const nextValue = normalizeNumericControlValue(baseId, rawValue);
        if (nextValue === null) return null;

        const slider = getInputElement(`${baseId}Slider`);
        const input = getInputElement(`${baseId}Input`);
        const bounds = {
            min: this._resolveNumericBound('min', slider, input, nextValue),
            max: this._resolveNumericBound('max', slider, input, nextValue)
        };
        const clampedValue = clampValueToBounds(nextValue, bounds);
        const step = this._resolveNumericStep(slider, input);
        if (!(step > 0) || INTEGER_INPUT_IDS.has(baseId)) {
            return clampedValue;
        }

        const min = Number.isFinite(bounds.min) ? bounds.min : 0;
        const roundedValue = Math.round((clampedValue - min) / step) * step + min;
        return Number(roundedValue.toFixed(this._countStepDecimals(step)));
    }

    _resolveNumericBound(boundName, slider, input, fallbackValue) {
        const bounds = [slider?.[boundName], input?.[boundName]]
            .map((value) => Number(value))
            .filter(Number.isFinite);
        if (!bounds.length) return fallbackValue;
        return boundName === 'min' ? Math.max(...bounds) : Math.min(...bounds);
    }

    _resolveNumericStep(slider, input) {
        const steps = [input?.step, slider?.step]
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
        return steps.length ? steps[0] : 0;
    }

    _countStepDecimals(step) {
        const stepText = String(step);
        const decimalIndex = stepText.indexOf('.');
        return decimalIndex >= 0 ? stepText.length - decimalIndex - 1 : 0;
    }

    _markTierInitialized(tierNum) {
        if (tierNum === 2) this._tier2Initialized = true;
        if (tierNum === 3) this._tier3Initialized = true;
    }

    _markManualInputPending(controlId) {
        if (typeof controlId !== 'string' || !controlId.trim()) return;
        this._pendingManualCommitIds.add(controlId.trim());
    }

    _clearPendingManualCommit(controlId) {
        if (typeof controlId !== 'string' || !controlId.trim()) return;
        this._pendingManualCommitIds.delete(controlId.trim());
    }

    _markImmediateManualCommit(controlId) {
        if (typeof controlId !== 'string' || !controlId.trim()) return;
        this._immediateManualCommitIds.add(controlId.trim());
    }

    _clearImmediateManualCommit(controlId) {
        if (typeof controlId !== 'string' || !controlId.trim()) return;
        this._immediateManualCommitIds.delete(controlId.trim());
    }

    _consumeImmediateManualCommit(controlId) {
        const normalizedControlId = typeof controlId === 'string' ? controlId.trim() : '';
        if (!normalizedControlId || !this._immediateManualCommitIds.has(normalizedControlId)) {
            return false;
        }

        this._immediateManualCommitIds.delete(normalizedControlId);
        return true;
    }

    _registerManualCommitHandler(controlId, element, commit) {
        if (typeof controlId !== 'string' || !controlId.trim()) return;
        if (!element || typeof commit !== 'function') return;
        this._manualCommitRegistrations.set(controlId.trim(), {
            element,
            commit
        });
    }

    _commitManualInput(controlId, applyCommit) {
        const normalizedControlId = typeof controlId === 'string' ? controlId.trim() : '';
        if (!normalizedControlId || !this._pendingManualCommitIds.has(normalizedControlId)) {
            return false;
        }

        if (typeof applyCommit === 'function') {
            applyCommit();
        }

        this._pendingManualCommitIds.delete(normalizedControlId);
        this._immediateManualCommitIds.delete(normalizedControlId);
        this._emitChange('state', normalizedControlId);
        return true;
    }

    _handleDocumentPointerDown(event) {
        const activeElement = document?.activeElement;
        const activeControlId = typeof activeElement?.id === 'string' ? activeElement.id.trim() : '';
        if (!activeControlId || !this._pendingManualCommitIds.has(activeControlId)) {
            return;
        }

        const registration = this._manualCommitRegistrations.get(activeControlId);
        if (!registration?.element || typeof registration.commit !== 'function') {
            return;
        }

        if (event?.target === registration.element) {
            return;
        }

        registration.commit();
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
