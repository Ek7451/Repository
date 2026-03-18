import { describe, expect, it, vi } from 'vitest';

import { FieldRenderer } from '../../viz/field-renderer.js';
import {
    buildGeometryPaths,
    resolveAisleStationRatios,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';

function createTierSolver({ tierIndex = 0 } = {}) {
    return {
        tierIndex,
        rows: [
            { x: 24, tread_depth: 3 },
            { x: 27, tread_depth: 3 },
            { x: 30, tread_depth: 3 },
            { x: 33, tread_depth: 3 }
        ]
    };
}

function createFullChamferBowlConfig(overrides = {}) {
    return {
        width: 120,
        length: 180,
        radius: 20,
        corner: 'Chamfer',
        type: 'Full',
        straightAisleMode: 'perpendicular',
        chamferAisleMode: 'radial',
        ...overrides
    };
}

function createTierMetrics() {
    return { numAisles: 8, aisleWidth: 48 };
}

function createEgressParams() {
    return {
        seatWidthIn: 20,
        seatsBetweenAisles: 24,
        egressFactor: 0.2,
        minAisleWidthIn: 48,
        maxAisleWidthIn: 72
    };
}

describe('FieldRenderer helper delegation surface', () => {
    it('preserves sport-based offset correction behavior', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getOffsetCorrection({ width: 120 }, 'Football')).toBe(0);
        expect(renderer.getOffsetCorrection({ width: 120 }, 'Baseball')).toBe(60);
        expect(renderer.getOffsetCorrection({}, 'Baseball')).toBe(0);
    });

    it('derives visual focal Y from the shared field-edge anchor and focal-X sign rules', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getVisualFocalY({ focal_y: -80 }, { x: 15 }, 'Football')).toBe(-95);
        expect(renderer.getVisualFocalY({ focal_y: -42.5 }, { x: 12 }, 'Ice Hockey')).toBe(-54.5);
        expect(renderer.getVisualFocalY({ focal_y: -80 }, { x: -20 }, 'Football')).toBe(-60);
        expect(renderer.getVisualFocalY({ focal_y: 0, field_width: 303.6 }, { x: 10 }, 'Track')).toBeCloseTo(-161.8);
        expect(renderer.getVisualFocalY({ focal_y: 0, field_radius: 325 }, { x: 5 }, 'Baseball')).toBe(-5);
        expect(renderer.getVisualFocalY(null, null, 'Soccer')).toBe(0);
    });

    it('builds tier aisle layouts only for solved tiers with metrics', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer.generateTierAisleLayout = vi.fn((solver, bowlConfig, metrics, offsetCorrection, egressParams) => ({
            solver,
            bowlConfig,
            metrics,
            offsetCorrection,
            egressParams
        }));

        const solvers = [
            { tierIndex: 0, rows: [{ x: 10, tread_depth: 3 }] },
            { tierIndex: 1, rows: [] },
            { rows: [{ x: 20, tread_depth: 4 }] }
        ];
        const tierMetricsByIndex = new Map([
            [0, { numAisles: 4 }],
            [2, { numAisles: 2 }]
        ]);

        const layouts = renderer.buildTierAisleLayouts(
            solvers,
            { width: 100 },
            tierMetricsByIndex,
            8,
            { seatsBetweenAisles: 24 }
        );

        expect(renderer.generateTierAisleLayout).toHaveBeenCalledTimes(2);
        expect(renderer.generateTierAisleLayout).toHaveBeenNthCalledWith(
            1,
            solvers[0],
            { width: 100 },
            { numAisles: 4 },
            8,
            { seatsBetweenAisles: 24 }
        );
        expect(renderer.generateTierAisleLayout).toHaveBeenNthCalledWith(
            2,
            solvers[2],
            { width: 100 },
            { numAisles: 2 },
            8,
            { seatsBetweenAisles: 24 }
        );
        expect(layouts).toHaveLength(2);
        expect(layouts[0].tierIndex).toBe(0);
        expect(layouts[1].tierIndex).toBe(2);
    });

    it('calculates row lengths from the full bowl geometry segments', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer._getBowlGeometry = vi.fn(() => ([
            { cmd: 'moveTo', x: 0, y: 0 },
            { cmd: 'lineTo', x: 3, y: 4 },
            { cmd: 'lineTo', x: 6, y: 4 },
            { cmd: 'closePath' }
        ]));

        expect(renderer.calculateRowLength({ width: 120 }, 10)).toBe(15.21110255092798);
        expect(renderer._getBowlGeometry).toHaveBeenCalledWith({ width: 120 }, 10);
    });

    it('preserves the stable tier layout contract when generating real aisle layouts', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const layout = renderer.generateTierAisleLayout(
            createTierSolver(),
            createFullChamferBowlConfig(),
            createTierMetrics(),
            0,
            createEgressParams()
        );

        expect(layout).toEqual(expect.objectContaining({
            tierIndex: 0,
            aisleWidthFt: 4,
            seatWidthIn: 20,
            targetAisles: expect.any(Number),
            forcedCount: expect.any(Number),
            sectionBoundaries: expect.any(Array),
            axisExclusionFt: expect.any(Number),
            sectionSummary: expect.objectContaining({
                actualAisles: expect.any(Number),
                actualSections: expect.any(Number),
                allSectionPathsClosed: true,
                backRowSectionSeatCounts: expect.any(Array),
                avgBackRowSeatsPerSection: expect.any(Number),
                maxBackRowSeatsPerSection: expect.any(Number),
                minBackRowSeatsPerSection: expect.any(Number)
            })
        }));

        expect(layout.aisles.length).toBe(layout.sectionSummary.actualAisles);
        expect(layout.sectionBoundaries).toHaveLength(1);
        expect(layout.sectionBoundaries[0]).toHaveLength(layout.aisles.length);
        expect(layout.forcedCount).toBe(layout.aisles.filter((aisle) => aisle.forced).length);
        expect(layout.sectionSummary.backRowSectionSeatCounts).toHaveLength(layout.sectionSummary.actualSections);

        expect(layout.aisles.find((aisle) => aisle.forced)).toEqual(expect.objectContaining({
            anchorType: 'forced_chamfer',
            cornerOrdinal: expect.any(Number)
        }));
        expect(layout.aisles.find((aisle) => !aisle.forced)).toEqual(expect.objectContaining({
            anchorType: 'segment_fraction',
            segmentIndex: expect.any(Number),
            segmentT: expect.any(Number),
            alignmentMode: expect.stringMatching(/^(radial|perpendicular)$/)
        }));
        expect(
            layout.aisles
                .filter((aisle) => !aisle.forced)
                .every((aisle) => aisle.alignmentMode === 'radial' || aisle.alignmentMode === 'perpendicular')
        ).toBe(true);
    });

    it('keeps straight perpendicular aisle polygons on one tier-stable axis in plan view', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();
        const bowlConfig = createFullChamferBowlConfig();
        const tierLayout = renderer.generateTierAisleLayout(
            solver,
            bowlConfig,
            createTierMetrics(),
            0,
            createEgressParams()
        );
        const targetAisleIndex = tierLayout.aisles.findIndex((aisle) => !aisle.forced && aisle.alignmentMode === 'perpendicular');

        expect(targetAisleIndex).toBeGreaterThanOrEqual(0);

        const targetAisle = tierLayout.aisles[targetAisleIndex];
        const firstRow = solver.rows[0];
        const lastRow = solver.rows[solver.rows.length - 1];
        const referenceFrontPaths = buildGeometryPaths(
            renderer._getBowlGeometry(bowlConfig, firstRow.x - firstRow.tread_depth)
        );
        const referenceBackPaths = buildGeometryPaths(
            renderer._getBowlGeometry(bowlConfig, lastRow.x)
        );
        const pathIndex = Math.max(0, Math.floor(Number(targetAisle.pathIndex) || 0));
        const referenceRatios = resolveAisleStationRatios(
            referenceFrontPaths[pathIndex],
            referenceBackPaths[pathIndex],
            targetAisle,
            new Map()
        );

        expect(referenceRatios).not.toBeNull();

        const referenceFrontPoint = samplePathPointByRatio(referenceFrontPaths[pathIndex], referenceRatios.uFront);
        const referenceBackPoint = samplePathPointByRatio(referenceBackPaths[pathIndex], referenceRatios.uBack);
        const polygons = renderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, 0)
            .filter((polygon) => polygon.aisleIndex === targetAisleIndex);

        expect(polygons).toHaveLength(solver.rows.length);

        const centers = polygons.flatMap((polygon) => ([
            {
                x: (polygon.points[0].x + polygon.points[1].x) * 0.5,
                y: (polygon.points[0].y + polygon.points[1].y) * 0.5
            },
            {
                x: (polygon.points[2].x + polygon.points[3].x) * 0.5,
                y: (polygon.points[2].y + polygon.points[3].y) * 0.5
            }
        ]));
        const spreadX = Math.max(...centers.map((point) => point.x)) - Math.min(...centers.map((point) => point.x));
        const spreadY = Math.max(...centers.map((point) => point.y)) - Math.min(...centers.map((point) => point.y));

        if (Math.abs(referenceFrontPoint.x - referenceBackPoint.x) <= 1e-4) {
            expect(spreadX).toBeLessThan(1e-3);
        } else {
            expect(Math.abs(referenceFrontPoint.y - referenceBackPoint.y)).toBeLessThanOrEqual(1e-4);
            expect(spreadY).toBeLessThan(1e-3);
        }
    });
});
