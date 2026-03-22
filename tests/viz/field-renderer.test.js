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
import {
    buildActiveTierSolvers,
    buildStructuralProfileGeometry
} from '../../core/profile-solver.js';
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

function createBaseballArcBowlConfig(overrides = {}) {
    return {
        shape: 'arc',
        radius_arc: 325,
        arc_angle: 90,
        type: 'BaseballStandard',
        sideLength: 325,
        endLength: 325,
        radius: 18,
        corner: 'Chamfer',
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

function createMockCanvas({ width = 800, height = 600 } = {}) {
    const handlers = new Map();
    return {
        width,
        height,
        handlers,
        getContext: vi.fn(() => ({
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            save: vi.fn(),
            translate: vi.fn(),
            scale: vi.fn(),
            restore: vi.fn()
        })),
        addEventListener: vi.fn((type, handler) => {
            handlers.set(type, handler);
        }),
        getBoundingClientRect: vi.fn(() => ({
            left: 0,
            top: 0,
            width,
            height
        }))
    };
}

function createSharedBowlGeometryCases() {
    return [
        createFullChamferBowlConfig({ corner: 'Square', radius: 0 }),
        createFullChamferBowlConfig({ corner: 'Chamfer', radius: 18 }),
        createFullChamferBowlConfig({ corner: 'Radius', radius: 18 }),
        createFullChamferBowlConfig({ type: 'U-End1', corner: 'Chamfer', radius: 18 }),
        createFullChamferBowlConfig({ type: 'Sides', corner: 'Radius', radius: 18 }),
        createBaseballArcBowlConfig({ type: 'BaseballStandard', radius: 18 }),
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

function expectSequentialSectionNumbers(labels, comparator, startNumber) {
    const orderedNumbers = labels
        .slice()
        .sort(comparator)
        .map((label) => label.sectionNumber);

    expect(orderedNumbers).toEqual(
        orderedNumbers.map((_, index) => startNumber + index)
    );
}

describe('FieldRenderer helper delegation surface', () => {
    it('preserves sport-based offset correction behavior', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getOffsetCorrection({ width: 120 }, 'Football')).toBe(0);
        expect(renderer.getOffsetCorrection({ width: 303.6 }, 'Track')).toBe(0);
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

    it('anchors track oval apexes to the overall field length while runoff grows uniformly from the field edge', () => {
        const template = {
            shape: 'oval',
            straight_length: 580.5,
            field_width: 303.6,
            corner_radius: 120
        };

        const baseSegments = buildFieldGeometrySegments(template, 0);
        const runoffSegments = buildFieldGeometrySegments(template, 10);
        const baseRightArc = baseSegments.find((segment) => segment.cmd === 'arc' && segment.x > 0);
        const runoffRightArc = runoffSegments.find((segment) => segment.cmd === 'arc' && segment.x > 0);

        expect(baseSegments[0]).toEqual({
            cmd: 'moveTo',
            x: -138.45,
            y: 151.8
        });
        expect(baseRightArc).toEqual(expect.objectContaining({
            cmd: 'arc',
            x: 138.45,
            y: 0,
            r: 151.8
        }));
        expect(baseRightArc.x + baseRightArc.r).toBeCloseTo(290.25);

        expect(runoffSegments[0]).toEqual({
            cmd: 'moveTo',
            x: -138.45,
            y: 161.8
        });
        expect(runoffRightArc).toEqual(expect.objectContaining({
            cmd: 'arc',
            x: 138.45,
            y: 0,
            r: 161.8
        }));
        expect(runoffRightArc.x + runoffRightArc.r).toBeCloseTo(300.25);
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
        renderer._drawSectionCutLine = vi.fn(() => {
            callOrder.push('sectionCut');
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

        expect(callOrder).toEqual(['runoff', 'field', 'seating', 'sectionCut', 'focal']);
    });

    it('draws the plan-view grid from the visible canvas bounds', () => {
        const renderer = Object.create(FieldRenderer.prototype);
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
        renderer._drawShape = vi.fn();
        renderer._drawSeating = vi.fn();
        renderer._drawFocalPoint = vi.fn();
        renderer._getBounds = vi.fn(() => ({
            minX: -100,
            maxX: 100,
            minY: -50,
            maxY: 50
        }));
        renderer._getFitViewport = vi.fn(() => ({
            offsetX: 0,
            offsetY: 0,
            width: 800,
            height: 600
        }));
        renderer._getBaseFitState = vi.fn(() => ({
            scale: 2,
            tx: 400,
            ty: 300
        }));

        renderer.render(
            {
                shape: 'rectangle',
                field_length: 360,
                field_width: 160,
                runoff: 10
            },
            null,
            [],
            { showSeating: false, t1: false, t2: false, t3: false },
            0,
            null,
            0,
            []
        );

        expect(renderer._drawGrid).toHaveBeenCalledWith(
            renderer.ctx,
            800,
            600,
            2,
            {
                minX: -200,
                maxX: 200,
                minY: -150,
                maxY: 150
            },
            400,
            300
        );
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

    it('projects the section cut line to the outermost visible tier edge and extends it 10 feet', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const cutLine = renderer._getSectionCutLineData(
            [
                createTierSolver({ tierIndex: 0 }),
                {
                    tierIndex: 1,
                    rows: [
                        { x: 44, tread_depth: 3 },
                        { x: 48, tread_depth: 3 }
                    ]
                }
            ],
            { showSeating: true, t1: false, t2: true, t3: false },
            -42.5,
            createFullChamferBowlConfig(),
            0
        );

        expect(cutLine).toEqual({
            startX: 0,
            startY: -42.5,
            edgeX: 0,
            edgeY: -108,
            endX: 0,
            endY: -118
        });
    });

    it('finds the section cut edge on open two-sided bowls', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const cutLine = renderer._getSectionCutLineData(
            [createTierSolver({ tierIndex: 0 })],
            { showSeating: true, t1: true, t2: false, t3: false },
            -54.5,
            createFullChamferBowlConfig({ type: 'Sides' }),
            0
        );

        expect(cutLine).toEqual({
            startX: 0,
            startY: -54.5,
            edgeX: 0,
            edgeY: -93,
            endX: 0,
            endY: -103
        });
    });

    it('keeps seating extents padding symmetric around plan geometry', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const bounds = renderer._getBounds(
            {
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                runoff: 0
            },
            0,
            [
                {
                    rows: [
                        { x: 40, tread_depth: 3 },
                        { x: 80, tread_depth: 3 }
                    ]
                }
            ],
            { showSeating: true, t1: true, t2: false, t3: false }
        );

        expect(bounds.minX).toBeCloseTo(-142);
        expect(bounds.maxX).toBeCloseTo(142);
        expect(bounds.minY).toBeCloseTo(-92);
        expect(bounds.maxY).toBeCloseTo(92);
    });

    it('fits baseball plan extents to the rendered arc geometry instead of a full square radius box', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const template = {
            shape: 'arc',
            field_radius: 325,
            arc_angle: 90,
            runoff: 60
        };

        const expectedBounds = renderer._computeSegmentBounds(buildFieldGeometrySegments(template, 60));
        const bounds = renderer._getBounds(template, 60, null, null, null, 0);

        expect(bounds).toEqual(expectedBounds);
        expect(bounds.minY).toBeCloseTo(0);
        expect(bounds.maxY).toBeCloseTo(385);
    });

    it('fits plan extents against the visible panel frame instead of the dock-reserved canvas area', () => {
        const canvas = createMockCanvas({ width: 1124, height: 808 });
        const renderer = new FieldRenderer(/** @type {any} */ (canvas));

        canvas.parentElement = {};
        canvas.getBoundingClientRect.mockReturnValue({
            left: 0,
            top: 0,
            width: 1124,
            height: 768
        });
        vi.stubGlobal('getComputedStyle', () => ({
            paddingLeft: '0px',
            paddingRight: '0px',
            paddingTop: '0px',
            paddingBottom: '40px'
        }));

        const viewport = renderer._getFitViewport();

        expect(viewport.width).toBe(1124);
        expect(viewport.height).toBe(768);
        expect(viewport.offsetY).toBe(0);

        vi.unstubAllGlobals();
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

    it('keeps the canonical baseball bowl families on one shared geometry source', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const side1Paths = buildGeometryPaths(renderer._getBowlGeometry(
            createBaseballArcBowlConfig({ type: 'Side1', radius: 18 }),
            0
        ));
        const sidesPaths = buildGeometryPaths(renderer._getBowlGeometry(
            createBaseballArcBowlConfig({ type: 'Sides', radius: 18 }),
            0
        ));
        const baseballStandardPaths = buildGeometryPaths(renderer._getBowlGeometry(
            createBaseballArcBowlConfig({ type: 'BaseballStandard', radius: 18 }),
            0
        ));

        expect(side1Paths).toHaveLength(1);
        expect(side1Paths[0].closed).toBe(false);
        expect(side1Paths[0].parts.length).toBe(1);

        expect(sidesPaths).toHaveLength(2);
        expect(sidesPaths.map((path) => path.closed)).toEqual([false, false]);
        expect(sidesPaths.map((path) => path.parts.length)).toEqual([1, 1]);

        expect(baseballStandardPaths).toHaveLength(1);
        expect(baseballStandardPaths[0].closed).toBe(false);
        expect(baseballStandardPaths[0].parts.length).toBe(3);
    });

    it('measures baseball leg length from the theoretical apex while chamfer only shortens the visible connector', () => {
        const shortChamferSegments = buildBowlGeometrySegments(
            createBaseballArcBowlConfig({ radius: 18 }),
            0
        );
        const longChamferSegments = buildBowlGeometrySegments(
            createBaseballArcBowlConfig({ radius: 36 }),
            0
        );

        expect(Math.hypot(shortChamferSegments[0].x, shortChamferSegments[0].y)).toBeCloseTo(325);
        expect(Math.hypot(shortChamferSegments[3].x, shortChamferSegments[3].y)).toBeCloseTo(325);
        expect(shortChamferSegments[0]).toEqual(longChamferSegments[0]);
        expect(shortChamferSegments[3]).toEqual(longChamferSegments[3]);
        expect(Math.hypot(shortChamferSegments[1].x, shortChamferSegments[1].y)).toBeCloseTo(18);
        expect(Math.hypot(longChamferSegments[1].x, longChamferSegments[1].y)).toBeCloseTo(36);
        expect(shortChamferSegments[1].y).toBeLessThan(longChamferSegments[1].y);
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

    it('preserves legacy chamfer growth for U and C bowls while the open-end slider only moves the terminal face', () => {
        const cShapeConfig = createFullChamferBowlConfig({
            type: 'U-End1',
            radius: 5,
            chamferReferenceOffset: 30,
            endLength: 60
        });
        const uShapeConfig = createFullChamferBowlConfig({
            type: 'U-End2',
            radius: 5,
            chamferReferenceOffset: 30,
            endLength: 60
        });
        const outerHalfWidth = (cShapeConfig.width / 2) + 42;
        const outerHalfLength = (cShapeConfig.length / 2) + 42;
        const expectedOuterLeg = 5 + ((42 - 30) * 0.5858);
        const cSegments = buildBowlGeometrySegments(cShapeConfig, 42);
        const uSegments = buildBowlGeometrySegments(uShapeConfig, 42);

        expect(cSegments[1].x).toBeCloseTo(-outerHalfLength + expectedOuterLeg);
        expect(cSegments[1].y).toBeCloseTo(outerHalfWidth);
        expect(cSegments[2].x).toBeCloseTo(-outerHalfLength);
        expect(cSegments[2].y).toBeCloseTo(outerHalfWidth - expectedOuterLeg);

        expect(uSegments[1].x).toBeCloseTo(outerHalfLength);
        expect(uSegments[1].y).toBeCloseTo(-outerHalfWidth + expectedOuterLeg);
        expect(uSegments[2].x).toBeCloseTo(outerHalfLength - expectedOuterLeg);
        expect(uSegments[2].y).toBeCloseTo(-outerHalfWidth);
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

    it('builds explicit 3-sided and 4-sided bowl families for shared renderer consumers', () => {
        const threeSideSubpaths = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'Sides3', sideLength: 140, endLength: 70 }),
            6
        );
        const fourSideSubpaths = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'Sides4', sideLength: 140, endLength: 70 }),
            6
        );

        expect(threeSideSubpaths).toHaveLength(3);
        expect(threeSideSubpaths.every((subpath) => !subpathIsClosed(subpath))).toBe(true);
        expect(fourSideSubpaths).toHaveLength(4);
        expect(fourSideSubpaths.every((subpath) => !subpathIsClosed(subpath))).toBe(true);
    });

    it('lets U and C bowls use the open-end length control while keeping the open-end terminal faces straight', () => {
        const cShapeShortFront = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'U-End1', sideLength: 180, endLength: 60 }),
            0
        );
        const cShapeShortBack = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'U-End1', sideLength: 180, endLength: 60 }),
            12
        );
        const cShapeLongFront = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'U-End1', sideLength: 180, endLength: 110 }),
            0
        );
        const uShapeShortFront = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'U-End2', sideLength: 180, endLength: 60 }),
            0
        );
        const uShapeShortBack = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'U-End2', sideLength: 180, endLength: 60 }),
            12
        );
        const uShapeLongFront = buildBowlGeometrySubpaths(
            createFullChamferBowlConfig({ type: 'U-End2', sideLength: 180, endLength: 110 }),
            0
        );

        expect(Math.max(...cShapeLongFront[0].map((point) => point.x))).toBeGreaterThan(
            Math.max(...cShapeShortFront[0].map((point) => point.x))
        );
        expect(Math.max(...uShapeLongFront[0].map((point) => point.y))).toBeGreaterThan(
            Math.max(...uShapeShortFront[0].map((point) => point.y))
        );
        expect(cShapeShortFront[0][0].x).toBeCloseTo(cShapeShortBack[0][0].x);
        expect(cShapeShortFront[0].slice(1, 5)).toEqual(cShapeLongFront[0].slice(1, 5));
        expect(cShapeShortFront[0][cShapeShortFront[0].length - 1].x).toBeCloseTo(
            cShapeShortBack[0][cShapeShortBack[0].length - 1].x
        );
        expect(uShapeShortFront[0][0].y).toBeCloseTo(uShapeShortBack[0][0].y);
        expect(uShapeShortFront[0].slice(1, 5)).toEqual(uShapeLongFront[0].slice(1, 5));
        expect(uShapeShortFront[0][uShapeShortFront[0].length - 1].y).toBeCloseTo(
            uShapeShortBack[0][uShapeShortBack[0].length - 1].y
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

    it('numbers C-shape sections clockwise from the lower-right open end', () => {
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
        const labelsBySlot = overlay.sectionLabels
            .slice()
            .sort((a, b) => a.slotIndex - b.slotIndex);

        expect(labelsBySlot.map((label) => label.sectionNumber)).toEqual(
            labelsBySlot.map((_, index) => 100 + (labelsBySlot.length - 1 - index))
        );
    });

    it('numbers open side bowls in bottom-left-top-right traversal order', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        const solver = createTierSolver();
        const cases = [
            {
                type: 'Side1',
                bowlConfig: createFullChamferBowlConfig({
                    type: 'Side1',
                    corner: 'None',
                    width: 85,
                    length: 200
                }),
                expectations: [
                    {
                        pathIndex: 0,
                        startNumber: 100,
                        comparator: (a, b) => (b.x - a.x) || (a.y - b.y)
                    }
                ]
            },
            {
                type: 'Sides',
                bowlConfig: createFullChamferBowlConfig({
                    type: 'Sides',
                    corner: 'None',
                    width: 85,
                    length: 200
                }),
                expectations: [
                    {
                        pathIndex: 0,
                        startNumber: 100,
                        comparator: (a, b) => (b.x - a.x) || (a.y - b.y)
                    },
                    {
                        pathIndex: 1,
                        startNumber: 105,
                        comparator: (a, b) => (a.x - b.x) || (b.y - a.y)
                    }
                ]
            },
            {
                type: 'Sides3',
                bowlConfig: createFullChamferBowlConfig({
                    type: 'Sides3',
                    corner: 'None',
                    width: 85,
                    length: 200,
                    sideLength: 200,
                    endLength: 85
                }),
                expectations: [
                    {
                        pathIndex: 1,
                        startNumber: 100,
                        comparator: (a, b) => (b.x - a.x) || (a.y - b.y)
                    },
                    {
                        pathIndex: 2,
                        startNumber: 105,
                        comparator: (a, b) => (a.y - b.y) || (a.x - b.x)
                    },
                    {
                        pathIndex: 0,
                        startNumber: 107,
                        comparator: (a, b) => (a.x - b.x) || (b.y - a.y)
                    }
                ]
            },
            {
                type: 'Sides4',
                bowlConfig: createFullChamferBowlConfig({
                    type: 'Sides4',
                    corner: 'None',
                    width: 85,
                    length: 200,
                    sideLength: 200,
                    endLength: 85
                }),
                expectations: [
                    {
                        pathIndex: 1,
                        startNumber: 100,
                        comparator: (a, b) => (b.x - a.x) || (a.y - b.y)
                    },
                    {
                        pathIndex: 2,
                        startNumber: 105,
                        comparator: (a, b) => (a.y - b.y) || (a.x - b.x)
                    },
                    {
                        pathIndex: 0,
                        startNumber: 107,
                        comparator: (a, b) => (a.x - b.x) || (b.y - a.y)
                    },
                    {
                        pathIndex: 3,
                        startNumber: 112,
                        comparator: (a, b) => (b.y - a.y) || (a.x - b.x)
                    }
                ]
            }
        ];

        cases.forEach(({ bowlConfig, expectations }) => {
            const tierLayout = renderer.generateTierAisleLayout(
                solver,
                bowlConfig,
                createTierMetrics(),
                0,
                createEgressParams()
            );
            const overlay = renderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, 0);

            expectations.forEach(({ pathIndex, startNumber, comparator }) => {
                const labels = overlay.sectionLabels.filter((label) => label.pathIndex === pathIndex);
                expect(labels.length).toBeGreaterThan(0);
                expectSequentialSectionNumbers(labels, comparator, startNumber);
            });
        });
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

        ['Side1', 'Sides', 'BaseballStandard'].forEach((type) => {
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

    it('caps open row-end bowl meshes so side bowls do not export as hollow strips', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        scene.THREE = THREE;
        const row = { x: 24, z: 10, riser_height: 2, tread_depth: 3 };
        const bowlConfig = createFullChamferBowlConfig({
            type: 'Side1',
            corner: 'None',
            radius: 0
        });
        const pointCount = buildBowlGeometrySubpaths(bowlConfig, row.x - row.tread_depth)[0].length;
        const baseVertexCount = pointCount * 3;

        const geometry = scene._createTierGeometry(
            {
                tierIndex: 0,
                rows: [row]
            },
            bowlConfig,
            0
        );

        expect(geometry).not.toBeNull();
        expect(geometry.attributes.position.count).toBe(baseVertexCount + 6);

        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        const duplicatedStartVertex = baseVertexCount;
        const originalPosition = new THREE.Vector3().fromArray(positions, 0);
        const duplicatedPosition = new THREE.Vector3().fromArray(positions, duplicatedStartVertex * 3);
        const originalNormal = new THREE.Vector3().fromArray(normals, 0);
        const duplicatedNormal = new THREE.Vector3().fromArray(normals, duplicatedStartVertex * 3);
        const duplicatedNeighborNormal = new THREE.Vector3().fromArray(normals, (duplicatedStartVertex + 1) * 3);

        expect(duplicatedPosition.distanceTo(originalPosition)).toBeCloseTo(0, 6);
        expect(Math.abs(originalNormal.dot(duplicatedNormal))).toBeLessThan(0.999);
        expect(duplicatedNormal.angleTo(duplicatedNeighborNormal)).toBeCloseTo(0, 6);
    });

    it('caps open structural-depth bowl meshes at both end faces', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        scene.THREE = THREE;

        const [solver] = buildActiveTierSolvers([
            {
                enabled: true,
                cValue: 4,
                firstRowDist: 45,
                firstRowElev: 6,
                treadDepth: 33,
                riserHeight: 10,
                numRows: 4,
                eyeHeight: 3.75,
                eyeSetback: 6,
                profileType: 'Parabolic'
            }
        ], { x: 0, z: 0 });
        const bowlConfig = /** @type {any} */ (createFullChamferBowlConfig({
            type: 'Side1',
            corner: 'None',
            radius: 0,
            structuralDepth: 18
        }));
        const structuralDepthFt = 18 / 12;
        const geometry = scene._createTierGeometryWithDepth(solver, bowlConfig, structuralDepthFt, 0);
        const profile = buildStructuralProfileGeometry(solver, {
            structuralDepthFt,
            structuralProfileMode: bowlConfig.structuralProfileMode,
            tierIndex: 0
        })?.closedProfile;
        const firstPathPointCount = buildBowlGeometrySubpaths(bowlConfig, profile[0].x)[0].length;
        const baseVertexCount = profile.length * firstPathPointCount;
        const capTriangleCount = scene.THREE.ShapeUtils.triangulateShape(
            profile.map((point) => new scene.THREE.Vector2(point.x, point.z)),
            []
        ).length;
        const expectedTriangleCount = ((profile.length - 1) * (firstPathPointCount - 1) * 2)
            + (capTriangleCount * 2);

        expect(geometry).not.toBeNull();
        expect(geometry.index.array.length / 3).toBe(expectedTriangleCount);
        expect(geometry.attributes.position.count).toBe(baseVertexCount + (profile.length * 2));

        const positions = geometry.attributes.position.array;
        const normals = geometry.attributes.normal.array;
        const duplicatedStartVertex = baseVertexCount;
        const originalPosition = new THREE.Vector3().fromArray(positions, 0);
        const duplicatedPosition = new THREE.Vector3().fromArray(positions, duplicatedStartVertex * 3);
        const originalNormal = new THREE.Vector3().fromArray(normals, 0);
        const duplicatedNormal = new THREE.Vector3().fromArray(normals, duplicatedStartVertex * 3);

        expect(duplicatedPosition.distanceTo(originalPosition)).toBeCloseTo(0, 6);
        expect(Math.abs(originalNormal.dot(duplicatedNormal))).toBeLessThan(0.999);
    });

    it('stores seat eye anchors for spectator view and keeps Alt-look rotations fixed to the head position', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');
        const scene = Object.create(Scene3D.prototype);
        scene.THREE = THREE;
        scene.camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
        scene.controls = {
            target: new THREE.Vector3(),
            update: vi.fn(),
            enabled: true,
            enableRotate: true,
            enablePan: true,
            enableZoom: true
        };
        scene.renderer = {
            domElement: {
                style: {},
                setPointerCapture: vi.fn(),
                releasePointerCapture: vi.fn()
            }
        };
        scene._hoveredSeatRef = null;
        scene._selectedSeatRef = null;
        scene._spectatorView = null;

        const seatPreview = scene._createTierSeatPreviewMesh(
            {
                tierIndex: 0,
                eyeHeight: 3.75,
                rows: [
                    { x: 24, z: 10, tread_depth: 3, eye_x: 23.5, eye_z: 13.75 }
                ]
            },
            createFullChamferBowlConfig({
                type: 'Side1',
                corner: 'None',
                radius: 0
            }),
            { tierIndex: 0, aisles: [] },
            24,
            0
        );
        const seatRef = { mesh: seatPreview.mesh, instanceId: 0 };
        const previewSeat = seatPreview.mesh.userData.seatPreview.instances[0];
        const instanceColor = new THREE.Color();

        expect(previewSeat.eyePosition.y).toBeCloseTo(13.75);

        scene._setSeatHover(seatRef);
        seatPreview.mesh.getColorAt(0, instanceColor);
        expect(instanceColor.getHex()).toBe(0xde850a);

        scene._setSeatSelection(seatRef);
        scene._enterSpectatorView(previewSeat);
        const initialPosition = scene.camera.position.clone();
        const initialTarget = scene.controls.target.clone();

        expect(scene.controls.enabled).toBe(false);
        expect(scene.camera.position.y).toBeCloseTo(13.75);

        scene._rotateSpectatorView(60, -20);

        expect(scene.camera.position.distanceTo(initialPosition)).toBeCloseTo(0);
        expect(scene.controls.target.distanceTo(initialTarget)).toBeGreaterThan(0.01);
        expect(scene.controls.target.distanceTo(scene.camera.position)).toBeGreaterThan(8);

        scene._clearSpectatorView();
        expect(scene.controls.enabled).toBe(true);

        scene._enterSpectatorView(previewSeat);
        scene._getSeatPickFromPointerEvent = vi.fn(() => seatRef);

        scene._handleSpectatorPointerDown({
            altKey: true,
            button: 0,
            pointerId: 7,
            clientX: 20,
            clientY: 30,
            preventDefault: vi.fn()
        });
        scene._handleSpectatorPointerMove({
            pointerId: 7,
            clientX: 32,
            clientY: 18,
            preventDefault: vi.fn()
        });
        scene._handleSpectatorPointerUp({
            pointerId: 7
        });
        scene._handleSeatClick({
            button: 0
        });

        expect(scene._getSeatPickFromPointerEvent).not.toHaveBeenCalled();
        expect(scene._selectedSeatRef).toBe(seatRef);
    });
});

describe('Scene3D interaction guards', () => {
    it('keeps top and bottom padding stable across wider plan viewports', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer.padding = 40;
        const bounds = {
            minX: -100,
            maxX: 100,
            minY: -50,
            maxY: 50
        };

        const wideScale = renderer._calcScale(bounds, 700, 400);
        const extraWideScale = renderer._calcScale(bounds, 1000, 400);
        const renderedHeight = (bounds.maxY - bounds.minY) * wideScale;

        expect(wideScale).toBeCloseTo(extraWideScale);
        expect((400 - renderedHeight) / 2).toBeCloseTo(40);
    });

    it('reduces plan-view extents scale only when the viewport becomes width-limited', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer.padding = 40;
        const bounds = {
            minX: -100,
            maxX: 100,
            minY: -50,
            maxY: 50
        };

        const wideScale = renderer._calcScale(bounds, 700, 400);
        const narrowScale = renderer._calcScale(bounds, 500, 400);

        expect(wideScale).toBeCloseTo(3.2);
        expect(narrowScale).toBeCloseTo(2.5);
        expect(narrowScale).toBeLessThan(wideScale);
    });

    it('resets plan zoom extents after middle-button double-click following manual pan and zoom', () => {
        const canvas = createMockCanvas();
        const renderer = new FieldRenderer(/** @type {any} */ (canvas));
        const dateNowSpy = vi.spyOn(Date, 'now');
        renderer._lastArgs = [{ runoff: 18 }, null, null, null, 0, null, 0, []];
        renderer._rerenderFromLastArgs = vi.fn();
        renderer._userZoom = 1.8;
        renderer._panX = 64;
        renderer._panY = -28;
        renderer._userHasZoomed = true;

        dateNowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1180);
        canvas.handlers.get('auxclick')({ button: 1 });
        canvas.handlers.get('auxclick')({ button: 1 });

        expect(renderer._userZoom).toBe(1);
        expect(renderer._panX).toBe(0);
        expect(renderer._panY).toBe(0);
        expect(renderer._userHasZoomed).toBe(false);
        expect(renderer._rerenderFromLastArgs).toHaveBeenCalledTimes(1);

        dateNowSpy.mockRestore();
    });

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

    it('uses combined field and bowl bounds for baseball 3d zoom extents only', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');

        const createScene = (template) => {
            const scene = Object.create(Scene3D.prototype);
            scene.THREE = THREE;
            scene._currentTemplate = template;
            scene.camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
            scene.camera.position.set(450, 280, 450);
            scene.controls = {
                target: new THREE.Vector3(0, 0, 0),
                update: vi.fn()
            };
            scene.bowlGroup = new THREE.Group();
            scene.fieldGroup = new THREE.Group();
            scene._getViewportSize = () => ({ w: 1200, h: 800 });
            scene._clearSpectatorView = vi.fn();
            scene._stabilizeCameraDistance = vi.fn();

            const bowlMesh = /** @type {any} */ (new THREE.Mesh(
                new THREE.BoxGeometry(200, 120, 200),
                new THREE.MeshBasicMaterial()
            ));
            scene.bowlGroup.add(bowlMesh);

            const fieldMesh = /** @type {any} */ (new THREE.Mesh(
                new THREE.BoxGeometry(400, 10, 400),
                new THREE.MeshBasicMaterial()
            ));
            fieldMesh.position.set(0, 0, -220);
            scene.fieldGroup.add(fieldMesh);

            return scene;
        };

        const baseballScene = createScene({ shape: 'arc' });
        baseballScene._fitCameraToBowl();

        const baseballBox = new THREE.Box3()
            .setFromObject(baseballScene.bowlGroup)
            .union(new THREE.Box3().setFromObject(baseballScene.fieldGroup));
        const baseballCenter = baseballBox.getCenter(new THREE.Vector3());
        expect(baseballScene.controls.target.z).toBeCloseTo(baseballCenter.z, 6);

        const rectangleScene = createScene({ shape: 'rectangle' });
        rectangleScene._fitCameraToBowl();

        const bowlCenter = new THREE.Box3()
            .setFromObject(rectangleScene.bowlGroup)
            .getCenter(new THREE.Vector3());
        expect(rectangleScene.controls.target.z).toBeCloseTo(bowlCenter.z, 6);
        expect(baseballScene.controls.target.z).toBeLessThan(rectangleScene.controls.target.z);
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

    it('keeps 3d zoom-extents distance stable across wider viewports when height is unchanged', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');

        const createScene = (viewport) => {
            const scene = Object.create(Scene3D.prototype);
            scene.THREE = THREE;
            scene.camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
            scene.camera.position.set(600, 420, 600);
            scene.controls = {
                target: new THREE.Vector3(0, 0, 0),
                update: vi.fn()
            };
            scene.bowlGroup = new THREE.Group();
            scene.bowlGroup.add(
                new THREE.Mesh(
                    new THREE.BoxGeometry(200, 500, 200),
                    new THREE.MeshBasicMaterial()
                )
            );
            scene._getViewportSize = () => viewport;
            return scene;
        };

        const wideScene = createScene({ w: 1000, h: 400 });
        wideScene._fitCameraToBowl();
        const wideDistance = wideScene.camera.position.distanceTo(wideScene.controls.target);

        const extraWideScene = createScene({ w: 1400, h: 400 });
        extraWideScene._fitCameraToBowl();
        const extraWideDistance = extraWideScene.camera.position.distanceTo(extraWideScene.controls.target);

        expect(wideDistance).toBeCloseTo(extraWideDistance, 6);
    });

    it('pushes 3d zoom extents farther back when viewport width becomes the limiting axis', async () => {
        const { Scene3D } = await import('../../viz/scene3d.js');
        const THREE = await import('../../lib/three.module.js');

        const createScene = (viewport) => {
            const scene = Object.create(Scene3D.prototype);
            scene.THREE = THREE;
            scene.camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
            scene.camera.position.set(600, 300, 520);
            scene.controls = {
                target: new THREE.Vector3(0, 0, 0),
                update: vi.fn()
            };
            scene.bowlGroup = new THREE.Group();
            scene.bowlGroup.add(
                new THREE.Mesh(
                    new THREE.BoxGeometry(1200, 120, 200),
                    new THREE.MeshBasicMaterial()
                )
            );
            scene._getViewportSize = () => viewport;
            return scene;
        };

        const wideScene = createScene({ w: 1400, h: 400 });
        wideScene._fitCameraToBowl();
        const wideDistance = wideScene.camera.position.distanceTo(wideScene.controls.target);

        const narrowScene = createScene({ w: 400, h: 400 });
        narrowScene._fitCameraToBowl();
        const narrowDistance = narrowScene.camera.position.distanceTo(narrowScene.controls.target);

        expect(narrowDistance).toBeGreaterThan(wideDistance);
    });
});
