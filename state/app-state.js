import {
    clampTemplateFocalXFt,
    FOCAL_X_STEP_FT,
    getTemplate,
    resolveTemplateFocalXBoundsFt
} from '../core/sports-templates.js';

const APP_STATE_VERSION = 'phase6-app-state';
const VALID_VIEW_TABS = new Set(['profile', 'field', 'scene3d']);
const VALID_RESULTS_TABS = new Set(['statsTab', 'accessibilityTab', 'detailsTab', 'sectionMetricsTab']);

/**
 * @typedef {{ x: number, y: number, z: number }} VectorState
 * @typedef {{
 *   enabled: boolean,
 *   profileType: string,
 *   cValue: number,
 *   numRows: number,
 *   firstRowDist: number,
 *   firstRowElev: number,
 *   treadDepth: number,
 *   riserHeight: number,
 *   eyeHeight: number,
 *   eyeSetback: number
 * }} TierState
 * @typedef {{
 *   name: string,
 *   position: VectorState,
 *   target: VectorState,
 *   thumbnail: string
 * }} BookmarkState
 * @typedef {{
 *   minSeats: number,
 *   maxSeats: number | null,
 *   requiredSpaces: number,
 *   seatsPerIncrement: number,
 *   incrementAppliesAfter: number
 * }} WheelchairSpaceBandState
 * @typedef {{
 *   minSeats: number,
 *   maxSeats: number | null,
 *   requiredLocations: number,
 *   seatsPerIncrement: number,
 *   incrementAppliesAfter: number
 * }} WheelchairLocationBandState
 * @typedef {{
 *   companionSeatsPerWheelchairSpace: number,
 *   wheelchairSpaceAreaSqFt: number,
 *   companionSpaceAreaSqFt: number,
 *   wheelchairSpaceBands: WheelchairSpaceBandState[],
 *   wheelchairLocationBands: WheelchairLocationBandState[]
 * }} AccessibilityState
 * @typedef {{
 *   _version: string,
 *   sport: string,
 *   setup: {
 *     customRunoff: number | null,
 *     focalX: number,
 *     focalZ: number,
 *     sightlineVisuals: boolean,
 *     sectionMetrics: boolean
 *   },
 *   bowl: {
 *     type: string,
 *     cornerRad: number,
 *     sideLength: number,
 *     endLength: number,
 *     structuralDepth: number,
 *     structuralProfileMode: string,
 *     straightAisleMode: string,
 *     chamferAisleMode: string
 *   },
 *   occupancy: {
 *     seatWidth: number,
 *     minAisle: number,
 *     maxAisle: number,
 *     seatsBetweenAisles: number,
 *     egressFactor: number,
 *     showSeatCubes3D: boolean,
 *     accessibility: AccessibilityState
 *   },
 *   ui: {
 *     activeViewTab: string,
 *     activeResultsTab: string
 *   },
 *   tiers: TierState[],
 *   bookmarks: BookmarkState[]
 * }} AppStateData
 * @typedef {{
 *   sport?: string,
 *   template?: {
 *     runoff?: number,
 *     field_length?: number,
 *     field_width?: number,
 *     straight_length?: number,
 *     field_radius?: number,
 *     shape?: string,
 *     arc_angle?: number,
 *     defaults?: {
 *       setup?: {
 *         customRunoff?: number | null,
 *         focalX?: number,
 *         focalZ?: number
 *       },
 *       bowl?: {
 *         type?: string,
 *         cornerRad?: number,
 *         radius?: number,
 *         sideLength?: number,
 *         endLength?: number,
 *         secondarySideLength?: number,
 *         sideLength2?: number,
 *         structuralDepth?: number,
 *         structuralProfileMode?: string,
 *         straightAisleMode?: string,
 *         chamferAisleMode?: string,
 *         typeOptions?: Array<string | { value?: string, label?: string }>
 *       },
 *       occupancy?: {
 *         seatWidth?: number,
 *         minAisle?: number,
 *         maxAisle?: number,
 *         seatsBetweenAisles?: number,
 *         egressFactor?: number,
 *         accessibility?: object
 *       },
 *       tier1?: {
 *         targetCValue?: number,
 *         numRows?: number,
 *         firstRowDist?: number,
 *         firstRowDistance?: number,
 *         firstRowElev?: number,
 *         firstRowElevation?: number,
 *         treadDepth?: number,
 *         riserHeight?: number,
 *         eyeHeight?: number,
 *         eyeSetback?: number,
 *         profileType?: string
 *       }
 *     }
 *   }
 * }} SportDefaultsOptions
 * @typedef {{
 *   base?: AppStateData | AppStateInstance
 * }} AppStateFromJsonOptions
 * @typedef {{
 *   reset(): AppStateInstance,
 *   fromJSON(rawState?: object, options?: AppStateFromJsonOptions): AppStateInstance,
 *   mergeJSON(partialState?: object): AppStateInstance,
 *   applySportDefaults(options?: SportDefaultsOptions): AppStateInstance,
 *   toJSON(): AppStateData
 * }} AppStateMethods
 * @typedef {AppStateData & AppStateMethods} AppStateInstance
 */

/** @returns {TierState} */
function createDefaultTier(overrides = {}) {
    return {
        enabled: false,
        profileType: 'Parabolic',
        cValue: 4,
        numRows: 10,
        firstRowDist: 10,
        firstRowElev: 0,
        treadDepth: 33,
        riserHeight: 10,
        eyeHeight: 3.75,
        eyeSetback: 6,
        ...overrides
    };
}

/** @returns {AccessibilityState} */
function createDefaultAccessibilityState() {
    return {
        companionSeatsPerWheelchairSpace: 1,
        wheelchairSpaceAreaSqFt: 12,
        companionSpaceAreaSqFt: 8,
        wheelchairSpaceBands: [
            { minSeats: 4, maxSeats: 25, requiredSpaces: 1, seatsPerIncrement: 0, incrementAppliesAfter: 25 },
            { minSeats: 26, maxSeats: 50, requiredSpaces: 2, seatsPerIncrement: 0, incrementAppliesAfter: 50 },
            { minSeats: 51, maxSeats: 100, requiredSpaces: 4, seatsPerIncrement: 0, incrementAppliesAfter: 100 },
            { minSeats: 101, maxSeats: 300, requiredSpaces: 5, seatsPerIncrement: 0, incrementAppliesAfter: 300 },
            { minSeats: 301, maxSeats: 500, requiredSpaces: 6, seatsPerIncrement: 0, incrementAppliesAfter: 500 },
            { minSeats: 501, maxSeats: 5000, requiredSpaces: 6, seatsPerIncrement: 150, incrementAppliesAfter: 500 },
            { minSeats: 5001, maxSeats: null, requiredSpaces: 36, seatsPerIncrement: 200, incrementAppliesAfter: 5000 }
        ],
        wheelchairLocationBands: [
            { minSeats: 1, maxSeats: 150, requiredLocations: 1, seatsPerIncrement: 0, incrementAppliesAfter: 150 },
            { minSeats: 151, maxSeats: 500, requiredLocations: 2, seatsPerIncrement: 0, incrementAppliesAfter: 500 },
            { minSeats: 501, maxSeats: 1000, requiredLocations: 3, seatsPerIncrement: 0, incrementAppliesAfter: 1000 },
            { minSeats: 1001, maxSeats: 5000, requiredLocations: 3, seatsPerIncrement: 1000, incrementAppliesAfter: 1000 },
            { minSeats: 5001, maxSeats: null, requiredLocations: 7, seatsPerIncrement: 2000, incrementAppliesAfter: 5000 }
        ]
    };
}

function createBaseDefaultStateData() {
    return {
        _version: APP_STATE_VERSION,
        sport: 'Football',
        setup: {
            customRunoff: 25,
            focalX: 0,
            focalZ: 0,
            sightlineVisuals: true,
            sectionMetrics: false
        },
        bowl: {
            type: 'Full',
            cornerRad: 10,
            sideLength: 300,
            endLength: 300,
            structuralDepth: 12,
            structuralProfileMode: 'stepped',
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        },
        occupancy: {
            seatWidth: 20,
            minAisle: 48,
            maxAisle: 72,
            seatsBetweenAisles: 20,
            egressFactor: 0.2,
            showSeatCubes3D: false,
            accessibility: createDefaultAccessibilityState()
        },
        ui: {
            activeViewTab: 'profile',
            activeResultsTab: 'statsTab'
        },
        tiers: [
            createDefaultTier({
                enabled: true,
                numRows: 30,
                firstRowDist: 45,
                firstRowElev: 6
            }),
            createDefaultTier(),
            createDefaultTier()
        ],
        bookmarks: []
    };
}

/** @returns {AppStateData} */
function createDefaultStateData() {
    const state = createBaseDefaultStateData();
    const template = getTemplate('Ice Hockey');
    const templateDefaults = template?.defaults && typeof template.defaults === 'object'
        ? template.defaults
        : {};
    const defaultTier = state.tiers[0];
    const templateSideLength = Number(template?.field_length ?? template?.straight_length);

    state.sport = 'Ice Hockey';
    state.setup.customRunoff = templateDefaults.setup?.customRunoff ?? template?.runoff ?? state.setup.customRunoff;
    state.setup.focalX = clampTemplateFocalXFt(template, templateDefaults.setup?.focalX ?? state.setup.focalX);
    state.setup.focalZ = templateDefaults.setup?.focalZ ?? state.setup.focalZ;
    state.bowl.type = templateDefaults.bowl?.type ?? state.bowl.type;
    state.bowl.cornerRad = templateDefaults.bowl?.cornerRad
        ?? templateDefaults.bowl?.radius
        ?? state.bowl.cornerRad;
    state.bowl.sideLength = templateDefaults.bowl?.sideLength
        ?? (Number.isFinite(templateSideLength) ? templateSideLength : state.bowl.sideLength);
    state.bowl.endLength = templateDefaults.bowl?.endLength
        ?? templateDefaults.bowl?.secondarySideLength
        ?? templateDefaults.bowl?.sideLength2
        ?? (Number.isFinite(Number(template?.field_width)) ? Number(template.field_width) : state.bowl.sideLength);
    state.bowl.structuralDepth = templateDefaults.bowl?.structuralDepth ?? state.bowl.structuralDepth;
    state.bowl.structuralProfileMode = templateDefaults.bowl?.structuralProfileMode
        ?? state.bowl.structuralProfileMode;
    state.bowl.straightAisleMode = templateDefaults.bowl?.straightAisleMode
        ?? state.bowl.straightAisleMode;
    state.bowl.chamferAisleMode = templateDefaults.bowl?.chamferAisleMode
        ?? state.bowl.chamferAisleMode;
    state.occupancy.seatWidth = templateDefaults.occupancy?.seatWidth ?? state.occupancy.seatWidth;
    state.occupancy.minAisle = templateDefaults.occupancy?.minAisle ?? state.occupancy.minAisle;
    state.occupancy.maxAisle = templateDefaults.occupancy?.maxAisle ?? state.occupancy.maxAisle;
    state.occupancy.seatsBetweenAisles = templateDefaults.occupancy?.seatsBetweenAisles
        ?? state.occupancy.seatsBetweenAisles;
    state.occupancy.egressFactor = templateDefaults.occupancy?.egressFactor ?? state.occupancy.egressFactor;
    state.occupancy.accessibility = normalizeAccessibilityState(
        templateDefaults.occupancy?.accessibility,
        state.occupancy.accessibility
    );
    state.tiers[0] = createDefaultTier({
        ...defaultTier,
        enabled: true,
        profileType: templateDefaults.tier1?.profileType ?? defaultTier.profileType,
        cValue: templateDefaults.tier1?.targetCValue ?? defaultTier.cValue,
        numRows: templateDefaults.tier1?.numRows ?? defaultTier.numRows,
        firstRowDist: templateDefaults.tier1?.firstRowDist
            ?? templateDefaults.tier1?.firstRowDistance
            ?? defaultTier.firstRowDist,
        firstRowElev: templateDefaults.tier1?.firstRowElev
            ?? templateDefaults.tier1?.firstRowElevation
            ?? defaultTier.firstRowElev,
        treadDepth: templateDefaults.tier1?.treadDepth ?? defaultTier.treadDepth,
        riserHeight: templateDefaults.tier1?.riserHeight ?? defaultTier.riserHeight,
        eyeHeight: templateDefaults.tier1?.eyeHeight ?? defaultTier.eyeHeight,
        eyeSetback: templateDefaults.tier1?.eyeSetback ?? defaultTier.eyeSetback
    });

    return state;
}

/** @returns {AppStateData} */
function createDefaultAppStateData() {
    return createDefaultStateData();
}

const TIER_INITIALIZATION_KEYS = [
    'profileType',
    'cValue',
    'numRows',
    'firstRowDist',
    'firstRowElev',
    'treadDepth',
    'riserHeight',
    'eyeHeight',
    'eyeSetback'
];

const FALLBACK_BOWL_TYPE_OPTIONS = [
    { value: 'Full', label: 'Full Bowl' },
    { value: 'U-End1', label: 'C-Shape' },
    { value: 'U-End2', label: 'U-Shape' },
    { value: 'Side1', label: '1-Sided' },
    { value: 'Sides', label: '2-Sided' },
    { value: 'Sides3', label: '3-Sided' },
    { value: 'Sides4', label: '4-Sided' }
];

const DEFAULT_TIER_STATE_TEMPLATE = createDefaultStateData().tiers;

function parseNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function parseNullableNumber(value, fallback) {
    if (value === null) return null;
    if (value === undefined || value === '') return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function parseBoolean(value, fallback) {
    return value === undefined ? fallback : Boolean(value);
}

function parseString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
}

function normalizeBowlType(value, fallback) {
    const nextValue = parseString(value, fallback);
    if (nextValue === 'Side2') return 'Side1';
    if (nextValue === 'Side3') return 'Sides3';
    if (nextValue === 'Side4') return 'Sides4';
    if (nextValue === 'Standard' || nextValue === 'Baseball Standard') return 'BaseballStandard';
    if (nextValue === 'C-Shape') return 'U-End1';
    if (nextValue === 'U-Shape') return 'U-End2';
    return nextValue;
}

function normalizeBowlTypeOption(option) {
    if (typeof option === 'string') {
        const value = option.trim();
        return value ? { value, label: value } : null;
    }

    if (!option || typeof option !== 'object') return null;

    const value = parseString(option.value ?? option.id ?? option.name, '');
    if (!value) return null;

    return {
        ...option,
        value,
        label: parseString(option.label ?? option.text ?? option.name, value)
    };
}

function normalizeStructuralProfileMode(value, fallback = 'stepped') {
    return value === 'sloped' ? 'sloped' : fallback;
}

function normalizeAisleMode(value, fallback = 'radial') {
    if (value === 'radial' || value === 'perpendicular') return value;
    return fallback === 'perpendicular' ? 'perpendicular' : 'radial';
}

function normalizeViewTab(value, fallback) {
    return VALID_VIEW_TABS.has(value) ? value : fallback;
}

function normalizeResultsTab(value, fallback) {
    return VALID_RESULTS_TABS.has(value) ? value : fallback;
}

/**
 * @param {object} rawBand
 * @param {WheelchairSpaceBandState} fallbackBand
 * @returns {WheelchairSpaceBandState}
 */
function normalizeWheelchairSpaceBand(rawBand, fallbackBand) {
    const band = rawBand && typeof rawBand === 'object' ? rawBand : {};
    const fallback = fallbackBand && typeof fallbackBand === 'object'
        ? fallbackBand
        : createDefaultAccessibilityState().wheelchairSpaceBands[0];

    return {
        minSeats: Math.max(0, Math.round(parseNumber(band.minSeats, fallback.minSeats ?? 0))),
        maxSeats: parseNullableNumber(band.maxSeats, fallback.maxSeats ?? null),
        requiredSpaces: Math.max(
            0,
            Math.round(parseNumber(band.requiredSpaces, fallback.requiredSpaces ?? 0))
        ),
        seatsPerIncrement: Math.max(0, Math.round(parseNumber(band.seatsPerIncrement, fallback.seatsPerIncrement ?? 0))),
        incrementAppliesAfter: Math.max(
            0,
            Math.round(parseNumber(
                band.incrementAppliesAfter,
                fallback.incrementAppliesAfter ?? 0
            ))
        )
    };
}

/**
 * @param {object} rawBand
 * @param {WheelchairLocationBandState} fallbackBand
 * @returns {WheelchairLocationBandState}
 */
function normalizeWheelchairLocationBand(rawBand, fallbackBand) {
    const band = rawBand && typeof rawBand === 'object' ? rawBand : {};
    const fallback = fallbackBand && typeof fallbackBand === 'object'
        ? fallbackBand
        : createDefaultAccessibilityState().wheelchairLocationBands[0];

    return {
        minSeats: Math.max(0, Math.round(parseNumber(band.minSeats, fallback.minSeats ?? 0))),
        maxSeats: parseNullableNumber(band.maxSeats, fallback.maxSeats ?? null),
        requiredLocations: Math.max(
            0,
            Math.round(parseNumber(band.requiredLocations, fallback.requiredLocations ?? 0))
        ),
        seatsPerIncrement: Math.max(0, Math.round(parseNumber(band.seatsPerIncrement, fallback.seatsPerIncrement ?? 0))),
        incrementAppliesAfter: Math.max(
            0,
            Math.round(parseNumber(
                band.incrementAppliesAfter,
                fallback.incrementAppliesAfter ?? 0
            ))
        )
    };
}

/**
 * @param {unknown} rawBands
 * @param {WheelchairSpaceBandState[]} fallbackBands
 * @returns {WheelchairSpaceBandState[]}
 */
function normalizeWheelchairSpaceBands(rawBands, fallbackBands) {
    const fallback = Array.isArray(fallbackBands) ? fallbackBands : [];
    const bands = Array.isArray(rawBands) ? rawBands : [];

    return fallback.map((fallbackBand, index) => (
        normalizeWheelchairSpaceBand(bands[index], fallbackBand)
    ));
}

/**
 * @param {unknown} rawBands
 * @param {WheelchairLocationBandState[]} fallbackBands
 * @returns {WheelchairLocationBandState[]}
 */
function normalizeWheelchairLocationBands(rawBands, fallbackBands) {
    const fallback = Array.isArray(fallbackBands) ? fallbackBands : [];
    const bands = Array.isArray(rawBands) ? rawBands : [];

    return fallback.map((fallbackBand, index) => (
        normalizeWheelchairLocationBand(bands[index], fallbackBand)
    ));
}

/** @returns {AccessibilityState} */
function normalizeAccessibilityState(rawAccessibility, fallbackAccessibility = createDefaultAccessibilityState()) {
    const accessibility = rawAccessibility && typeof rawAccessibility === 'object'
        ? rawAccessibility
        : {};
    const fallback = fallbackAccessibility && typeof fallbackAccessibility === 'object'
        ? fallbackAccessibility
        : createDefaultAccessibilityState();

    return {
        companionSeatsPerWheelchairSpace: Math.max(
            0,
            Math.round(parseNumber(
                accessibility.companionSeatsPerWheelchairSpace,
                fallback.companionSeatsPerWheelchairSpace ?? 0
            ))
        ),
        wheelchairSpaceAreaSqFt: Math.max(
            0,
            parseNumber(
                accessibility.wheelchairSpaceAreaSqFt,
                fallback.wheelchairSpaceAreaSqFt ?? 0
            )
        ),
        companionSpaceAreaSqFt: Math.max(
            0,
            parseNumber(
                accessibility.companionSpaceAreaSqFt,
                fallback.companionSpaceAreaSqFt ?? 0
            )
        ),
        wheelchairSpaceBands: normalizeWheelchairSpaceBands(
            accessibility.wheelchairSpaceBands,
            fallback.wheelchairSpaceBands
        ),
        wheelchairLocationBands: normalizeWheelchairLocationBands(
            accessibility.wheelchairLocationBands,
            fallback.wheelchairLocationBands
        )
    };
}

export function normalizeSportName(sportName) {
    return getTemplate(sportName) ? sportName : 'Football';
}

/** @returns {TierState} */
function normalizeTier(rawTier, fallbackTier) {
    const tier = rawTier && typeof rawTier === 'object' ? rawTier : {};
    const fallback = fallbackTier && typeof fallbackTier === 'object'
        ? fallbackTier
        : createDefaultTier();

    return {
        enabled: parseBoolean(tier.enabled, fallback.enabled),
        profileType: parseString(tier.profileType, fallback.profileType),
        cValue: parseNumber(tier.cValue ?? tier.targetCValue, fallback.cValue),
        numRows: Math.max(0, Math.round(parseNumber(tier.numRows, fallback.numRows))),
        firstRowDist: parseNumber(tier.firstRowDist ?? tier.firstRowDistance, fallback.firstRowDist),
        firstRowElev: parseNumber(tier.firstRowElev ?? tier.firstRowElevation, fallback.firstRowElev),
        treadDepth: parseNumber(tier.treadDepth, fallback.treadDepth),
        riserHeight: parseNumber(tier.riserHeight ?? tier.defaultRiser, fallback.riserHeight),
        eyeHeight: parseNumber(tier.eyeHeight, fallback.eyeHeight),
        eyeSetback: parseNumber(tier.eyeSetback, fallback.eyeSetback)
    };
}

/** @returns {VectorState} */
function normalizeVector(rawVector, fallbackVector) {
    const vector = rawVector && typeof rawVector === 'object' ? rawVector : {};
    const fallback = fallbackVector && typeof fallbackVector === 'object'
        ? fallbackVector
        : { x: 0, y: 0, z: 0 };

    return {
        x: parseNumber(vector.x, fallback.x),
        y: parseNumber(vector.y, fallback.y),
        z: parseNumber(vector.z, fallback.z)
    };
}

/** @returns {BookmarkState[]} */
function normalizeBookmarks(rawBookmarks, fallbackBookmarks) {
    const bookmarks = Array.isArray(rawBookmarks) ? rawBookmarks : fallbackBookmarks;
    if (!Array.isArray(bookmarks)) return [];

    return bookmarks.map((bookmark, index) => {
        const fallbackBookmark = Array.isArray(fallbackBookmarks) ? fallbackBookmarks[index] : null;
        return {
            name: parseString(bookmark?.name, fallbackBookmark?.name ?? `View ${index + 1}`),
            position: normalizeVector(bookmark?.position, fallbackBookmark?.position),
            target: normalizeVector(bookmark?.target, fallbackBookmark?.target),
            thumbnail: typeof bookmark?.thumbnail === 'string'
                ? bookmark.thumbnail
                : (fallbackBookmark?.thumbnail ?? '')
        };
    });
}

/** @returns {TierState[]} */
function normalizeTiers(rawState, fallbackTiers) {
    const fallback = Array.isArray(fallbackTiers) && fallbackTiers.length
        ? fallbackTiers
        : createDefaultStateData().tiers;

    if (Array.isArray(rawState?.tiers) && rawState.tiers.length) {
        return [0, 1, 2].map((index) => normalizeTier(rawState.tiers[index], fallback[index]));
    }

    if (rawState?.tier1 || rawState?.tier2 || rawState?.tier3) {
        return [rawState.tier1, rawState.tier2, rawState.tier3]
            .map((tier, index) => normalizeTier(tier, fallback[index]));
    }

    return fallback.map((tier) => normalizeTier(null, tier));
}

/**
 * @param {unknown} [rawState]
 * @param {AppStateData | null | undefined} [fallbackState]
 * @returns {AppStateData}
 */
function normalizeAppState(rawState = {}, fallbackState = createDefaultStateData()) {
    /** @type {AppStateData} */
    const fallback = fallbackState && typeof fallbackState === 'object'
        ? fallbackState
        : createDefaultStateData();
    /** @type {any} */
    const state = rawState && typeof rawState === 'object' ? rawState : {};
    const sport = normalizeSportName(parseString(state.sport, fallback.sport));
    const template = getTemplate(sport);
    const focalX = clampTemplateFocalXFt(
        template,
        parseNumber(state.setup?.focalX, fallback.setup.focalX)
    );

    return {
        _version: APP_STATE_VERSION,
        sport,
        setup: {
            customRunoff: parseNullableNumber(
                state.setup?.customRunoff,
                fallback.setup.customRunoff
            ),
            focalX,
            focalZ: parseNumber(state.setup?.focalZ, fallback.setup.focalZ),
            sightlineVisuals: parseBoolean(
                state.setup?.sightlineVisuals,
                fallback.setup.sightlineVisuals
            ),
            sectionMetrics: parseBoolean(
                state.setup?.sectionMetrics,
                fallback.setup.sectionMetrics
            )
        },
        bowl: {
            type: normalizeBowlType(state.bowl?.type, fallback.bowl.type),
            cornerRad: parseNumber(
                state.bowl?.cornerRad ?? state.bowl?.radius,
                fallback.bowl.cornerRad
            ),
            sideLength: parseNumber(state.bowl?.sideLength, fallback.bowl.sideLength),
            endLength: parseNumber(
                state.bowl?.endLength ?? state.bowl?.sideLength2,
                fallback.bowl.endLength ?? fallback.bowl.sideLength
            ),
            structuralDepth: parseNumber(
                state.bowl?.structuralDepth,
                fallback.bowl.structuralDepth
            ),
            structuralProfileMode: normalizeStructuralProfileMode(
                state.bowl?.structuralProfileMode,
                fallback.bowl.structuralProfileMode
            ),
            straightAisleMode: normalizeAisleMode(
                state.bowl?.straightAisleMode,
                fallback.bowl.straightAisleMode
            ),
            chamferAisleMode: normalizeAisleMode(
                state.bowl?.chamferAisleMode,
                fallback.bowl.chamferAisleMode
            )
        },
        occupancy: {
            seatWidth: parseNumber(state.occupancy?.seatWidth, fallback.occupancy.seatWidth),
            minAisle: parseNumber(state.occupancy?.minAisle, fallback.occupancy.minAisle),
            maxAisle: parseNumber(state.occupancy?.maxAisle, fallback.occupancy.maxAisle),
            seatsBetweenAisles: Math.max(
                0,
                Math.round(
                    parseNumber(
                        state.occupancy?.seatsBetweenAisles,
                        fallback.occupancy.seatsBetweenAisles
                    )
                )
            ),
            egressFactor: parseNumber(
                state.occupancy?.egressFactor,
                fallback.occupancy.egressFactor
            ),
            showSeatCubes3D: parseBoolean(
                state.occupancy?.showSeatCubes3D,
                fallback.occupancy.showSeatCubes3D
            ),
            accessibility: normalizeAccessibilityState(
                state.occupancy?.accessibility,
                fallback.occupancy.accessibility
            )
        },
        ui: {
            activeViewTab: normalizeViewTab(state.ui?.activeViewTab, fallback.ui.activeViewTab),
            activeResultsTab: normalizeResultsTab(
                state.ui?.activeResultsTab,
                fallback.ui.activeResultsTab
            )
        },
        tiers: normalizeTiers(state, fallback.tiers),
        bookmarks: normalizeBookmarks(state.bookmarks, fallback.bookmarks)
    };
}

/**
 * @template {AppStateData | AppStateInstance} T
 * @param {T} target
 * @param {AppStateData} source
 * @returns {T}
 */
function applyStateData(target, source) {
    target._version = source._version;
    target.sport = source.sport;
    target.setup = source.setup;
    target.bowl = source.bowl;
    target.occupancy = source.occupancy;
    target.ui = source.ui;
    target.tiers = source.tiers;
    target.bookmarks = source.bookmarks;
    return target;
}

function getTemplateSideLength(template, fallback) {
    if (!template || typeof template !== 'object') return fallback;
    const candidate = template.field_length ?? template.straight_length;
    return Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
}

function getStateOccupancy(state) {
    return state?.occupancy && typeof state.occupancy === 'object'
        ? state.occupancy
        : {};
}

function getStateBowl(state) {
    return state?.bowl && typeof state.bowl === 'object'
        ? state.bowl
        : {};
}

function getStateSetup(state) {
    return state?.setup && typeof state.setup === 'object'
        ? state.setup
        : {};
}

function getPrimaryTier(state) {
    return Array.isArray(state?.tiers) && state.tiers[0] && typeof state.tiers[0] === 'object'
        ? state.tiers[0]
        : {};
}

function getFirstEnabledTier(state) {
    const tiers = Array.isArray(state?.tiers) ? state.tiers : [];
    return tiers.find((tier) => tier && typeof tier === 'object' && tier.enabled) || getPrimaryTier(state);
}

function buildChamferReferenceOffset(state) {
    const tier = getFirstEnabledTier(state);
    const firstRowDistance = Number(tier?.firstRowDist);
    const treadDepthIn = Number(tier?.treadDepth);
    if (!Number.isFinite(firstRowDistance) || !Number.isFinite(treadDepthIn)) return 0;

    return Math.max(0, firstRowDistance - (treadDepthIn / 12));
}

function tierMatchesDefaultState(tierState, defaultTierState) {
    if (!tierState || typeof tierState !== 'object') return false;
    if (!defaultTierState || typeof defaultTierState !== 'object') return false;

    return TIER_INITIALIZATION_KEYS.every((key) => tierState[key] === defaultTierState[key]);
}

export function getCustomRunoff(state) {
    const setup = getStateSetup(state);
    return setup.customRunoff ?? null;
}

export function getRunoffDistance(state, template) {
    const customRunoff = getCustomRunoff(state);
    return customRunoff !== null && customRunoff !== undefined
        ? customRunoff
        : (template?.runoff || 0);
}

export function resolveSportName(state) {
    return normalizeSportName(state?.sport);
}

export function resolveSportTemplate(stateOrSport) {
    const nextSport = typeof stateOrSport === 'string'
        ? normalizeSportName(stateOrSport)
        : resolveSportName(stateOrSport);
    return getTemplate(nextSport);
}

export function resolveSportBowlTypeOptions(template) {
    const rawOptions = template?.defaults?.bowl?.typeOptions
        ?? template?.defaults?.bowl?.types
        ?? template?.bowlTypes
        ?? template?.supportedBowlTypes
        ?? null;

    const options = Array.isArray(rawOptions) && rawOptions.length
        ? rawOptions
            .map((option) => normalizeBowlTypeOption(option))
            .filter((option) => option && typeof option.value === 'string')
        : FALLBACK_BOWL_TYPE_OPTIONS;

    const seen = new Set();
    return options.filter((option) => {
        const key = option.value;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildFocalXControlConfig(state) {
    const template = resolveSportTemplate(state);
    const bounds = resolveTemplateFocalXBoundsFt(template);
    const setup = getStateSetup(state);

    return {
        min: bounds.min,
        max: bounds.max,
        step: FOCAL_X_STEP_FT,
        value: clampTemplateFocalXFt(template, setup.focalX ?? 0)
    };
}

export function buildFocalPointFt(state) {
    const focalX = buildFocalXControlConfig(state).value;
    const setup = getStateSetup(state);
    return {
        x: focalX,
        z: setup.focalZ ?? 0
    };
}

export function buildEgressParams(state) {
    const occupancy = getStateOccupancy(state);
    return {
        seatWidthIn: occupancy.seatWidth ?? 0,
        maxAisleWidthIn: occupancy.maxAisle ?? 0,
        minAisleWidthIn: occupancy.minAisle ?? 0,
        egressFactor: occupancy.egressFactor ?? 0,
        seatsBetweenAisles: occupancy.seatsBetweenAisles ?? 0
    };
}

export function buildAccessibilityParams(state) {
    const occupancy = getStateOccupancy(state);
    const accessibility = normalizeAccessibilityState(occupancy.accessibility);
    const applyDerivedIncrementThreshold = (bands = []) => bands.map((band) => ({
        ...band,
        incrementAppliesAfter: band.seatsPerIncrement > 0
            ? Math.max(0, band.minSeats - 1)
            : band.incrementAppliesAfter
    }));

    return {
        ...accessibility,
        wheelchairSpaceBands: applyDerivedIncrementThreshold(accessibility.wheelchairSpaceBands),
        wheelchairLocationBands: applyDerivedIncrementThreshold(accessibility.wheelchairLocationBands)
    };
}

export function buildPrimaryTierParameters(state) {
    const primaryTier = getPrimaryTier(state);

    return {
        targetCValue: primaryTier.cValue ?? 0,
        firstRowDistance: primaryTier.firstRowDist ?? 0,
        firstRowElevation: primaryTier.firstRowElev ?? 0,
        treadDepth: primaryTier.treadDepth ?? 0,
        riserHeight: primaryTier.riserHeight ?? 0,
        numRows: primaryTier.numRows ?? 0,
        eyeHeight: primaryTier.eyeHeight ?? 0,
        eyeSetback: primaryTier.eyeSetback ?? 0
    };
}

export function buildPrimaryTierSolverParameters(state) {
    const primaryTier = getPrimaryTier(state);

    return {
        targetCValue: primaryTier.cValue ?? 0,
        firstRowDistance: primaryTier.firstRowDist ?? 0,
        firstRowElevation: primaryTier.firstRowElev ?? 0,
        treadDepth: primaryTier.treadDepth ?? 0,
        riserHeight: primaryTier.riserHeight ?? 0,
        numRows: primaryTier.numRows ?? 0,
        eyeHeight: primaryTier.eyeHeight ?? 0,
        eyeSetback: primaryTier.eyeSetback ?? 0
    };
}

export function buildBowlConfig(state, template) {
    const bowl = getStateBowl(state);

    return {
        width: template?.field_width,
        length: template?.field_length ?? template?.straight_length,
        shape: template?.shape,
        radius_arc: template?.field_radius,
        arc_angle: template?.arc_angle,
        type: bowl.type,
        corner: 'Chamfer',
        radius: bowl.cornerRad,
        chamferReferenceOffset: buildChamferReferenceOffset(state),
        sideLength: bowl.sideLength,
        endLength: bowl.endLength ?? bowl.sideLength,
        structuralDepth: bowl.structuralDepth || 0,
        structuralProfileMode: normalizeStructuralProfileMode(bowl.structuralProfileMode),
        straightAisleMode: normalizeAisleMode(bowl.straightAisleMode),
        chamferAisleMode: normalizeAisleMode(bowl.chamferAisleMode)
    };
}

export function buildFieldVisibility(state) {
    const setup = getStateSetup(state);
    const tiers = Array.isArray(state?.tiers) ? state.tiers : [];

    return {
        showSeating: true,
        t1: !!tiers[0]?.enabled,
        t2: !!tiers[1]?.enabled,
        t3: !!tiers[2]?.enabled,
        colorByCValue: !!setup.sightlineVisuals,
        showSectionMetrics: !!setup.sectionMetrics
    };
}

export function buildSceneSeatPreviewOptions(state) {
    const occupancy = getStateOccupancy(state);

    return {
        showSeatCubes: !!occupancy.showSeatCubes3D,
        seatWidthIn: occupancy.seatWidth ?? 0
    };
}

export function buildTierRowCountControlConfig(state, tierIndex) {
    const tiers = Array.isArray(state?.tiers) && state.tiers.length
        ? state.tiers
        : createDefaultStateData().tiers;
    const nextTierIndex = Number(tierIndex);
    if (!Number.isInteger(nextTierIndex) || nextTierIndex < 0 || nextTierIndex >= tiers.length) {
        return null;
    }

    return nextTierIndex === 0
        ? { min: 5, max: 80, step: 1 }
        : { min: 3, max: 60, step: 1 };
}

export function buildTierRowCountControlConfigs(state) {
    const tiers = Array.isArray(state?.tiers) && state.tiers.length
        ? state.tiers
        : createDefaultStateData().tiers;
    return tiers.map((_tier, tierIndex) => buildTierRowCountControlConfig(state, tierIndex));
}

export function buildTierInitializationFlags(state) {
    const isTierStateInitialized = (tierNum) => {
        if (!Number.isInteger(tierNum) || tierNum <= 1) return true;

        const tierIndex = tierNum - 1;
        const tierState = state?.tiers?.[tierIndex];
        if (!tierState || typeof tierState !== 'object') return false;
        if (tierState.enabled) return true;

        return !tierMatchesDefaultState(tierState, DEFAULT_TIER_STATE_TEMPLATE[tierIndex]);
    };

    return {
        tier2Initialized: isTierStateInitialized(2),
        tier3Initialized: isTierStateInitialized(3)
    };
}

export function buildProfileRenderOptions(state, structuralDepth = 0) {
    const setup = getStateSetup(state);
    const showSightlines = !!setup.sightlineVisuals;

    return {
        structuralDepth: Number(structuralDepth) || 0,
        structuralProfileMode: normalizeStructuralProfileMode(state?.bowl?.structuralProfileMode),
        showSightlines,
        tierRowCountControls: buildTierRowCountControlConfigs(state)
    };
}

/** @type {AppStateMethods} */
const appStateMethods = {
    /** @this {AppStateInstance} */
    reset() {
        return this.fromJSON();
    },

    /** @this {AppStateInstance} */
    fromJSON(rawState = {}, options = {}) {
        const fallbackState = options.base
            ? normalizeAppState(options.base)
            : createDefaultStateData();
        return applyStateData(this, normalizeAppState(rawState, fallbackState));
    },

    /** @this {AppStateInstance} */
    mergeJSON(partialState = {}) {
        return this.fromJSON(partialState, { base: this.toJSON() });
    },

    /**
     * @param {SportDefaultsOptions} [options]
     * @this {AppStateInstance}
     */
    applySportDefaults({ sport, template = null } = {}) {
        const nextSport = normalizeSportName(parseString(sport, this.sport));
        const templateDefaults = template?.defaults && typeof template.defaults === 'object'
            ? template.defaults
            : {};

        const partialState = {
            sport: nextSport,
            setup: {
                customRunoff: templateDefaults.setup?.customRunoff ?? template?.runoff,
                focalX: templateDefaults.setup?.focalX,
                focalZ: templateDefaults.setup?.focalZ
            },
            bowl: {
                type: templateDefaults.bowl?.type,
                cornerRad: templateDefaults.bowl?.cornerRad ?? templateDefaults.bowl?.radius,
                sideLength: templateDefaults.bowl?.sideLength ?? getTemplateSideLength(template, this.bowl.sideLength),
                endLength: templateDefaults.bowl?.endLength
                    ?? templateDefaults.bowl?.secondarySideLength
                    ?? templateDefaults.bowl?.sideLength2
                    ?? (Number.isFinite(Number(template?.field_width))
                        ? Number(template.field_width)
                        : (this.bowl.endLength ?? this.bowl.sideLength)),
                structuralDepth: templateDefaults.bowl?.structuralDepth,
                structuralProfileMode: templateDefaults.bowl?.structuralProfileMode,
                straightAisleMode: templateDefaults.bowl?.straightAisleMode,
                chamferAisleMode: templateDefaults.bowl?.chamferAisleMode
            },
            occupancy: {
                seatWidth: templateDefaults.occupancy?.seatWidth,
                minAisle: templateDefaults.occupancy?.minAisle,
                maxAisle: templateDefaults.occupancy?.maxAisle,
                seatsBetweenAisles: templateDefaults.occupancy?.seatsBetweenAisles,
                egressFactor: templateDefaults.occupancy?.egressFactor,
                accessibility: templateDefaults.occupancy?.accessibility
            },
            tiers: [{
                ...templateDefaults.tier1,
                firstRowDist: templateDefaults.tier1?.firstRowDist
                    ?? templateDefaults.tier1?.firstRowDistance,
                firstRowElev: templateDefaults.tier1?.firstRowElev
                    ?? templateDefaults.tier1?.firstRowElevation
            }, {}, {}]
        };

        return this.mergeJSON(partialState);
    },

    /** @this {AppStateInstance} */
    toJSON() {
        return normalizeAppState(this);
    }
};

/** @returns {AppStateInstance} */
export function createAppState() {
    return {
        ...createDefaultStateData(),
        ...appStateMethods
    };
}

/** @type {AppStateInstance} */
export const AppState = createAppState();

export { APP_STATE_VERSION };
export { createDefaultAppStateData };
