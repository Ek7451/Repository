import { describe, expect, it, vi } from 'vitest';

import {
    FieldRenderer,
    buildBowlGeometrySegments,
    buildBowlGeometrySubpaths,
    buildFieldGeometrySegments,
    buildBowlBandPolygons
} from '../../viz/field-renderer.js';
import {
    buildGeometryPaths,
    resolveAisleStationRatios,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';
import { resolvePlanFocalYFt } from '../../core/sports-templates.js';

vi.mock('three', async () => import('../../lib/three.module.js'));

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
    return { numAisles: 8, aisleWidth: 48, occupantsPerAisleLine: 80 };
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

function createFieldTemplateCases() {
    return [
        {
            shape: 'rectangle',
            field_length: 360,
            field_width: 160
        },
        {
            shape: 'rounded_rect',
            field_length: 200,
            field_width: 85,
            corner_radius: 28
        },
        {
            shape: 'oval',
            straight_length: 580.5,
            field_width: 303.6,
            corner_radius: 120
        },
        {
            shape: 'arc',
            field_radius: 325,
            arc_angle: 90
        }
    ];
}

function createSharedBowlGeometryCases() {
    return [
        createFullChamferBowlConfig({ corner: 'Square', radius: 0 }),
        createFullChamferBowlConfig({ corner: 'Chamfer', radius: 18 }),
        createFullChamferBowlConfig({ corner: 'Radius', radius: 18 }),
        createFullChamferBowlConfig({ type: 'U-End1', corner: 'Chamfer', radius: 18 }),
        createFullChamferBowlConfig({ type: 'Sides', corner: 'Radius', radius: 18 }),
        {
            shape: 'arc',
            radius_arc: 325,
            arc_angle: 90,
            type: 'Full'
        }
    ];
}

function subpathIsClosed(points = []) {
    if (!Array.isArray(points) || points.length < 2) return false;
    const first = points[0];
    const last = points[points.length - 1];
    return Math.abs((first?.x || 0) - (last?.x || 0)) < 1e-9
        && Math.abs((first?.y || 0) - (last?.y || 0)) < 1e-9;
}

function normalizeAnglePi(angle) {
    let normalized = Number(angle) || 0;
    while (normalized <= -Math.PI) normalized += Math.PI * 2;
    while (normalized > Math.PI) normalized -= Math.PI * 2;
    return normalized;
}

function isReadableLabelAngle(angle) {
    const normalized = normalizeAnglePi(angle);
    const baselineX = Math.cos(normalized);
    const bottomX = Math.sin(normalized);
    const bottomY = Math.cos(normalized);
    return baselineX >= -1e-6
        && (bottomY >= -1e-6 || (Math.abs(bottomY) <= 1e-6 && bottomX >= -1e-6));
}

function smallestAngleDistance(a, b) {
    return Math.abs(normalizeAnglePi((Number(a) || 0) - (Number(b) || 0)));
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

    it('builds shared field perimeter segments across supported template shapes', () => {
        createFieldTemplateCases().forEach((template) => {
            const baseSegments = buildFieldGeometrySegments(template, 0);
            const expandedSegments = buildFieldGeometrySegments(template, 5);
            const hasClosedBaseContour = baseSegments.some((segment) => segment.cmd === 'closePath')
                || baseSegments[baseSegments.length - 1]?.cmd === 'lineTo';
            const hasClosedExpandedContour = expandedSegments.some((segment) => segment.cmd === 'closePath')
                || expandedSegments[expandedSegments.length - 1]?.cmd === 'lineTo';

            expect(baseSegments.length).toBeGreaterThan(0);
            expect(baseSegments[0]).toEqual(expect.objectContaining({ cmd: 'moveTo' }));
            expect(hasClosedBaseContour).toBe(true);
            expect(expandedSegments.length).toBeGreaterThan(0);
            expect(expandedSegments[0]).toEqual(expect.objectContaining({ cmd: 'moveTo' }));
            expect(hasClosedExpandedContour).toBe(true);
        });
    });

    it('draws runoff and field edge beneath seating in plan view', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const callOrder = [];
        renderer.canvas = { width: 800, height: 600 };
        renderer.ctx = {
            clearRect: vi.fn(),
            fillStyle: '',
            fillRect: vi.fn(),
            save: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            restore: vi.fn()
        };
        renderer._userHasZoomed = false;
        renderer._drawGrid = vi.fn();
        renderer._drawLegend = vi.fn();
        renderer._getBounds = vi.fn(() => ({
            minX: -100,
            maxX: 100,
            minY: -50,
            maxY: 50
        }));
        renderer._calcScale = vi.fn(() => 1);
        renderer._drawShape = vi.fn((_ctx, _template, extraRunoff) => {
            callOrder.push(extraRunoff > 0 ? 'runoff' : 'field');
        });
        renderer._drawSeating = vi.fn(() => {
            callOrder.push('seating');
        });
        renderer._drawFocalPoint = vi.fn(() => {
            callOrder.push('focal');
        });

        renderer.render(
            {
                shape: 'rectangle',
                field_length: 360,
                field_width: 160,
                runoff: 10
            },
            null,
            [createTierSolver()],
            { showSeating: true, t1: true, t2: false, t3: false },
            0,
            createFullChamferBowlConfig(),
            0,
            []
        );

        expect(callOrder).toEqual(['runoff', 'field', 'seating', 'focal']);
    });

    it('keeps the plan-view focal marker on the field centerline', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const ctx = {
            save: vi.fn(),
            restore: vi.fn(),
            setLineDash: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            arc: vi.fn()
        };

        renderer._drawFocalPoint(
            ctx,
            { focal_x: -10, focal_y: -42.5 },
            1,
            -54.5
        );

        expect(ctx.moveTo).toHaveBeenNthCalledWith(1, -8, -54.5);
        expect(ctx.lineTo).toHaveBeenNthCalledWith(1, 8, -54.5);
        expect(ctx.moveTo).toHaveBeenNthCalledWith(2, 0, -62.5);
        expect(ctx.lineTo).toHaveBeenNthCalledWith(2, 0, -46.5);
        expect(ctx.arc).toHaveBeenCalledWith(0, -54.5, 4.8, 0, Math.PI * 2);
    });

    it('shares bowl geometry segments across renderer consumers for supported bowl families', async () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const { Scene3D } = await import('../../viz/scene3d.js');
        const scene = Object.create(Scene3D.prototype);

        createSharedBowlGeometryCases().forEach((bowlConfig) => {
            [0, 6, 18].forEach((offset) => {
                expect(renderer.getBowlGeometrySegments(bowlConfig, offset)).toEqual(
                    buildBowlGeometrySegments(bowlConfig, offset)
                );
                expect(scene.getBowlGeometrySegments(bowlConfig, offset)).toEqual(
                    buildBowlGeometrySegments(bowlConfig, offset)
                );
            });
        });
    });

    it('anchors chamfer slider values at the interior reference edge while preserving 45-degree growth outward', () => {
        const bowlConfig = createFullChamferBowlConfig({
            width: 160,
            length: 360,
            radius: 5,
            chamferReferenceOffset: 30
        });

        const interiorSegments = buildBowlGeometrySegments(bowlConfig, 30);
        const outerSegments = buildBowlGeometrySegments(bowlConfig, 42);
        const interiorHalfWidth = (bowlConfig.width / 2) + 30;
        const interiorHalfLength = (bowlConfig.length / 2) + 30;
        const outerHalfWidth = (bowlConfig.width / 2) + 42;
        const outerHalfLength = (bowlConfig.length / 2) + 42;
        const expectedOuterLeg = 5 + ((42 - 30) * 0.5858);

        expect(interiorSegments[0]).toEqual({
            cmd: 'moveTo',
            x: interiorHalfLength - 5,
            y: interiorHalfWidth
        });
        expect(interiorSegments[1]).toEqual({
            cmd: 'lineTo',
            x: interiorHalfLength,
            y: interiorHalfWidth - 5
        });

        expect(outerSegments[0].x).toBeCloseTo(outerHalfLength - expectedOuterLeg);
        expect(outerSegments[0].y).toBeCloseTo(outerHalfWidth);
        expect(outerSegments[1].x).toBeCloseTo(outerHalfLength);
        expect(outerSegments[1].y).toBeCloseTo(outerHalfWidth - expectedOuterLeg);
    });

    it('accepts the renamed human-readable bowl type aliases without changing geometry output', () => {
        const cShapeConfig = createFullChamferBowlConfig({ type: 'C-Shape', corner: 'Chamfer', radius: 18 });
        const uShapeConfig = createFullChamferBowlConfig({ type: 'U-Shape', corner: 'Radius', radius: 18 });

        expect(buildBowlGeometrySegments(cShapeConfig, 6)).toEqual(
            buildBowlGeometrySegments(createFullChamferBowlConfig({ type: 'U-End1', corner: 'Chamfer', radius: 18 }), 6)
        );
        expect(buildBowlGeometrySegments(uShapeConfig, 6)).toEqual(
            buildBowlGeometrySegments(createFullChamferBowlConfig({ type: 'U-End2', corner: 'Radius', radius: 18 }), 6)
        );
    });

    it('builds row band polygons from both front and back offsets across bowl families', () => {
        createSharedBowlGeometryCases().forEach((bowlConfig) => {
            const frontOffset = 9;
            const backOffset = 12;
            const frontSubpaths = buildBowlGeometrySubpaths(bowlConfig, frontOffset);
            const backSubpaths = buildBowlGeometrySubpaths(bowlConfig, backOffset);
            const polygons = buildBowlBandPolygons(bowlConfig, frontOffset, backOffset);

            expect(polygons.length).toBe(Math.min(frontSubpaths.length, backSubpaths.length));

            polygons.forEach((polygon, index) => {
                const frontPath = frontSubpaths[index];
                const backPath = backSubpaths[index];
                const expectClosedBand = subpathIsClosed(frontPath) && subpathIsClosed(backPath);

                expect(polygon.points.length).toBe(frontPath.length + backPath.length);
                expect(polygon.points[0]).toEqual(frontPath[0]);
                expect(polygon.points[frontPath.length - 1]).toEqual(frontPath[frontPath.length - 1]);
                expect(polygon.points[frontPath.length]).toEqual(backPath[backPath.length - 1]);
                expect(polygon.points[polygon.points.length - 1]).toEqual(backPath[0]);

                if (expectClosedBand) {
                    expect(frontPath[0]).toEqual(frontPath[frontPath.length - 1]);
                    expect(backPath[0]).toEqual(backPath[backPath.length - 1]);
                    expect(polygon.points[frontPath.length - 1]).toEqual(polygon.points[0]);
                    expect(polygon.points[polygon.points.length - 1]).toEqual(backPath[0]);
                }
            });
        });
    });

    it('builds tier aisle layouts for solved tiers with rows and ignores metrics as a truth source', () => {
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
            null,
            8,
            { seatsBetweenAisles: 24 }
        );
        expect(renderer.generateTierAisleLayout).toHaveBeenNthCalledWith(
            2,
            solvers[2],
            { width: 100 },
            null,
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
            aisleWidthFt: expect.any(Number),
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
                aisleOccupancyTotals: expect.any(Array),
                sectionOccupancyTotals: expect.any(Array),
                avgBackRowSeatsPerSection: expect.any(Number),
                maxBackRowSeatsPerSection: expect.any(Number),
                minBackRowSeatsPerSection: expect.any(Number),
                requiredWidthIn: expect.any(Number),
                governingWidthIn: expect.any(Number),
                renderedAisleWidthIn: expect.any(Number),
                rowSummaries: expect.any(Array),
                tierSeatCount: expect.any(Number),
                maxRenderedAisleWidthIn: expect.any(Number),
                compliance: expect.objectContaining({
                    seatCapCompliant: expect.any(Boolean),
                    egressCapCompliant: expect.any(Boolean),
                    renderedWidthCompliant: expect.any(Boolean),
                    isCompliant: expect.any(Boolean)
                }),
                aisles: expect.any(Array),
                sections: expect.any(Array)
            })
        }));

        expect(layout.aisles.length).toBe(layout.sectionSummary.actualAisles);
        expect(layout.sectionBoundaries).toHaveLength(1);
        expect(layout.sectionBoundaries[0]).toHaveLength(layout.aisles.length);
        expect(layout.forcedCount).toBe(layout.aisles.filter((aisle) => aisle.forced).length);
        expect(layout.sectionSummary.backRowSectionSeatCounts).toHaveLength(layout.sectionSummary.actualSections);
        expect(layout.sectionSummary.sectionOccupancyTotals).toHaveLength(layout.sectionSummary.actualSections);
        expect(layout.sectionSummary.aisles).toHaveLength(layout.aisles.length);

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
        expect(layout.sectionSummary.aisles.find((aisle) => Number.isFinite(aisle.tributaryOccupancy))).toEqual(expect.objectContaining({
            tributaryOccupancy: expect.any(Number),
            requiredWidthIn: expect.any(Number),
            governingWidthIn: expect.any(Number)
        }));
        expect(
            layout.aisles
                .filter((aisle) => !aisle.forced)
                .every((aisle) => aisle.alignmentMode === 'radial' || aisle.alignmentMode === 'perpendicular')
        ).toBe(true);
    });

    it('builds aisle metric labels from precomputed aisle values', () => {
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
        const targetAisleIndex = tierLayout.sectionSummary.aisles.findIndex((aisle) => (
            Number.isFinite(aisle?.tributaryOccupancy)
        ));
        tierLayout.sectionSummary.aisles[targetAisleIndex].tributaryOccupancy = 123.50000000000001;
        tierLayout.sectionSummary.aisles[targetAisleIndex].governingWidthIn = 48.300000000000004;

        const overlay = renderer._getTierAisleMetricLabelData(solver, bowlConfig, tierLayout, 0);

        expect(overlay.occupancyLabels.length).toBeGreaterThan(0);
        expect(overlay.widthLabels).toHaveLength(tierLayout.aisles.length);
        expect(overlay.occupancyLabels[targetAisleIndex]).toEqual(expect.objectContaining({
            text: '123.5occ',
            rotationRad: expect.any(Number),
            arrow: expect.objectContaining({
                direction: expect.any(Number)
            })
        }));
        expect(overlay.widthLabels[targetAisleIndex]).toEqual(expect.objectContaining({
            text: '48.3"',
            rotationRad: expect.any(Number)
        }));
        expect(isReadableLabelAngle(overlay.occupancyLabels[targetAisleIndex].rotationRad)).toBe(true);
        expect(Math.abs(overlay.occupancyLabels[targetAisleIndex].arrow.direction)).toBe(1);
        expect(isReadableLabelAngle(overlay.widthLabels[targetAisleIndex].rotationRad)).toBe(true);
        expect(
            Math.abs(smallestAngleDistance(
                overlay.widthLabels[targetAisleIndex].rotationRad,
                overlay.occupancyLabels[targetAisleIndex].rotationRad
            ) - (Math.PI * 0.5))
        ).toBeLessThan(0.25);
    });

    it('renders aisle polygons from rendered widths while width labels stay on governing widths', () => {
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
        const baselineOverlay = renderer._getTierAisleMetricLabelData(solver, bowlConfig, tierLayout, 0);
        const baselinePolygons = renderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, 0)
            .filter((polygon) => polygon.aisleIndex === 0);
        tierLayout.sectionSummary.aisles[0].renderedWidthIn = 60;
        tierLayout.sectionSummary.aisles[0].renderedWidthFt = 5;
        tierLayout.sectionSummary.maxRenderedAisleWidthIn = Math.max(
            60,
            Number(tierLayout.sectionSummary.maxRenderedAisleWidthIn) || 0
        );

        const polygons = renderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, 0)
            .filter((polygon) => polygon.aisleIndex === 0);
        const overlay = renderer._getTierAisleMetricLabelData(solver, bowlConfig, tierLayout, 0);
        const baselineFrontWidthFt = Math.hypot(
            baselinePolygons[0].points[0].x - baselinePolygons[0].points[1].x,
            baselinePolygons[0].points[0].y - baselinePolygons[0].points[1].y
        );
        const firstPolygon = polygons[0];
        const frontWidthFt = Math.hypot(
            firstPolygon.points[0].x - firstPolygon.points[1].x,
            firstPolygon.points[0].y - firstPolygon.points[1].y
        );

        expect(polygons.length).toBeGreaterThan(0);
        expect(frontWidthFt).toBeGreaterThan(baselineFrontWidthFt + 0.3);
        expect(overlay.widthLabels[0]).toEqual(expect.objectContaining({
            text: baselineOverlay.widthLabels[0].text
        }));
        expect(overlay.widthLabels[0].text).not.toBe('60"');
    });

    it('builds section overlays from U-end terminal aisle summaries instead of edge slivers', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();
        const bowlConfig = createFullChamferBowlConfig({
            type: 'U-End1',
            width: 85,
            length: 200,
            radius: 28
        });
        const tierLayout = renderer.generateTierAisleLayout(
            solver,
            bowlConfig,
            createTierMetrics(),
            0,
            createEgressParams()
        );

        const overlay = renderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, 0);
        const sections = tierLayout.sectionSummary.sections;
        const firstSection = sections[0];
        const lastSection = sections[sections.length - 1];

        expect(tierLayout.aisles[0]).toEqual(expect.objectContaining({
            anchorType: 'open_edge_terminal',
            edge: 'start'
        }));
        expect(tierLayout.aisles[tierLayout.aisles.length - 1]).toEqual(expect.objectContaining({
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
        expect(overlay.sectionLabels.length).toBe(sections.length);
        expect(overlay.rowSeatLabels.some((label) => label.slotIndex === firstSection.slotIndex)).toBe(true);
        expect(overlay.rowSeatLabels.some((label) => label.slotIndex === lastSection.slotIndex)).toBe(true);
        expect(overlay.rowSeatLabels.every((label) => Number.isFinite(label.rotationRad))).toBe(true);
        expect(overlay.rowSeatLabels.every((label) => isReadableLabelAngle(label.rotationRad))).toBe(true);
    });

    it('renders U-end terminal aisle polygons flush to the open segment edge', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();
        const bowlConfig = createFullChamferBowlConfig({
            type: 'U-End1',
            width: 85,
            length: 200,
            radius: 28,
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        const tierLayout = renderer.generateTierAisleLayout(
            solver,
            bowlConfig,
            createTierMetrics(),
            0,
            createEgressParams()
        );
        const polygons = renderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, 0)
            .filter((polygon) => polygon.aisleIndex === 0);

        expect(tierLayout.aisles[0]).toEqual(expect.objectContaining({
            anchorType: 'open_edge_terminal',
            edge: 'start'
        }));
        expect(polygons).toHaveLength(solver.rows.length);

        polygons.forEach((polygon, rowIndex) => {
            const row = solver.rows[rowIndex];
            const frontPaths = buildGeometryPaths(
                renderer._getBowlGeometry(bowlConfig, row.x - row.tread_depth)
            );
            const backPaths = buildGeometryPaths(
                renderer._getBowlGeometry(bowlConfig, row.x)
            );
            const pathIndex = tierLayout.aisles[0].pathIndex;
            const frontPath = frontPaths[pathIndex];
            const backPath = backPaths[pathIndex];
            const frontOuterX = Math.max(polygon.points[0].x, polygon.points[1].x);
            const backOuterX = Math.max(polygon.points[2].x, polygon.points[3].x);

            expect(frontOuterX).toBeCloseTo(frontPath.startX, 6);
            expect(backOuterX).toBeCloseTo(backPath.startX, 6);
        });
    });

    it('renders side-run terminal aisle polygons flush to the open segment edge', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();

        ['Side1', 'Side2', 'Sides'].forEach((type) => {
            const bowlConfig = createFullChamferBowlConfig({
                type,
                width: 85,
                length: 200,
                radius: 0,
                corner: 'None',
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            });
            const tierLayout = renderer.generateTierAisleLayout(
                solver,
                bowlConfig,
                createTierMetrics(),
                0,
                createEgressParams()
            );

            const firstAislesByPath = new Map();
            tierLayout.aisles.forEach((aisle, aisleIndex) => {
                if (aisle.anchorType !== 'distributed_linear_even') return;
                const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
                const current = firstAislesByPath.get(pathIndex);
                if (!current || (Number(aisle.u) || 0) < (Number(current.aisle.u) || 0)) {
                    firstAislesByPath.set(pathIndex, { aisle, aisleIndex });
                }
            });

            firstAislesByPath.forEach(({ aisleIndex }, pathIndex) => {
                const polygons = renderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, 0)
                    .filter((polygon) => polygon.aisleIndex === aisleIndex);

                expect(polygons).toHaveLength(solver.rows.length);

                polygons.forEach((polygon, rowIndex) => {
                    const row = solver.rows[rowIndex];
                    const frontPaths = buildGeometryPaths(
                        renderer._getBowlGeometry(bowlConfig, row.x - row.tread_depth)
                    );
                    const backPaths = buildGeometryPaths(
                        renderer._getBowlGeometry(bowlConfig, row.x)
                    );
                    const frontPath = frontPaths[pathIndex];
                    const backPath = backPaths[pathIndex];
                    const frontOuterX = Math.min(polygon.points[0].x, polygon.points[1].x);
                    const backOuterX = Math.min(polygon.points[2].x, polygon.points[3].x);

                    expect(frontOuterX).toBeCloseTo(frontPath.startX, 6);
                    expect(backOuterX).toBeCloseTo(backPath.startX, 6);
                });
            });
        });
    });

    it('anchors row seat-count labels to the section start-side aisle instead of screen-right heuristics', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();
        const bowlConfig = createFullChamferBowlConfig({
            type: 'U-End1',
            width: 85,
            length: 200,
            radius: 28
        });
        const tierLayout = renderer.generateTierAisleLayout(
            solver,
            bowlConfig,
            createTierMetrics(),
            0,
            createEgressParams()
        );
        const overlay = renderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, 0);
        const targetSection = tierLayout.sectionSummary.sections.find((section) => (
            section.startBoundaryKind === 'aisle'
            && Number.isFinite(section.aisleIndexA)
            && Number.isFinite(section.aisleIndexB)
        ));
        expect(targetSection).toBeTruthy();
        const targetLabel = overlay.rowSeatLabels.find((label) => (
            label.slotIndex === targetSection?.slotIndex && label.rowIndex === 0
        ));
        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(renderer._getBowlGeometry(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };
        const chamferCache = new Map();
        const aisleReferenceMap = renderer._buildTierAisleReferenceMap(
            solver,
            bowlConfig,
            tierLayout,
            0,
            getPathsForOffset,
            chamferCache
        );
        const row = solver.rows[0];
        const centerOffset = row.x - (row.tread_depth * 0.5);
        const sampledRow = renderer._pickBestRowLabelSampling(
            centerOffset,
            getPathsForOffset,
            tierLayout,
            chamferCache,
            aisleReferenceMap
        );
        expect(targetLabel).toBeTruthy();
        const path = sampledRow.paths[targetLabel.pathIndex];
        const aisleMap = sampledRow.aisleRatiosByPath.get(targetLabel.pathIndex);
        const startU = aisleMap.get(targetSection.aisleIndexA);
        const endU = aisleMap.get(targetSection.aisleIndexB);
        const startPoint = samplePathPointByRatio(path, startU);
        const endPoint = samplePathPointByRatio(path, endU);
        const startDistance = Math.hypot(targetLabel.x - startPoint.x, targetLabel.y - startPoint.y);
        const endDistance = Math.hypot(targetLabel.x - endPoint.x, targetLabel.y - endPoint.y);

        expect(startDistance).toBeLessThan(endDistance);
    });

    it('gates row, section-occupancy, and aisle detail labels at their configured zoom thresholds', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer._drawWorldTextLabel = vi.fn();
        renderer.getTierSectionMetricsOverlayData = vi.fn(() => ({
            sectionLabels: [{ x: 12, y: 18, text: '#101', occText: '240occ' }],
            rowSeatLabels: [{ x: 10, y: 14, text: '24', rotationRad: Math.PI / 2 }]
        }));
        renderer._getTierAisleMetricLabelData = vi.fn(() => ({
            occupancyLabels: [{ x: 4, y: 8, text: '120occ', rotationRad: 0, arrow: { direction: 1 } }],
            widthLabels: [{ x: 6, y: 10, text: '48"', rotationRad: Math.PI / 2 }]
        }));

        const ctx = {
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn()
        };

        renderer._drawTierSectionMetrics(
            ctx,
            createTierSolver(),
            createFullChamferBowlConfig(),
            { aisles: [{}, {}], seatWidthIn: 20 },
            0,
            2.9,
            0,
            0
        );

        expect(renderer._getTierAisleMetricLabelData).not.toHaveBeenCalled();
        expect(renderer._drawWorldTextLabel).toHaveBeenCalledTimes(1);

        renderer._drawWorldTextLabel.mockClear();
        renderer._getTierAisleMetricLabelData.mockClear();
        ctx.save.mockClear();
        ctx.restore.mockClear();
        ctx.translate.mockClear();

        renderer._drawTierSectionMetrics(
            ctx,
            createTierSolver(),
            createFullChamferBowlConfig(),
            { aisles: [{}, {}], seatWidthIn: 20 },
            0,
            4.9,
            0,
            0
        );

        expect(renderer._getTierAisleMetricLabelData).not.toHaveBeenCalled();
        expect(renderer._drawWorldTextLabel).toHaveBeenCalledTimes(2);
        expect(ctx.save).toHaveBeenCalledTimes(1);
        expect(ctx.restore).toHaveBeenCalledTimes(1);

        renderer._drawWorldTextLabel.mockClear();
        renderer._getTierAisleMetricLabelData.mockClear();
        ctx.save.mockClear();
        ctx.restore.mockClear();
        ctx.translate.mockClear();

        renderer._drawTierSectionMetrics(
            ctx,
            createTierSolver(),
            createFullChamferBowlConfig(),
            { aisles: [{}, {}], seatWidthIn: 20 },
            0,
            5.1,
            0,
            0
        );

        expect(renderer._getTierAisleMetricLabelData).not.toHaveBeenCalled();
        expect(renderer._drawWorldTextLabel).toHaveBeenCalledTimes(2);
        expect(ctx.save).toHaveBeenCalledTimes(1);
        expect(ctx.restore).toHaveBeenCalledTimes(1);

        renderer._drawWorldTextLabel.mockClear();
        renderer._getTierAisleMetricLabelData.mockClear();
        ctx.save.mockClear();
        ctx.restore.mockClear();
        ctx.translate.mockClear();

        renderer._drawTierSectionMetrics(
            ctx,
            createTierSolver(),
            createFullChamferBowlConfig(),
            { aisles: [{}, {}], seatWidthIn: 20 },
            0,
            7.1,
            0,
            0
        );

        expect(renderer._getTierAisleMetricLabelData).toHaveBeenCalledTimes(1);
        expect(renderer._drawWorldTextLabel).toHaveBeenCalledTimes(5);
        expect(ctx.save).toHaveBeenCalledTimes(2);
        expect(ctx.restore).toHaveBeenCalledTimes(2);
    });

    it('skips label background and border fills when transparent label styling is requested and still draws arrows', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const ctx = {
            save: vi.fn(),
            restore: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            rotate: vi.fn(),
            fillRect: vi.fn(),
            strokeRect: vi.fn(),
            fillText: vi.fn(),
            measureText: vi.fn(() => ({ width: 20 })),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            font: '',
            textAlign: '',
            textBaseline: '',
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0
        };

        renderer._drawWorldTextLabel(ctx, 2, 5, 6, '120occ', {
            bgColor: null,
            borderColor: null,
            rotationRad: Math.PI / 2,
            arrow: { direction: 1 }
        });

        expect(ctx.fillRect).not.toHaveBeenCalled();
        expect(ctx.strokeRect).not.toHaveBeenCalled();
        expect(ctx.fillText).toHaveBeenCalledWith('120occ', 0, 0);
        expect(ctx.beginPath).toHaveBeenCalledTimes(1);
        expect(ctx.moveTo).toHaveBeenCalled();
        expect(ctx.lineTo).toHaveBeenCalled();
        expect(ctx.stroke).toHaveBeenCalledTimes(1);
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

    it('changes distributed chamfer plan-view polygons when the chamfer mode changes', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();
        const egressParams = {
            ...createEgressParams(),
            seatsBetweenAisles: 12
        };
        const radialBowlConfig = createFullChamferBowlConfig({
            straightAisleMode: 'radial',
            chamferAisleMode: 'radial'
        });
        const bowlConfig = createFullChamferBowlConfig({
            straightAisleMode: 'radial',
            chamferAisleMode: 'perpendicular'
        });
        const radialLayout = renderer.generateTierAisleLayout(
            solver,
            radialBowlConfig,
            createTierMetrics(),
            0,
            egressParams
        );
        const tierLayout = renderer.generateTierAisleLayout(
            solver,
            bowlConfig,
            createTierMetrics(),
            0,
            egressParams
        );
        const radialAisleIndex = radialLayout.aisles.findIndex((aisle) => (
            !aisle.forced &&
            aisle.segmentIndex === 0 &&
            aisle.segmentT < 0.5
        ));
        const radialAisle = radialLayout.aisles[radialAisleIndex];
        const targetAisleIndex = tierLayout.aisles.findIndex((aisle) => (
            !aisle.forced &&
            aisle.segmentIndex === radialAisle?.segmentIndex &&
            aisle.segmentT === radialAisle?.segmentT &&
            aisle.alignmentMode === 'perpendicular'
        ));

        expect(radialAisleIndex).toBeGreaterThanOrEqual(0);
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
        const radialPolygons = renderer.getTierAisleBandPolygons(solver, radialBowlConfig, radialLayout, 0)
            .filter((polygon) => polygon.aisleIndex === radialAisleIndex);
        const polygons = renderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, 0)
            .filter((polygon) => polygon.aisleIndex === targetAisleIndex);

        expect(radialPolygons).toHaveLength(solver.rows.length);
        expect(polygons).toHaveLength(solver.rows.length);

        const referenceDot =
            ((referenceBackPoint.x - referenceFrontPoint.x) * referenceFrontPoint.tx) +
            ((referenceBackPoint.y - referenceFrontPoint.y) * referenceFrontPoint.ty);
        expect(Math.abs(referenceDot)).toBeLessThan(1e-3);

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
        const radialCenters = radialPolygons.flatMap((polygon) => ([
            {
                x: (polygon.points[0].x + polygon.points[1].x) * 0.5,
                y: (polygon.points[0].y + polygon.points[1].y) * 0.5
            },
            {
                x: (polygon.points[2].x + polygon.points[3].x) * 0.5,
                y: (polygon.points[2].y + polygon.points[3].y) * 0.5
            }
        ]));
        const maxCenterDelta = Math.max(...centers.map((point, index) => (
            Math.hypot(
                point.x - radialCenters[index].x,
                point.y - radialCenters[index].y
            )
        )));

        expect(maxCenterDelta).toBeGreaterThan(0.25);
    });

    it('matches scene3d tier-stable perpendicular resolution to the plan-view contract', async () => {
        const fieldRenderer = Object.create(FieldRenderer.prototype);
        const { Scene3D } = await import('../../viz/scene3d.js');
        const scene = Object.create(Scene3D.prototype);
        const solver = createTierSolver();
        const cases = [
            {
                bowlConfig: createFullChamferBowlConfig(),
                egressParams: createEgressParams(),
                pickAisle: (aisle) => !aisle.forced && aisle.alignmentMode === 'perpendicular'
            },
            {
                bowlConfig: createFullChamferBowlConfig({
                    straightAisleMode: 'radial',
                    chamferAisleMode: 'perpendicular'
                }),
                egressParams: {
                    ...createEgressParams(),
                    seatsBetweenAisles: 12
                },
                pickAisle: (aisle) => (
                    !aisle.forced &&
                    aisle.segmentIndex === 0 &&
                    aisle.segmentT < 0.5 &&
                    aisle.alignmentMode === 'perpendicular'
                )
            }
        ];

        cases.forEach(({ bowlConfig, egressParams, pickAisle }) => {
            const tierLayout = fieldRenderer.generateTierAisleLayout(
                solver,
                bowlConfig,
                createTierMetrics(),
                0,
                egressParams
            );
            const targetAisleIndex = tierLayout.aisles.findIndex(pickAisle);
            expect(targetAisleIndex).toBeGreaterThanOrEqual(0);

            const getPathsForOffset = (offset) => buildGeometryPaths(
                scene.getBowlGeometrySegments(bowlConfig, offset)
            );
            const fieldChamferCache = new Map();
            const sceneChamferCache = new Map();
            const fieldReferenceMap = fieldRenderer._buildTierAisleReferenceMap(
                solver,
                bowlConfig,
                tierLayout,
                0,
                getPathsForOffset,
                fieldChamferCache
            );
            const sceneReferenceMap = scene._buildTierAisleReferenceMap(
                solver,
                tierLayout,
                0,
                getPathsForOffset,
                sceneChamferCache
            );

            const row = solver.rows[1];
            const pathIndex = Math.max(0, Math.floor(Number(tierLayout.aisles[targetAisleIndex].pathIndex) || 0));
            const frontPaths = getPathsForOffset(row.x - row.tread_depth);
            const backPaths = getPathsForOffset(row.x);
            const fieldRatios = fieldRenderer._resolveTierAisleStationRatios(
                frontPaths[pathIndex],
                backPaths[pathIndex],
                tierLayout.aisles[targetAisleIndex],
                targetAisleIndex,
                tierLayout,
                fieldChamferCache,
                fieldReferenceMap
            );
            const sceneRatios = scene._resolveTierAisleStationRatios(
                frontPaths[pathIndex],
                backPaths[pathIndex],
                tierLayout.aisles[targetAisleIndex],
                targetAisleIndex,
                tierLayout,
                sceneChamferCache,
                sceneReferenceMap
            );

            expect(fieldReferenceMap.get(targetAisleIndex)).toEqual(sceneReferenceMap.get(targetAisleIndex));
            expect(sceneRatios).not.toBeNull();
            expect(fieldRatios).not.toBeNull();
            expect(sceneRatios.uFront).toBeCloseTo(fieldRatios.uFront);
            expect(sceneRatios.uBack).toBeCloseTo(fieldRatios.uBack);
        });
    });

    it('uses rendered aisle widths when building scene3d aisle geometry', async () => {
        const fieldRenderer = Object.create(FieldRenderer.prototype);
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        scene.THREE = THREE;

        const solver = createTierSolver();
        const bowlConfig = createFullChamferBowlConfig();
        const baseLayout = fieldRenderer.generateTierAisleLayout(
            solver,
            bowlConfig,
            createTierMetrics(),
            0,
            createEgressParams()
        );
        const widenedLayout = structuredClone(baseLayout);
        widenedLayout.sectionSummary.aisles[0].renderedWidthIn = 60;
        widenedLayout.sectionSummary.aisles[0].renderedWidthFt = 5;
        widenedLayout.sectionSummary.maxRenderedAisleWidthIn = Math.max(
            60,
            Number(widenedLayout.sectionSummary.maxRenderedAisleWidthIn) || 0
        );

        const baseGeometry = scene._createTierAisleGeometry(solver, bowlConfig, baseLayout, 0);
        const widenedGeometry = scene._createTierAisleGeometry(solver, bowlConfig, widenedLayout, 0);
        const basePositions = baseGeometry.getAttribute('position').array;
        const widenedPositions = widenedGeometry.getAttribute('position').array;
        const baseFrontWidthFt = Math.hypot(
            basePositions[0] - basePositions[3],
            basePositions[2] - basePositions[5]
        );
        const widenedFrontWidthFt = Math.hypot(
            widenedPositions[0] - widenedPositions[3],
            widenedPositions[2] - widenedPositions[5]
        );

        expect(baseGeometry).not.toBeNull();
        expect(widenedGeometry).not.toBeNull();
        expect(widenedFrontWidthFt).toBeGreaterThan(baseFrontWidthFt + 0.3);
    });

    it('keeps the 3d focal marker on the field centerline while preserving depth', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        scene._initialized = true;
        scene.THREE = THREE;
        scene.fieldGroup = {
            children: [],
            add(child) {
                this.children.push(child);
            },
            remove(child) {
                const index = this.children.indexOf(child);
                if (index >= 0) this.children.splice(index, 1);
            }
        };

        const template = {
            shape: 'rectangle',
            field_length: 360,
            field_width: 160,
            runoff: 18,
            focal_x: -10,
            focal_y: -42.5
        };

        scene.updateField(template, null, 9, 18);

        const marker = scene.fieldGroup.children.at(-1);
        expect(marker.position.x).toBe(0);
        expect(marker.position.y).toBe(9);
        expect(marker.position.z).toBeCloseTo(-resolvePlanFocalYFt(template, 18));
    });
});

describe('Scene3D interaction guards', () => {
    it('does not treat middle-button dolly drags as double-click zoom extents', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const scene = Object.create(Scene3D.prototype);
        scene._lastMiddleClickTime = 0;
        scene._middlePointerState = null;

        scene._handleMiddlePointerDown({ button: 1, pointerId: 11, clientX: 100, clientY: 120 });
        scene._handleMiddlePointerMove({ pointerId: 11, clientX: 122, clientY: 148 });
        expect(scene._handleMiddlePointerUp({ button: 1, pointerId: 11 }, 1000)).toBe(false);
        expect(scene._lastMiddleClickTime).toBe(0);

        scene._handleMiddlePointerDown({ button: 1, pointerId: 11, clientX: 100, clientY: 120 });
        expect(scene._handleMiddlePointerUp({ button: 1, pointerId: 11 }, 1300)).toBe(false);

        scene._handleMiddlePointerDown({ button: 1, pointerId: 11, clientX: 100, clientY: 120 });
        expect(scene._handleMiddlePointerUp({ button: 1, pointerId: 11 }, 1500)).toBe(true);
    });

    it('leaves normal camera distances unchanged when stabilizing zoom', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        const updateProjectionMatrix = vi.fn();
        scene.THREE = THREE;
        scene.camera = {
            position: new THREE.Vector3(0, 10, 40),
            near: 1,
            far: 1000,
            updateProjectionMatrix
        };
        scene.controls = {
            target: new THREE.Vector3(0, 10, 0)
        };

        scene._stabilizeCameraDistance();

        expect(scene.camera.position.distanceTo(scene.controls.target)).toBeCloseTo(40);
        expect(scene.camera.position.x).toBeCloseTo(0);
        expect(scene.camera.position.y).toBeCloseTo(10);
        expect(scene.camera.position.z).toBeCloseTo(40);
        expect(updateProjectionMatrix).toHaveBeenCalledTimes(1);
    });

    it('pushes near-collapsed cameras back to the soft safety distance', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        const updateProjectionMatrix = vi.fn();
        scene.THREE = THREE;
        scene.camera = {
            position: new THREE.Vector3(0, 0, 2),
            near: 1,
            far: 1000,
            updateProjectionMatrix
        };
        scene.controls = {
            target: new THREE.Vector3(0, 0, 0)
        };

        scene._stabilizeCameraDistance();

        expect(scene.camera.position.distanceTo(scene.controls.target)).toBeCloseTo(8);
        expect(scene.camera.near).toBeCloseTo(0.1);
        expect(scene.camera.far).toBeCloseTo(5000);
        expect(updateProjectionMatrix).toHaveBeenCalledTimes(1);
    });
});
