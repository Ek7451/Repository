import { afterEach, describe, expect, test, vi } from 'vitest';

import { EditorExportController } from '../../ui/editor-export-controller.js';

function createSolver({ tierIndex = 0 } = {}) {
    return {
        tierIndex,
        treadDepthFt: 3,
        rows: [
            {
                row_number: 1,
                x: 15,
                z: 1,
                tread_depth: 3,
                riser_height: 0.75,
                c_value: 0,
                sightline_angle: 12,
                eye_x: 12,
                eye_z: 4.75,
                computedLength: 120,
                computedSeats: 60
            },
            {
                row_number: 2,
                x: 19,
                z: 2,
                tread_depth: 3,
                riser_height: 1,
                c_value: 4.2,
                sightline_angle: 13,
                eye_x: 16,
                eye_z: 5.75,
                computedLength: 132,
                computedSeats: 66
            }
        ],
        getStepGeometry: () => [
            [{ x: 12, z: 0.25 }, { x: 15, z: 1 }],
            [{ x: 15, z: 1 }, { x: 19, z: 2 }]
        ]
    };
}

function createFieldRenderer() {
    const rowSeatCounts = [60, 60];
    const rowSummaries = rowSeatCounts.map((seatCount, rowIndex) => ({
        rowIndex,
        rowNumber: rowIndex + 1,
        seatCount,
        sectionCount: 1,
        maxContinuousSectionSeats: seatCount,
        pathSeatCounts: [{ pathIndex: 0, seatCount }],
        linearLengthFt: rowIndex === 0 ? 120 : 132,
        linearLengthPerRunFt: rowIndex === 0 ? 120 : 132,
        seatCountPerRun: seatCount,
        sectionCountPerRun: 1
    }));

    return {
        calculateRowLength: vi.fn(() => 120),
        generateTierAisleLayout: vi.fn(() => ({
            tierIndex: 0,
            seatWidthIn: 20,
            aisleWidthFt: 4,
            aisles: [{ x: 0 }],
            forcedCount: 0,
            targetAisles: 1,
            sectionSummary: {
                actualAisles: 1,
                actualSections: 1,
                allSectionPathsClosed: true,
                backRowSectionSeatCounts: [60],
                sectionOccupancyTotals: [120],
                aisleOccupancyTotals: [30],
                avgBackRowSeatsPerSection: 60,
                maxBackRowSeatsPerSection: 60,
                minBackRowSeatsPerSection: 60,
                tierSeatCount: 120,
                largestSectionOccupancy: 120,
                maxRequiredAisleWidthIn: 6,
                maxGoverningAisleWidthIn: 48,
                minRenderedAisleWidthIn: 48,
                maxRenderedAisleWidthIn: 48,
                requiredWidthIn: 6,
                governingWidthIn: 48,
                renderedAisleWidthIn: 48,
                rowSummaries,
                sections: [{
                    pathIndex: 0,
                    slotIndex: 0,
                    aisleIndexA: 0,
                    aisleIndexB: 0,
                    rowSeatCounts,
                    occupancy: 120,
                    frontRowSeats: 60,
                    backRowSeats: 60,
                    minSeatsPerRow: 60,
                    maxSeatsPerRow: 60,
                    avgSeatsPerRow: 60
                }],
                aisles: [{
                    aisleIndex: 0,
                    pathIndex: 0,
                    tributaryOccupancy: 30,
                    requiredWidthIn: 6,
                    governingWidthIn: 48,
                    renderedWidthIn: 48,
                    renderedWidthFt: 4,
                    legalMaxOccupantsPerAisle: 360,
                    withinMaxWidth: true,
                    renderedWidthCompliant: true
                }],
                compliance: {
                    seatCapCompliant: true,
                    egressCapCompliant: true,
                    renderedWidthCompliant: true
                }
            }
        })),
        getBowlGeometrySegments: vi.fn(() => [
            { cmd: 'moveTo', x: 1, y: 2 },
            { cmd: 'lineTo', x: 3, y: 4 }
        ]),
        getTierSectionMetricsOverlayData: vi.fn(() => ({
            sectionLabels: [
                {
                    sectionNumber: 1,
                    pathIndex: 0,
                    slotIndex: 0,
                    x: 5,
                    y: 6,
                    text: 'Section 1',
                    occText: '120'
                }
            ],
            rowSeatLabels: [
                {
                    rowIndex: 0,
                    sectionNumber: 1,
                    pathIndex: 0,
                    slotIndex: 0,
                    x: 7,
                    y: 8,
                    text: '60',
                    seatCount: 60
                }
            ]
        })),
        getTierAisleBandPolygons: vi.fn(() => ([
            {
                points: [
                    { x: 1, y: 1 },
                    { x: 2, y: 1 },
                    { x: 2, y: 2 }
                ]
            }
        ]))
    };
}

function createExportContext(overrides = {}) {
    return {
        stateJson: {
            sport: 'Football',
            setup: { focalZ: 4 },
            bowl: { structuralDepth: 18, structuralProfileMode: 'stepped' },
            tiers: [{ profileType: 'Parabolic' }]
        },
        sportName: 'Football',
        template: {
            field_length: 360,
            field_width: 160,
            focal_x: 0,
            focal_y: -80,
            shape: 'rectangle',
            runoff: 25
        },
        runoffDistance: 25,
        focalPointFt: { x: 0, z: 4 },
        bowlConfig: {
            width: 160,
            length: 360,
            shape: 'rectangle',
            radius_arc: 0,
            arc_angle: 0,
            type: 'Full',
            corner: 'Chamfer',
            radius: 10,
            sideLength: 300,
            structuralDepth: 18,
            structuralProfileMode: 'stepped',
            clip: { enabled: false }
        },
        egressParams: {
            seatWidthIn: 20,
            minAisleWidthIn: 48,
            maxAisleWidthIn: 72,
            egressFactor: 0.2,
            seatsBetweenAisles: 20
        },
        primaryTierParameters: {
            targetCValue: 4,
            firstRowDistance: 45,
            firstRowElevation: 6,
            treadDepth: 33,
            riserHeight: 10,
            numRows: 30,
            eyeHeight: 3.75,
            eyeSetback: 6
        },
        solvers: [createSolver()],
        activeSolvers: [createSolver()],
        tierAisleLayouts: [],
        configurationSummary: {
            totalOccupancyAllTiers: 120,
            totalAislesAllTiers: 1,
            totalSectionsAllTiers: 1,
            tierSeatCounts: [{ tierIndex: 0, tierSeatCount: 120 }],
            maxRequiredAisleWidthInOverall: 6
        },
        structuralDepthFt: 1.5,
        offsetCorrection: 0,
        ...overrides
    };
}

function createSceneGeometryPort(overrides = {}) {
    return {
        getExportSceneData: vi.fn(() => ({
            bowlMeshes: [
                { type: 'Mesh', geometry: { attributes: { position: { array: [0, 0, 0] } }, index: { array: [0, 0, 0] } } }
            ],
            aisleMeshes: [],
            seatMeshes: [],
            THREE: {}
        })),
        getBowlGeometrySegments: vi.fn(() => []),
        ...overrides
    };
}

function createController(overrides = {}) {
    const exportContext = createExportContext(overrides.exportContext);
    const fieldGeometryPort = createFieldRenderer();
    const sceneGeometryPort = createSceneGeometryPort();

    return new EditorExportController({
        getExportContext: () => exportContext,
        getFieldGeometryPort: () => fieldGeometryPort,
        getSceneGeometryPort: () => sceneGeometryPort,
        ...overrides
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('EditorExportController', () => {
    test('builds the current json export descriptor contract', async () => {
        const controller = createController();

        const descriptor = await controller.buildDescriptor('json');

        expect(descriptor).toMatchObject({
            filename: 'seating - study - football.json',
            type: 'application/json'
        });
        const payload = JSON.parse(descriptor.content);
        expect(payload).toMatchObject({
            sport: 'Football',
            profileType: 'Parabolic',
            bowlConfig: {
                width: 160,
                structuralDepth: 18
            },
            egressInputs: {
                seatWidthIn: 20,
                maxSeatsPerRow: 20
            },
            parameters: {
                focalZ: 4,
                targetCValue: 4
            },
            totals: {
                enabledTierCount: 1,
                totalOccupancy: 120
            }
        });
        expect(payload.tiers).toHaveLength(1);
        expect(payload.tiers[0]).toMatchObject({
            tierIndex: 0,
            totalOccupancy: 120,
            actualLayout: {
                sectionCount: 1
            },
            egressFinal: {
                requiredWidthIn: 6,
                governingWidthIn: 48,
                renderedWidthMinIn: 48,
                renderedWidthMaxIn: 48,
                renderedWidthVaries: false
            }
        });
        expect(payload.tiers[0].egressEstimate).toBeNull();
    });

    test('builds the current config export descriptor contract', async () => {
        const exportContext = createExportContext();
        const getFieldGeometryPort = vi.fn(() => {
            throw new Error('config export should not request field geometry');
        });
        const getSceneGeometryPort = vi.fn(() => {
            throw new Error('config export should not request scene geometry');
        });
        const controller = new EditorExportController({
            getExportContext: () => exportContext,
            getFieldGeometryPort,
            getSceneGeometryPort
        });

        const descriptor = await controller.buildDescriptor('config');

        expect(descriptor).toEqual({
            filename: 'bowl-config-football.json',
            content: JSON.stringify(exportContext.stateJson, null, 2),
            type: 'application/json'
        });
        expect(getFieldGeometryPort).not.toHaveBeenCalled();
        expect(getSceneGeometryPort).not.toHaveBeenCalled();
    });

    test('builds the current profile dxf descriptor contract', async () => {
        const controller = createController();

        const descriptor = await controller.buildDescriptor('profile-dxf');

        expect(descriptor).toMatchObject({
            filename: 'SeatingProfile_football.dxf',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('Tier_1_Profile');
        expect(descriptor.content).toContain('Tier_1_Sightlines');
        expect(descriptor.content).toContain('Focal_Point');
    });

    test('builds the current plan dxf descriptor contract', async () => {
        const controller = createController();

        const descriptor = await controller.buildDescriptor('plan-dxf');

        expect(descriptor).toMatchObject({
            filename: 'SeatingPlan_football.dxf',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('Field_Edge');
        expect(descriptor.content).toContain('Tier_1_Plan');
        expect(descriptor.content).toContain('Tier_1_Aisles');
    });

    test('short-circuits rhino export when there is no scene geometry', async () => {
        const getSceneGeometryPort = vi.fn(() => ({
            getExportSceneData: () => null
        }));
        const controller = createController({
            getSceneGeometryPort
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(controller.buildDescriptor('rhino')).resolves.toBeNull();
        expect(getSceneGeometryPort).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith('No 3D data to export');
    });

    test('uses core tier-index fallback when building the public study-results descriptor', async () => {
        const getBowlGeometrySegments = vi.fn(() => []);
        const getTierSectionMetricsOverlayData = vi.fn(() => ({ sectionLabels: [], rowSeatLabels: [] }));
        const getTierAisleBandPolygons = vi.fn(() => []);
        const controller = new EditorExportController({
            getExportContext: () => createExportContext({
                activeSolvers: [{ tierIndex: '4', rows: [{ x: 20, tread_depth: 2 }] }],
                bowlConfig: { type: 'Full' },
                egressParams: { seatWidthIn: 20 },
                tierAisleLayouts: [{
                    tierIndex: '4',
                    aisleWidthFt: 4,
                    aisles: [{ pathIndex: 0 }],
                    sectionSummary: {
                        actualAisles: 1,
                        actualSections: 1,
                        tierSeatCount: 24,
                        maxRequiredAisleWidthIn: 4.8,
                        maxGoverningAisleWidthIn: 48,
                        minRenderedAisleWidthIn: 48,
                        maxRenderedAisleWidthIn: 48,
                        largestSectionOccupancy: 24,
                        backRowSectionSeatCounts: [24],
                        aisleOccupancyTotals: [12],
                        rowSummaries: [{
                            rowIndex: 0,
                            rowNumber: 1,
                            seatCount: 24,
                            sectionCount: 1,
                            maxContinuousSectionSeats: 24,
                            pathSeatCounts: [{ pathIndex: 0, seatCount: 24 }],
                            linearLengthFt: 100,
                            linearLengthPerRunFt: 100,
                            seatCountPerRun: 24,
                            sectionCountPerRun: 1
                        }],
                        sections: [{
                            pathIndex: 0,
                            slotIndex: 0,
                            aisleIndexA: 0,
                            aisleIndexB: 0,
                            rowSeatCounts: [24],
                            occupancy: 24,
                            frontRowSeats: 24,
                            backRowSeats: 24,
                            minSeatsPerRow: 24,
                            maxSeatsPerRow: 24,
                            avgSeatsPerRow: 24
                        }],
                        aisles: [{
                            aisleIndex: 0,
                            pathIndex: 0,
                            tributaryOccupancy: 12,
                            requiredWidthIn: 4.8,
                            governingWidthIn: 48,
                            renderedWidthIn: 48,
                            renderedWidthFt: 4,
                            legalMaxOccupantsPerAisle: 360,
                            withinMaxWidth: true,
                            renderedWidthCompliant: true
                        }],
                        compliance: {
                            seatCapCompliant: true,
                            egressCapCompliant: true,
                            renderedWidthCompliant: true
                        }
                    }
                }],
                configurationSummary: {
                    totalOccupancyAllTiers: 24,
                    totalAislesAllTiers: 1,
                    totalSectionsAllTiers: 1,
                    tierSeatCounts: [{ tierIndex: 4, tierSeatCount: 24 }],
                    maxRequiredAisleWidthInOverall: 4.8
                }
            }),
            getFieldGeometryPort: () => ({
                calculateRowLength: vi.fn(() => 100),
                getBowlGeometrySegments,
                getTierSectionMetricsOverlayData,
                getTierAisleBandPolygons
            })
        });

        const descriptor = await controller.buildDescriptor('json');
        const payload = JSON.parse(descriptor.content);

        expect(payload.tiers).toHaveLength(1);
        expect(payload.tiers[0]).toMatchObject({
            tierIndex: 4,
            tierNumber: 5,
            name: 'Tier 5'
        });
    });
});
