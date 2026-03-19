import { describe, expect, it } from 'vitest';

import {
    buildGeometryPaths,
    buildPerpendicularAisleReferenceMap,
    buildConfigurationAisleSummary,
    buildTierAisleAnalysis,
    buildTierAisleLayout,
    buildTierAisleLayoutSummary,
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

    it('supports perpendicular chamfer-interval resolution as a distinct mode', () => {
        const fixture = buildRendererBowlFixture('Full', {
            frontOffset: 21,
            backOffset: 33,
            straightAisleMode: 'radial',
            chamferAisleMode: 'perpendicular'
        });
        const [pathFront] = fixture.frontPaths;
        const [pathBack] = fixture.backPaths;
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig,
            maxSeatsBetweenAisles: 12,
            seatWidthIn: 20
        });
        const targetAisle = layout.aisles.find((aisle) => (
            !aisle.forced &&
            aisle.segmentIndex === 0 &&
            aisle.segmentT < 0.5
        ));

        expect(targetAisle).toBeTruthy();

        const radial = resolveAisleStationRatios(pathFront, pathBack, {
            ...targetAisle,
            alignmentMode: 'radial'
        });
        const perpendicular = resolveAisleStationRatios(pathFront, pathBack, {
            ...targetAisle
        });

        expect(radial).not.toBeNull();
        expect(perpendicular).not.toBeNull();

        const radialFront = samplePathPointByRatio(pathFront, radial.uFront);
        const radialBack = samplePathPointByRatio(pathBack, radial.uBack);
        const perpendicularFront = samplePathPointByRatio(pathFront, perpendicular.uFront);
        const perpendicularBack = samplePathPointByRatio(pathBack, perpendicular.uBack);
        const radialDot =
            ((radialBack.x - radialFront.x) * radialFront.tx) +
            ((radialBack.y - radialFront.y) * radialFront.ty);
        const perpendicularDot =
            ((perpendicularBack.x - perpendicularFront.x) * perpendicularFront.tx) +
            ((perpendicularBack.y - perpendicularFront.y) * perpendicularFront.ty);

        expect(Math.abs(radialDot)).toBeGreaterThan(0.5);
        expect(Math.abs(perpendicularDot)).toBeLessThan(1e-3);
        expect(
            Math.abs(perpendicularFront.x - radialFront.x) > 0.5 ||
            Math.abs(perpendicularFront.y - radialFront.y) > 0.5 ||
            Math.abs(perpendicularBack.x - radialBack.x) > 0.5 ||
            Math.abs(perpendicularBack.y - radialBack.y) > 0.5
        ).toBe(true);
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

    it('adds egress-driven distributed chamfer aisles without moving forced transitions', () => {
        const fixture = buildRendererBowlFixture('Full', {
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const relaxedLayout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig,
            seatWidthIn: 20,
            rowCount: 12,
            maxOccupantsPerAisle: 500
        });
        const strictLayout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig,
            seatWidthIn: 20,
            rowCount: 12,
            maxOccupantsPerAisle: 60
        });

        expect(strictLayout.forcedCount).toBe(relaxedLayout.forcedCount);
        expect(
            strictLayout.aisles
                .filter((aisle) => aisle.forced)
                .map((aisle) => ({ cornerOrdinal: aisle.cornerOrdinal, u: aisle.u }))
        ).toEqual(
            relaxedLayout.aisles
                .filter((aisle) => aisle.forced)
                .map((aisle) => ({ cornerOrdinal: aisle.cornerOrdinal, u: aisle.u }))
        );
        expect(strictLayout.aisles.length).toBeGreaterThan(relaxedLayout.aisles.length);
        expect(
            strictLayout.aisles.filter((aisle) => !aisle.forced && [0, 2, 4, 6].includes(aisle.segmentIndex)).length
        ).toBeGreaterThan(0);
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

    it('keeps forced chamfer edge aisles on the fixed corner contract', () => {
        const fixture = buildRendererBowlFixture('Full', {
            straightAisleMode: 'radial',
            chamferAisleMode: 'perpendicular'
        });
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig
        });

        const forcedChamferAisles = layout.aisles.filter((aisle) => aisle.forced);
        expect(forcedChamferAisles).toHaveLength(layout.forcedCount);
        expect(forcedChamferAisles.length).toBeGreaterThan(0);
        expect(forcedChamferAisles.every((aisle) => aisle.alignmentMode === undefined)).toBe(true);
    });

    it('builds tier-stable perpendicular references for distributed aisles only', () => {
        const fixture = buildRendererBowlFixture('Full', {
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'perpendicular'
        });
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 8,
            aisleWidthFt: 4,
            bowlConfig: fixture.bowlConfig,
            maxSeatsBetweenAisles: 12,
            seatWidthIn: 20
        });
        const references = buildPerpendicularAisleReferenceMap(
            fixture.frontPaths,
            fixture.backPaths,
            layout.aisles,
            new Map()
        );
        const expectedCount = layout.aisles.filter((aisle) => (
            !aisle.forced && aisle.alignmentMode === 'perpendicular'
        )).length;
        const straightIndex = layout.aisles.findIndex((aisle) => (
            !aisle.forced && [1, 3, 5, 7].includes(aisle.segmentIndex)
        ));
        const chamferIndex = layout.aisles.findIndex((aisle) => (
            !aisle.forced && [0, 2, 4, 6].includes(aisle.segmentIndex)
        ));
        const forcedIndex = layout.aisles.findIndex((aisle) => aisle.forced);

        expect(references.size).toBe(expectedCount);
        expect(straightIndex).toBeGreaterThanOrEqual(0);
        expect(chamferIndex).toBeGreaterThanOrEqual(0);
        expect(forcedIndex).toBeGreaterThanOrEqual(0);
        expect(references.get(straightIndex)).toEqual(expect.objectContaining({
            referencePath: fixture.backPaths[0],
            referenceU: expect.any(Number)
        }));
        expect(references.get(chamferIndex)).toEqual(expect.objectContaining({
            referencePath: fixture.backPaths[0],
            referenceU: expect.any(Number)
        }));
        expect(references.has(forcedIndex)).toBe(false);
    });

    it('keeps U-end discretionary extras on straight intervals and includes terminal open-end runs', () => {
        ['U-End1', 'U-End2'].forEach((type) => {
            const fixture = buildRendererBowlFixture(type, {
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            });
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: 8,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig
            });

            const distributed = layout.aisles.filter((aisle) => !aisle.forced);
            const distributedSegments = distributed.map((aisle) => aisle.segmentIndex);
            expect(distributedSegments.length).toBeGreaterThan(0);
            expect(distributedSegments.every((segmentIndex) => [0, 2, 4].includes(segmentIndex))).toBe(true);
            expect(distributedSegments.some((segmentIndex) => [0, 4].includes(segmentIndex))).toBe(true);
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

    it('enforces seat and egress caps on simple open-path layouts', () => {
        const frontSegments = [
            { cmd: 'moveTo', x: -15, y: 0 },
            { cmd: 'lineTo', x: 15, y: 0 }
        ];

        const seatCappedLayout = buildTierAisleLayout({
            frontSegments,
            targetAisles: 2,
            aisleWidthFt: 4,
            bowlConfig: { type: 'Side1', corner: 'None' },
            maxSeatsBetweenAisles: 6,
            seatWidthIn: 20
        });
        const egressCappedLayout = buildTierAisleLayout({
            frontSegments,
            targetAisles: 2,
            aisleWidthFt: 4,
            bowlConfig: { type: 'Side1', corner: 'None' },
            seatWidthIn: 20,
            rowCount: 40,
            maxAisleWidthIn: 48,
            egressFactor: 0.2
        });

        expect(seatCappedLayout.aisles.length).toBeGreaterThan(2);
        expect(egressCappedLayout.aisles.length).toBeGreaterThan(2);
    });

    it('builds authoritative realized section and aisle summaries from explicit row samples', () => {
        const frontSegments = [
            { cmd: 'moveTo', x: -10, y: 0 },
            { cmd: 'lineTo', x: 10, y: 0 }
        ];
        const tierLayout = buildTierAisleLayout({
            frontSegments,
            targetAisles: 3,
            aisleWidthFt: 4,
            bowlConfig: { type: 'Side1', corner: 'None' }
        });
        const referencePaths = buildGeometryPaths(frontSegments);
        const aisleRatiosByPath = new Map([[
            0,
            new Map(tierLayout.aisles.map((aisle, aisleIndex) => [aisleIndex, aisle.u]))
        ]]);

        const summary = buildTierAisleLayoutSummary({
            rows: [{ row_number: 1 }, { row_number: 2 }],
            tierLayout,
            referencePaths,
            resolveRowAisleSampling: () => ({
                paths: referencePaths,
                aisleRatiosByPath
            }),
            seatWidthIn: 20,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 72,
            egressFactor: 0.2,
            maxSeatsBetweenAisles: 24
        });

        expect(summary).toMatchObject({
            actualAisles: 3,
            actualSections: 2,
            allSectionPathsClosed: false,
            sectionOccupancyTotals: [4, 4],
            aisleOccupancyTotals: [2, 4, 2],
            tierSeatCount: 8,
            largestSectionOccupancy: 4,
            largestContinuousRowSeatCount: 2,
            requiredWidthIn: 0.8,
            governingWidthIn: 48,
            maxRequiredAisleWidthIn: 0.8,
            maxGoverningAisleWidthIn: 48,
            minRenderedAisleWidthIn: 48,
            maxRenderedAisleWidthIn: 48,
            renderedWidthSolveConverged: true,
            compliance: {
                seatCapCompliant: true,
                egressCapCompliant: true,
                renderedWidthCompliant: true,
                isCompliant: true
            }
        });
        expect(summary.sections).toEqual([
            expect.objectContaining({
                pathIndex: 0,
                occupancy: 4,
                rowSeatCounts: [2, 2]
            }),
            expect.objectContaining({
                pathIndex: 0,
                occupancy: 4,
                rowSeatCounts: [2, 2]
            })
        ]);
        expect(summary.aisles).toEqual([
            expect.objectContaining({ aisleIndex: 0, tributaryOccupancy: 2, governingWidthIn: 48 }),
            expect.objectContaining({ aisleIndex: 1, tributaryOccupancy: 4, governingWidthIn: 48 }),
            expect.objectContaining({ aisleIndex: 2, tributaryOccupancy: 2, governingWidthIn: 48 })
        ]);
        expect(summary.rowSummaries).toEqual([
            expect.objectContaining({ rowIndex: 0, seatCount: 4, sectionCount: 2 }),
            expect.objectContaining({ rowIndex: 1, seatCount: 4, sectionCount: 2 })
        ]);
    });

    it('builds configuration totals from authoritative tier analyses only', () => {
        const frontSegments = [
            { cmd: 'moveTo', x: -15, y: 0 },
            { cmd: 'lineTo', x: 15, y: 0 }
        ];
        const rows = [
            { row_number: 1, x: 12, tread_depth: 2 },
            { row_number: 2, x: 14, tread_depth: 2 }
        ];
        const getPathsForOffset = () => buildGeometryPaths(frontSegments);
        const tierLayout = buildTierAisleAnalysis({
            tierIndex: 0,
            rows,
            bowlConfig: { type: 'Side1', corner: 'None' },
            offsetCorrection: 0,
            egressParams: {
                seatWidthIn: 20,
                minAisleWidthIn: 48,
                maxAisleWidthIn: 72,
                egressFactor: 0.2,
                seatsBetweenAisles: 24
            },
            getPathsForOffset,
            getRowLengthFt: () => 30
        });

        expect(tierLayout).not.toBeNull();
        expect(tierLayout.sectionSummary).toEqual(expect.objectContaining({
            tierSeatCount: expect.any(Number),
            rowSummaries: expect.any(Array),
            aisles: expect.any(Array)
        }));

        const configurationSummary = buildConfigurationAisleSummary({
            tierLayouts: [tierLayout]
        });

        expect(configurationSummary).toEqual({
            totalOccupancyAllTiers: tierLayout.sectionSummary.tierSeatCount,
            totalAislesAllTiers: tierLayout.sectionSummary.actualAisles,
            totalSectionsAllTiers: tierLayout.sectionSummary.actualSections,
            tierSeatCounts: [{
                tierIndex: 0,
                tierSeatCount: tierLayout.sectionSummary.tierSeatCount
            }],
            maxRequiredAisleWidthInOverall: tierLayout.sectionSummary.maxRequiredAisleWidthIn
        });
    });

    it('adds terminal end aisles for U-end analyses and gives them side-like half-tributary loads', () => {
        ['U-End1', 'U-End2'].forEach((type) => {
            const fixture = buildRendererBowlFixture(type, {
                width: 85,
                length: 200,
                radius: 28,
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            });
            const renderer = Object.create(FieldRenderer.prototype);
            const rows = Array.from({ length: 25 }, (_, index) => ({
                row_number: index + 1,
                x: 12 + (index * 2.5),
                tread_depth: 2.5
            }));

            const tierLayout = buildTierAisleAnalysis({
                tierIndex: 0,
                rows,
                bowlConfig: fixture.bowlConfig,
                offsetCorrection: 0,
                egressParams: {
                    seatWidthIn: 20,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 72,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 24
                },
                getPathsForOffset: (offset) => buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, offset)),
                getRowLengthFt: (offset) => renderer.calculateRowLength(fixture.bowlConfig, offset)
            });

            const firstAisle = tierLayout.aisles[0];
            const lastAisle = tierLayout.aisles[tierLayout.aisles.length - 1];
            const firstSection = tierLayout.sectionSummary.sections[0];
            const lastSection = tierLayout.sectionSummary.sections[tierLayout.sectionSummary.sections.length - 1];
            const firstAisleSummary = tierLayout.sectionSummary.aisles[0];
            const lastAisleSummary = tierLayout.sectionSummary.aisles[tierLayout.sectionSummary.aisles.length - 1];

            expect(firstAisle).toEqual(expect.objectContaining({
                anchorType: 'open_edge_terminal',
                edge: 'start'
            }));
            expect(lastAisle).toEqual(expect.objectContaining({
                anchorType: 'open_edge_terminal',
                edge: 'end'
            }));
            expect(firstSection).toEqual(expect.objectContaining({
                startBoundaryKind: 'aisle',
                aisleIndexA: 0
            }));
            expect(lastSection).toEqual(expect.objectContaining({
                endBoundaryKind: 'aisle',
                aisleIndexB: tierLayout.aisles.length - 1
            }));
            expect(firstAisleSummary.tributaryOccupancy).toBeCloseTo(firstSection.occupancy / 2, 5);
            expect(lastAisleSummary.tributaryOccupancy).toBeCloseTo(lastSection.occupancy / 2, 5);
        });
    });
});
