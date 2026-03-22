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
 *   minSeats?: number | string,
 *   maxSeats?: number | string | null,
 *   requiredSpaces?: number | string,
 *   requiredLocations?: number | string,
 *   seatsPerIncrement?: number | string,
 *   incrementAppliesAfter?: number | string
 * }} AccessibilityRequirementBandInput
 * @typedef {{
 *   wheelchairSpaceBands?: AccessibilityRequirementBandInput[],
 *   wheelchairLocationBands?: AccessibilityRequirementBandInput[],
 *   companionSeatsPerWheelchairSpace?: number,
 *   wheelchairSpaceAreaSqFt?: number,
 *   companionSpaceAreaSqFt?: number
 * }} AccessibilityParams
 * @typedef {{
 *   tierIndex?: number,
 *   tierSeatCount?: number
 * }} TierSeatCountInput
 */

function toNonNegativeInteger(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function toNonNegativeNumber(value) {
    return Math.max(0, Number(value) || 0);
}

/**
 * @param {'requiredSpaces' | 'requiredLocations'} requirementKey
 * @param {AccessibilityRequirementBandInput[] | undefined} [bands]
 */
function normalizeAccessibilityBands(requirementKey, bands = []) {
    return (Array.isArray(bands) ? bands : [])
        .map((band, index) => {
            const minSeats = toNonNegativeInteger(band?.minSeats);
            const maxSeats = band?.maxSeats === null || band?.maxSeats === undefined || band?.maxSeats === ''
                ? Number.POSITIVE_INFINITY
                : Math.max(minSeats, toNonNegativeInteger(band.maxSeats));
            return {
                minSeats,
                maxSeats,
                requirement: toNonNegativeInteger(band?.[requirementKey]),
                seatsPerIncrement: toNonNegativeInteger(band?.seatsPerIncrement),
                incrementAppliesAfter: toNonNegativeInteger(
                    band?.incrementAppliesAfter ?? (minSeats > 0 ? (minSeats - 1) : 0)
                ),
                order: index
            };
        })
        .sort((a, b) => (
            a.minSeats - b.minSeats
            || a.maxSeats - b.maxSeats
            || a.order - b.order
        ));
}

/**
 * @param {{
 *   seatCount?: number,
 *   bands?: AccessibilityRequirementBandInput[],
 *   requirementKey: 'requiredSpaces' | 'requiredLocations'
 * }} options
 */
function computeRequirementFromBands({ seatCount = 0, bands = [], requirementKey }) {
    const resolvedSeatCount = toNonNegativeInteger(seatCount);
    if (!(resolvedSeatCount > 0)) return 0;

    const normalizedBands = normalizeAccessibilityBands(requirementKey, bands);
    for (let index = 0; index < normalizedBands.length; index += 1) {
        const band = normalizedBands[index];
        if (resolvedSeatCount < band.minSeats || resolvedSeatCount > band.maxSeats) continue;
        if (!(band.seatsPerIncrement > 0)) return band.requirement;

        return band.requirement + Math.ceil(
            Math.max(0, resolvedSeatCount - band.incrementAppliesAfter) / band.seatsPerIncrement
        );
    }

    return 0;
}

/** @param {TierSeatCountInput[] | undefined} [tierSeatCounts] */
function normalizeTierSeatCounts(tierSeatCounts = []) {
    return (Array.isArray(tierSeatCounts) ? tierSeatCounts : [])
        .map((tier, index) => ({
            tierIndex: Math.max(0, Math.floor(Number(tier?.tierIndex) || index)),
            tierSeatCount: Math.max(0, Number(tier?.tierSeatCount) || 0)
        }))
        .sort((a, b) => a.tierIndex - b.tierIndex);
}

/** @param {{ seatCount?: number, accessibilityParams?: AccessibilityParams }} [options] */
export function computeRequiredWheelchairSpaces({
    seatCount = 0,
    accessibilityParams = {}
} = {}) {
    return computeRequirementFromBands({
        seatCount,
        bands: accessibilityParams?.wheelchairSpaceBands,
        requirementKey: 'requiredSpaces'
    });
}

/** @param {{ seatCount?: number, accessibilityParams?: AccessibilityParams }} [options] */
export function computeRequiredWheelchairLocations({
    seatCount = 0,
    accessibilityParams = {}
} = {}) {
    return computeRequirementFromBands({
        seatCount,
        bands: accessibilityParams?.wheelchairLocationBands,
        requirementKey: 'requiredLocations'
    });
}

/** @param {{ totalRequired?: number, tierSeatCounts?: TierSeatCountInput[] }} [options] */
export function allocateRequirementByLargestRemainder({
    totalRequired = 0,
    tierSeatCounts = []
} = {}) {
    const tiers = normalizeTierSeatCounts(tierSeatCounts);
    const resolvedTotalRequired = toNonNegativeInteger(totalRequired);
    if (!tiers.length) return [];

    const totalSeatCount = tiers.reduce((sum, tier) => sum + tier.tierSeatCount, 0);
    if (!(resolvedTotalRequired > 0) || !(totalSeatCount > 0)) {
        return tiers.map((tier) => ({
            tierIndex: tier.tierIndex,
            allocated: 0
        }));
    }

    const rawShares = tiers.map((tier) => {
        const rawShare = (tier.tierSeatCount / totalSeatCount) * resolvedTotalRequired;
        const floorShare = Math.floor(rawShare);
        return {
            tierIndex: tier.tierIndex,
            tierSeatCount: tier.tierSeatCount,
            rawShare,
            floorShare,
            fractionalShare: rawShare - floorShare
        };
    });
    const allocations = new Map(rawShares.map((share) => [share.tierIndex, share.floorShare]));
    let remaining = resolvedTotalRequired - rawShares.reduce((sum, share) => sum + share.floorShare, 0);

    const rank = rawShares
        .filter((share) => share.tierSeatCount > 0)
        .sort((a, b) => (
            b.fractionalShare - a.fractionalShare
            || b.tierSeatCount - a.tierSeatCount
            || a.tierIndex - b.tierIndex
        ));

    for (let index = 0; index < remaining; index += 1) {
        const nextShare = rank[index % rank.length];
        allocations.set(nextShare.tierIndex, (allocations.get(nextShare.tierIndex) || 0) + 1);
    }

    return tiers.map((tier) => ({
        tierIndex: tier.tierIndex,
        allocated: allocations.get(tier.tierIndex) || 0
    }));
}

/** @param {{ tierSeatCounts?: TierSeatCountInput[], accessibilityParams?: AccessibilityParams }} [options] */
export function buildAccessibilityRequirementSummary({
    tierSeatCounts = [],
    accessibilityParams = {}
} = {}) {
    const tiers = normalizeTierSeatCounts(tierSeatCounts);
    const baseSeatCount = tiers.reduce((sum, tier) => sum + tier.tierSeatCount, 0);
    const companionSeatsPerWheelchairSpace = toNonNegativeInteger(
        accessibilityParams?.companionSeatsPerWheelchairSpace
    );
    const wheelchairSpaceAreaSqFt = toNonNegativeNumber(accessibilityParams?.wheelchairSpaceAreaSqFt);
    const companionSpaceAreaSqFt = toNonNegativeNumber(accessibilityParams?.companionSpaceAreaSqFt);
    const wheelchairSpacesRequired = computeRequiredWheelchairSpaces({
        seatCount: baseSeatCount,
        accessibilityParams
    });
    const companionSeatsRequired = wheelchairSpacesRequired * companionSeatsPerWheelchairSpace;
    const wheelchairSpacesAreaSqFt = wheelchairSpacesRequired * wheelchairSpaceAreaSqFt;
    const companionSpacesAreaSqFt = companionSeatsRequired * companionSpaceAreaSqFt;
    const totalAccessibilityAreaSqFt = wheelchairSpacesAreaSqFt + companionSpacesAreaSqFt;
    const wheelchairLocationsRequired = computeRequiredWheelchairLocations({
        seatCount: baseSeatCount,
        accessibilityParams
    });

    const wheelchairAllocations = new Map(
        allocateRequirementByLargestRemainder({
            totalRequired: wheelchairSpacesRequired,
            tierSeatCounts: tiers
        }).map((entry) => [entry.tierIndex, entry.allocated])
    );
    const locationAllocations = new Map(
        allocateRequirementByLargestRemainder({
            totalRequired: wheelchairLocationsRequired,
            tierSeatCounts: tiers
        }).map((entry) => [entry.tierIndex, entry.allocated])
    );

    const tierSummaries = tiers.map((tier) => {
        const allocatedWheelchairSpaces = wheelchairAllocations.get(tier.tierIndex) || 0;
        const allocatedCompanionSeats = allocatedWheelchairSpaces * companionSeatsPerWheelchairSpace;
        const allocatedWheelchairAreaSqFt = allocatedWheelchairSpaces * wheelchairSpaceAreaSqFt;
        const allocatedCompanionAreaSqFt = allocatedCompanionSeats * companionSpaceAreaSqFt;
        const allocatedWheelchairLocations = locationAllocations.get(tier.tierIndex) || 0;
        const accessibilityOccupancyContribution = allocatedWheelchairSpaces + allocatedCompanionSeats;

        return {
            tierIndex: tier.tierIndex,
            baseSeatCount: tier.tierSeatCount,
            wheelchairSpacesRequired: allocatedWheelchairSpaces,
            companionSeatsRequired: allocatedCompanionSeats,
            wheelchairSpacesAreaSqFt: allocatedWheelchairAreaSqFt,
            companionSpacesAreaSqFt: allocatedCompanionAreaSqFt,
            totalAccessibilityAreaSqFt: allocatedWheelchairAreaSqFt + allocatedCompanionAreaSqFt,
            wheelchairLocationsRequired: allocatedWheelchairLocations,
            accessibilityOccupancyContribution,
            reportedOccupancy: tier.tierSeatCount + accessibilityOccupancyContribution
        };
    });

    const accessibilityOccupancyContribution = tierSummaries.reduce(
        (sum, tier) => sum + tier.accessibilityOccupancyContribution,
        0
    );

    return {
        baseSeatCount,
        companionSeatsPerWheelchairSpace,
        wheelchairSpaceAreaSqFt,
        companionSpaceAreaSqFt,
        wheelchairSpacesRequired,
        companionSeatsRequired,
        wheelchairSpacesAreaSqFt,
        companionSpacesAreaSqFt,
        totalAccessibilityAreaSqFt,
        wheelchairLocationsRequired,
        accessibilityOccupancyContribution,
        reportedOccupancy: baseSeatCount + accessibilityOccupancyContribution,
        tiers: tierSummaries
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
 *   measureWorstTributaryOccupancyForCount?: ((count: number) => number),
 *   maxCount?: number
 * }} [options]
 */
export function findRequiredIntervalAisleCountForAisleLoad({
    maxOccupantsPerAisle,
    rowCount,
    measureWorstSeatsForCount,
    measureWorstOccupantsPerSectionForCount,
    measureWorstTributaryOccupancyForCount,
    maxCount = 500
} = {}) {
    const loadCap = Number(maxOccupantsPerAisle);
    if (!(Number.isFinite(loadCap) && loadCap > 0)) return 0;
    if (typeof measureWorstSeatsForCount !== 'function') return 0;

    const resolvedRowCount = Math.max(1, Math.round(Number(rowCount) || 1));
    const safeMaxCount = Math.max(0, Math.floor(Number(maxCount) || 0));
    let required = 0;
    while (required < safeMaxCount) {
        const tributaryOccupancy = typeof measureWorstTributaryOccupancyForCount === 'function'
            ? Math.max(0, Number(measureWorstTributaryOccupancyForCount(required)) || 0)
            : (() => {
                const worstSeatsPerSection = Math.max(0, Number(measureWorstSeatsForCount(required)) || 0);
                const occupantsPerSection = typeof measureWorstOccupantsPerSectionForCount === 'function'
                    ? Math.max(0, Number(measureWorstOccupantsPerSectionForCount(required)) || 0)
                    : (worstSeatsPerSection * resolvedRowCount);
                return computeTributaryOccupancyPerAisle({
                    occupantsPerBlock: occupantsPerSection,
                    blockCount: required + 1
                });
            })();
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
export function estimateWorstTributaryOccupancyInTaperedInterval({
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
    const sections = [];

    for (let i = 0; i < sectionCount; i += 1) {
        const frontSeats = Math.max(0, Number(frontSeatCounts[i] ?? backSeatCounts[i]) || 0);
        const backSeats = Math.max(0, Number(backSeatCounts[i] ?? frontSeatCounts[i]) || 0);
        const estimatedAverageSeats = Math.ceil((frontSeats + backSeats) * 0.5);
        sections.push({
            occupancy: estimatedAverageSeats * resolvedRowCount,
            aisleIndexA: i,
            aisleIndexB: i + 1
        });
    }

    return Math.max(0, ...computeAisleTributaryOccupancies({
        aisleCount: sectionCount + 1,
        sections
    }));
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
