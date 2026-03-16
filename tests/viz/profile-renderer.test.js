import { describe, expect, it, vi } from 'vitest';

import { buildActiveTierSolvers } from '../../core/profile-solver.js';
import { buildStructuralProfileGeometry } from '../../core/profile-solver.js';
import { ProfileRenderer } from '../../viz/profile-renderer.js';

function createCanvasStub(context = {}) {
    return /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ({
        style: {},
        width: 800,
        height: 600,
        getContext: vi.fn(() => context),
        addEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({
            left: 0,
            top: 0
        })),
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn()
    }));
}

function createRecordingContext() {
    let pathIndex = -1;
    const operations = [];

    return {
        operations,
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(() => {
            pathIndex += 1;
            operations.push({ type: 'beginPath', pathIndex });
        }),
        moveTo: vi.fn((x, y) => operations.push({ type: 'moveTo', pathIndex, x, y })),
        lineTo: vi.fn((x, y) => operations.push({ type: 'lineTo', pathIndex, x, y })),
        closePath: vi.fn(() => operations.push({ type: 'closePath', pathIndex })),
        fill: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn()
    };
}

function createTier(overrides = {}) {
    return {
        enabled: true,
        profileType: 'Parabolic',
        cValue: 4,
        numRows: 12,
        firstRowDist: 45,
        firstRowElev: 6,
        treadDepth: 33,
        riserHeight: 10,
        eyeHeight: 3.75,
        eyeSetback: 6,
        ...overrides
    };
}

describe('ProfileRenderer drag snapping helpers', () => {
    it('snaps dragged tier positions to previous tier row front and back edges', () => {
        const renderer = new ProfileRenderer(createCanvasStub(), {});
        const solvers = buildActiveTierSolvers([
            createTier(),
            createTier({
                firstRowDist: 96,
                firstRowElev: 24,
                numRows: 10
            })
        ], { x: 0, z: 0 });

        renderer._pxPerFoot = 10;
        renderer._offsetX = 0;
        renderer._offsetY = 0;
        renderer._lastTierRenderState = solvers
            .map((solver, index) => renderer._buildTierRenderState(solver, index))
            .filter(Boolean);

        const previousTier = renderer._lastTierRenderState[0];
        const activeTier = renderer._lastTierRenderState[1];
        const referenceXPoint = previousTier.referencePoints.find((point) => point.edge === 'back');
        const referenceZPoint = previousTier.referencePoints.find((point) => point.edge === 'front');
        const activeXPoint = activeTier.referencePoints.find((point) => point.edge === 'front');
        const activeZPoint = activeTier.referencePoints.find((point) => point.edge === 'back');

        const expectedFirstRowDist = activeTier.firstRowDist + (referenceXPoint.x - activeXPoint.x);
        const expectedFirstRowElev = activeTier.firstRowElev + (referenceZPoint.z - activeZPoint.z);

        const resolved = renderer._resolveDragTargetPosition(
            1,
            expectedFirstRowDist + 0.4,
            expectedFirstRowElev + 0.25
        );

        expect(Math.abs(resolved.firstRowDist - expectedFirstRowDist)).toBeLessThanOrEqual(1.2);
        expect(Math.abs(resolved.firstRowElev - expectedFirstRowElev)).toBeLessThanOrEqual(1.2);
        expect(resolved.guides.x).toBeTruthy();
        expect(Math.abs(resolved.guides.x.activePoint.x - resolved.guides.x.referencePoint.x)).toBeLessThanOrEqual(1.2);
        expect(resolved.guides.z).toBeTruthy();
        expect(Math.abs(resolved.guides.z.activePoint.z - resolved.guides.z.referencePoint.z)).toBeLessThanOrEqual(1.2);
    });

    it('does not draw a sloped underside diagonal when the structural profile is stepped', () => {
        const ctx = createRecordingContext();
        const renderer = new ProfileRenderer(createCanvasStub(ctx), {});
        const [solver] = buildActiveTierSolvers([
            createTier({ firstRowElev: 3, numRows: 4 })
        ], { x: 0, z: 0 });

        renderer._drawProfile(ctx, solver, (x, z) => ({ sx: x, sy: z }), 1, {
            structuralDepth: 1.5,
            structuralProfileMode: 'stepped',
            tierIdx: 0
        });

        const geometry = buildStructuralProfileGeometry(solver, {
            structuralDepthFt: 1.5,
            structuralProfileMode: 'stepped',
            tierIndex: 0
        });
        const frontBottomPoint = {
            x: geometry.topProfile[0].x,
            z: geometry.undersideProfile[0].z
        };
        const rearBottomPoint = geometry.undersideProfile.at(-1);
        const fillPathLineTos = ctx.operations.filter((operation) => (
            operation.pathIndex === 0 && operation.type === 'lineTo'
        ));

        const hasRearToFrontDiagonal = fillPathLineTos.some((operation, index) => {
            if (index === 0) return false;

            const previous = fillPathLineTos[index - 1];
            return previous.x === rearBottomPoint.x &&
                previous.y === rearBottomPoint.z &&
                operation.x === frontBottomPoint.x &&
                operation.y === frontBottomPoint.z;
        });

        expect(hasRearToFrontDiagonal).toBe(false);
    });

    it('draws the upper-tier front riser to the structural depth when depth is enabled', () => {
        const ctx = createRecordingContext();
        const renderer = new ProfileRenderer(createCanvasStub(ctx), {});
        const [solver] = buildActiveTierSolvers([
            createTier({ enabled: false }),
            createTier({
                firstRowDist: 90,
                firstRowElev: 24,
                riserHeight: 10,
                numRows: 4
            })
        ], { x: 0, z: 0 });
        const firstRow = solver.rows[0];
        const riserTopX = firstRow.x - solver.treadDepthFt;
        const expectedBottomZ = firstRow.z - 1.5;

        renderer._drawProfile(ctx, solver, (x, z) => ({ sx: x, sy: z }), 1, {
            structuralDepth: 1.5,
            structuralProfileMode: 'stepped',
            tierIdx: 1
        });

        const riserPath = ctx.operations.filter((operation) => operation.pathIndex === 4);

        expect(riserPath).toEqual([
            { type: 'beginPath', pathIndex: 4 },
            { type: 'moveTo', pathIndex: 4, x: riserTopX, y: expectedBottomZ },
            { type: 'lineTo', pathIndex: 4, x: riserTopX, y: firstRow.z }
        ]);
    });

    it('finds the row-count handle at the last-row back corner when row-count candidates exist', () => {
        const renderer = new ProfileRenderer(createCanvasStub(), {});
        const [solver] = buildActiveTierSolvers([
            createTier({ numRows: 4 })
        ], { x: 0, z: 0 });

        renderer._pxPerFoot = 10;
        renderer._offsetX = 0;
        renderer._offsetY = 0;
        renderer._lastTierRenderState = [
            renderer._buildTierRenderState(solver, 0, { min: 3, max: 6, step: 1 })
        ].filter(Boolean);

        const handlePoint = renderer._lastTierRenderState[0].rowCountHandlePoint;
        const target = renderer._findTierRowCountHandleTarget(
            handlePoint.x * renderer._pxPerFoot,
            -handlePoint.z * renderer._pxPerFoot
        );

        expect(target).toMatchObject({
            tierIndex: 0,
            numRows: 4
        });
        expect(target?.candidates.map((candidate) => candidate.numRows)).toEqual([3, 4, 5, 6]);
    });

    it('resolves row-count drags to the nearest candidate and emits only changed row counts', () => {
        const onTierRowCountChanged = vi.fn();
        const renderer = new ProfileRenderer(createCanvasStub(), {
            onTierRowCountChanged
        });
        const [solver] = buildActiveTierSolvers([
            createTier({ numRows: 4 })
        ], { x: 0, z: 0 });
        const tierState = renderer._buildTierRenderState(solver, 0, { min: 3, max: 6, step: 1 });
        if (!tierState) {
            throw new Error('Expected tier render state');
        }

        renderer._pxPerFoot = 10;
        renderer._offsetX = 0;
        renderer._offsetY = 0;
        renderer._rerender = vi.fn();
        renderer._dragState = {
            mode: 'rowCount',
            pointerId: 1,
            tierIndex: tierState.tierIndex,
            currentNumRows: tierState.rowCountHandlePoint.numRows,
            activeHandlePoint: tierState.rowCountHandlePoint,
            candidates: tierState.rowCountCandidates
        };

        const nearestCandidate = tierState.rowCountCandidates.at(-1);
        if (!nearestCandidate) {
            throw new Error('Expected row-count candidate');
        }

        renderer._updateTierDrag({
            worldPoint: { x: 0, z: 0 },
            mx: nearestCandidate.x * renderer._pxPerFoot,
            my: -nearestCandidate.z * renderer._pxPerFoot
        });

        expect(onTierRowCountChanged).toHaveBeenCalledWith({
            tierIndex: tierState.tierIndex,
            numRows: nearestCandidate.numRows
        });
        expect(renderer._dragState.currentNumRows).toBe(nearestCandidate.numRows);
        expect(renderer._dragState.activeHandlePoint).toEqual({
            x: nearestCandidate.x,
            z: nearestCandidate.z,
            numRows: nearestCandidate.numRows
        });

        onTierRowCountChanged.mockClear();
        renderer._updateTierDrag({
            worldPoint: { x: 0, z: 0 },
            mx: nearestCandidate.x * renderer._pxPerFoot,
            my: -nearestCandidate.z * renderer._pxPerFoot
        });

        expect(onTierRowCountChanged).not.toHaveBeenCalled();
    });
});
