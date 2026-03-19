import {
    computeAverageSeatsPerBlock,
    computeUsableRunLengthIn,
    countSeatsFromUsableRunLengthIn,
    normalizeAisleWidthFt,
    normalizeSeatWidthIn,
    spanGapToSeatCount
} from './seat-math.js';

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
 *   maxCount?: number
 * }} [options]
 */
export function findRequiredIntervalAisleCountForAisleLoad({
    maxOccupantsPerAisle,
    rowCount,
    measureWorstSeatsForCount,
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
        const occupantsPerSection = worstSeatsPerSection * resolvedRowCount;
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
