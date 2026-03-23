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
    resolveTierAisleStationRatios,
    sampleAisleBand,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';
import { computeMaximumOccupantsPerAisle } from '../../core/egress-policy.js';
import { spanGapToSeatCount } from '../../core/seat-math.js';
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

function buildClosedRectangleSegments({
    width = 16,
    height = 16,
    offsetX = 0,
    offsetY = 0
} = {}) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    return [
        { cmd: 'moveTo', x: offsetX - halfWidth, y: offsetY + halfHeight },
        { cmd: 'lineTo', x: offsetX + halfWidth, y: offsetY + halfHeight },
        { cmd: 'lineTo', x: offsetX + halfWidth, y: offsetY - halfHeight },
        { cmd: 'lineTo', x: offsetX - halfWidth, y: offsetY - halfHeight },
        { cmd: 'closePath' }
    ];
}

function buildManualClosedTierLayout(aisleUs = []) {
    const aisles = aisleUs.map((u) => ({
        pathIndex: 0,
        u,
        forced: false,
        anchorType: 'manual_closed_test'
    }));

    return {
        aisles,
        aisleWidthFt: 0,
        targetAisles: aisles.length,
        forcedCount: 0,
        axisExclusionFt: 0,
        sectionBoundaries: [aisles.map((aisle, _aisleIndex) => ({
            aisleIndex: _aisleIndex,
            u: aisle.u,
            forced: false,
            boundaryKind: 'aisle',
            boundaryKey: `aisle:${_aisleIndex}`
        }))]
    };
}

function buildClosedLoopSectionRecords(boundaryOrder = []) {
    return boundaryOrder.map((aisleIndex, slotIndex) => {
        const nextAisleIndex = boundaryOrder[(slotIndex + 1) % boundaryOrder.length];
        const startBoundaryKey = `aisle:${aisleIndex}`;
        const endBoundaryKey = `aisle:${nextAisleIndex}`;

        return {
            pathIndex: 0,
            slotIndex,
            pathClosed: true,
            aisleIndexA: aisleIndex,
            aisleIndexB: nextAisleIndex,
            startBoundaryKind: 'aisle',
            endBoundaryKind: 'aisle',
            startBoundaryKey,
            endBoundaryKey,
            boundaryPairKey: __testHooks.buildBoundaryPairKey(startBoundaryKey, endBoundaryKey),
            startU: NaN,
            endU: NaN
        };
    });
}

function buildSelectiveClosedPathResolver(validOffsets = [], segments = buildClosedRectangleSegments()) {
    const allowedOffsets = validOffsets.map((offset) => Number(offset) || 0);

    return (offset) => {
        const numericOffset = Number(offset) || 0;
        const isAllowed = allowedOffsets.some((allowedOffset) => Math.abs(numericOffset - allowedOffset) <= 1e-6);
        return isAllowed ? buildGeometryPaths(segments) : [];
    };
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

/**
 * @param {string} type
 * @param {{ frontOffset?: number, backOffset?: number, [key: string]: any }} [options]
 */
function buildBaseballArcFixture(type, {
    frontOffset = 0,
    backOffset = 12,
    ...overrides
} = {}) {
    return buildRendererBowlFixture(type, {
        frontOffset,
        backOffset,
        shape: 'arc',
        radius_arc: 325,
        arc_angle: 90,
        sideLength: 325,
        endLength: 325,
        radius: 40,
        corner: 'Chamfer',
        straightAisleMode: 'perpendicular',
        chamferAisleMode: 'radial',
        ...overrides
    });
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

function countFixedDeterministicAisles(tierLayout) {
    return (Array.isArray(tierLayout?.aisles) ? tierLayout.aisles : []).filter(
        (aisle) => aisle?.forced || aisle?.anchorType === 'open_edge_terminal'
    ).length;
}

function getWorstMeasuredSectionSeatCount(summary) {
    return Math.max(
        0,
        ...((Array.isArray(summary?.sections) ? summary.sections : []).map((section) => Math.max(0, Number(section?.maxSeatsPerRow) || 0)))
    );
}

function countAislesByPath(tierLayout) {
    return (Array.isArray(tierLayout?.aisles) ? tierLayout.aisles : []).reduce((counts, aisle) => {
        const pathIndex = Math.max(0, Math.floor(Number(aisle?.pathIndex) || 0));
        counts[pathIndex] = (counts[pathIndex] || 0) + 1;
        return counts;
    }, {});
}

function countSectionsByPath(summary) {
    return (Array.isArray(summary?.sections) ? summary.sections : []).reduce((counts, section) => {
        const pathIndex = Math.max(0, Math.floor(Number(section?.pathIndex) || 0));
        counts[pathIndex] = (counts[pathIndex] || 0) + 1;
        return counts;
    }, {});
}

function buildGroupedOpenFixtureAnalysis({
    type,
    sideLength = 232,
    endLength = 187,
    seatsBetweenAisles = 30,
    rowCount = 12
}) {
    const fixture = buildRendererBowlFixture(type, {
        corner: 'None',
        length: sideLength,
        width: endLength,
        sideLength,
        endLength
    });
    const rows = buildTierRows({ count: rowCount, startX: 24, treadDepth: 3 });
    const egressParams = {
        seatWidthIn: 19,
        minAisleWidthIn: 48,
        maxAisleWidthIn: 72,
        egressFactor: 0.2,
        seatsBetweenAisles
    };

    return {
        fixture,
        rows,
        egressParams,
        analysis: buildTierAisleAnalysisForFixture({
            fixture,
            rows,
            egressParams
        })
    };
}

function normalizeWrappedTestU(u) {
    let out = Number(u) || 0;
    out %= 1;
    if (out < 0) out += 1;
    return out;
}

function computeWrappedTestSpan(startU, endU) {
    const start = normalizeWrappedTestU(startU);
    let end = normalizeWrappedTestU(endU);
    if (end <= start + 1e-6) end += 1;
    return { start, end, span: end - start };
}

function resolveWrappedTestOffset(startU, u) {
    let offset = normalizeWrappedTestU(u) - normalizeWrappedTestU(startU);
    if (offset < 0) offset += 1;
    return offset;
}

function findUpperRightChamferStartSlotIndex(sections, referencePath, bowlConfig) {
    const perimeterModel = __testHooks.buildPerimeterModel([referencePath], [referencePath], bowlConfig);
    const upperRightChamfer = perimeterModel.paths[0].intervals
        .filter((interval) => interval?.family === 'chamfer')
        .map((interval) => {
            const side = interval.front || interval.back;
            const midU = normalizeWrappedTestU(side.startU + (computeWrappedTestSpan(side.startU, side.endU).span * 0.5));
            const point = samplePathPointByRatio(referencePath, midU);
            return {
                interval,
                point,
                score: (Number(point?.x) || 0) + (Number(point?.y) || 0)
            };
        })
        .sort((left, right) => (
            (right.score - left.score)
            || ((Number(right.point?.x) || 0) - (Number(left.point?.x) || 0))
            || ((Number(right.point?.y) || 0) - (Number(left.point?.y) || 0))
        ))[0]?.interval;
    const side = upperRightChamfer?.front || upperRightChamfer?.back;
    if (!side) return null;

    const intervalSpan = computeWrappedTestSpan(side.startU, side.endU).span;
    /** @type {{ slotIndex: number, endOffset: number } | null} */
    let bestContained = null;
    /** @type {{ slotIndex: number, overlap: number, endOffset: number } | null} */
    let bestOverlap = null;

    sections.forEach((section) => {
        const sectionRange = computeWrappedTestSpan(section.startU, section.endU);
        const startOffset = resolveWrappedTestOffset(side.startU, sectionRange.start);
        const endOffset = startOffset + sectionRange.span;
        const overlap = Math.max(0, Math.min(endOffset, intervalSpan) - Math.max(startOffset, 0));

        if (
            !bestOverlap
            || overlap > bestOverlap.overlap + 1e-6
            || (
                Math.abs(overlap - bestOverlap.overlap) <= 1e-6
                && endOffset > bestOverlap.endOffset + 1e-6
            )
        ) {
            bestOverlap = {
                slotIndex: section.slotIndex,
                overlap,
                endOffset
            };
        }

        if (!(overlap > 1e-6) || endOffset > intervalSpan + 1e-6) return;
        if (!bestContained || endOffset > bestContained.endOffset + 1e-6) {
            bestContained = {
                slotIndex: section.slotIndex,
                endOffset
            };
        }
    });

    if (bestContained) return bestContained.slotIndex;
    if (bestOverlap) return bestOverlap.slotIndex;
    return null;
}

function buildRetryGroupedOpenAnalysis({
    type,
    sideLength = 269,
    endLength = 215,
    seatsBetweenAisles = 28,
    rowCount = 15
}) {
    const fixture = buildRendererBowlFixture(type, {
        width: 85,
        length: 200,
        shape: 'rounded_rect',
        corner: 'Chamfer',
        radius: 16,
        chamferReferenceOffset: 0,
        sideLength,
        endLength,
        straightAisleMode: 'perpendicular',
        chamferAisleMode: 'radial'
    });
    const rows = Array.from({ length: rowCount }, (_, index) => ({
        row_number: index + 1,
        x: 2.75 * (index + 1),
        tread_depth: 2.75
    }));
    const egressParams = {
        seatWidthIn: 19,
        minAisleWidthIn: 48,
        maxAisleWidthIn: 66,
        egressFactor: 0.2,
        seatsBetweenAisles
    };

    return buildTierAisleAnalysisForFixture({
        fixture,
        rows,
        egressParams
    });
}

function buildRowMatchedDeterministicBaseline({
    fixture,
    rows,
    egressParams
}) {
    const renderer = Object.create(FieldRenderer.prototype);
    const safeRows = Array.isArray(rows) ? rows : [];
    const firstRow = safeRows[0];
    const lastRow = safeRows[safeRows.length - 1];
    const frontSegments = firstRow
        ? renderer._getBowlGeometry(fixture.bowlConfig, firstRow.x - firstRow.tread_depth)
        : fixture.frontSegments;
    const backSegments = lastRow
        ? renderer._getBowlGeometry(fixture.bowlConfig, lastRow.x)
        : fixture.backSegments;
    const tierLayout = buildTierAisleLayout({
        frontSegments,
        backSegments,
        targetAisles: 0,
        aisleWidthFt: egressParams.maxAisleWidthIn / 12,
        bowlConfig: fixture.bowlConfig,
        maxSeatsBetweenAisles: egressParams.seatsBetweenAisles,
        seatWidthIn: egressParams.seatWidthIn,
        maxAisleWidthIn: egressParams.maxAisleWidthIn,
        egressFactor: egressParams.egressFactor,
        rowCount: safeRows.length
    });
    const summary = summarizeTierLayoutForRows({
        rows: safeRows,
        tierLayout,
        bowlConfig: fixture.bowlConfig,
        seatWidthIn: egressParams.seatWidthIn,
        minAisleWidthIn: egressParams.minAisleWidthIn,
        maxAisleWidthIn: egressParams.maxAisleWidthIn,
        egressFactor: egressParams.egressFactor,
        maxSeatsBetweenAisles: egressParams.seatsBetweenAisles
    });
    const referencePaths = lastRow
        ? buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, lastRow.x - (lastRow.tread_depth * 0.5)))
        : [];
    const perimeterModel = __testHooks.buildPerimeterModel(
        buildGeometryPaths(frontSegments),
        buildGeometryPaths(backSegments),
        fixture.bowlConfig
    );

    return {
        tierLayout,
        summary,
        referencePaths,
        perimeterModel
    };
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
            { type: 'Sides3', pathCount: 3, closed: [false, false, false], parts: [1, 1, 1] },
            { type: 'Sides4', pathCount: 4, closed: [false, false, false, false], parts: [1, 1, 1, 1] },
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

    it('keeps baseball arc bowl topology on the same authoritative path and anchor contracts', () => {
        const cases = [
            { type: 'Side1', pathCount: 1, closed: [false], parts: [1], forcedCount: 0 },
            { type: 'Sides', pathCount: 2, closed: [false, false], parts: [1, 1], forcedCount: 0 },
            { type: 'BaseballStandard', pathCount: 1, closed: [false], parts: [3], forcedCount: 4 }
        ];

        cases.forEach((spec) => {
            const fixture = buildBaseballArcFixture(spec.type);
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: 0,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig
            });

            expect(fixture.frontPaths).toHaveLength(spec.pathCount);
            expect(fixture.frontPaths.map((path) => path.closed)).toEqual(spec.closed);
            expect(fixture.frontPaths.map((path) => path.parts.length)).toEqual(spec.parts);
            expect(layout.forcedCount).toBe(spec.forcedCount);
            expect(layout.aisles.filter((aisle) => aisle.forced)).toHaveLength(spec.forcedCount);
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

    it('allocates aisles across every independent 3-sided and 4-sided renderer path', () => {
        [
            { type: 'Sides3', expectedPaths: 3 },
            { type: 'Sides4', expectedPaths: 4 }
        ].forEach(({ type, expectedPaths }) => {
            const fixture = buildRendererBowlFixture(type);
            const layout = buildTierAisleLayout({
                frontSegments: fixture.frontSegments,
                backSegments: fixture.backSegments,
                targetAisles: 3,
                aisleWidthFt: 4,
                bowlConfig: fixture.bowlConfig
            });
            const aislesByPath = layout.aisles.reduce((counts, aisle) => {
                const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
                counts.set(pathIndex, (counts.get(pathIndex) || 0) + 1);
                return counts;
            }, new Map());

            expect(layout.forcedCount).toBe(0);
            expect(layout.aisles.length).toBeGreaterThan(0);
            expect(layout.sectionBoundaries).toHaveLength(expectedPaths);
            expect(layout.aisles.every((aisle) => aisle.anchorType === 'distributed_linear_even')).toBe(true);
            expect(layout.aisles.every((aisle) => aisle.alignmentMode === 'radial')).toBe(true);
            expect(aislesByPath.size).toBe(expectedPaths);
            aislesByPath.forEach((aisleCount) => {
                expect(aisleCount).toBeGreaterThan(0);
            });
        });
    });

    it('builds authoritative grouped ownership metadata for open multi-side bowls', () => {
        const sides3Fixture = buildRendererBowlFixture('Sides3', {
            corner: 'None',
            length: 232,
            width: 142,
            sideLength: 232,
            endLength: 142
        });
        const sides4Fixture = buildRendererBowlFixture('Sides4', {
            corner: 'None',
            length: 232,
            width: 187,
            sideLength: 232,
            endLength: 187
        });
        const sides3Model = __testHooks.buildPerimeterModel(
            sides3Fixture.frontPaths,
            sides3Fixture.backPaths,
            sides3Fixture.bowlConfig
        );
        const sides4Model = __testHooks.buildPerimeterModel(
            sides4Fixture.frontPaths,
            sides4Fixture.backPaths,
            sides4Fixture.bowlConfig
        );

        expect(sides3Model.openPathGroups).toEqual([
            expect.objectContaining({
                groupId: 'side_length_12',
                pathIndices: [0, 1],
                axis: 'horizontal'
            }),
            expect.objectContaining({
                groupId: 'side_length_34',
                normalizationScope: 'path:2',
                pathIndices: [2],
                axis: 'vertical'
            })
        ]);
        expect(sides4Model.openPathGroups).toEqual([
            expect.objectContaining({
                groupId: 'side_length_12',
                pathIndices: [0, 1],
                axis: 'horizontal'
            }),
            expect.objectContaining({
                groupId: 'side_length_34',
                pathIndices: [2, 3],
                axis: 'vertical'
            })
        ]);
        expect(sides4Model.paths.map((pathRecord) => pathRecord.openPathOwnership?.groupId)).toEqual([
            'side_length_12',
            'side_length_12',
            'side_length_34',
            'side_length_34'
        ]);
    });

    it('isolates Sides4 side-length 3/4 changes to the owning vertical pair', () => {
        const baseline = buildGroupedOpenFixtureAnalysis({
            type: 'Sides4',
            sideLength: 232,
            endLength: 187,
            seatsBetweenAisles: 30
        });
        const shortened = buildGroupedOpenFixtureAnalysis({
            type: 'Sides4',
            sideLength: 232,
            endLength: 142,
            seatsBetweenAisles: 30
        });

        expect(countAislesByPath(baseline.analysis)).toEqual({ 0: 6, 1: 6, 2: 5, 3: 5 });
        expect(countAislesByPath(shortened.analysis)).toEqual({ 0: 6, 1: 6, 2: 4, 3: 4 });
        expect(countSectionsByPath(baseline.analysis.sectionSummary)).toEqual({ 0: 5, 1: 5, 2: 4, 3: 4 });
        expect(countSectionsByPath(shortened.analysis.sectionSummary)).toEqual({ 0: 5, 1: 5, 2: 3, 3: 3 });
    });

    it('isolates Sides4 side-length 1/2 changes to the owning horizontal pair', () => {
        const baseline = buildGroupedOpenFixtureAnalysis({
            type: 'Sides4',
            sideLength: 232,
            endLength: 187,
            seatsBetweenAisles: 30
        });
        const shortened = buildGroupedOpenFixtureAnalysis({
            type: 'Sides4',
            sideLength: 142,
            endLength: 187,
            seatsBetweenAisles: 30
        });

        expect(countAislesByPath(baseline.analysis)).toEqual({ 0: 6, 1: 6, 2: 5, 3: 5 });
        expect(countAislesByPath(shortened.analysis)).toEqual({ 0: 4, 1: 4, 2: 5, 3: 5 });
        expect(countSectionsByPath(baseline.analysis.sectionSummary)).toEqual({ 0: 5, 1: 5, 2: 4, 3: 4 });
        expect(countSectionsByPath(shortened.analysis.sectionSummary)).toEqual({ 0: 3, 1: 3, 2: 4, 3: 4 });
    });

    it('keeps Sides4 max-seat escalation scoped to each owning pair', () => {
        const relaxed = buildGroupedOpenFixtureAnalysis({
            type: 'Sides4',
            sideLength: 232,
            endLength: 142,
            seatsBetweenAisles: 30
        });
        const strict = buildGroupedOpenFixtureAnalysis({
            type: 'Sides4',
            sideLength: 232,
            endLength: 142,
            seatsBetweenAisles: 18
        });

        expect(countAislesByPath(relaxed.analysis)).toEqual({ 0: 6, 1: 6, 2: 4, 3: 4 });
        expect(countAislesByPath(strict.analysis)).toEqual({ 0: 8, 1: 8, 2: 5, 3: 5 });
        expect(countSectionsByPath(strict.analysis.sectionSummary)).toEqual({ 0: 7, 1: 7, 2: 4, 3: 4 });
    });

    it('keeps Sides3 grouped-open normalization scoped to the owning pair plus single side', () => {
        const grouped = buildGroupedOpenFixtureAnalysis({
            type: 'Sides3',
            sideLength: 232,
            endLength: 142,
            seatsBetweenAisles: 30
        });

        expect(countAislesByPath(grouped.analysis)).toEqual({ 0: 6, 1: 6, 2: 4 });
        expect(countSectionsByPath(grouped.analysis.sectionSummary)).toEqual({ 0: 5, 1: 5, 2: 3 });
    });

    it('keeps Sides open bowls normalized as one owning pair', () => {
        const grouped = buildGroupedOpenFixtureAnalysis({
            type: 'Sides',
            sideLength: 232,
            endLength: 187,
            seatsBetweenAisles: 30
        });

        expect(countAislesByPath(grouped.analysis)).toEqual({ 0: 6, 1: 6 });
        expect(countSectionsByPath(grouped.analysis.sectionSummary)).toEqual({ 0: 5, 1: 5 });
    });

    it('keeps Sides3 retry convergence scoped to the paired sides versus the independent side', () => {
        const analysis = buildRetryGroupedOpenAnalysis({
            type: 'Sides3',
            sideLength: 269,
            endLength: 215,
            seatsBetweenAisles: 28
        });

        expect(analysis.sectionSummary.compliance.isCompliant).toBe(true);
        expect(countAislesByPath(analysis)).toEqual({ 0: 8, 1: 8, 2: 7 });
        expect(countSectionsByPath(analysis.sectionSummary)).toEqual({ 0: 7, 1: 7, 2: 6 });
    });

    it('keeps Sides4 retry convergence scoped to the owning pair that needs another aisle', () => {
        const analysis = buildRetryGroupedOpenAnalysis({
            type: 'Sides4',
            sideLength: 269,
            endLength: 215,
            seatsBetweenAisles: 28
        });

        expect(analysis.sectionSummary.compliance.isCompliant).toBe(true);
        expect(countAislesByPath(analysis)).toEqual({ 0: 8, 1: 8, 2: 7, 3: 7 });
        expect(countSectionsByPath(analysis.sectionSummary)).toEqual({ 0: 7, 1: 7, 2: 6, 3: 6 });
    });

    it('keeps 3-sided and 4-sided aisle analysis populated on every seating segment', () => {
        [
            { type: 'Sides3', expectedPaths: 3 },
            { type: 'Sides4', expectedPaths: 4 }
        ].forEach(({ type, expectedPaths }) => {
            const fixture = buildRendererBowlFixture(type);
            const tierLayout = buildTierAisleAnalysisForFixture({
                fixture,
                rows: buildTierRows(),
                egressParams: {
                    seatWidthIn: 20,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 72,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 24
                }
            });
            const aislesByPath = tierLayout.aisles.reduce((counts, aisle) => {
                const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
                counts.set(pathIndex, (counts.get(pathIndex) || 0) + 1);
                return counts;
            }, new Map());

            expect(tierLayout.sectionSummary.actualAisles).toBeGreaterThan(0);
            expect(aislesByPath.size).toBe(expectedPaths);
            aislesByPath.forEach((aisleCount) => {
                expect(aisleCount).toBeGreaterThan(0);
            });
        });
    });

    it('resolves side-run terminal aisles from rendered widths so edge bands stay flush', () => {
        const fixture = buildRendererBowlFixture('Side1', {
            corner: 'None',
            width: 200,
            length: 85,
            radius: 0
        });
        const rows = buildTierRows();
        const renderer = Object.create(FieldRenderer.prototype);
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
        const chamferCache = new Map();
        const getPathsForOffset = (offset) => buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, offset));
        const aisleReferenceMap = buildTierAisleReferenceMap({
            rows,
            tierLayout,
            offsetCorrection: 0,
            getPathsForOffset,
            chamferCache
        });
        const firstRow = rows[0];
        const frontPath = getPathsForOffset(firstRow.x - firstRow.tread_depth)[0];
        const backPath = getPathsForOffset(firstRow.x)[0];
        const ratios = resolveTierAisleStationRatios(
            frontPath,
            backPath,
            tierLayout.aisles[0],
            0,
            chamferCache,
            aisleReferenceMap,
            tierLayout
        );
        const widthFt = tierLayout.sectionSummary.aisles[0].renderedWidthFt;
        const frontBand = sampleAisleBand(frontPath, ratios.uFront, widthFt);
        const backBand = sampleAisleBand(backPath, ratios.uBack, widthFt);

        expect(tierLayout.aisles[0]).toEqual(expect.objectContaining({
            anchorType: 'distributed_linear_even'
        }));
        expect(frontBand.left.x).toBeCloseTo(frontPath.startX, 6);
        expect(backBand.left.x).toBeCloseTo(backPath.startX, 6);
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

    it('stops at the first authoritative compliant U-end solve without overshooting terminal edge aisles', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('U-End2', {
                    width: 102,
                    length: 200,
                    radius: 33,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 25,
                    startX: 12,
                    treadDepth: 2.5
                }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 28
                }
            },
            {
                fixture: buildRendererBowlFixture('U-End1', {
                    width: 102,
                    length: 200,
                    radius: 28,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 25,
                    startX: 12,
                    treadDepth: 2.5
                }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 28
                }
            }
        ];

        cases.forEach(({ fixture, rows, egressParams }) => {
            const firstCompliantSolve = findFirstCompliantTargetAisleSolve({
                fixture,
                rows,
                egressParams,
                maxTargetAisles: 40
            });

            expect(firstCompliantSolve).not.toBeNull();
            expect(firstCompliantSolve.summary.compliance.isCompliant).toBe(true);

            const tierLayout = buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams
            });

            expect(tierLayout.sectionSummary.compliance.isCompliant).toBe(true);
            expect(tierLayout.targetAisles).toBeLessThanOrEqual(firstCompliantSolve.tierLayout.targetAisles);
            expect(tierLayout.sectionSummary.actualAisles).toBeLessThanOrEqual(firstCompliantSolve.summary.actualAisles);
            expect(tierLayout.sectionSummary.tierSeatCount).toBeGreaterThanOrEqual(firstCompliantSolve.summary.tierSeatCount);
            expect(tierLayout.sectionSummary.maxRequiredAisleWidthIn).toBeLessThanOrEqual(egressParams.maxAisleWidthIn);
        });
    });

    it('does not escalate deterministic full-bowl aisle counts when a tapered 18-aisle solve already meets measured egress', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 80,
                    length: 180,
                    radius: 16,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 15,
                    startX: 2.75,
                    treadDepth: 2.75
                })
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
                })
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 90,
                    length: 180,
                    radius: 18,
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({
                    count: 15,
                    startX: 2.75,
                    treadDepth: 2.75
                })
            }
        ];
        const egressParams = {
            seatWidthIn: 19,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 66,
            egressFactor: 0.2,
            seatsBetweenAisles: 50
        };

        cases.forEach(({ fixture, rows }) => {
            const firstRow = rows[0];
            const lastRow = rows[rows.length - 1];
            const frontSegments = renderer._getBowlGeometry(
                fixture.bowlConfig,
                firstRow.x - firstRow.tread_depth
            );
            const backSegments = renderer._getBowlGeometry(
                fixture.bowlConfig,
                lastRow.x
            );
            const targetedLayout = buildTierAisleLayout({
                frontSegments,
                backSegments,
                targetAisles: 18,
                aisleWidthFt: egressParams.maxAisleWidthIn / 12,
                bowlConfig: fixture.bowlConfig,
                maxSeatsBetweenAisles: egressParams.seatsBetweenAisles,
                seatWidthIn: egressParams.seatWidthIn,
                maxAisleWidthIn: egressParams.maxAisleWidthIn,
                egressFactor: egressParams.egressFactor,
                rowCount: rows.length
            });
            const targetedSummary = summarizeTierLayoutForRows({
                rows,
                tierLayout: targetedLayout,
                bowlConfig: fixture.bowlConfig,
                seatWidthIn: egressParams.seatWidthIn,
                minAisleWidthIn: egressParams.minAisleWidthIn,
                maxAisleWidthIn: egressParams.maxAisleWidthIn,
                egressFactor: egressParams.egressFactor,
                maxSeatsBetweenAisles: egressParams.seatsBetweenAisles
            });
            const analysis = buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams
            });

            expect(targetedLayout.aisles.length).toBe(18);
            expect(targetedSummary.compliance.isCompliant).toBe(true);
            expect(analysis.sectionSummary.compliance.isCompliant).toBe(true);
            expect(analysis.aisles.length).toBe(targetedLayout.aisles.length);
            expect(analysis.sectionSummary.actualAisles).toBe(targetedLayout.aisles.length);
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
            seatWidthIn: 20,
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
                slotIndex: 1,
                sectionNumber: 101,
                pathIndex: 0,
                occupancy: 4,
                rowSeatCounts: [2, 2],
                rowSeatingLengthsFt: [4, 4]
            }),
            expect.objectContaining({
                slotIndex: 2,
                sectionNumber: 100,
                pathIndex: 0,
                occupancy: 4,
                rowSeatCounts: [2, 2],
                rowSeatingLengthsFt: [4, 4]
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

    it('builds exactly one row-local closed-path gap per sampled boundary and one seam gap', () => {
        const [path] = buildGeometryPaths(buildClosedRectangleSegments());
        const sectionRecords = buildClosedLoopSectionRecords([0, 1, 2, 3]);
        const evaluation = __testHooks.buildRowLocalBoundaryGapMap({
            path,
            aisleMap: new Map([
                [0, 0.05],
                [1, 0.3],
                [2, 0.55],
                [3, 0.8]
            ]),
            sectionRecords,
            pathClosed: true
        });
        const participationCounts = evaluation.gaps.reduce((counts, gap) => {
            counts.set(gap.startBoundaryKey, (counts.get(gap.startBoundaryKey) || 0) + 1);
            counts.set(gap.endBoundaryKey, (counts.get(gap.endBoundaryKey) || 0) + 1);
            return counts;
        }, new Map());

        expect(evaluation.topologyValid).toBe(true);
        expect(evaluation.measurementValid).toBe(true);
        expect(evaluation.gapByPairKey.size).toBe(4);
        expect(evaluation.gaps).toHaveLength(4);
        expect(evaluation.wrapGapCount).toBe(1);
        expect(evaluation.gaps.filter((gap) => gap.seamCrossing)).toHaveLength(1);
        expect(Array.from(participationCounts.values()).sort((a, b) => a - b)).toEqual([2, 2, 2, 2]);
    });

    it('measures closed-path sections from row-local boundary pair gaps instead of raw slot orientation', () => {
        const segments = buildClosedRectangleSegments();
        const [path] = buildGeometryPaths(segments);
        const tierLayout = buildManualClosedTierLayout([0, 0.25, 0.5, 0.75]);
        const referencePaths = buildGeometryPaths(segments);
        const sampledAisleMap = new Map([
            [0, 0],
            [1, 0.75],
            [2, 0.5],
            [3, 0.25]
        ]);
        const evaluation = __testHooks.buildRowLocalBoundaryGapMap({
            path,
            aisleMap: sampledAisleMap,
            sectionRecords: buildClosedLoopSectionRecords([0, 1, 2, 3]),
            pathClosed: true
        });
        const summary = buildTierAisleLayoutSummary({
            rows: [{ row_number: 1 }, { row_number: 2 }],
            tierLayout,
            referencePaths,
            resolveRowAisleSampling: () => ({
                paths: referencePaths,
                aisleRatiosByPath: new Map([[0, sampledAisleMap]])
            }),
            seatWidthIn: 24,
            minAisleWidthIn: 0,
            maxAisleWidthIn: 120,
            egressFactor: 0
        });
        const aisleZeroPairKey = __testHooks.buildBoundaryPairKey('aisle:0', 'aisle:1');

        expect(evaluation.topologyValid).toBe(true);
        expect(evaluation.measurementValid).toBe(true);
        expect(evaluation.gapByPairKey.get(aisleZeroPairKey)?.centerGapFt).toBeCloseTo(path.length * 0.25, 6);
        expect(summary.topologyValid).toBe(true);
        expect(summary.measurementValid).toBe(true);
        expect(summary.rowSummaries.map((rowSummary) => rowSummary.seatCount)).toEqual([32, 32]);
        expect(summary.sections.map((section) => section.rowSeatCounts)).toEqual([
            [8, 8],
            [8, 8],
            [8, 8],
            [8, 8]
        ]);
    });

    it('marks a closed-path summary invalid when a reference section pair is no longer row-local adjacent', () => {
        const segments = buildClosedRectangleSegments();
        const [path] = buildGeometryPaths(segments);
        const tierLayout = buildManualClosedTierLayout([0, 0.25, 0.5, 0.75]);
        const referencePaths = buildGeometryPaths(segments);
        const sampledAisleMap = new Map([
            [0, 0],
            [1, 0.5],
            [2, 0.25],
            [3, 0.75]
        ]);
        const evaluation = __testHooks.buildRowLocalBoundaryGapMap({
            path,
            aisleMap: sampledAisleMap,
            sectionRecords: buildClosedLoopSectionRecords([0, 1, 2, 3]),
            pathClosed: true
        });
        const summary = buildTierAisleLayoutSummary({
            rows: [{ row_number: 1 }],
            tierLayout,
            referencePaths,
            resolveRowAisleSampling: () => ({
                paths: referencePaths,
                aisleRatiosByPath: new Map([[0, sampledAisleMap]])
            }),
            seatWidthIn: 24,
            minAisleWidthIn: 0,
            maxAisleWidthIn: 120,
            egressFactor: 0
        });

        expect(evaluation.topologyValid).toBe(false);
        expect(evaluation.nonAdjacentPairs).toContain(
            __testHooks.buildBoundaryPairKey('aisle:0', 'aisle:1')
        );
        expect(summary.topologyValid).toBe(false);
        expect(summary.measurementValid).toBe(false);
        expect(summary.invalidTopologyPaths).toEqual([0]);
        expect(summary.invalidTopologyRowIndices).toEqual([0]);
        expect(summary.failureReason).toBe('invalid_topology');
        expect(summary.compliance.isCompliant).toBe(false);
    });

    it('preserves closed-path slot numbering when a zero-seat slot drops out of the measured summary', () => {
        const referencePaths = buildGeometryPaths(buildClosedRectangleSegments({
            width: 20,
            height: 20
        }));
        const sampledAisleMap = new Map([
            [0, 0],
            [1, 0.01],
            [2, 0.5],
            [3, 0.75]
        ]);
        const tierLayout = {
            tierIndex: 0,
            aisleWidthFt: 0,
            aisles: [
                { pathIndex: 0, u: 0 },
                { pathIndex: 0, u: 0.01 },
                { pathIndex: 0, u: 0.5 },
                { pathIndex: 0, u: 0.75 }
            ],
            sectionBoundaries: [[
                { aisleIndex: 0, u: 0, boundaryKind: 'aisle', boundaryKey: 'aisle:0' },
                { aisleIndex: 1, u: 0.01, boundaryKind: 'aisle', boundaryKey: 'aisle:1' },
                { aisleIndex: 2, u: 0.5, boundaryKind: 'aisle', boundaryKey: 'aisle:2' },
                { aisleIndex: 3, u: 0.75, boundaryKind: 'aisle', boundaryKey: 'aisle:3' }
            ]]
        };
        const buildSummary = (seatWidthIn) => buildTierAisleLayoutSummary({
            rows: [{ row_number: 1 }, { row_number: 2 }],
            tierLayout,
            referencePaths,
            resolveRowAisleSampling: () => ({
                paths: referencePaths,
                aisleRatiosByPath: new Map([[0, sampledAisleMap]])
            }),
            seatWidthIn,
            minAisleWidthIn: 0,
            maxAisleWidthIn: 120,
            egressFactor: 0,
            bowlConfig: { type: 'Full', corner: 'None' }
        });

        const allSectionsSummary = buildSummary(1);
        const filteredSummary = buildSummary(24);
        const sectionNumberBySlot = new Map(
            allSectionsSummary.sections.map((section) => [section.slotIndex, section.sectionNumber])
        );

        expect(allSectionsSummary.sections).toHaveLength(4);
        expect(filteredSummary.sections.map((section) => section.slotIndex)).toEqual([1, 2, 3]);
        filteredSummary.sections.forEach((section) => {
            expect(section.sectionNumber).toBe(sectionNumberBySlot.get(section.slotIndex));
        });
    });

    it('anchors authoritative full-bowl section numbering to the last section on the upper-right chamfer across varying tier counts', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const fixture = buildRendererBowlFixture('Full', {
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const egressParams = {
            seatWidthIn: 20,
            seatsBetweenAisles: 24,
            egressFactor: 0.2,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 72
        };
        const tierCases = [
            { tierIndex: 0, startX: 24, count: 5 },
            { tierIndex: 1, startX: 52, count: 5 },
            { tierIndex: 2, startX: 68, count: 5 }
        ];

        tierCases.forEach(({ tierIndex, startX, count }) => {
            const rows = buildTierRows({ count, startX });
            const analysis = buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams,
                tierIndex
            });
            const lastRow = rows[rows.length - 1];
            const referencePaths = buildGeometryPaths(
                renderer._getBowlGeometry(fixture.bowlConfig, lastRow.x - (lastRow.tread_depth * 0.5))
            );
            const pathSections = analysis.sectionSummary.sections.filter((section) => section.pathIndex === 0);
            const baseSectionNumber = (tierIndex + 1) * 100;
            const baseSection = pathSections.find((section) => section.sectionNumber === baseSectionNumber);
            const expectedStartSlotIndex = findUpperRightChamferStartSlotIndex(
                pathSections,
                referencePaths[0],
                fixture.bowlConfig
            );

            expect(baseSection).toBeTruthy();
            expect(baseSection.slotIndex).toBe(expectedStartSlotIndex);
        });
    });

    it('conserves row seats for valid closed-path sampling and stops aisle escalation on topology failure', () => {
        const segments = buildClosedRectangleSegments();
        const [path] = buildGeometryPaths(segments);
        const referencePaths = buildGeometryPaths(segments);
        const validAisleMap = new Map([
            [0, 0],
            [1, 0.75],
            [2, 0.5],
            [3, 0.25]
        ]);
        const validEvaluation = __testHooks.buildRowLocalBoundaryGapMap({
            path,
            aisleMap: validAisleMap,
            sectionRecords: buildClosedLoopSectionRecords([0, 1, 2, 3]),
            pathClosed: true
        });
        const validSummary = buildTierAisleLayoutSummary({
            rows: [{ row_number: 1 }, { row_number: 2 }],
            tierLayout: buildManualClosedTierLayout([0, 0.25, 0.5, 0.75]),
            referencePaths,
            resolveRowAisleSampling: () => ({
                paths: referencePaths,
                aisleRatiosByPath: new Map([[0, validAisleMap]])
            }),
            seatWidthIn: 24,
            minAisleWidthIn: 0,
            maxAisleWidthIn: 120,
            egressFactor: 0
        });
        const maxAdjacentGapSeatCount = Math.max(...validEvaluation.gaps.map((gap) => spanGapToSeatCount(gap.centerGapFt, 0, 24)));
        const rows = [
            { row_number: 1, x: 10, tread_depth: 2 },
            { row_number: 2, x: 13, tread_depth: 2 }
        ];
        const egressParams = {
            seatWidthIn: 20,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 48,
            egressFactor: 0.2,
            seatsBetweenAisles: 24
        };
        const baselineLayout = buildTierAisleLayout({
            frontSegments: segments,
            backSegments: segments,
            targetAisles: 0,
            aisleWidthFt: egressParams.maxAisleWidthIn / 12,
            bowlConfig: { type: 'Full', corner: 'None' },
            maxSeatsBetweenAisles: egressParams.seatsBetweenAisles,
            seatWidthIn: egressParams.seatWidthIn,
            maxAisleWidthIn: egressParams.maxAisleWidthIn,
            egressFactor: egressParams.egressFactor,
            rowCount: rows.length
        });
        const topologyFailureAnalysis = buildTierAisleAnalysis({
            tierIndex: 0,
            rows,
            bowlConfig: { type: 'Full', corner: 'None' },
            offsetCorrection: 0,
            egressParams,
            getPathsForOffset: buildSelectiveClosedPathResolver([8, 12, 13], segments),
            getRowLengthFt: () => path.length
        });

        validSummary.rowSummaries.forEach((rowSummary, rowIndex) => {
            const sectionSeatTotal = validSummary.sections.reduce(
                (sum, section) => sum + Math.max(0, Number(section.rowSeatCounts[rowIndex]) || 0),
                0
            );

            expect(sectionSeatTotal).toBe(rowSummary.seatCount);
        });
        validSummary.sections.forEach((section) => {
            section.rowSeatCounts.forEach((rowSeatCount) => {
                expect(rowSeatCount).toBeLessThanOrEqual(maxAdjacentGapSeatCount);
            });
        });
        expect(topologyFailureAnalysis).not.toBeNull();
        expect(topologyFailureAnalysis.sectionSummary.topologyValid).toBe(false);
        expect(topologyFailureAnalysis.sectionSummary.failureReason).toBe('invalid_topology');
        expect(topologyFailureAnalysis.sectionSummary.layoutSolveConverged).toBe(false);
        expect(topologyFailureAnalysis.sectionSummary.converged).toBe(false);
        expect(topologyFailureAnalysis.targetAisles).toBe(baselineLayout.targetAisles);
        expect(topologyFailureAnalysis.aisles.length).toBe(baselineLayout.aisles.length);
    });

    it('targets measured violating interval runs when refining deterministic chamfer layouts', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 85,
                    length: 200,
                    radius: 16,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 10, startX: 55, treadDepth: 2.75 }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 24
                }
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 92,
                    length: 210,
                    radius: 18,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 8, startX: 65, treadDepth: 2.75 }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 26
                }
            }
        ];

        cases.forEach(({ fixture, rows, egressParams }) => {
            const baseline = buildRowMatchedDeterministicBaseline({ fixture, rows, egressParams });
            const refinement = __testHooks.buildMeasuredSeatCapRefinement({
                perimeterModel: baseline.perimeterModel,
                referencePaths: baseline.referencePaths,
                sectionSummary: baseline.summary,
                aisles: baseline.tierLayout.aisles,
                maxSeatsBetweenAisles: egressParams.seatsBetweenAisles
            });
            const violatingKeys = new Set(
                refinement.intervalPressures
                    .filter((pressure) => pressure.deficit > 0)
                    .map((pressure) => `${pressure.pathIndex}:${pressure.intervalIndex}`)
            );

            expect(baseline.summary.topologyValid).toBe(true);
            expect(baseline.summary.compliance.seatCapCompliant).toBe(false);
            expect(refinement.violatingIntervalCount).toBeGreaterThan(0);

            refinement.intervalPressures
                .filter((pressure) => pressure.deficit > 0)
                .forEach((pressure) => {
                    const topPressure = refinement.intervalPressures[0];
                    const isMirroredTopPressure = topPressure &&
                        pressure.pathIndex === topPressure.pathIndex &&
                        Number.isFinite(topPressure.oppositeIndex) &&
                        pressure.intervalIndex === topPressure.oppositeIndex;
                    const expectedCount = pressure === topPressure || isMirroredTopPressure
                        ? pressure.currentCount + 1
                        : pressure.currentCount;
                    expect(refinement.nextCounts[pressure.pathIndex][pressure.intervalIndex]).toBe(expectedCount);
                });

            refinement.intervalPressures
                .filter((pressure) => (
                    pressure.deficit === 0 &&
                    !violatingKeys.has(`${pressure.pathIndex}:${pressure.oppositeIndex}`)
                ))
                .forEach((pressure) => {
                    expect(refinement.nextCounts[pressure.pathIndex][pressure.intervalIndex]).toBe(pressure.currentCount);
                });
        });
    });

    it('resolves challenging synthetic full-chamfer seat-cap cases without runaway aisle escalation', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 85,
                    length: 200,
                    radius: 16,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 10, startX: 55, treadDepth: 2.75 }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 24
                }
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 92,
                    length: 210,
                    radius: 18,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 8, startX: 65, treadDepth: 2.75 }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 26
                }
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 100,
                    length: 220,
                    radius: 20,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 8, startX: 55, treadDepth: 2.75 }),
                egressParams: {
                    seatWidthIn: 19,
                    minAisleWidthIn: 48,
                    maxAisleWidthIn: 66,
                    egressFactor: 0.2,
                    seatsBetweenAisles: 24
                }
            }
        ];

        cases.forEach(({ fixture, rows, egressParams }) => {
            const baseline = buildRowMatchedDeterministicBaseline({ fixture, rows, egressParams });
            const refinement = __testHooks.buildMeasuredSeatCapRefinement({
                perimeterModel: baseline.perimeterModel,
                referencePaths: baseline.referencePaths,
                sectionSummary: baseline.summary,
                aisles: baseline.tierLayout.aisles,
                maxSeatsBetweenAisles: egressParams.seatsBetweenAisles
            });
            const analysis = buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams
            });
            const fixedAisleCount = countFixedDeterministicAisles(analysis);
            const refinedDistributedCount = refinement.nextCounts.reduce(
                (sum, row) => sum + row.reduce((inner, value) => inner + value, 0),
                0
            );

            expect(analysis).not.toBeNull();
            expect(baseline.summary.compliance.seatCapCompliant).toBe(false);
            expect(analysis.sectionSummary.topologyValid).toBe(true);
            expect(analysis.sectionSummary.measurementValid).toBe(true);
            expect(analysis.sectionSummary.compliance.isCompliant).toBe(true);
            expect(getWorstMeasuredSectionSeatCount(analysis.sectionSummary)).toBeLessThan(
                getWorstMeasuredSectionSeatCount(baseline.summary)
            );
            expect(getWorstMeasuredSectionSeatCount(analysis.sectionSummary)).toBeLessThanOrEqual(
                egressParams.seatsBetweenAisles
            );
            expect(analysis.aisles.length).toBeGreaterThanOrEqual(fixedAisleCount + refinedDistributedCount);
            expect(analysis.targetAisles).toBe(analysis.aisles.length);
        });
    });

    it('prioritizes the highest occupancy overloaded tapered boundaries when refining measured egress caps', () => {
        const fixture = buildRendererBowlFixture('Full', {
            width: 85,
            length: 200,
            radius: 16,
            corner: 'Chamfer',
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const rows = buildTierRows({ count: 20, startX: 2.75, treadDepth: 2.75 });
        const egressParams = {
            seatWidthIn: 19,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 66,
            egressFactor: 0.2,
            seatsBetweenAisles: 40
        };
        const baseline = buildRowMatchedDeterministicBaseline({ fixture, rows, egressParams });
        const legalMaxOccupantsPerAisle = computeMaximumOccupantsPerAisle({
            maxAisleWidthIn: egressParams.maxAisleWidthIn,
            egressFactor: egressParams.egressFactor
        });
        const refinement = __testHooks.buildMeasuredEgressCapRefinement({
            perimeterModel: baseline.perimeterModel,
            referencePaths: baseline.referencePaths,
            sectionSummary: baseline.summary,
            aisles: baseline.tierLayout.aisles,
            maxOccupantsPerAisle: legalMaxOccupantsPerAisle
        });
        const topPressure = refinement.intervalPressures[0];
        const shortStraightPressure = refinement.intervalPressures.find((pressure) => pressure.intervalIndex === 1);

        expect(baseline.summary.topologyValid).toBe(true);
        expect(baseline.summary.measurementValid).toBe(true);
        expect(baseline.summary.compliance.seatCapCompliant).toBe(true);
        expect(baseline.summary.compliance.egressCapCompliant).toBe(false);
        expect(legalMaxOccupantsPerAisle).toBe(330);
        expect(topPressure.family).toBe('chamfer');
        expect(topPressure.currentCount).toBe(0);
        expect(topPressure.totalBoundaryOccupancy).toBeGreaterThan(shortStraightPressure.totalBoundaryOccupancy);
        expect(topPressure.totalBoundaryDeficit).toBeLessThan(shortStraightPressure.totalBoundaryDeficit);
        expect(refinement.nextCounts[0][0]).toBe(1);
        expect(refinement.nextCounts[0][4]).toBe(1);
        expect(refinement.nextCounts[0][1]).toBe(shortStraightPressure.currentCount);
        expect(refinement.nextCounts[0][5]).toBe(shortStraightPressure.currentCount);
    });

    it('keeps compliant deterministic full-chamfer distributions stable as seat caps relax under the same egress limit', () => {
        const cases = [
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 85,
                    length: 200,
                    radius: 16,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 20, startX: 2.75, treadDepth: 2.75 })
            },
            {
                fixture: buildRendererBowlFixture('Full', {
                    width: 80,
                    length: 190,
                    radius: 16,
                    corner: 'Chamfer',
                    straightAisleMode: 'perpendicular',
                    chamferAisleMode: 'radial'
                }),
                rows: buildTierRows({ count: 20, startX: 2.75, treadDepth: 2.75 })
            }
        ];
        const baseParams = {
            seatWidthIn: 19,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 66,
            egressFactor: 0.2
        };

        cases.forEach(({ fixture, rows }) => {
            const seatCaps = [30, 40, 50];
            const analyses = seatCaps.map((seatsBetweenAisles) => buildTierAisleAnalysisForFixture({
                fixture,
                rows,
                egressParams: {
                    ...baseParams,
                    seatsBetweenAisles
                }
            }));
            const distributions = analyses.map((analysis) => countDistributedAislesBySegment(analysis));
            const shortStraightCounts = distributions.map((counts) => (counts[1] || 0) + (counts[5] || 0));
            const legalMaxOccupantsPerAisle = computeMaximumOccupantsPerAisle({
                maxAisleWidthIn: baseParams.maxAisleWidthIn,
                egressFactor: baseParams.egressFactor
            });

            analyses.forEach((analysis) => {
                expect(analysis.sectionSummary.topologyValid).toBe(true);
                expect(analysis.sectionSummary.measurementValid).toBe(true);
                expect(analysis.sectionSummary.compliance.isCompliant).toBe(true);
                analysis.sectionSummary.aisles.forEach((aisle) => {
                    expect(aisle.tributaryOccupancy).toBeLessThanOrEqual(legalMaxOccupantsPerAisle + 1e-9);
                });
            });

            expect(distributions[1]).toEqual(distributions[0]);
            expect(distributions[2]).toEqual(distributions[0]);
            expect(analyses[1].aisles.length).toBe(analyses[0].aisles.length);
            expect(analyses[2].aisles.length).toBe(analyses[0].aisles.length);
            expect(shortStraightCounts[1]).toBe(shortStraightCounts[0]);
            expect(shortStraightCounts[2]).toBe(shortStraightCounts[0]);
        });
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
            reportedOccupancyAllTiers: tierLayout.sectionSummary.tierSeatCount,
            accessibilityOccupancyContributionAllTiers: 0,
            totalAislesAllTiers: tierLayout.sectionSummary.actualAisles,
            totalSectionsAllTiers: tierLayout.sectionSummary.actualSections,
            tierSeatCounts: [{
                tierIndex: 0,
                tierSeatCount: tierLayout.sectionSummary.tierSeatCount
            }],
            accessibility: {
                baseSeatCount: tierLayout.sectionSummary.tierSeatCount,
                companionSeatsPerWheelchairSpace: 0,
                wheelchairSpaceAreaSqFt: 0,
                companionSpaceAreaSqFt: 0,
                wheelchairSpacesRequired: 0,
                companionSeatsRequired: 0,
                wheelchairSpacesAreaSqFt: 0,
                companionSpacesAreaSqFt: 0,
                totalAccessibilityAreaSqFt: 0,
                wheelchairLocationsRequired: 0,
                accessibilityOccupancyContribution: 0,
                reportedOccupancy: tierLayout.sectionSummary.tierSeatCount,
                tiers: [{
                    tierIndex: 0,
                    baseSeatCount: tierLayout.sectionSummary.tierSeatCount,
                    wheelchairSpacesRequired: 0,
                    companionSeatsRequired: 0,
                    wheelchairSpacesAreaSqFt: 0,
                    companionSpacesAreaSqFt: 0,
                    totalAccessibilityAreaSqFt: 0,
                    wheelchairLocationsRequired: 0,
                    accessibilityOccupancyContribution: 0,
                    reportedOccupancy: tierLayout.sectionSummary.tierSeatCount
                }]
            },
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

    it('classifies baseball terminal legs as straight intervals so the shared straight-aisle contract applies across the full path', () => {
        const fixture = buildBaseballArcFixture('BaseballStandard', {
            radius: 18,
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const renderer = Object.create(FieldRenderer.prototype);
        const perimeterModel = __testHooks.buildPerimeterModel(
            buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, 0)),
            buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, 0)),
            fixture.bowlConfig
        );
        const rows = buildTierRows({ count: 20, startX: 12, treadDepth: 2.5 });
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
                seatsBetweenAisles: 20
            },
            getPathsForOffset: (offset) => buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, offset)),
            getRowLengthFt: (offset) => renderer.calculateRowLength(fixture.bowlConfig, offset)
        });
        const chamferCache = new Map();
        const getPathsForOffset = (offset) => buildGeometryPaths(renderer._getBowlGeometry(fixture.bowlConfig, offset));
        const aisleReferenceMap = buildTierAisleReferenceMap({
            rows,
            tierLayout,
            offsetCorrection: 0,
            getPathsForOffset,
            chamferCache
        });
        const firstRow = rows[0];
        const frontPath = getPathsForOffset(firstRow.x - firstRow.tread_depth)[0];
        const backPath = getPathsForOffset(firstRow.x)[0];
        const perpendicularAisleIndexes = tierLayout.aisles
            .map((aisle, index) => ({ aisle, index }))
            .filter(({ aisle }) => aisle?.alignmentMode === 'perpendicular' && aisle?.forced !== true)
            .map(({ index }) => index);

        expect(perimeterModel.paths[0].intervals.map((interval) => interval.family)).toEqual([
            'straight',
            'straight',
            'straight'
        ]);
        expect(tierLayout.aisles.some((aisle) => aisle?.anchorType === 'open_edge_terminal' && aisle?.edge === 'start')).toBe(true);
        expect(tierLayout.aisles.some((aisle) => aisle?.anchorType === 'open_edge_terminal' && aisle?.edge === 'end')).toBe(true);
        expect(perpendicularAisleIndexes.length).toBeGreaterThan(2);

        perpendicularAisleIndexes.forEach((aisleIndex) => {
            const aisle = tierLayout.aisles[aisleIndex];
            const ratios = resolveTierAisleStationRatios(
                frontPath,
                backPath,
                aisle,
                aisleIndex,
                chamferCache,
                aisleReferenceMap,
                tierLayout
            );
            const widthFt = tierLayout.sectionSummary.aisles[aisleIndex].renderedWidthFt;
            const frontBand = sampleAisleBand(frontPath, ratios.uFront, widthFt);
            const backBand = sampleAisleBand(backPath, ratios.uBack, widthFt);

            expect(frontBand).not.toBeNull();
            expect(backBand).not.toBeNull();
            expect(Math.hypot(
                backBand.center.x - frontBand.center.x,
                backBand.center.y - frontBand.center.y
            )).toBeGreaterThan(0);
        });
    });
});
