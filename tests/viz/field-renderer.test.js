import { describe, expect, it, vi } from 'vitest';

import { FieldRenderer } from '../../viz/field-renderer.js';
import {
    buildGeometryPaths,
    resolveAisleStationRatios,
    samplePathPointByRatio
} from '../../core/aisle-layout.js';

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
                aisleOccupancyTotals: expect.any(Array),
                sectionOccupancyTotals: expect.any(Array),
                avgBackRowSeatsPerSection: expect.any(Number),
                maxBackRowSeatsPerSection: expect.any(Number),
                minBackRowSeatsPerSection: expect.any(Number),
                requiredWidthIn: expect.any(Number),
                governingWidthIn: expect.any(Number),
                renderedAisleWidthIn: expect.any(Number),
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

        const overlay = renderer._getTierAisleMetricLabelData(solver, bowlConfig, tierLayout, 0);

        expect(overlay.occupancyLabels.length).toBeGreaterThan(0);
        expect(overlay.widthLabels).toHaveLength(tierLayout.aisles.length);
        expect(overlay.occupancyLabels[0]).toEqual(expect.objectContaining({
            text: expect.stringMatching(/occ$/),
            rotationRad: expect.any(Number)
        }));
        expect(overlay.widthLabels[0]).toEqual(expect.objectContaining({
            text: expect.stringMatching(/"$/)
        }));
    });

    it('restores the canvas context after drawing section metrics overlays', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer._drawWorldTextLabel = vi.fn();
        renderer.getTierSectionMetricsOverlayData = vi.fn(() => ({
            sectionLabels: [{ x: 12, y: 18, text: '#101', occText: null }],
            rowSeatLabels: []
        }));
        renderer._getTierAisleMetricLabelData = vi.fn(() => ({
            occupancyLabels: [],
            widthLabels: []
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
            1,
            0,
            0
        );

        expect(ctx.save).toHaveBeenCalledTimes(2);
        expect(ctx.restore).toHaveBeenCalledTimes(2);
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
                scene._getBowlGeometrySegments(bowlConfig, offset)
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
                fieldChamferCache,
                fieldReferenceMap
            );
            const sceneRatios = scene._resolveTierAisleStationRatios(
                frontPaths[pathIndex],
                backPaths[pathIndex],
                tierLayout.aisles[targetAisleIndex],
                targetAisleIndex,
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
