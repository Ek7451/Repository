import { describe, expect, it } from 'vitest';

import {
    buildAccessibilitySummary,
    computeAisleTributaryOccupancies,
    buildDistributedAisleCountMatrix,
    clampAisleWidthIn,
    computeMinimumWheelchairSpaces,
    computeMinimumWheelchairZones,
    computeRequiredPerimeterSegmentCounts,
    computeAssignedAisleWidthIn,
    computeMaximumOccupantsPerAisle,
    computeMinimumBlockCountForSeatLimit,
    computeRequiredAisleWidthIn,
    estimateWorstOccupantsPerSectionInTaperedInterval,
    computeRequiredBlockCountForWidthCap,
    computeTierEgressMetrics,
    computeTributaryOccupancyPerAisle,
    estimateWorstSeatsInInterval,
    findRequiredIntervalAisleCount,
    findRequiredIntervalAisleCountForAisleLoad,
    solveUniformTierEgressPolicy,
    validatePerimeterSeatCaps,
    validateDistributedSeatCaps,
    validateTributaryAisleCapacity,
    createDefaultAccessibilitySettings
} from '../../core/egress-policy.js';

describe('egress policy helpers', () => {
    it('solves uniform tier egress policy with current fixed-point behavior', () => {
        expect(solveUniformTierEgressPolicy({
            avgRunLengthIn: 1680,
            backRunLengthIn: 1680,
            rowCount: 4,
            seatWidthIn: 20,
            seatsBetweenAisles: 20,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 72,
            egressFactor: 0.2
        })).toEqual({
            numAisles: 5,
            aisleWidthIn: 48,
            seatsPerRow: 72,
            backRowSeatsPerRow: 72,
            numSections: 4,
            converged: true
        });
    });

    it('computes width, blocks, and tributary occupancy helpers', () => {
        expect(computeMinimumBlockCountForSeatLimit({ backRowSeatsPerRun: 60, seatsBetweenAisles: 20 })).toBe(3);
        expect(computeTributaryOccupancyPerAisle({ occupantsPerBlock: 60, blockCount: 1 })).toBe(30);
        expect(computeTributaryOccupancyPerAisle({ occupantsPerBlock: 60, blockCount: 4 })).toBe(60);
        expect(computeMaximumOccupantsPerAisle({ maxAisleWidthIn: 72, egressFactor: 0.2 })).toBe(360);
        expect(computeRequiredAisleWidthIn({ tributaryOccupancy: 60, egressFactor: 0.2 })).toBe(12);
        expect(clampAisleWidthIn({ aisleWidthIn: 12, minAisleWidthIn: 48, maxAisleWidthIn: 72 })).toBe(48);
        expect(computeAssignedAisleWidthIn({ tributaryOccupancy: 60, egressFactor: 0.2, minAisleWidthIn: 48, maxAisleWidthIn: 72 })).toBe(48);
        expect(computeRequiredBlockCountForWidthCap({ seatsPerRow: 100, rowCount: 10, assignedAisleWidthIn: 48, egressFactor: 0.2 })).toBe(5);
        expect(validateTributaryAisleCapacity({ tributaryOccupancy: 300, maxAisleWidthIn: 72, egressFactor: 0.2 })).toBe(true);
        expect(validateTributaryAisleCapacity({ tributaryOccupancy: 400, maxAisleWidthIn: 72, egressFactor: 0.2 })).toBe(false);
    });

    it('finds interval aisle counts and worst seat spans using shared policy math', () => {
        expect(estimateWorstSeatsInInterval(30, 0, { aisleWidthFt: 4, seatWidthIn: 20 })).toBe(15);
        expect(estimateWorstSeatsInInterval(30, 2, { aisleWidthFt: 4, seatWidthIn: 20 })).toBe(3);
        expect(findRequiredIntervalAisleCount({
            maxSeatsBetweenAisles: 12,
            measureWorstSeatsForCount: (count) => estimateWorstSeatsInInterval(30, count, { aisleWidthFt: 4, seatWidthIn: 20 }),
            maxCount: 10
        })).toBe(1);
    });

    it('finds interval aisle counts from the shared aisle-load cap', () => {
        expect(findRequiredIntervalAisleCountForAisleLoad({
            maxOccupantsPerAisle: 25,
            rowCount: 4,
            measureWorstSeatsForCount: (count) => estimateWorstSeatsInInterval(30, count, { aisleWidthFt: 4, seatWidthIn: 20 }),
            maxCount: 10
        })).toBe(1);
    });

    it('estimates tapered interval occupancy from front and back section widths', () => {
        expect(estimateWorstOccupantsPerSectionInTaperedInterval({
            frontIntervalLengthFt: 53,
            backIntervalLengthFt: 87.1715,
            distributedCount: 1,
            rowCount: 15,
            aisleWidthFt: 5.5,
            seatWidthIn: 19,
            measureSegments: () => [0, 0.5, 1]
        })).toBe(285);

        expect(findRequiredIntervalAisleCountForAisleLoad({
            maxOccupantsPerAisle: 330,
            rowCount: 15,
            measureWorstSeatsForCount: (count) => [51, 24, 14][count] ?? 0,
            measureWorstOccupantsPerSectionForCount: (count) => [700, 285, 210][count] ?? 0,
            maxCount: 10
        })).toBe(1);
    });

    it('splits realized section occupancies into tributary aisle loads', () => {
        expect(computeAisleTributaryOccupancies({
            aisleCount: 3,
            sections: [
                { occupancy: 80, aisleIndexA: 0, aisleIndexB: 1 },
                { occupancy: 60, aisleIndexA: 1, aisleIndexB: 2 }
            ]
        })).toEqual([40, 70, 30]);
    });

    it('preserves computeTierEgressMetrics public shape', () => {
        expect(computeTierEgressMetrics({
            avgTierLengthIn: 1680,
            backRowLengthIn: 1680,
            numRows: 4,
            seatWidthIn: 20,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 72,
            egressFactor: 0.2,
            seatsBetweenAisles: 20
        })).toMatchObject({
            numAisles: 5,
            aisleWidthIn: 48,
            seatsPerRow: 72,
            backRowSeatsPerRow: 72,
            numSections: 4,
            seatsPerBlock: 18,
            maxSeatsPerSectionRow: 18,
            occupantsPerSection: 72,
            occupantsPerAisleLine: 72,
            capacityWidth: 14.4,
            totalEgressWidthRequired: 240,
            minimumWidth: 48,
            maximumWidth: 72,
            legalMaxOccupantsPerAisle: 360,
            governingWidth: 48,
            blocksAddedForEgress: 0,
            converged: true
        });
    });

    it('computes wheelchair space and zone requirements from the shared accessibility policy', () => {
        const accessibilitySettings = createDefaultAccessibilitySettings();

        expect(computeMinimumWheelchairSpaces({
            totalOccupancy: 530,
            accessibilitySettings
        })).toBe(7);
        expect(computeMinimumWheelchairSpaces({
            totalOccupancy: 5001,
            accessibilitySettings
        })).toBe(37);
        expect(computeMinimumWheelchairZones({
            requiredWheelchairSpaces: 7,
            accessibilitySettings
        })).toBe(3);
        expect(computeMinimumWheelchairZones({
            requiredWheelchairSpaces: 17,
            accessibilitySettings
        })).toBe(5);
    });

    it('allocates accessibility totals to tiers deterministically while preserving total sums', () => {
        const summary = buildAccessibilitySummary({
            totalOccupancy: 530,
            tierOccupancies: [
                { tierIndex: 0, tierSeatCount: 265 },
                { tierIndex: 1, tierSeatCount: 265 }
            ],
            accessibilitySettings: createDefaultAccessibilitySettings()
        });

        expect(summary).toMatchObject({
            totalWheelchairSpacesRequired: 7,
            totalCompanionSeatsRequired: 7,
            totalWheelchairZonesRequired: 3,
            totalWheelchairAreaRequiredSqFt: 63,
            totalCompanionAreaRequiredSqFt: 42,
            totalAccessibilityAreaRequiredSqFt: 105,
            totalAdjustedOccupancy: 544
        });
        expect(summary.tierRequirements).toEqual([
            expect.objectContaining({
                tierIndex: 0,
                baseOccupancy: 265,
                wheelchairSpacesRequired: 4,
                companionSeatsRequired: 4,
                wheelchairZonesRequired: 2,
                totalAccessibilityAreaRequiredSqFt: 60,
                adjustedOccupancy: 273
            }),
            expect.objectContaining({
                tierIndex: 1,
                baseOccupancy: 265,
                wheelchairSpacesRequired: 3,
                companionSeatsRequired: 3,
                wheelchairZonesRequired: 1,
                totalAccessibilityAreaRequiredSqFt: 45,
                adjustedOccupancy: 271
            })
        ]);
    });

    it('solves uniform tier egress metrics with stable public fields', () => {
        const metrics = computeTierEgressMetrics({
            avgTierLengthIn: 2400,
            backRowLengthIn: 2600,
            numRows: 20,
            seatWidthIn: 20,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 72,
            egressFactor: 0.2,
            seatsBetweenAisles: 20
        });

        expect(metrics).toMatchObject({
            numAisles: expect.any(Number),
            aisleWidthIn: expect.any(Number),
            numSections: expect.any(Number),
            occupantsPerSection: expect.any(Number),
            occupantsPerAisleLine: expect.any(Number)
        });
    });

    it('finds required interval aisle counts from a measurement callback', () => {
        const required = findRequiredIntervalAisleCount({
            maxSeatsBetweenAisles: 10,
            measureWorstSeatsForCount: (count) => 20 - (count * 4),
            maxCount: 10
        });

        expect(required).toBe(3);
    });

    it('builds count matrices through policy callbacks', () => {
        const perimeterModel = {};
        const counts = buildDistributedAisleCountMatrix(
            perimeterModel,
            () => [[0, 0]],
            () => [{ pathIndex: 0, interval: { index: 1 }, measureWorstSeatsForCount: () => 0 }],
            () => 2
        );

        expect(counts).toEqual([[0, 2]]);
    });

    it('computes required perimeter segment counts through policy callbacks', () => {
        const counts = computeRequiredPerimeterSegmentCounts({
            perimeterModel: {},
            maxSeatsBetweenAisles: 10,
            createCountMatrix: () => [[0, 0]],
            getEntries: () => [{ pathIndex: 0, interval: { index: 1 }, measureWorstSeatsForCount: (count) => 12 - (count * 2) }],
            resolveRequiredCount: ({ maxSeatsBetweenAisles, measureWorstSeatsForCount }) => findRequiredIntervalAisleCount({
                maxSeatsBetweenAisles,
                measureWorstSeatsForCount,
                maxCount: 10
            })
        });

        expect(counts).toEqual([[0, 1]]);
    });

    it('validates distributed seat caps through a policy callback', () => {
        const entries = [{ id: 1 }, { id: 2 }];
        expect(validateDistributedSeatCaps({}, () => entries, (entry) => entry.id === 1 ? 8 : 9, 10)).toBe(true);
        expect(validateDistributedSeatCaps({}, () => entries, (entry) => entry.id === 2 ? 11 : 8, 10)).toBe(false);
    });

    it('validates perimeter seat caps through accumulated aisle counts', () => {
        const valid = validatePerimeterSeatCaps({
            perimeterModel: {},
            aisles: [{ pathIndex: 0, segmentIndex: 0 }],
            maxSeatsBetweenAisles: 10,
            createCountMatrix: () => [[0]],
            getEntries: () => [{ pathIndex: 0, interval: { index: 0 } }],
            accumulateAisleCount: (counts, aisle) => { counts[aisle.pathIndex][aisle.segmentIndex] += 1; },
            measureWorstSeats: (_entry, counts) => counts[0][0] === 1 ? 9 : 11
        });

        expect(valid).toBe(true);
    });
});
