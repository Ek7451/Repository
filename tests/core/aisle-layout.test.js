import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
    __testHooks,
    buildGeometryPaths,
    buildPerpendicularAisleReferenceMap,
    buildConfigurationAisleSummary,
    buildTierAisleAnalysis,
    buildTierAisleLayout,
    buildTierAisleReferenceMap,
    buildTierAisleLayoutSummary,
    pickBestRowAisleSampling,
    resolveAisleStationRatios,
    sampleAisleBand,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';
import { computeMaximumOccupantsPerAisle } from '../../core/egress-policy.js';
import { spanGapToSeatCount } from '../../core/seat-math.js';
import { FieldRenderer } from '../../viz/field-renderer.js';

const ICE_HOCKEY_STUDY_FIXTURE = JSON.parse(
    readFileSync(new URL('../fixtures/ice-hockey-study.json', import.meta.url), 'utf8')
);

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

function buildTierRows({
    count = 4,
    startX = 24,
    treadDepth = 3
} = {}) {
    return Array.from({ length: count }, (_, index) => ({
        row_number: index + 1,
        x: startX + (index * treadDepth),
        tread_depth: treadDepth
    }));
}

function buildIceHockeyStudyCase() {
    const renderer = Object.create(FieldRenderer.prototype);
    const rows = ICE_HOCKEY_STUDY_FIXTURE.rows.map((row) => ({
        row_number: row.row,
        x: row.x,
        z: row.z,
        tread_depth: row.treadDepthIn / 12
    }));
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const frontOffset = (firstRow.x - firstRow.tread_depth);
    const backOffset = lastRow.x;
    const egressParams = {
        seatWidthIn: ICE_HOCKEY_STUDY_FIXTURE.egressInputs.seatWidthIn,
        minAisleWidthIn: ICE_HOCKEY_STUDY_FIXTURE.egressInputs.minAisleWidthIn,
        maxAisleWidthIn: ICE_HOCKEY_STUDY_FIXTURE.egressInputs.maxAisleWidthIn,
        egressFactor: ICE_HOCKEY_STUDY_FIXTURE.egressInputs.egressFactor,
        seatsBetweenAisles: ICE_HOCKEY_STUDY_FIXTURE.egressInputs.maxSeatsPerRow
    };
    const frontSegments = renderer._getBowlGeometry(ICE_HOCKEY_STUDY_FIXTURE.bowlConfig, frontOffset);
    const backSegments = renderer._getBowlGeometry(ICE_HOCKEY_STUDY_FIXTURE.bowlConfig, backOffset);

    return {
        renderer,
        rows,
        egressParams,
        frontSegments,
        backSegments,
        frontPaths: buildGeometryPaths(frontSegments),
        backPaths: buildGeometryPaths(backSegments)
    };
}

function buildIceHockeyStudyAnalysis() {
    const fixtureCase = buildIceHockeyStudyCase();

    return {
        ...fixtureCase,
        tierLayout: buildTierAisleAnalysis({
            tierIndex: 0,
            rows: fixtureCase.rows,
            bowlConfig: ICE_HOCKEY_STUDY_FIXTURE.bowlConfig,
            offsetCorrection: 0,
            egressParams: fixtureCase.egressParams,
            getPathsForOffset: (offset) => buildGeometryPaths(
                fixtureCase.renderer._getBowlGeometry(ICE_HOCKEY_STUDY_FIXTURE.bowlConfig, offset)
            ),
            getRowLengthFt: (offset) => fixtureCase.renderer.calculateRowLength(
                ICE_HOCKEY_STUDY_FIXTURE.bowlConfig,
                offset
            )
        })
    };
}

function collectForcedDelimitedDistributedGroups(tierLayout) {
    const aisles = Array.isArray(tierLayout?.aisles) ? tierLayout.aisles : [];
    const sections = Array.isArray(tierLayout?.sectionSummary?.sections) ? tierLayout.sectionSummary.sections : [];
    const groups = [];
    if (!aisles.length || aisles.every((aisle) => !aisle?.forced)) return groups;

    for (let startIndex = 0; startIndex < aisles.length; startIndex += 1) {
        if (!aisles[startIndex]?.forced) continue;

        const run = [];
        let nextIndex = (startIndex + 1) % aisles.length;
        while (nextIndex !== startIndex && !aisles[nextIndex]?.forced) {
            run.push({
                aisleIndex: nextIndex,
                aisle: aisles[nextIndex]
            });
            nextIndex = (nextIndex + 1) % aisles.length;
        }

        if (!run.length) continue;

        const sectionIndexes = [];
        for (let sectionIndex = startIndex; sectionIndex !== nextIndex; sectionIndex = (sectionIndex + 1) % aisles.length) {
            sectionIndexes.push(sectionIndex);
        }

        groups.push({
            startAisleIndex: startIndex,
            endAisleIndex: nextIndex,
            segmentIndex: run[0].aisle.segmentIndex,
            aisles: run,
            sections: sectionIndexes.map((sectionIndex) => sections[sectionIndex]).filter(Boolean)
        });
    }

    return groups;
}

function resolveStudyPlacementInputs(tierLayout, egressParams) {
    const aisleWidthFt = egressParams.maxAisleWidthIn / 12;
    const minSpacingFt = Math.max(aisleWidthFt * 1.05, 1.25);

    return {
        aisleWidthFt,
        axisExclusionFt: tierLayout.axisExclusionFt,
        endpointBufferFt: Math.max(2.0, aisleWidthFt, minSpacingFt * 0.5)
    };
}

function summarizeTierLayoutForRows(options = {}) {
    const {
        rows,
        tierLayout,
        bowlConfig,
        seatWidthIn = 20,
        minAisleWidthIn = 48,
        maxAisleWidthIn = 72,
        egressFactor = 0.2,
        maxSeatsBetweenAisles = NaN,
        offsetCorrection = 0
    } = options;
    const renderer = Object.create(FieldRenderer.prototype);
    const safeRows = Array.isArray(rows) ? rows : [];
    const lastRow = safeRows[safeRows.length - 1];
    const getPathsForOffset = (offset) => buildGeometryPaths(renderer._getBowlGeometry(bowlConfig, offset));
    const layoutForSummary = {
        ...tierLayout,
        tierIndex: tierLayout?.tierIndex ?? 0,
        seatWidthIn
    };
    const referencePaths = lastRow
        ? getPathsForOffset((lastRow.x - (lastRow.tread_depth * 0.5)) - offsetCorrection)
        : [];
    const chamferCache = new Map();
    const aisleReferenceMap = buildTierAisleReferenceMap({
        rows: safeRows,
        tierLayout: layoutForSummary,
        offsetCorrection,
        getPathsForOffset,
        chamferCache
    });

    return buildTierAisleLayoutSummary({
        rows: safeRows,
        tierLayout: layoutForSummary,
        referencePaths,
        resolveRowAisleSampling: (_rowIndex, row) => pickBestRowAisleSampling(
            (row.x - (row.tread_depth * 0.5)) - offsetCorrection,
            getPathsForOffset,
            layoutForSummary,
            chamferCache,
            aisleReferenceMap
        ),
        seatWidthIn,
        minAisleWidthIn,
        maxAisleWidthIn,
        egressFactor,
        maxSeatsBetweenAisles,
        getRowLengthFt: (offset) => renderer.calculateRowLength(bowlConfig, offset),
        bowlConfig,
        offsetCorrection,
        layoutSolveConverged: true
    });
}

function countDistributedAislesBySegment(tierLayout) {
    return tierLayout.aisles
        .filter((aisle) => !aisle.forced)
        .reduce((counts, aisle) => {
            const segmentIndex = Math.max(0, Math.floor(Number(aisle.segmentIndex) || 0));
            counts[segmentIndex] = (counts[segmentIndex] || 0) + 1;
            return counts;
        }, {});
}

function buildTierAisleAnalysisForFixture({
    fixture,
    rows,
    egressParams,
    tierIndex = 0,
    offsetCorrection = 0
}) {
    const renderer = Object.create(FieldRenderer.prototype);

    return buildTierAisleAnalysis({
        tierIndex,
        rows,
        bowlConfig: fixture.bowlConfig,
        offsetCorrection,
        egressParams,
        getPathsForOffset: (offset) => buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, offset)),
        getRowLengthFt: (offset) => renderer.calculateRowLength(fixture.bowlConfig, offset)
    });
}

function findFirstCompliantTargetAisleSolve({
    fixture,
    rows,
    egressParams,
    minTargetAisles = 0,
    maxTargetAisles = 32
}) {
    const renderer = Object.create(FieldRenderer.prototype);
    const firstRow = Array.isArray(rows) ? rows[0] : null;
    const lastRow = Array.isArray(rows) ? rows[rows.length - 1] : null;
    const frontSegments = firstRow
        ? renderer._getBowlGeometry(fixture.bowlConfig, firstRow.x - firstRow.tread_depth)
        : fixture.frontSegments;
    const backSegments = lastRow
        ? renderer._getBowlGeometry(fixture.bowlConfig, lastRow.x)
        : fixture.backSegments;

    for (let targetAisles = minTargetAisles; targetAisles <= maxTargetAisles; targetAisles += 1) {
        const tierLayout = buildTierAisleLayout({
            frontSegments,
            backSegments,
            targetAisles,
            aisleWidthFt: egressParams.maxAisleWidthIn / 12,
            bowlConfig: fixture.bowlConfig,
            maxSeatsBetweenAisles: egressParams.seatsBetweenAisles,
            seatWidthIn: egressParams.seatWidthIn,
            maxAisleWidthIn: egressParams.maxAisleWidthIn,
            egressFactor: egressParams.egressFactor,
            rowCount: rows.length
        });
        const summary = summarizeTierLayoutForRows({
            rows,
            tierLayout,
            bowlConfig: fixture.bowlConfig,
            seatWidthIn: egressParams.seatWidthIn,
            minAisleWidthIn: egressParams.minAisleWidthIn,
            maxAisleWidthIn: egressParams.maxAisleWidthIn,
            egressFactor: egressParams.egressFactor,
            maxSeatsBetweenAisles: egressParams.seatsBetweenAisles
        });

        if (summary.compliance.isCompliant) {
            return {
                targetAisles,
                tierLayout,
                summary
            };
        }
    }

    return null;
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

    it('places the odd full-bowl discretionary remainder at the midpoint of the top longest straight', () => {
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
        expect(point.x).toBeCloseTo(0, 6);
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

    it('places four discretionary long-straight aisles on the full bounded span', () => {
        const fixture = buildRendererBowlFixture('Full', {
            width: 85,
            length: 200,
            radius: 28,
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const aisleWidthFt = 6;
        const layout = buildTierAisleLayout({
            frontSegments: fixture.frontSegments,
            backSegments: fixture.backSegments,
            targetAisles: 18,
            aisleWidthFt,
            bowlConfig: fixture.bowlConfig
        });
        const segmentTs = layout.aisles
            .filter((aisle) => !aisle.forced && aisle.segmentIndex === 7)
            .map((aisle) => aisle.segmentT)
            .sort((a, b) => a - b);
        const expectedTs = [0.2, 0.4, 0.6, 0.8];

        expect(segmentTs).toHaveLength(4);
        expectedTs.forEach((expectedT, index) => {
            expect(segmentTs[index]).toBeCloseTo(expectedT, 6);
        });
        expect(segmentTs[1] - segmentTs[0]).toBeCloseTo(0.2, 6);
        expect(segmentTs[3] - segmentTs[2]).toBeCloseTo(0.2, 6);
    });

    it('adds seat-cap aisles beyond the requested target across multiple full-bowl scenarios', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                })
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 100,
                    length: 220,
                    radius: 16,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                })
            }
        ];

        cases.forEach(({ fixture }) => {
            const requestedTargetAisles = 8;
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: requestedTargetAisles,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig,
                maxSeatsBetweenAisles: 24,
                seatWidthIn: 20
            });
            const distributedSegments = layout.aisles
                .filter((aisle) => !aisle.forced)
                .map((aisle) => aisle.segmentIndex);
            const distributedCounts = countDistributedAislesBySegment(layout);

            expect(layout.forcedCount).toBe(8);
            expect(layout.targetAisles).toBeGreaterThan(requestedTargetAisles);
            expect(layout.aisles).toHaveLength(layout.targetAisles);
            expect(distributedSegments).toHaveLength(layout.targetAisles - layout.forcedCount);
            expect(distributedSegments.every((segmentIndex) => [1, 3, 5, 7].includes(segmentIndex))).toBe(true);
            expect(distributedCounts[1] || 0).toBe(distributedCounts[5] || 0);
            expect(distributedCounts[3] || 0).toBe(distributedCounts[7] || 0);
            expect(distributedCounts[3] || 0).toBeGreaterThanOrEqual(distributedCounts[1] || 0);
        });
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

    it('keeps authoritative full-bowl aisle analyses symmetric across multiple chamfered scenarios', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 85,
                    length: 200,
                    radius: 28,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 12,
                    startX: 10,
                    treadDepth: 1.5
                }),
                egressParams: {
                    seatWidthIn: 20,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 72,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 24
                }
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 85,
                    length: 200,
                    radius: 16,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 15,
                    startX: 2.75,
                    treadDepth: 2.75
                }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 40
                }
            }
        ];

        cases.forEach(({ fixture, rows, egressParams }) => {
            const tierLayout = buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams
            });
            const distributedCounts = countDistributedAislesBySegment(tierLayout);
            const longestStraightCount = Math.max(distributedCounts[3] || 0, distributedCounts[7] || 0);
            const otherSegmentCount = Math.max(
                distributedCounts[0] || 0,
                distributedCounts[1] || 0,
                distributedCounts[2] || 0,
                distributedCounts[4] || 0,
                distributedCounts[5] || 0,
                distributedCounts[6] || 0
            );

            expect(tierLayout.sectionSummary.actualAisles).toBe(tierLayout.sectionSummary.actualSections);
            expect(tierLayout.sectionSummary.actualAisles).toBeGreaterThan(tierLayout.forcedCount);
            expect(tierLayout.sectionSummary.compliance.isCompliant).toBe(true);
            expect(tierLayout.sectionSummary.maxRenderedAisleWidthIn).toBeGreaterThan(egressParams.minAisleWidthIn);
            expect(distributedCounts[0] || 0).toBe(distributedCounts[4] || 0);
            expect(distributedCounts[1] || 0).toBe(distributedCounts[5] || 0);
            expect(distributedCounts[2] || 0).toBe(distributedCounts[6] || 0);
            expect(distributedCounts[3] || 0).toBe(distributedCounts[7] || 0);
            expect(longestStraightCount).toBeGreaterThanOrEqual(otherSegmentCount);
        });
    });

    it('stops at the first authoritative compliant full-bowl solve across multiple scenarios', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 85,
                    length: 200,
                    radius: 16,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 15,
                    startX: 2.75,
                    treadDepth: 2.75
                }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 40
                }
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 80,
                    length: 180,
                    radius: 20,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 14,
                    startX: 6,
                    treadDepth: 2.25
                }),
                egressParams: {
                    seatWidthIn: 20,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 32
                }
            }
        ];

        cases.forEach(({ fixture, rows, egressParams }) => {
            const firstCompliantSolve = findFirstCompliantTargetAisleSolve({
                fixture,
                rows,
                egressParams,
                minTargetAisles: 8,
                maxTargetAisles: 24
            });

            expect(firstCompliantSolve).not.toBeNull();
            const tierLayout = buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams
            });

            expect(firstCompliantSolve.summary.compliance.isCompliant).toBe(true);
            expect(firstCompliantSolve.tierLayout.targetAisles).toBe(firstCompliantSolve.summary.actualAisles);
            expect(tierLayout.targetAisles).toBe(firstCompliantSolve.tierLayout.targetAisles);
            expect(tierLayout.sectionSummary.actualAisles).toBe(firstCompliantSolve.summary.actualAisles);
            expect(tierLayout.sectionSummary.compliance.isCompliant).toBe(true);
            expect(tierLayout.sectionSummary.maxRenderedAisleWidthIn).toBeGreaterThan(egressParams.minAisleWidthIn);
            expect(tierLayout.sectionSummary.maxRenderedAisleWidthIn).toBeLessThanOrEqual(
                egressParams.maxAisleWidthIn
            );
        });
    });

    it('pins single distributed straight aisles to the midpoint on the uploaded hockey fixture', () => {
        const { egressParams, frontPaths, backPaths, frontSegments, backSegments, rows } = buildIceHockeyStudyCase();
        const tierLayout = buildTierAisleLayout({
            frontSegments,
            backSegments,
            targetAisles: 18,
            aisleWidthFt: egressParams.maxAisleWidthIn / 12,
            bowlConfig: ICE_HOCKEY_STUDY_FIXTURE.bowlConfig
        });
        const summary = summarizeTierLayoutForRows({
            rows,
            tierLayout,
            bowlConfig: ICE_HOCKEY_STUDY_FIXTURE.bowlConfig,
            seatWidthIn: egressParams.seatWidthIn,
            minAisleWidthIn: egressParams.minAisleWidthIn,
            maxAisleWidthIn: egressParams.maxAisleWidthIn,
            egressFactor: egressParams.egressFactor,
            maxSeatsBetweenAisles: egressParams.seatsBetweenAisles
        });
        const perimeterModel = __testHooks.buildPerimeterModel(
            frontPaths,
            backPaths,
            ICE_HOCKEY_STUDY_FIXTURE.bowlConfig
        );
        const singleStraightGroups = collectForcedDelimitedDistributedGroups({
            ...tierLayout,
            sectionSummary: summary
        })
            .map((group) => ({
                ...group,
                interval: perimeterModel.paths[0]?.intervals?.[group.segmentIndex]
            }))
            .filter((group) => group.interval?.family === 'straight' && group.aisles.length === 1);

        expect(singleStraightGroups.length).toBeGreaterThan(0);

        singleStraightGroups.forEach((group) => {
            const [leftSection, rightSection] = group.sections;
            expect(group.aisles[0].aisle.segmentT).toBeCloseTo(0.5, 6);
            expect(Math.abs(leftSection.frontRowSeats - rightSection.frontRowSeats)).toBeLessThanOrEqual(1);
            expect(Math.abs(leftSection.backRowSeats - rightSection.backRowSeats)).toBeLessThanOrEqual(1);
        });
    });

    it('eliminates the legacy long-straight 24,20,20,20,24 underfill on the uploaded hockey fixture', () => {
        const { frontPaths, backPaths, tierLayout } = buildIceHockeyStudyAnalysis();
        const perimeterModel = __testHooks.buildPerimeterModel(
            frontPaths,
            backPaths,
            ICE_HOCKEY_STUDY_FIXTURE.bowlConfig
        );
        const groups = collectForcedDelimitedDistributedGroups(tierLayout)
            .map((group) => ({
                ...group,
                interval: perimeterModel.paths[0]?.intervals?.[group.segmentIndex]
            }))
            .filter((group) => group.interval?.family === 'straight' && group.sections.length >= 3);
        const longestStraightGroup = groups
            .slice()
            .sort((left, right) => {
                const leftLength = Number(left.interval?.back?.length ?? left.interval?.front?.length) || 0;
                const rightLength = Number(right.interval?.back?.length ?? right.interval?.front?.length) || 0;
                return rightLength - leftLength;
            })[0];
        const allBackRowSeats = tierLayout.sectionSummary.sections.map((section) => section.backRowSeats);
        const legacyPlateau = [24, 20, 20, 20, 24];
        let hasLegacyPlateau = false;

        for (let index = 0; index <= allBackRowSeats.length - legacyPlateau.length; index += 1) {
            if (legacyPlateau.every((seatCount, offset) => allBackRowSeats[index + offset] === seatCount)) {
                hasLegacyPlateau = true;
                break;
            }
        }

        expect(longestStraightGroup).toBeDefined();
        expect(hasLegacyPlateau).toBe(false);

        const backRowSeats = longestStraightGroup.sections.map((section) => section.backRowSeats);
        const middleSeats = backRowSeats.slice(1, -1);
        const edgeSeatCeiling = Math.max(backRowSeats[0], backRowSeats[backRowSeats.length - 1]);

        expect(Math.max(...middleSeats)).toBeGreaterThanOrEqual(22);
        expect(middleSeats.some((seatCount) => seatCount > 20)).toBe(true);
        expect(Math.max(...middleSeats)).toBeGreaterThanOrEqual(edgeSeatCeiling);
    });

    it('keeps every realized aisle tributary occupancy within the uploaded hockey egress cap', () => {
        const { egressParams, tierLayout } = buildIceHockeyStudyAnalysis();
        const legalMaxOccupantsPerAisle = computeMaximumOccupantsPerAisle({
            maxAisleWidthIn: egressParams.maxAisleWidthIn,
            egressFactor: egressParams.egressFactor
        });

        expect(legalMaxOccupantsPerAisle).toBe(330);
        tierLayout.sectionSummary.aisles.forEach((aisle) => {
            expect(aisle.tributaryOccupancy).toBeLessThanOrEqual(legalMaxOccupantsPerAisle + 1e-9);
        });
    });

    it('uses the same interval station routine for validation and materialization on the uploaded hockey fixture', () => {
        const { egressParams, frontPaths, backPaths, tierLayout } = buildIceHockeyStudyAnalysis();
        const perimeterModel = __testHooks.buildPerimeterModel(
            frontPaths,
            backPaths,
            ICE_HOCKEY_STUDY_FIXTURE.bowlConfig
        );
        const placementInputs = resolveStudyPlacementInputs(tierLayout, egressParams);
        const straightGroups = collectForcedDelimitedDistributedGroups(tierLayout)
            .map((group) => ({
                ...group,
                interval: perimeterModel.paths[0]?.intervals?.[group.segmentIndex]
            }))
            .filter((group) => group.interval?.family === 'straight');

        expect(straightGroups.length).toBeGreaterThan(0);

        straightGroups.forEach((group) => {
            const expectedTs = __testHooks.distributeIntervalTs(
                group.interval,
                group.aisles.length,
                placementInputs.axisExclusionFt,
                placementInputs.endpointBufferFt
            );
            const actualTs = group.aisles.map(({ aisle }) => aisle.segmentT);
            const intervalSide = group.interval.back || group.interval.front;
            const bounds = [0, ...expectedTs, 1].sort((left, right) => left - right);
            let manualWorstSeats = 0;

            for (let index = 0; index < bounds.length - 1; index += 1) {
                manualWorstSeats = Math.max(
                    manualWorstSeats,
                    spanGapToSeatCount(
                        intervalSide.length * (bounds[index + 1] - bounds[index]),
                        placementInputs.aisleWidthFt,
                        egressParams.seatWidthIn
                    )
                );
            }

            expect(actualTs).toHaveLength(expectedTs.length);
            actualTs.forEach((segmentT, index) => {
                expect(segmentT).toBeCloseTo(expectedTs[index], 6);
            });
            expect(__testHooks.estimateWorstSeatsInInterval(
                group.interval,
                group.aisles.length,
                egressParams.seatWidthIn,
                placementInputs.aisleWidthFt,
                placementInputs.axisExclusionFt,
                placementInputs.endpointBufferFt
            )).toBe(manualWorstSeats);
        });
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
