import { getTemplate } from '../core/sports-templates.js';

const APP_STATE_VERSION = 'phase6-app-state';
const VALID_VIEW_TABS = new Set(['profile', 'field', 'scene3d']);
const VALID_RESULTS_TABS = new Set(['statsTab', 'detailsTab']);

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
 *   _version: string,
 *   sport: string,
 *   setup: {
 *     customRunoff: number | null,
 *     focalZ: number,
 *     sightlineVisuals: boolean,
 *     sectionMetrics: boolean
 *   },
 *   bowl: {
 *     type: string,
 *     cornerRad: number,
 *     sideLength: number,
 *     structuralDepth: number,
 *     clipEnabled: boolean,
 *     clipAxis: string,
 *     clipPosition: number,
 *     clipSide: string
 *   },
 *   occupancy: {
 *     seatWidth: number,
 *     minAisle: number,
 *     maxAisle: number,
 *     seatsBetweenAisles: number,
 *     egressFactor: number,
 *     showSeatCubes3D: boolean
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
 *     straight_length?: number,
 *     defaults?: {
 *       setup?: {
 *         customRunoff?: number | null,
 *         focalZ?: number
 *       },
 *       bowl?: {
 *         type?: string,
 *         cornerRad?: number,
 *         radius?: number,
 *         sideLength?: number
 *       },
 *       tier1?: {
 *         targetCValue?: number,
 *         numRows?: number,
 *         firstRowDist?: number,
 *         firstRowElev?: number,
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
 *   applyClipPositionRange(clipRange?: { min?: number, max?: number, value?: number } | null): AppStateInstance,
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

/** @returns {AppStateData} */
function createDefaultStateData() {
    return {
        _version: APP_STATE_VERSION,
        sport: 'Football',
        setup: {
            customRunoff: 25,
            focalZ: 0,
            sightlineVisuals: true,
            sectionMetrics: false
        },
        bowl: {
            type: 'Full',
            cornerRad: 10,
            sideLength: 300,
            structuralDepth: 0,
            clipEnabled: false,
            clipAxis: 'X',
            clipPosition: 0,
            clipSide: 'positive'
        },
        occupancy: {
            seatWidth: 20,
            minAisle: 48,
            maxAisle: 72,
            seatsBetweenAisles: 20,
            egressFactor: 0.2,
            showSeatCubes3D: false
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
function createDefaultAppStateData() {
    return createDefaultStateData();
}

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
    return nextValue === 'Side2' ? 'Side1' : nextValue;
}

function normalizeClipAxis(value, fallback) {
    const nextValue = String(value ?? fallback).toUpperCase();
    return nextValue === 'Y' ? 'Y' : 'X';
}

function normalizeClipSide(value, fallback) {
    if (value === 'negative') return 'negative';
    if (value === 'positive') return 'positive';
    return fallback;
}

function normalizeViewTab(value, fallback) {
    return VALID_VIEW_TABS.has(value) ? value : fallback;
}

function normalizeResultsTab(value, fallback) {
    return VALID_RESULTS_TABS.has(value) ? value : fallback;
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

    return {
        _version: APP_STATE_VERSION,
        sport: normalizeSportName(parseString(state.sport, fallback.sport)),
        setup: {
            customRunoff: parseNullableNumber(
                state.setup?.customRunoff,
                fallback.setup.customRunoff
            ),
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
            structuralDepth: parseNumber(
                state.bowl?.structuralDepth,
                fallback.bowl.structuralDepth
            ),
            clipEnabled: parseBoolean(state.bowl?.clipEnabled, fallback.bowl.clipEnabled),
            clipAxis: normalizeClipAxis(state.bowl?.clipAxis, fallback.bowl.clipAxis),
            clipPosition: parseNumber(state.bowl?.clipPosition, fallback.bowl.clipPosition),
            clipSide: normalizeClipSide(state.bowl?.clipSide, fallback.bowl.clipSide)
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

export function buildClipPositionControlSync(state, clipRange) {
    if (!clipRange) return null;

    const nextMin = Number.isFinite(Number(clipRange.min)) ? Number(clipRange.min) : 0;
    const rawMax = Number.isFinite(Number(clipRange.max)) ? Number(clipRange.max) : nextMin;
    const nextMax = Math.max(nextMin, rawMax);

    let currentPosition = Number(getStateBowl(state).clipPosition);
    if (!Number.isFinite(currentPosition)) currentPosition = 0;

    return {
        min: nextMin,
        max: nextMax,
        value: Math.max(nextMin, Math.min(nextMax, currentPosition))
    };
}

export function buildFocalPointFt(state) {
    const setup = getStateSetup(state);
    return {
        x: 0,
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

export function buildBowlConfig(state, template, overrides = {}) {
    const bowl = getStateBowl(state);
    const clipPosition = overrides.clipPosition ?? bowl.clipPosition;
    const clip = bowl.clipEnabled
        ? {
            enabled: true,
            axis: bowl.clipAxis,
            position: clipPosition,
            side: bowl.clipSide
        }
        : { enabled: false };

    return {
        width: template?.field_width,
        length: template?.field_length,
        shape: template?.shape,
        radius_arc: template?.field_radius,
        arc_angle: template?.arc_angle,
        type: bowl.type,
        corner: 'Chamfer',
        radius: bowl.cornerRad,
        sideLength: bowl.sideLength,
        structuralDepth: bowl.structuralDepth || 0,
        clip
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

export function buildProfileRenderOptions(state, structuralDepth = 0) {
    const setup = getStateSetup(state);
    const showSightlines = !!setup.sightlineVisuals;

    return {
        structuralDepth: Number(structuralDepth) || 0,
        showSightlines,
        showCLabels: showSightlines
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
                focalZ: templateDefaults.setup?.focalZ
            },
            bowl: {
                type: templateDefaults.bowl?.type,
                cornerRad: templateDefaults.bowl?.cornerRad ?? templateDefaults.bowl?.radius,
                sideLength: templateDefaults.bowl?.sideLength ?? getTemplateSideLength(template, this.bowl.sideLength)
            },
            tiers: [templateDefaults.tier1 ?? {}, {}, {}]
        };

        return this.mergeJSON(partialState);
    },

    /** @this {AppStateInstance} */
    applyClipPositionRange(clipRange = null) {
        const nextRange = buildClipPositionControlSync(this, clipRange);
        if (nextRange && this.bowl && typeof this.bowl === 'object') {
            this.bowl.clipPosition = nextRange.value;
        }
        return this;
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
