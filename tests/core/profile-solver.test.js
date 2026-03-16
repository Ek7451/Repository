import { describe, expect, it, vi } from 'vitest';

import {
    buildActiveTierSolvers,
    buildNextTierDefaultsFromSolvers,
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
});
