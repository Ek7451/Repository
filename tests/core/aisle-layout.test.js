import { describe, expect, it } from 'vitest';

import {
    buildGeometryPaths,
    buildTierAisleLayout,
    resolveAisleStationRatios,
    sampleAisleBand,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';
import { FieldRenderer } from '../../viz/field-renderer.js';

function buildChamferRectangleSegments({
    width = 20,
    height = 16,
    chamfer = 2,
    offsetX = 0,
    offsetY = 0
} = {}) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    return [
        { cmd: 'moveTo', x: offsetX - halfWidth + chamfer, y: offsetY + halfHeight },
        { cmd: 'lineTo', x: offsetX + halfWidth - chamfer, y: offsetY + halfHeight },
        { cmd: 'lineTo', x: offsetX + halfWidth, y: offsetY + halfHeight - chamfer },
        { cmd: 'lineTo', x: offsetX + halfWidth, y: offsetY - halfHeight + chamfer },
        { cmd: 'lineTo', x: offsetX + halfWidth - chamfer, y: offsetY - halfHeight },
        { cmd: 'lineTo', x: offsetX - halfWidth + chamfer, y: offsetY - halfHeight },
        { cmd: 'lineTo', x: offsetX - halfWidth, y: offsetY - halfHeight + chamfer },
        { cmd: 'lineTo', x: offsetX - halfWidth, y: offsetY + halfHeight - chamfer },
        { cmd: 'closePath' }
    ];
}

function buildIndependentSideRunSegments({
    width = 20,
    topY = 8,
    bottomY = -8
} = {}) {
    const halfWidth = width / 2;

    return [
        { cmd: 'moveTo', x: -halfWidth, y: topY },
        { cmd: 'lineTo', x: halfWidth, y: topY },
        { cmd: 'moveTo', x: -halfWidth, y: bottomY },
        { cmd: 'lineTo', x: halfWidth, y: bottomY }
    ];
}

/**
 * @param {string} type
 * @param {{ frontOffset?: number, backOffset?: number, corner?: string, [key: string]: any }} [options]
 */
function buildRendererBowlFixture(type, {
    frontOffset = 0,
    backOffset = 12,
    corner = 'Chamfer',
    ...overrides
} = {}) {
    const renderer = Object.create(FieldRenderer.prototype);
    const bowlConfig = {
        width: 120,
        length: 180,
        radius: 20,
        corner,
        type,
        ...overrides
    };

    const frontSegments = renderer._getBowlGeometry(bowlConfig, frontOffset);
    const backSegments = renderer._getBowlGeometry(bowlConfig, backOffset);

    return {
        bowlConfig,
        frontSegments,
        backSegments,
        frontPaths: buildGeometryPaths(frontSegments),
        backPaths: buildGeometryPaths(backSegments)
    };
}

function expectPointClose(actual, expected) {
    expect(actual.x).toBeCloseTo(expected.x);
    expect(actual.y).toBeCloseTo(expected.y);
}

describe('aisle layout geometry seam', () => {
    it('builds closed chamfer rectangle paths with stable seam lengths and wraparound sampling', () => {
        const [path] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 20,
            height: 16,
            chamfer: 2
        }));

        expect(path.closed).toBe(true);
        expect(path.parts).toHaveLength(8);
        expect(path.length).toBeCloseTo(67.31370849898477);

        const start = samplePathPointByRatio(path, 0);
        const wrapped = samplePathPointByRatio(path, 1);
        const quarter = samplePathPointByRatio(path, 0.25);

        expectPointClose(start, { x: -8, y: 8 });
        expectPointClose(wrapped, { x: -8, y: 8 });
        expectPointClose(quarter, { x: 8.5857864376269, y: 7.414213562373099 });
        expect(quarter.tx).toBeCloseTo(Math.SQRT1_2);
        expect(quarter.ty).toBeCloseTo(-Math.SQRT1_2);
    });

    it('clamps open line-and-arc sampling and keeps aisle-band sampling stable across the transition', () => {
        const [path] = buildGeometryPaths([
            { cmd: 'moveTo', x: 0, y: 0 },
            { cmd: 'lineTo', x: 10, y: 0 },
            { cmd: 'arc', x: 10, y: 5, r: 5, sa: -Math.PI / 2, ea: 0, ccw: true }
        ]);

        expect(path.closed).toBe(false);
        expect(path.parts).toHaveLength(2);
        expect(path.length).toBeCloseTo(17.853981633974485);

        const clampedStart = samplePathPointByRatio(path, -1);
        const clampedEnd = samplePathPointByRatio(path, 2);
        const band = sampleAisleBand(path, 0.5, 4);

        expectPointClose(clampedStart, { x: 0, y: 0 });
        expect(clampedStart.tx).toBeCloseTo(1);
        expect(clampedStart.ty).toBeCloseTo(0);

        expectPointClose(clampedEnd, { x: 15, y: 5 });
        expect(clampedEnd.tx).toBeCloseTo(0);
        expect(clampedEnd.ty).toBeCloseTo(1);

        expect(band).not.toBeNull();
        expectPointClose(band.center, { x: 8.926990816987242, y: 0 });
        expectPointClose(band.left, { x: 6.926990816987242, y: 0 });
        expectPointClose(band.right, { x: 10.921689440869143, y: 0.08568534029511632 });
        expect(band.right.ty).toBeGreaterThan(0);
    });

    it('matches the actual renderer bowl families for path count, closure, and part count', () => {
        const cases = [
            { type: 'Full', pathCount: 1, closed: [true], parts: [8] },
            { type: 'U-End1', pathCount: 1, closed: [false], parts: [5] },
            { type: 'U-End2', pathCount: 1, closed: [false], parts: [5] },
            { type: 'Sides', pathCount: 2, closed: [false, false], parts: [1, 1] },
            { type: 'Side1', pathCount: 1, closed: [false], parts: [1] }
        ];

        cases.forEach((spec) => {
            const fixture = buildRendererBowlFixture(spec.type);
            expect(fixture.frontPaths).toHaveLength(spec.pathCount);
            expect(fixture.frontPaths.map((path) => path.closed)).toEqual(spec.closed);
            expect(fixture.frontPaths.map((path) => path.parts.length)).toEqual(spec.parts);
        });
    });

    it('counts mandatory transition anchors across the actual bowl families', () => {
        const cases = [
            { type: 'Full', forcedCount: 8 },
            { type: 'U-End1', forcedCount: 4 },
            { type: 'U-End2', forcedCount: 4 },
            { type: 'Sides', forcedCount: 0 },
            { type: 'Side1', forcedCount: 0 }
        ];

        cases.forEach((spec) => {
            const fixture = buildRendererBowlFixture(spec.type);
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: 0,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig
            });

            expect(layout.forcedCount).toBe(spec.forcedCount);
            expect(layout.aisles.filter((aisle) => aisle.forced)).toHaveLength(spec.forcedCount);
        });
    });

    it('keeps the last open-path chamfer transition on U-end bowls', () => {
        ['U-End1', 'U-End2'].forEach((type) => {
            const fixture = buildRendererBowlFixture(type);
            const [path] = fixture.frontPaths;
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: 0,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig
            });

            expect(layout.aisles.map((aisle) => aisle.cornerOrdinal)).toEqual([0, 1, 2, 3]);

            const lastForced = layout.aisles[layout.aisles.length - 1];
            const lastForcedPoint = samplePathPointByRatio(path, lastForced.u);
            const terminalTransition = path.parts[path.parts.length - 1];

            expectPointClose(lastForcedPoint, {
                x: terminalTransition.x1,
                y: terminalTransition.y1
            });
        });
    });

    it('pins forced chamfer aisles by ordinal across front and back offsets', () => {
        const [pathFront] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 20,
            height: 16,
            chamfer: 2
        }));
        const [pathBack] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 24,
            height: 20,
            chamfer: 2
        }));

        const resolved = resolveAisleStationRatios(pathFront, pathBack, {
            cornerOrdinal: 2,
            u: 0.91,
            uFront: 0.66,
            uBack: 0.11
        });

        expect(resolved).not.toBeNull();
        expectPointClose(samplePathPointByRatio(pathFront, resolved.uFront), { x: 10, y: 6 });
        expectPointClose(samplePathPointByRatio(pathBack, resolved.uBack), { x: 12, y: 8 });
    });

    it('defaults widening straight-interval resolution to radial interpolation', () => {
        const [pathFront] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 20,
            height: 16,
            chamfer: 2
        }));
        const [pathBack] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 28,
            height: 24,
            chamfer: 4
        }));

        const resolved = resolveAisleStationRatios(pathFront, pathBack, {
            segmentIndex: 0,
            segmentT: 0.25
        });

        expect(resolved).not.toBeNull();

        const frontPoint = samplePathPointByRatio(pathFront, resolved.uFront);
        const backPoint = samplePathPointByRatio(pathBack, resolved.uBack);

        expect(frontPoint.y).toBeCloseTo(8);
        expect(backPoint.y).toBeCloseTo(12);
        expect(frontPoint.x).toBeCloseTo(-4);
        expect(backPoint.x).toBeCloseTo(-5);
        expect(Math.abs(frontPoint.x - backPoint.x)).toBeGreaterThan(0.5);
    });

    it('supports perpendicular straight-interval resolution as a distinct mode', () => {
        const [pathFront] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 20,
            height: 16,
            chamfer: 2
        }));
        const [pathBack] = buildGeometryPaths(buildChamferRectangleSegments({
            width: 28,
            height: 24,
            chamfer: 4
        }));

        const radial = resolveAisleStationRatios(pathFront, pathBack, {
            segmentIndex: 0,
            segmentT: 0.25
        });
        const perpendicular = resolveAisleStationRatios(pathFront, pathBack, {
            segmentIndex: 0,
            segmentT: 0.25,
            alignmentMode: 'perpendicular'
        });

        expect(radial).not.toBeNull();
        expect(perpendicular).not.toBeNull();

        const radialFront = samplePathPointByRatio(pathFront, radial.uFront);
        const radialBack = samplePathPointByRatio(pathBack, radial.uBack);
        const perpendicularFront = samplePathPointByRatio(pathFront, perpendicular.uFront);
        const perpendicularBack = samplePathPointByRatio(pathBack, perpendicular.uBack);

        expect(perpendicularFront.y).toBeCloseTo(8);
        expect(perpendicularBack.y).toBeCloseTo(12);
        expect(perpendicularFront.x).toBeCloseTo(perpendicularBack.x);
        expect(perpendicularFront.tx).toBeCloseTo(1);
        expect(perpendicularBack.tx).toBeCloseTo(1);
        expect(Math.abs(radialFront.x - radialBack.x)).toBeGreaterThan(0.5);
        expect(
            Math.abs(perpendicularFront.x - radialFront.x) > 0.5 ||
            Math.abs(perpendicularBack.x - radialBack.x) > 0.5
        ).toBe(true);
    });

    it('keeps full chamfer tier layouts on the stable forced-corner contract', () => {
        const frontSegments = buildChamferRectangleSegments({
            width: 20,
            height: 16,
            chamfer: 2
        });
        const backSegments = buildChamferRectangleSegments({
            width: 24,
            height: 20,
            chamfer: 2
        });

        const layout = buildTierAisleLayout({
            frontSegments,
            backSegments,
            targetAisles: 4,
            aisleWidthFt: 4,
            bowlConfig: { type: 'Full', corner: 'Chamfer' }
        });

        expect(layout.aisles).toHaveLength(8);
        expect(layout.forcedCount).toBe(8);
        expect(layout.targetAisles).toBe(8);
        expect(layout.aisles.every((aisle) => aisle.forced)).toBe(true);
        expect(layout.aisles.map((aisle) => aisle.cornerOrdinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(layout.sectionBoundaries).toHaveLength(1);
        expect(layout.sectionBoundaries[0].map((boundary) => boundary.u)).toEqual(
            layout.aisles.map((aisle) => aisle.u)
        );
    });

    it('places the odd full-bowl discretionary remainder on the top longest straight and off the centerline', () => {
        const fixture = buildRendererBowlFixture('Full');
        const [path] = fixture.frontPaths;
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 9,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig
        });

        const distributed = layout.aisles.filter((aisle) => !aisle.forced);
        expect(distributed).toHaveLength(1);
        expect(distributed[0].segmentIndex).toBe(7);

        const point = samplePathPointByRatio(path, distributed[0].u);
        expect(point.y).toBeGreaterThan(0);
        expect(Math.abs(point.x)).toBeGreaterThan(1);
    });

    it('fills opposite longest straight pairs before chamfer interiors on full bowls', () => {
        const fixture = buildRendererBowlFixture('Full');
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 10,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig
        });

        const distributedSegments = layout.aisles
            .filter((aisle) => !aisle.forced)
            .map((aisle) => aisle.segmentIndex)
            .sort((a, b) => a - b);

        expect(distributedSegments).toEqual([3, 7]);
    });

    it('adds seat-cap aisles beyond the requested target when hard limits require them', () => {
        const fixture = buildRendererBowlFixture('Full', {
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig,
            maxSeatsBetweenAisles: 24,
            seatWidthIn: 20
        });

        expect(layout.forcedCount).toBe(8);
        expect(layout.targetAisles).toBe(18);
        expect(layout.aisles).toHaveLength(18);
        expect(
            layout.aisles
                .filter((aisle) => !aisle.forced)
                .map((aisle) => aisle.segmentIndex)
        ).toEqual([1, 1, 3, 3, 3, 5, 5, 7, 7, 7]);
    });

    it('stamps straight and chamfer distributed aisles with their configured alignment modes', () => {
        const fixture = buildRendererBowlFixture('Full', {
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig,
            maxSeatsBetweenAisles: 16,
            seatWidthIn: 20
        });

        const straightDistributed = layout.aisles.filter((aisle) => !aisle.forced && [1, 3, 5, 7].includes(aisle.segmentIndex));
        const chamferDistributed = layout.aisles.filter((aisle) => !aisle.forced && [0, 2, 4, 6].includes(aisle.segmentIndex));

        expect(straightDistributed.length).toBeGreaterThan(0);
        expect(chamferDistributed.length).toBeGreaterThan(0);
        expect(straightDistributed.every((aisle) => aisle.alignmentMode === 'perpendicular')).toBe(true);
        expect(chamferDistributed.every((aisle) => aisle.alignmentMode === 'radial')).toBe(true);
    });

    it('keeps U-end discretionary extras on the straight interval before chamfer interiors', () => {
        ['U-End1', 'U-End2'].forEach((type) => {
            const fixture = buildRendererBowlFixture(type, {
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            });
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: 6,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig
            });

            const distributed = layout.aisles.filter((aisle) => !aisle.forced);
            expect(distributed).toHaveLength(2);
            expect(distributed.every((aisle) => aisle.segmentIndex === 1)).toBe(true);
            expect(distributed.every((aisle) => aisle.alignmentMode === 'perpendicular')).toBe(true);
        });
    });

    it('keeps independent side runs on the linear even-spacing contract', () => {
        const layout = buildTierAisleLayout({
            frontSegments: buildIndependentSideRunSegments({
                width: 20,
                topY: 8,
                bottomY: -8
            }),
            targetAisles: 3,
            aisleWidthFt: 4,
            bowlConfig: { type: 'Sides', corner: 'None' }
        });

        expect(layout.aisles).toHaveLength(6);
        expect(layout.forcedCount).toBe(0);
        expect(layout.targetAisles).toBe(6);
        expect(layout.sectionBoundaries).toHaveLength(2);

        const topRun = layout.aisles.filter((aisle) => aisle.pathIndex === 0);
        const bottomRun = layout.aisles.filter((aisle) => aisle.pathIndex === 1);

        expect(topRun.map((aisle) => aisle.u)).toEqual([0.1, 0.5, 0.9]);
        expect(bottomRun.map((aisle) => aisle.u)).toEqual([0.1, 0.5, 0.9]);
        expect(layout.aisles.every((aisle) => aisle.anchorType === 'distributed_linear_even')).toBe(true);
        expect(layout.aisles.every((aisle) => aisle.alignmentMode === 'radial')).toBe(true);
    });
});
