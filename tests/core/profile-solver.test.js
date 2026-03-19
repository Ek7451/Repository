import { describe, expect, it, vi } from 'vitest';

import {
    buildActiveTierSolvers,
    buildNextTierDefaultsFromSolvers,
    buildTierRowCountHandleCandidates,
    buildStructuralProfileGeometry,
    buildTierMetricsByIndex,
    reconcileTierMetricsByIndexWithLayoutSummaries,
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

    it('reconciles tier metrics from closed layout summaries by stable tier index', () => {
        const tierMetricsByIndex = new Map([
            [0, {
                capacity: 120,
                numAisles: 5,
                numSections: 4,
                seatsPerBlock: '18.0',
                occupantsPerSection: 30,
                occupantsPerAisleLine: 30,
                capacityWidth: '6.0'
            }],
            [2, {
                capacity: 80,
                numAisles: 4,
                numSections: 4,
                seatsPerBlock: '10.0',
                occupantsPerSection: 20,
                occupantsPerAisleLine: 20,
                capacityWidth: '4.0'
            }]
        ]);

        const reconciled = reconcileTierMetricsByIndexWithLayoutSummaries({
            tierMetricsByIndex,
            tierAisleLayouts: [{
                tierIndex: 2,
                sectionSummary: {
                    actualSections: 2,
                    actualAisles: 2,
                    allSectionPathsClosed: true,
                    avgBackRowSeatsPerSection: 14,
                    sectionOccupancyTotals: [32, 48],
                    aisleOccupancyTotals: [40, 40]
                }
            }],
            egressParams: { egressFactor: 0.2 }
        });

        expect(reconciled).not.toBe(tierMetricsByIndex);
        expect(reconciled.get(0)).toBe(tierMetricsByIndex.get(0));
        expect(reconciled.get(2)).toMatchObject({
            numAisles: 2,
            numSections: 2,
            seatsPerBlock: '14.0',
            occupantsPerSection: 48,
            occupantsPerAisleLine: 40,
            capacityWidth: '8.0'
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
            seatsPerRow: 72,
            backRowSeatsPerRow: 72,
            numSections: 4,
            seatsPerBlock: '18.0',
            occupantsPerSection: 72,
            occupantsPerAisleLine: 72,
            capacityWidth: '14.4',
            minimumWidth: '48.0',
            maximumWidth: '72.0',
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
