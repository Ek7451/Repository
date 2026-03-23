import { describe, expect, it, vi } from 'vitest';

import {
    buildActiveTierSolvers,
    buildNextTierDefaultsFromSolvers,
    buildTierRowCountHandleCandidates,
    buildStructuralProfileGeometry,
    buildTierMetricsByIndex,
    buildTierMetricsByIndexFromLayouts,
    getSolverTierIndex,
    ProfileSolver
} from '../../core/profile-solver.js';

function createTier(overrides = {}) {
    return {
        enabled: true,
        cValue: 4,
        firstRowDist: 45,
        firstRowElev: 6,
        treadDepth: 33,
        riserHeight: 10,
        numRows: 4,
        eyeHeight: 3.75,
        eyeSetback: 6,
        profileType: 'Parabolic',
        ...overrides
    };
}

describe('profile solver helper exports', () => {
    it('builds solvers only for enabled tiers and preserves source tier indexes', () => {
        const solvers = buildActiveTierSolvers([
            createTier({ numRows: 3 }),
            createTier({ enabled: false, numRows: 8 }),
            createTier({
                firstRowDist: 120,
                firstRowElev: 28,
                riserHeight: 12,
                numRows: 2,
                profileType: 'Linear'
            })
        ], { x: 0, z: 0 });

        expect(solvers).toHaveLength(2);
        expect(solvers.map((solver) => solver.tierIndex)).toEqual([0, 2]);
        expect(solvers.map((solver) => solver.rows.length)).toEqual([3, 2]);
        expect(solvers.map((solver) => solver.solveMethod)).toEqual(['Parabolic', 'Linear']);
    });

    it('builds ordered row-count handle candidates from the solver end row', () => {
        const [solver] = buildActiveTierSolvers([
            createTier({ numRows: 4 })
        ], { x: 0, z: 0 });

        const candidates = buildTierRowCountHandleCandidates(solver, {
            min: 3,
            max: 6,
            step: 1
        });

        expect(candidates.map((candidate) => candidate.numRows)).toEqual([3, 4, 5, 6]);
        expect(candidates.every((candidate) => candidate.tierIndex === 0)).toBe(true);

        const expectedThreeRowSolver = buildActiveTierSolvers([
            createTier({ numRows: 3 })
        ], { x: 0, z: 0 })[0];
        const expectedSixRowSolver = buildActiveTierSolvers([
            createTier({ numRows: 6 })
        ], { x: 0, z: 0 })[0];

        expect(candidates[0]).toMatchObject({
            numRows: 3,
            x: expectedThreeRowSolver.rows.at(-1).x,
            z: expectedThreeRowSolver.rows.at(-1).z
        });
        expect(candidates.at(-1)).toMatchObject({
            numRows: 6,
            x: expectedSixRowSolver.rows.at(-1).x,
            z: expectedSixRowSolver.rows.at(-1).z
        });
    });

    it('derives next-tier defaults from the solved rows of the previous tier', () => {
        const solvers = buildActiveTierSolvers([
            createTier({ numRows: 3 })
        ], { x: 0, z: 0 });

        const lastRow = solvers[0].rows.at(-1);
        expect(buildNextTierDefaultsFromSolvers(solvers, 2)).toEqual({
            firstRowDist: Math.round(lastRow.x),
            firstRowElev: Math.round(lastRow.z + 15),
            riserHeight: 12
        });
        expect(buildNextTierDefaultsFromSolvers(solvers, 3)).toBeNull();
    });

    it('uses integer tier indexes and falls back when a solver does not expose one', () => {
        expect(getSolverTierIndex({ tierIndex: 2 }, 0)).toBe(2);
        expect(getSolverTierIndex({ tierIndex: '3' }, 0)).toBe(3);
        expect(getSolverTierIndex({ tierIndex: 1.5 }, 7)).toBe(7);
        expect(getSolverTierIndex(null, 4)).toBe(4);
    });

    it('builds tier metrics keyed by stable tier indexes via a narrow row-length callback', () => {
        const solvers = buildActiveTierSolvers([
            createTier({ numRows: 3 }),
            createTier({ enabled: false }),
            createTier({
                firstRowDist: 120,
                firstRowElev: 28,
                riserHeight: 12,
                numRows: 2
            })
        ], { x: 0, z: 0 });
        const calculateRowLength = vi.fn((bowlConfig, offset) => {
            expect(bowlConfig).toMatchObject({ type: 'Full' });
            return 140 + Math.max(0, offset);
        });

        const tierMetricsByIndex = buildTierMetricsByIndex({
            solvers,
            bowlConfig: { type: 'Full' },
            egressParams: {
                seatWidthIn: 20,
                maxAisleWidthIn: 72,
                minAisleWidthIn: 48,
                egressFactor: 0.2,
                seatsBetweenAisles: 20
            },
            offsetCorrection: 0,
            calculateRowLength
        });

        expect(Array.from(tierMetricsByIndex.keys())).toEqual([0, 2]);
        expect(tierMetricsByIndex.get(0)).toMatchObject({
            numAisles: expect.any(Number),
            capacity: expect.any(Number),
            mirroredSideRuns: 1
        });
        expect(tierMetricsByIndex.get(2)).toMatchObject({
            numAisles: expect.any(Number),
            capacity: expect.any(Number),
            mirroredSideRuns: 1
        });
        expect(calculateRowLength).toHaveBeenCalled();
    });

    it('maps authoritative layout summaries into legacy tier metrics without recomputing egress math', () => {
        const solver = {
            tierIndex: 0,
            rows: [
                { row_number: 1, x: 10, tread_depth: 2 },
                { row_number: 2, x: 12, tread_depth: 2 }
            ]
        };

        const tierMetricsByIndex = buildTierMetricsByIndexFromLayouts({
            solvers: [solver],
            egressParams: {
                seatWidthIn: 20,
                minAisleWidthIn: 48,
                maxAisleWidthIn: 72,
                seatsBetweenAisles: 20
            },
            configurationSummary: {
                accessibility: {
                    tiers: [{
                        tierIndex: 0,
                        wheelchairSpacesRequired: 2,
                        companionSeatsRequired: 2,
                        wheelchairSpacesAreaSqFt: 24,
                        companionSpacesAreaSqFt: 18,
                        totalAccessibilityAreaSqFt: 42,
                        wheelchairLocationsRequired: 1,
                        accessibilityOccupancyContribution: 4,
                        reportedOccupancy: 26
                    }]
                }
            },
            tierLayouts: [{
                tierIndex: 0,
                sectionSummary: {
                    seatWidthIn: 20,
                    actualAisles: 2,
                    actualSections: 1,
                    tierSeatCount: 22,
                    legalMaxOccupantsPerAisle: 360,
                    failureReason: 'egress_cap_stagnated',
                    topologyValid: true,
                    measurementValid: true,
                    layoutSolveConverged: false,
                    renderedWidthSolveConverged: true,
                    invalidTopologyPaths: [0],
                    invalidTopologyRowIndices: [1],
                    backRowSectionSeatCounts: [12],
                    avgBackRowSeatsPerSection: 12,
                    maxBackRowSeatsPerSection: 12,
                    aisleOccupancyTotals: [11, 11],
                    largestSectionOccupancy: 22,
                    maxRequiredAisleWidthIn: 12,
                    maxGoverningAisleWidthIn: 48,
                    maxRenderedAisleWidthIn: 48,
                    converged: true,
                    compliance: {
                        seatCapCompliant: true,
                        egressCapCompliant: true,
                        renderedWidthCompliant: true
                    },
                    rowSummaries: [
                        {
                            rowIndex: 0,
                            rowNumber: 1,
                            seatCount: 10,
                            sectionCount: 1,
                            maxContinuousSectionSeats: 10,
                            pathSeatCounts: [{ pathIndex: 0, seatCount: 10 }],
                            linearLengthFt: 40,
                            linearLengthPerRunFt: 40,
                            seatCountPerRun: 10,
                            sectionCountPerRun: 1
                        },
                        {
                            rowIndex: 1,
                            rowNumber: 2,
                            seatCount: 12,
                            sectionCount: 1,
                            maxContinuousSectionSeats: 12,
                            pathSeatCounts: [{ pathIndex: 0, seatCount: 12 }],
                            linearLengthFt: 42,
                            linearLengthPerRunFt: 42,
                            seatCountPerRun: 12,
                            sectionCountPerRun: 1
                        }
                    ],
                    sections: [{
                        sectionNumber: 100,
                        occupancy: 22,
                        frontRowSeats: 10,
                        backRowSeats: 12,
                        minSeatsPerRow: 10,
                        maxSeatsPerRow: 12,
                        avgSeatsPerRow: 11,
                        rowSeatCounts: [10, 12],
                        rowSeatingLengthsFt: [16.7, 20]
                    }],
                    aisles: [
                        { legalMaxOccupantsPerAisle: 360 },
                        { legalMaxOccupantsPerAisle: 360 }
                    ]
                }
            }]
        });

        expect(tierMetricsByIndex.get(0)).toMatchObject({
            capacity: 22,
            reportedOccupancy: 26,
            accessibilityOccupancyContribution: 4,
            wheelchairSpacesRequired: 2,
            companionSeatsRequired: 2,
            wheelchairSpacesAreaSqFt: 24,
            companionSpacesAreaSqFt: 18,
            totalAccessibilityAreaSqFt: 42,
            wheelchairLocationsRequired: 1,
            numAisles: 2,
            numSections: 1,
            seatsPerBlock: '12.0',
            backRowSeatsPerRow: 12,
            occupantsPerSection: 22,
            occupantsPerAisleLine: 11,
            capacityWidth: '12.0',
            governingWidth: '48.0',
            renderedAisleWidth: '48.0',
            totalRowLength: '82',
            totalSeatingLength: '37',
            totalAisleLength: '45',
            blocksAddedForEgress: 0,
            failureReason: 'egress_cap_stagnated',
            topologyValid: true,
            measurementValid: true,
            layoutSolveConverged: false,
            renderedWidthSolveConverged: true,
            invalidTopologyPaths: [0],
            invalidTopologyRowIndices: [1],
            renderedWidthCompliant: true
        });
        expect(tierMetricsByIndex.get(0)?.sectionDetails).toEqual([
            expect.objectContaining({
                sectionNumber: 100,
                occupancy: 22,
                seatWidthIn: 20,
                longestRowBySeatCount: expect.objectContaining({ rowNumber: 2, seatCount: 12 }),
                shortestRowBySeatCount: expect.objectContaining({ rowNumber: 1, seatCount: 10 }),
                longestRowByLength: expect.objectContaining({ rowNumber: 2, seatingLengthFt: 20 }),
                shortestRowByLength: expect.objectContaining({ rowNumber: 1, seatingLengthFt: 16.7 })
            })
        ]);
        expect(solver.rows[0]).toMatchObject({
            computedLength: 40,
            computedSeats: 10,
            computedBlocks: 1
        });
        expect(solver.rows[1]).toMatchObject({
            computedLength: 42,
            computedSeats: 12,
            computedBlocks: 1
        });
    });

    it('does not treat Sides4 layout summaries as mirrored runs in legacy metrics', () => {
        const solver = {
            tierIndex: 0,
            rows: [
                { row_number: 1, x: 10, tread_depth: 2 },
                { row_number: 2, x: 12, tread_depth: 2 }
            ]
        };

        const tierMetricsByIndex = buildTierMetricsByIndexFromLayouts({
            solvers: [solver],
            egressParams: {
                seatWidthIn: 19,
                minAisleWidthIn: 48,
                maxAisleWidthIn: 72,
                seatsBetweenAisles: 30
            },
            tierLayouts: [{
                tierIndex: 0,
                sectionSummary: {
                    bowlType: 'Sides4',
                    actualAisles: 20,
                    actualSections: 16,
                    tierSeatCount: 2880,
                    legalMaxOccupantsPerAisle: 360,
                    backRowSectionSeatCounts: [180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180, 180],
                    avgBackRowSeatsPerSection: 180,
                    maxBackRowSeatsPerSection: 180,
                    aisleOccupancyTotals: new Array(20).fill(144),
                    largestSectionOccupancy: 360,
                    maxRequiredAisleWidthIn: 28.8,
                    maxGoverningAisleWidthIn: 48,
                    maxRenderedAisleWidthIn: 48,
                    converged: true,
                    compliance: {
                        seatCapCompliant: true,
                        egressCapCompliant: true,
                        renderedWidthCompliant: true
                    },
                    rowSummaries: [
                        {
                            rowIndex: 0,
                            rowNumber: 1,
                            seatCount: 1440,
                            sectionCount: 8,
                            maxContinuousSectionSeats: 180,
                            pathSeatCounts: [
                                { pathIndex: 0, seatCount: 360 },
                                { pathIndex: 1, seatCount: 360 },
                                { pathIndex: 2, seatCount: 360 },
                                { pathIndex: 3, seatCount: 360 }
                            ],
                            linearLengthFt: 80,
                            linearLengthPerRunFt: 80,
                            seatCountPerRun: 1440,
                            sectionCountPerRun: 8
                        },
                        {
                            rowIndex: 1,
                            rowNumber: 2,
                            seatCount: 1440,
                            sectionCount: 8,
                            maxContinuousSectionSeats: 180,
                            pathSeatCounts: [
                                { pathIndex: 0, seatCount: 360 },
                                { pathIndex: 1, seatCount: 360 },
                                { pathIndex: 2, seatCount: 360 },
                                { pathIndex: 3, seatCount: 360 }
                            ],
                            linearLengthFt: 82,
                            linearLengthPerRunFt: 82,
                            seatCountPerRun: 1440,
                            sectionCountPerRun: 8
                        }
                    ],
                    aisles: new Array(20).fill({ legalMaxOccupantsPerAisle: 360 })
                }
            }]
        });

        expect(tierMetricsByIndex.get(0)).toMatchObject({
            mirroredSideRuns: 1,
            numAisles: 20,
            numSections: 16,
            backRowSeatsPerRow: 2880,
            seatsPerRow: 1440
        });
        expect(solver.rows[0]).toMatchObject({
            computedSeats: 1440,
            computedSeatsPerSide: 1440,
            computedBlocks: 8
        });
    });

    it('preserves tier metrics seat and egress outputs for a representative tier', () => {
        const solver = new ProfileSolver({
            targetCValue: 4,
            firstRowDistance: 45,
            firstRowElevation: 6,
            treadDepth: 33,
            defaultRiser: 10,
            numRows: 4,
            eyeHeight: 3.75,
            eyeSetback: 6,
            focalX: 0,
            focalZ: 0
        });
        solver.solve('Parabolic');

        const metrics = ProfileSolver.calculateTierMetrics(
            solver,
            { type: 'Full' },
            { calculateRowLength: () => 140 },
            {
                seatWidthIn: 20,
                maxAisleWidthIn: 72,
                minAisleWidthIn: 48,
                egressFactor: 0.2,
                seatsBetweenAisles: 20
            },
            0
        );

        expect(metrics).toMatchObject({
            numAisles: 5,
            aisleWidth: '48.0',
            renderedAisleWidth: '48.0',
            seatsPerRow: 72,
            backRowSeatsPerRow: 72,
            numSections: 4,
            seatsPerBlock: '18.0',
            maxSeatsPerSectionRow: 18,
            occupantsPerSection: 72,
            occupantsPerAisleLine: 72,
            capacityWidth: '14.4',
            minimumWidth: '48.0',
            maximumWidth: '72.0',
            legalMaxOccupantsPerAisle: 360,
            governingWidth: '48.0',
            blocksAddedForEgress: 0,
            converged: true,
            mirroredSideRuns: 1
        });
        expect(metrics.capacity).toBe(288);
    });

    it('clamps tier 1 stepped structural underside to non-negative elevations', () => {
        const [solver] = buildActiveTierSolvers([
            createTier({ firstRowElev: 3, numRows: 3 })
        ], { x: 0, z: 0 });

        const geometry = buildStructuralProfileGeometry(solver, {
            structuralDepthFt: 6,
            structuralProfileMode: 'stepped',
            tierIndex: 0
        });

        expect(geometry.undersideProfile.length).toBeGreaterThan(1);
        expect(geometry.undersideProfile.every((point) => point.z >= 0)).toBe(true);
        expect(geometry.undersideProfile.every((point) => point.x <= solver.rows.at(-1).x)).toBe(true);
    });

    it('builds a tier 1 sloped structural underside that ends at the last row rear edge', () => {
        const [solver] = buildActiveTierSolvers([
            createTier({ firstRowElev: 3, numRows: 4 })
        ], { x: 0, z: 0 });

        const geometry = buildStructuralProfileGeometry(solver, {
            structuralDepthFt: 6,
            structuralProfileMode: 'sloped',
            tierIndex: 0
        });

        expect(geometry.undersideProfile).toHaveLength(2);
        expect(geometry.undersideProfile[1].x).toBe(solver.rows.at(-1).x);
        expect(geometry.undersideProfile.every((point) => point.x <= solver.rows.at(-1).x)).toBe(true);
        expect(geometry.undersideProfile.every((point) => point.z >= 0)).toBe(true);
    });

    it('uses the structural depth for upper-tier front closure in both modes', () => {
        const [solver] = buildActiveTierSolvers([
            createTier({ enabled: false }),
            createTier({ firstRowDist: 90, firstRowElev: 24, numRows: 3 })
        ], { x: 0, z: 0 });
        const startX = solver.rows[0].x - solver.treadDepthFt;
        const expectedFrontBottomZ = solver.rows[0].z - 1.5;

        for (const structuralProfileMode of ['stepped', 'sloped']) {
            const geometry = buildStructuralProfileGeometry(solver, {
                structuralDepthFt: 1.5,
                structuralProfileMode,
                tierIndex: 1
            });

            expect(geometry.topProfile[0]).toEqual({
                x: startX,
                z: expectedFrontBottomZ
            });
            expect(geometry.undersideProfile[0].z).toBe(expectedFrontBottomZ);
            expect(
                geometry.closedProfile.some((point) => point.x === startX && point.z === expectedFrontBottomZ)
            ).toBe(true);
        }
    });

    it('starts the sloped underside at the back of the first row for tiers 2 and 3', () => {
        const solvers = buildActiveTierSolvers([
            createTier({ enabled: false }),
            createTier({ firstRowDist: 90, firstRowElev: 24, numRows: 3 }),
            createTier({ firstRowDist: 135, firstRowElev: 42, numRows: 3 })
        ], { x: 0, z: 0 });

        for (const solver of solvers) {
            const tierIndex = solver.tierIndex;
            const firstRow = solver.rows[0];
            const lastRow = solver.rows.at(-1);
            const structuralDepthFt = 1.5;
            const geometry = buildStructuralProfileGeometry(solver, {
                structuralDepthFt,
                structuralProfileMode: 'sloped',
                tierIndex
            });

            expect(tierIndex === 1 || tierIndex === 2).toBe(true);
            expect(geometry.undersideProfile[0]).toEqual({
                x: firstRow.x,
                z: firstRow.z - structuralDepthFt
            });
            expect(geometry.undersideProfile[1]).toEqual({
                x: lastRow.x,
                z: lastRow.z - structuralDepthFt
            });
        }
    });

    it('keeps non-tier-2-and-3 sloped underside behavior unchanged', () => {
        const [solver] = buildActiveTierSolvers([
            createTier({ firstRowElev: 6, numRows: 4 })
        ], { x: 0, z: 0 });
        const structuralDepthFt = 1.5;
        const geometry = buildStructuralProfileGeometry(solver, {
            structuralDepthFt,
            structuralProfileMode: 'sloped',
            tierIndex: 0
        });

        expect(geometry.undersideProfile[0]).toEqual({
            x: (solver.rows[0].x - solver.treadDepthFt) + structuralDepthFt,
            z: 0
        });
    });

    it('dedupes large-depth structural geometry without extending below zero', () => {
        const [solver] = buildActiveTierSolvers([
            createTier({ firstRowElev: 2, numRows: 3 })
        ], { x: 0, z: 0 });

        const geometry = buildStructuralProfileGeometry(solver, {
            structuralDepthFt: 50,
            structuralProfileMode: 'stepped',
            tierIndex: 0
        });

        expect(geometry.undersideProfile.every((point) => point.z >= 0)).toBe(true);
        expect(geometry.closedProfile.every((point) => point.z >= 0)).toBe(true);
        expect(
            geometry.closedProfile.every((point, index, points) => {
                if (index === 0) return true;
                return point.x !== points[index - 1].x || point.z !== points[index - 1].z;
            })
        ).toBe(true);
    });
});
