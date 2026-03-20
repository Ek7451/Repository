import {
    computeAverageSeatsPerBlock,
    computeUsableRunLengthIn,
    countSeatsFromUsableRunLengthIn,
    normalizeAisleWidthFt,
    normalizeSeatWidthIn,
    spanGapToSeatCount
} from './seat-math.js';

/**
 * @typedef {{
 *   upto25: number,
 *   upto50: number,
 *   upto150: number,
 *   upto300: number,
 *   upto500: number,
 *   over500Base: number,
 *   over500StepOccupants: number,
 *   over500StepSpaces: number,
 *   over5000Base: number,
 *   over5000StepOccupants: number,
 *   over5000StepSpaces: number
 * }} WheelchairSpaceRequirements
 *
 * @typedef {{
 *   upto1Space: number,
 *   upto4Spaces: number,
 *   upto8Spaces: number,
 *   upto16Spaces: number,
 *   over16Base: number,
 *   over16StepSpaces: number,
 *   over16StepZones: number
 * }} WheelchairZoneRequirements
 *
 * @typedef {{
 *   companionSeatsPerWheelchair: number,
 *   wheelchairAreaSqFt: number,
 *   companionAreaSqFt: number,
 *   wheelchairSpaceRequirements: WheelchairSpaceRequirements,
 *   wheelchairZoneRequirements: WheelchairZoneRequirements
 * }} AccessibilitySettings
 */

/** @type {AccessibilitySettings} */
const DEFAULT_ACCESSIBILITY_SETTINGS = Object.freeze({
    companionSeatsPerWheelchair: 1,
    wheelchairAreaSqFt: 12,
    companionAreaSqFt: 8,
    wheelchairSpaceRequirements: Object.freeze({
        upto25: 1,
        upto50: 2,
        upto150: 4,
        upto300: 5,
        upto500: 6,
        over500Base: 6,
        over500StepOccupants: 150,
        over500StepSpaces: 1,
        over5000Base: 36,
        over5000StepOccupants: 200,
        over5000StepSpaces: 1
    }),
    wheelchairZoneRequirements: Object.freeze({
        upto1Space: 1,
        upto4Spaces: 2,
        upto8Spaces: 3,
        upto16Spaces: 4,
        over16Base: 4,
        over16StepSpaces: 8,
        over16StepZones: 1
    })
});

/**
 * @param {WheelchairSpaceRequirements} [requirements]
 * @returns {WheelchairSpaceRequirements}
 */
function cloneWheelchairSpaceRequirements(requirements = DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairSpaceRequirements) {
    return {
        ...requirements
    };
}

/**
 * @param {WheelchairZoneRequirements} [requirements]
 * @returns {WheelchairZoneRequirements}
 */
function cloneWheelchairZoneRequirements(requirements = DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairZoneRequirements) {
    return {
        ...requirements
    };
}

/** @returns {AccessibilitySettings} */
export function createDefaultAccessibilitySettings() {
    return {
        companionSeatsPerWheelchair: DEFAULT_ACCESSIBILITY_SETTINGS.companionSeatsPerWheelchair,
        wheelchairAreaSqFt: DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairAreaSqFt,
        companionAreaSqFt: DEFAULT_ACCESSIBILITY_SETTINGS.companionAreaSqFt,
        wheelchairSpaceRequirements: cloneWheelchairSpaceRequirements(
            DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairSpaceRequirements
        ),
        wheelchairZoneRequirements: cloneWheelchairZoneRequirements(
            DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairZoneRequirements
        )
    };
}

function normalizeCountValue(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return Math.max(0, Math.ceil(Number(fallback) || 0));
    }
    return Math.max(0, Math.ceil(numeric));
}

function normalizePositiveStep(value, fallback = 1) {
    const numeric = Number(value);
    if (!(Number.isFinite(numeric) && numeric > 0)) {
        return Math.max(1, Math.ceil(Number(fallback) || 1));
    }
    return Math.max(1, Math.ceil(numeric));
}

function normalizeMetricValue(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : Math.max(0, Number(fallback) || 0);
}

function computeIncrementalRequirement({
    measuredValue,
    threshold,
    baseRequirement,
    stepSize,
    stepRequirement
}) {
    if (!(measuredValue > threshold)) {
        return normalizeCountValue(baseRequirement);
    }

    const resolvedStepSize = normalizePositiveStep(stepSize);
    const resolvedStepRequirement = normalizeCountValue(stepRequirement);
    const additionalSteps = Math.ceil((measuredValue - threshold) / resolvedStepSize);
    return normalizeCountValue(baseRequirement) + (additionalSteps * resolvedStepRequirement);
}

function buildTierWeightEntries(tierOccupancies = []) {
    return (Array.isArray(tierOccupancies) ? tierOccupancies : []).map((tier, index) => ({
        tierIndex: Math.max(0, Math.floor(Number(tier?.tierIndex) || index)),
        occupancy: Math.max(0, Number(tier?.tierSeatCount ?? tier?.occupancy) || 0)
    }));
}

function allocateWholeRequirement(totalRequirement, tierWeights = []) {
    const resolvedTotal = Math.max(0, Math.ceil(Number(totalRequirement) || 0));
    const safeTierWeights = Array.isArray(tierWeights) ? tierWeights : [];
    if (safeTierWeights.length === 0) return [];
    if (!(resolvedTotal > 0)) {
        return safeTierWeights.map((tier) => ({
            tierIndex: tier.tierIndex,
            count: 0,
            rawShare: 0
        }));
    }

    const totalWeight = safeTierWeights.reduce((sum, tier) => (
        sum + Math.max(0, Number(tier?.occupancy ?? tier?.count) || 0)
    ), 0);
    if (!(totalWeight > 0)) {
        return safeTierWeights.map((tier, index) => ({
            tierIndex: tier.tierIndex,
            count: index < resolvedTotal ? 1 : 0,
            rawShare: 0
        }));
    }

    const allocations = safeTierWeights.map((tier) => {
        const weight = Math.max(0, Number(tier?.occupancy ?? tier?.count) || 0);
        const rawShare = (weight / totalWeight) * resolvedTotal;
        const count = Math.floor(rawShare);
        return {
            tierIndex: tier.tierIndex,
            count,
            rawShare
        };
    });

    let remainder = resolvedTotal - allocations.reduce((sum, tier) => sum + tier.count, 0);
    allocations
        .slice()
        .sort((a, b) => {
            const fractionalDelta = (b.rawShare - b.count) - (a.rawShare - a.count);
            if (Math.abs(fractionalDelta) > 1e-9) return fractionalDelta;
            return a.tierIndex - b.tierIndex;
        })
        .forEach((tier) => {
            if (!(remainder > 0)) return;
            const target = allocations.find((entry) => entry.tierIndex === tier.tierIndex);
            if (!target) return;
            target.count += 1;
            remainder -= 1;
        });

    return allocations;
}

/**
 * @param {{
 *   totalOccupancy?: number,
 *   accessibilitySettings?: AccessibilitySettings
 * }} [options]
 */
export function computeMinimumWheelchairSpaces({
    totalOccupancy,
    accessibilitySettings = createDefaultAccessibilitySettings()
} = {}) {
    const occupancy = Math.max(0, Number(totalOccupancy) || 0);
    if (!(occupancy > 0)) return 0;

    const requirements = accessibilitySettings?.wheelchairSpaceRequirements
        || DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairSpaceRequirements;
    if (occupancy <= 25) return normalizeCountValue(requirements.upto25, 1);
    if (occupancy <= 50) return normalizeCountValue(requirements.upto50, 2);
    if (occupancy <= 150) return normalizeCountValue(requirements.upto150, 4);
    if (occupancy <= 300) return normalizeCountValue(requirements.upto300, 5);
    if (occupancy <= 500) return normalizeCountValue(requirements.upto500, 6);
    if (occupancy <= 5000) {
        return computeIncrementalRequirement({
            measuredValue: occupancy,
            threshold: 500,
            baseRequirement: requirements.over500Base,
            stepSize: requirements.over500StepOccupants,
            stepRequirement: requirements.over500StepSpaces
        });
    }

    return computeIncrementalRequirement({
        measuredValue: occupancy,
        threshold: 5000,
        baseRequirement: requirements.over5000Base,
        stepSize: requirements.over5000StepOccupants,
        stepRequirement: requirements.over5000StepSpaces
    });
}

/**
 * @param {{
 *   requiredWheelchairSpaces?: number,
 *   accessibilitySettings?: AccessibilitySettings
 * }} [options]
 */
export function computeMinimumWheelchairZones({
    requiredWheelchairSpaces,
    accessibilitySettings = createDefaultAccessibilitySettings()
} = {}) {
    const spaces = Math.max(0, Math.ceil(Number(requiredWheelchairSpaces) || 0));
    if (!(spaces > 0)) return 0;

    const requirements = accessibilitySettings?.wheelchairZoneRequirements
        || DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairZoneRequirements;
    if (spaces <= 1) return normalizeCountValue(requirements.upto1Space, 1);
    if (spaces <= 4) return normalizeCountValue(requirements.upto4Spaces, 2);
    if (spaces <= 8) return normalizeCountValue(requirements.upto8Spaces, 3);
    if (spaces <= 16) return normalizeCountValue(requirements.upto16Spaces, 4);

    return computeIncrementalRequirement({
        measuredValue: spaces,
        threshold: 16,
        baseRequirement: requirements.over16Base,
        stepSize: requirements.over16StepSpaces,
        stepRequirement: requirements.over16StepZones
    });
}

/**
 * @param {{
 *   totalOccupancy?: number,
 *   tierOccupancies?: Array<{ tierIndex?: number, tierSeatCount?: number, occupancy?: number }>,
 *   accessibilitySettings?: AccessibilitySettings
 * }} [options]
 */
export function buildAccessibilitySummary({
    totalOccupancy,
    tierOccupancies = [],
    accessibilitySettings = createDefaultAccessibilitySettings()
} = {}) {
    const totalBaseOccupancy = Math.max(0, Number(totalOccupancy) || 0);
    const tierWeights = buildTierWeightEntries(tierOccupancies);
    const totalWheelchairSpacesRequired = computeMinimumWheelchairSpaces({
        totalOccupancy: totalBaseOccupancy,
        accessibilitySettings
    });
    const totalCompanionSeatsRequired = normalizeCountValue(
        totalWheelchairSpacesRequired * normalizeMetricValue(
            accessibilitySettings?.companionSeatsPerWheelchair,
            DEFAULT_ACCESSIBILITY_SETTINGS.companionSeatsPerWheelchair
        )
    );
    const totalWheelchairZonesRequired = computeMinimumWheelchairZones({
        requiredWheelchairSpaces: totalWheelchairSpacesRequired,
        accessibilitySettings
    });
    const wheelchairAllocations = allocateWholeRequirement(totalWheelchairSpacesRequired, tierWeights);
    const companionAllocations = allocateWholeRequirement(
        totalCompanionSeatsRequired,
        wheelchairAllocations
    );
    const zoneAllocations = allocateWholeRequirement(
        totalWheelchairZonesRequired,
        wheelchairAllocations
    );
    const companionByTierIndex = new Map(companionAllocations.map((tier) => [tier.tierIndex, tier.count]));
    const zoneByTierIndex = new Map(zoneAllocations.map((tier) => [tier.tierIndex, tier.count]));
    const wheelchairAreaSqFt = normalizeMetricValue(
        accessibilitySettings?.wheelchairAreaSqFt,
        DEFAULT_ACCESSIBILITY_SETTINGS.wheelchairAreaSqFt
    );
    const companionAreaSqFt = normalizeMetricValue(
        accessibilitySettings?.companionAreaSqFt,
        DEFAULT_ACCESSIBILITY_SETTINGS.companionAreaSqFt
    );

    const tierRequirements = wheelchairAllocations.map((tier) => {
        const wheelchairSpacesRequired = tier.count;
        const companionSeatsRequired = companionByTierIndex.get(tier.tierIndex) || 0;
        const wheelchairZonesRequired = zoneByTierIndex.get(tier.tierIndex) || 0;
        const baseOccupancy = tierWeights.find((entry) => entry.tierIndex === tier.tierIndex)?.occupancy || 0;
        const wheelchairAreaRequiredSqFt = wheelchairSpacesRequired * wheelchairAreaSqFt;
        const companionAreaRequiredSqFt = companionSeatsRequired * companionAreaSqFt;
        return {
            tierIndex: tier.tierIndex,
            baseOccupancy,
            wheelchairSpacesRequired,
            companionSeatsRequired,
            wheelchairZonesRequired,
            wheelchairAreaRequiredSqFt,
            companionAreaRequiredSqFt,
            totalAccessibilityAreaRequiredSqFt: wheelchairAreaRequiredSqFt + companionAreaRequiredSqFt,
            adjustedOccupancy: baseOccupancy + wheelchairSpacesRequired + companionSeatsRequired
        };
    });

    const totalWheelchairAreaRequiredSqFt = tierRequirements.reduce((sum, tier) => (
        sum + tier.wheelchairAreaRequiredSqFt
    ), 0);
    const totalCompanionAreaRequiredSqFt = tierRequirements.reduce((sum, tier) => (
        sum + tier.companionAreaRequiredSqFt
    ), 0);

    return {
        assumptions: {
            companionSeatsPerWheelchair: normalizeMetricValue(
                accessibilitySettings?.companionSeatsPerWheelchair,
                DEFAULT_ACCESSIBILITY_SETTINGS.companionSeatsPerWheelchair
            ),
            wheelchairAreaSqFt,
            companionAreaSqFt
        },
        tierRequirements,
        totalWheelchairSpacesRequired,
        totalCompanionSeatsRequired,
        totalWheelchairZonesRequired,
        totalWheelchairAreaRequiredSqFt,
        totalCompanionAreaRequiredSqFt,
        totalAccessibilityAreaRequiredSqFt: (
            totalWheelchairAreaRequiredSqFt + totalCompanionAreaRequiredSqFt
        ),
        totalAdjustedOccupancy: (
            totalBaseOccupancy + totalWheelchairSpacesRequired + totalCompanionSeatsRequired
        )
    };
}

export function computeMinimumBlockCountForSeatLimit({ backRowSeatsPerRun, seatsBetweenAisles }) {
    const backSeats = Math.max(0, Number(backRowSeatsPerRun) || 0);
    const limit = Math.max(1, Math.round(Number(seatsBetweenAisles) || 1));
    return Math.max(1, Math.ceil(backSeats / limit));
}

export function computeTributaryOccupancyPerAisle({ occupantsPerBlock, blockCount }) {
    const resolvedOccupantsPerBlock = Math.max(0, Number(occupantsPerBlock) || 0);
    const resolvedBlockCount = Math.max(1, Math.round(Number(blockCount) || 1));
    return resolvedBlockCount === 1 ? (0.5 * resolvedOccupantsPerBlock) : resolvedOccupantsPerBlock;
}

export function computeMaximumOccupantsPerAisle({ maxAisleWidthIn, egressFactor }) {
    const factor = Math.max(0, Number(egressFactor) || 0);
    if (!(factor > 0)) return Number.POSITIVE_INFINITY;

    const maxWidth = Math.max(0, Number(maxAisleWidthIn) || 0);
    return maxWidth / factor;
}

export function computeRequiredAisleWidthIn({ tributaryOccupancy, egressFactor }) {
    const factor = Math.max(0, Number(egressFactor) || 0);
    return Math.max(0, Number(tributaryOccupancy) || 0) * factor;
}

export function clampAisleWidthIn({ aisleWidthIn, minAisleWidthIn, maxAisleWidthIn }) {
    const minWidth = Math.max(0, Number(minAisleWidthIn) || 0);
    const maxWidth = Math.max(minWidth, Number(maxAisleWidthIn) || minWidth);
    return Math.min(Math.max(Math.max(0, Number(aisleWidthIn) || 0), minWidth), maxWidth);
}

export function computeAssignedAisleWidthIn({ tributaryOccupancy, egressFactor, minAisleWidthIn, maxAisleWidthIn }) {
    return clampAisleWidthIn({
        aisleWidthIn: computeRequiredAisleWidthIn({
            tributaryOccupancy,
            egressFactor
        }),
        minAisleWidthIn,
        maxAisleWidthIn
    });
}

export function validateTributaryAisleCapacity({ tributaryOccupancy, maxAisleWidthIn, egressFactor }) {
    const load = Math.max(0, Number(tributaryOccupancy) || 0);
    const maxOccupants = computeMaximumOccupantsPerAisle({
        maxAisleWidthIn,
        egressFactor
    });
    return load <= maxOccupants + 1e-9;
}

export function computeRequiredBlockCountForWidthCap({ seatsPerRow, rowCount, assignedAisleWidthIn, egressFactor }) {
    const resolvedSeatsPerRow = Math.max(0, Number(seatsPerRow) || 0);
    const resolvedRowCount = Math.max(1, Math.round(Number(rowCount) || 1));
    const resolvedWidth = Math.max(0, Number(assignedAisleWidthIn) || 0);
    const maxOccAllowed = computeMaximumOccupantsPerAisle({
        maxAisleWidthIn: resolvedWidth,
        egressFactor
    });
    if (!(resolvedWidth > 0) || !Number.isFinite(maxOccAllowed) || !(maxOccAllowed > 0)) return 1;

    return Math.max(1, Math.ceil((resolvedSeatsPerRow * resolvedRowCount) / Math.max(1e-9, maxOccAllowed)));
}

export function solveUniformTierEgressPolicy({
    avgRunLengthIn,
    backRunLengthIn,
    rowCount,
    seatWidthIn,
    seatsBetweenAisles,
    minAisleWidthIn,
    maxAisleWidthIn,
    egressFactor
}) {
    const resolvedSeatWidthIn = normalizeSeatWidthIn(seatWidthIn);
    const resolvedMinAisleWidthIn = Math.max(0, Number(minAisleWidthIn) || 0);
    const resolvedMaxAisleWidthIn = Math.max(resolvedMinAisleWidthIn, Number(maxAisleWidthIn) || resolvedMinAisleWidthIn);
    const resolvedEgressFactor = Math.max(0, Number(egressFactor) || 0);
    const resolvedSeatsBetweenAisles = Math.max(1, Math.round(Number(seatsBetweenAisles) || 1));
    const resolvedRowCount = Math.max(1, Math.round(Number(rowCount) || 1));

    let iterAisleLines = 2;
    let iterAisleWidth = resolvedMinAisleWidthIn;
    let finalSeatsPerRow = 0;
    let finalBackRowSeatsPerRow = 0;
    let blocksPerRow = 1;
    let converged = false;

    for (let i = 0; i < 20; i++) {
        const avgSeatsPerRow = countSeatsFromUsableRunLengthIn({
            usableRunLengthIn: computeUsableRunLengthIn({
                totalRunLengthIn: avgRunLengthIn,
                aisleLineCount: iterAisleLines,
                aisleWidthIn: iterAisleWidth
            }),
            seatWidthIn: resolvedSeatWidthIn
        });
        const backSeatsPerRow = countSeatsFromUsableRunLengthIn({
            usableRunLengthIn: computeUsableRunLengthIn({
                totalRunLengthIn: backRunLengthIn,
                aisleLineCount: iterAisleLines,
                aisleWidthIn: iterAisleWidth
            }),
            seatWidthIn: resolvedSeatWidthIn
        });

        let newBlocksPerRow = computeMinimumBlockCountForSeatLimit({
            backRowSeatsPerRun: backSeatsPerRow,
            seatsBetweenAisles: resolvedSeatsBetweenAisles
        });

        const seatsInBlockPerRow = computeAverageSeatsPerBlock({ seatsPerRow: avgSeatsPerRow, blockCount: newBlocksPerRow });
        const occupantsPerBlock = seatsInBlockPerRow * resolvedRowCount;
        const tributaryOccupancy = computeTributaryOccupancyPerAisle({ occupantsPerBlock, blockCount: newBlocksPerRow });
        const newAisleWidth = computeAssignedAisleWidthIn({
            tributaryOccupancy,
            egressFactor: resolvedEgressFactor,
            minAisleWidthIn: resolvedMinAisleWidthIn,
            maxAisleWidthIn: resolvedMaxAisleWidthIn
        });

        if (tributaryOccupancy * resolvedEgressFactor > newAisleWidth && resolvedEgressFactor > 0) {
            const requiredBlocks = computeRequiredBlockCountForWidthCap({
                seatsPerRow: avgSeatsPerRow,
                rowCount: resolvedRowCount,
                assignedAisleWidthIn: newAisleWidth,
                egressFactor: resolvedEgressFactor
            });
            if (requiredBlocks > newBlocksPerRow) newBlocksPerRow = requiredBlocks;
        }

        const newAisleLines = newBlocksPerRow + 1;
        if (
            newAisleLines === iterAisleLines &&
            Math.abs(newAisleWidth - iterAisleWidth) < 0.1 &&
            avgSeatsPerRow === finalSeatsPerRow &&
            backSeatsPerRow === finalBackRowSeatsPerRow &&
            newBlocksPerRow === blocksPerRow
        ) {
            converged = true;
            finalSeatsPerRow = avgSeatsPerRow;
            finalBackRowSeatsPerRow = backSeatsPerRow;
            blocksPerRow = newBlocksPerRow;
            iterAisleWidth = newAisleWidth;
            iterAisleLines = newAisleLines;
            break;
        }

        iterAisleLines = newAisleLines;
        iterAisleWidth = newAisleWidth;
        finalSeatsPerRow = avgSeatsPerRow;
        finalBackRowSeatsPerRow = backSeatsPerRow;
        blocksPerRow = newBlocksPerRow;
    }

    return {
        numAisles: iterAisleLines,
        aisleWidthIn: iterAisleWidth,
        seatsPerRow: finalSeatsPerRow,
        backRowSeatsPerRow: finalBackRowSeatsPerRow,
        numSections: blocksPerRow,
        converged
    };
}

/**
 * @param {{
 *   maxSeatsBetweenAisles?: number,
 *   measureWorstSeatsForCount?: ((count: number) => number),
 *   maxCount?: number
 * }} [options]
 */
export function findRequiredIntervalAisleCount({
    maxSeatsBetweenAisles,
    measureWorstSeatsForCount,
    maxCount = 500
} = {}) {
    const limit = Number(maxSeatsBetweenAisles);
    if (!(Number.isFinite(limit) && limit > 0)) return 0;
    if (typeof measureWorstSeatsForCount !== 'function') return 0;

    const safeMaxCount = Math.max(0, Math.floor(Number(maxCount) || 0));
    let required = 0;
    while (required < safeMaxCount && measureWorstSeatsForCount(required) > limit) {
        required += 1;
    }
    return required;
}

/**
 * @param {{
 *   maxOccupantsPerAisle?: number,
 *   rowCount?: number,
 *   measureWorstSeatsForCount?: ((count: number) => number),
 *   measureWorstOccupantsPerSectionForCount?: ((count: number) => number),
 *   maxCount?: number
 * }} [options]
 */
export function findRequiredIntervalAisleCountForAisleLoad({
    maxOccupantsPerAisle,
    rowCount,
    measureWorstSeatsForCount,
    measureWorstOccupantsPerSectionForCount,
    maxCount = 500
} = {}) {
    const loadCap = Number(maxOccupantsPerAisle);
    if (!(Number.isFinite(loadCap) && loadCap > 0)) return 0;
    if (typeof measureWorstSeatsForCount !== 'function') return 0;

    const resolvedRowCount = Math.max(1, Math.round(Number(rowCount) || 1));
    const safeMaxCount = Math.max(0, Math.floor(Number(maxCount) || 0));
    let required = 0;
    while (required < safeMaxCount) {
        const worstSeatsPerSection = Math.max(0, Number(measureWorstSeatsForCount(required)) || 0);
        const occupantsPerSection = typeof measureWorstOccupantsPerSectionForCount === 'function'
            ? Math.max(0, Number(measureWorstOccupantsPerSectionForCount(required)) || 0)
            : (worstSeatsPerSection * resolvedRowCount);
        const tributaryOccupancy = computeTributaryOccupancyPerAisle({
            occupantsPerBlock: occupantsPerSection,
            blockCount: required + 1
        });
        if (tributaryOccupancy <= loadCap + 1e-9) break;
        required += 1;
    }
    return required;
}

/**
 * @param {{
 *   aisleCount?: number,
 *   sections?: Array<{
 *     occupancy?: number,
 *     aisleIndexA?: number,
 *     aisleIndexB?: number
 *   }>
 * }} [options]
 */
export function computeAisleTributaryOccupancies({
    aisleCount,
    sections
} = {}) {
    const resolvedAisleCount = Math.max(0, Math.floor(Number(aisleCount) || 0));
    const occupancies = new Array(resolvedAisleCount).fill(0);
    if (!occupancies.length) return occupancies;

    const safeSections = Array.isArray(sections) ? sections : [];
    safeSections.forEach((section) => {
        const occupancy = Math.max(0, Number(section?.occupancy) || 0);
        if (!(occupancy > 0)) return;

        const aisleIndexA = Math.floor(Number(section?.aisleIndexA));
        const aisleIndexB = Math.floor(Number(section?.aisleIndexB));
        const hasA = Number.isInteger(aisleIndexA) && aisleIndexA >= 0 && aisleIndexA < resolvedAisleCount;
        const hasB = Number.isInteger(aisleIndexB) && aisleIndexB >= 0 && aisleIndexB < resolvedAisleCount;
        if (!hasA && !hasB) return;

        if (hasA && hasB && aisleIndexA === aisleIndexB) {
            occupancies[aisleIndexA] += occupancy;
            return;
        }

        if (hasA) occupancies[aisleIndexA] += occupancy * 0.5;
        if (hasB) occupancies[aisleIndexB] += occupancy * 0.5;
    });

    return occupancies;
}

export function buildDistributedAisleCountMatrix(perimeterModel, createCountMatrix, getEntries, resolveRequiredCount) {
    const counts = typeof createCountMatrix === 'function' ? createCountMatrix(perimeterModel) : [];
    const entries = typeof getEntries === 'function' ? getEntries(perimeterModel) : [];

    entries.forEach(({ pathIndex, interval, measureWorstSeatsForCount }) => {
        if (!counts[pathIndex] || !interval) return;
        counts[pathIndex][interval.index] = Math.max(0, Math.floor(Number(resolveRequiredCount({
            pathIndex,
            interval,
            measureWorstSeatsForCount
        })) || 0));
    });

    return counts;
}

export function validateDistributedSeatCaps(perimeterModel, getEntries, resolveCountForEntry, maxSeatsBetweenAisles) {
    const limit = Number(maxSeatsBetweenAisles);
    if (!(Number.isFinite(limit) && limit > 0)) return true;

    const entries = typeof getEntries === 'function' ? getEntries(perimeterModel) : [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const worst = Number(resolveCountForEntry(entry));
        if (Number.isFinite(worst) && worst > limit) return false;
    }

    return true;
}

export function estimateWorstSeatsInInterval(intervalLengthFt, distributedCount, options = {}) {
    const gapFt = Math.max(0, Number(intervalLengthFt) || 0);
    const count = Math.max(0, Math.floor(Number(distributedCount) || 0));
    const aisleWidthFt = normalizeAisleWidthFt(options.aisleWidthFt);
    const seatWidthIn = normalizeSeatWidthIn(options.seatWidthIn);
    if (typeof options.measureSegments === 'function') {
        const bounds = options.measureSegments(count);
        if (Array.isArray(bounds) && bounds.length >= 2) {
            let worst = 0;
            for (let i = 0; i < bounds.length - 1; i += 1) {
                const start = Math.max(0, Math.min(1, Number(bounds[i]) || 0));
                const end = Math.max(0, Math.min(1, Number(bounds[i + 1]) || 0));
                const seats = spanGapToSeatCount(Math.max(0, gapFt * (end - start)), aisleWidthFt, seatWidthIn);
                if (seats > worst) worst = seats;
            }
            return worst;
        }
    }
    const segmentLengthFt = count >= 0 ? gapFt / (count + 1) : gapFt;
    return spanGapToSeatCount(segmentLengthFt, aisleWidthFt, seatWidthIn);
}

function buildIntervalSectionSeatCounts(intervalLengthFt, distributedCount, options = {}) {
    const gapFt = Math.max(0, Number(intervalLengthFt) || 0);
    const count = Math.max(0, Math.floor(Number(distributedCount) || 0));
    const aisleWidthFt = normalizeAisleWidthFt(options.aisleWidthFt);
    const seatWidthIn = normalizeSeatWidthIn(options.seatWidthIn);

    if (typeof options.measureSegments === 'function') {
        const bounds = options.measureSegments(count);
        if (Array.isArray(bounds) && bounds.length >= 2) {
            const seatCounts = [];
            for (let i = 0; i < bounds.length - 1; i += 1) {
                const start = Math.max(0, Math.min(1, Number(bounds[i]) || 0));
                const end = Math.max(0, Math.min(1, Number(bounds[i + 1]) || 0));
                seatCounts.push(spanGapToSeatCount(Math.max(0, gapFt * (end - start)), aisleWidthFt, seatWidthIn));
            }
            return seatCounts;
        }
    }

    return new Array(count + 1).fill(
        spanGapToSeatCount(count >= 0 ? (gapFt / (count + 1)) : gapFt, aisleWidthFt, seatWidthIn)
    );
}

/**
 * @param {{
 *   frontIntervalLengthFt?: number,
 *   backIntervalLengthFt?: number,
 *   distributedCount?: number,
 *   rowCount?: number,
 *   aisleWidthFt?: number,
 *   seatWidthIn?: number,
 *   measureSegments?: ((count: number) => number[])
 * }} [options]
 */
export function estimateWorstOccupantsPerSectionInTaperedInterval({
    frontIntervalLengthFt,
    backIntervalLengthFt,
    distributedCount,
    rowCount,
    aisleWidthFt,
    seatWidthIn,
    measureSegments
} = {}) {
    const resolvedRowCount = Math.max(1, Math.round(Number(rowCount) || 1));
    const frontSeatCounts = buildIntervalSectionSeatCounts(frontIntervalLengthFt, distributedCount, {
        aisleWidthFt,
        seatWidthIn,
        measureSegments
    });
    const backSeatCounts = buildIntervalSectionSeatCounts(backIntervalLengthFt, distributedCount, {
        aisleWidthFt,
        seatWidthIn,
        measureSegments
    });
    const sectionCount = Math.max(frontSeatCounts.length, backSeatCounts.length);
    let worstOccupancy = 0;

    for (let i = 0; i < sectionCount; i += 1) {
        const frontSeats = Math.max(0, Number(frontSeatCounts[i] ?? backSeatCounts[i]) || 0);
        const backSeats = Math.max(0, Number(backSeatCounts[i] ?? frontSeatCounts[i]) || 0);
        const estimatedAverageSeats = Math.ceil((frontSeats + backSeats) * 0.5);
        worstOccupancy = Math.max(worstOccupancy, estimatedAverageSeats * resolvedRowCount);
    }

    return worstOccupancy;
}

export function computeTierEgressMetrics({
    avgTierLengthIn,
    backRowLengthIn,
    numRows,
    seatWidthIn,
    minAisleWidthIn,
    maxAisleWidthIn,
    egressFactor,
    seatsBetweenAisles
}) {
    const resolvedSeatWidthIn = normalizeSeatWidthIn(seatWidthIn);
    const resolvedMinAisleWidthIn = Math.max(0, Number(minAisleWidthIn) || 0);
    const resolvedMaxAisleWidthIn = Math.max(resolvedMinAisleWidthIn, Number(maxAisleWidthIn) || resolvedMinAisleWidthIn);
    const resolvedEgressFactor = Math.max(0, Number(egressFactor) || 0);
    const resolvedSeatsBetweenAisles = Math.max(1, Math.round(Number(seatsBetweenAisles) || 1));
    const resolvedNumRows = Math.max(1, Math.round(Number(numRows) || 1));

    const solvedPolicy = solveUniformTierEgressPolicy({
        avgRunLengthIn: avgTierLengthIn,
        backRunLengthIn: backRowLengthIn,
        rowCount: resolvedNumRows,
        seatWidthIn: resolvedSeatWidthIn,
        seatsBetweenAisles: resolvedSeatsBetweenAisles,
        minAisleWidthIn: resolvedMinAisleWidthIn,
        maxAisleWidthIn: resolvedMaxAisleWidthIn,
        egressFactor: resolvedEgressFactor
    });

    const seatsPerBlock = computeAverageSeatsPerBlock({ seatsPerRow: solvedPolicy.seatsPerRow, blockCount: solvedPolicy.numSections });
    const maxSeatsPerSectionRow = Math.ceil(
        Math.max(0, Number(solvedPolicy.backRowSeatsPerRow) || 0) / Math.max(1, Number(solvedPolicy.numSections) || 1)
    );
    const occupantsPerSection = seatsPerBlock * resolvedNumRows;
    const occupantsPerAisleLine = computeTributaryOccupancyPerAisle({ occupantsPerBlock: occupantsPerSection, blockCount: solvedPolicy.numSections });
    const capacityWidth = computeRequiredAisleWidthIn({
        tributaryOccupancy: occupantsPerAisleLine,
        egressFactor: resolvedEgressFactor
    });
    let baselineBlocksPerRow = computeMinimumBlockCountForSeatLimit({ backRowSeatsPerRun: solvedPolicy.backRowSeatsPerRow, seatsBetweenAisles: resolvedSeatsBetweenAisles });
    if (baselineBlocksPerRow < 1) baselineBlocksPerRow = 1;

    return {
        numAisles: solvedPolicy.numAisles,
        aisleWidthIn: solvedPolicy.aisleWidthIn,
        seatsPerRow: solvedPolicy.seatsPerRow,
        backRowSeatsPerRow: solvedPolicy.backRowSeatsPerRow,
        numSections: solvedPolicy.numSections,
        seatsPerBlock,
        maxSeatsPerSectionRow,
        occupantsPerSection,
        occupantsPerAisleLine,
        capacityWidth,
        totalEgressWidthRequired: solvedPolicy.numAisles * solvedPolicy.aisleWidthIn,
        minimumWidth: resolvedMinAisleWidthIn,
        maximumWidth: resolvedMaxAisleWidthIn,
        legalMaxOccupantsPerAisle: computeMaximumOccupantsPerAisle({
            maxAisleWidthIn: resolvedMaxAisleWidthIn,
            egressFactor: resolvedEgressFactor
        }),
        governingWidth: solvedPolicy.aisleWidthIn,
        blocksAddedForEgress: solvedPolicy.numSections - baselineBlocksPerRow,
        converged: solvedPolicy.converged
    };
}

export function computeRequiredPerimeterSegmentCounts({
    perimeterModel,
    maxSeatsBetweenAisles,
    createCountMatrix,
    getEntries,
    resolveRequiredCount
}) {
    const limit = Number(maxSeatsBetweenAisles);
    if (!(Number.isFinite(limit) && limit > 0)) {
        return typeof createCountMatrix === 'function' ? createCountMatrix(perimeterModel) : [];
    }

    return buildDistributedAisleCountMatrix(
        perimeterModel,
        createCountMatrix,
        getEntries,
        ({ pathIndex, interval, measureWorstSeatsForCount }) => resolveRequiredCount({
            pathIndex,
            interval,
            measureWorstSeatsForCount,
            maxSeatsBetweenAisles: limit
        })
    );
}

export function validatePerimeterSeatCaps({
    perimeterModel,
    aisles,
    maxSeatsBetweenAisles,
    createCountMatrix,
    getEntries,
    accumulateAisleCount,
    measureWorstSeats
}) {
    const limit = Number(maxSeatsBetweenAisles);
    if (!(Number.isFinite(limit) && limit > 0)) return true;

    const counts = typeof createCountMatrix === 'function' ? createCountMatrix(perimeterModel) : [];
    const safeAisles = Array.isArray(aisles) ? aisles : [];

    for (let i = 0; i < safeAisles.length; i += 1) {
        accumulateAisleCount?.(counts, safeAisles[i]);
    }

    return validateDistributedSeatCaps(
        perimeterModel,
        getEntries,
        (entry) => measureWorstSeats(entry, counts),
        limit
    );
}
