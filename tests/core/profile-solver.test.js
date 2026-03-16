import { describe, expect, it, vi } from 'vitest';

import {
    buildActiveTierSolvers,
    buildNextTierDefaultsFromSolvers,
    buildTierRowCountHandleCandidates,
    buildStructuralProfileGeometry,
    buildTierMetricsByIndex,
    getSolverTierIndex
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
