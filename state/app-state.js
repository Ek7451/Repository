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
        sport: parseString(state.sport, fallback.sport),
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
 * @param {AppStateData} target
 * @param {AppStateData} source
 * @returns {AppStateData}
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

export const AppState = {
    ...createDefaultStateData(),

    reset() {
        return this.fromJSON();
    },

    fromJSON(rawState = {}, options = {}) {
        const fallbackState = options.base
            ? normalizeAppState(options.base)
            : createDefaultStateData();
        return applyStateData(this, normalizeAppState(rawState, fallbackState));
    },

    mergeJSON(partialState = {}) {
        return this.fromJSON(partialState, { base: this.toJSON() });
    },

    /**
     * @param {SportDefaultsOptions} [options]
     */
    applySportDefaults({ sport, template = null } = {}) {
        const nextSport = parseString(sport, this.sport);
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

    toJSON() {
        return normalizeAppState(this);
    }
};

export { APP_STATE_VERSION };
