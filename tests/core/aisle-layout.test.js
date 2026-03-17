import { describe, expect, it } from 'vitest';

import {
    buildGeometryPaths,
    buildTierAisleLayout,
    resolveAisleStationRatios,
    sampleAisleBand,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';

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

    it('preserves world-axis alignment for distributed straight-edge aisles on offset chamfer bowls', () => {
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
            segmentT: 0.5
        });

        expect(resolved).not.toBeNull();

        const frontPoint = samplePathPointByRatio(pathFront, resolved.uFront);
        const backPoint = samplePathPointByRatio(pathBack, resolved.uBack);

        expect(frontPoint.x).toBeCloseTo(0);
        expect(backPoint.x).toBeCloseTo(0);
        expect(frontPoint.y).toBeCloseTo(8);
        expect(backPoint.y).toBeCloseTo(12);
        expect(frontPoint.tx).toBeCloseTo(1);
        expect(backPoint.tx).toBeCloseTo(1);
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
    });
});
