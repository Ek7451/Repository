import { describe, expect, test } from 'vitest';
import {
    buildPlanDxf,
    buildPlanDxfExportDescriptor,
    buildProfileDxf,
    buildProfileDxfExportDescriptor
} from '../../export/dxf-exporter.js';
import { buildFieldGeometrySegments } from '../../viz/field-renderer.js';

function createSolver() {
    return {
        tierIndex: 0,
        treadDepthFt: 2,
        rows: [
            {
                x: 10,
                z: 1,
                tread_depth: 2,
                riser_height: 1,
                eye_x: 9.5,
                eye_z: 4.5,
                c_value: 3.25
            }
        ],
        getStepGeometry() {
            return [[{ x: 8, z: 1 }, { x: 10, z: 1 }]];
        }
    };
}

function createPlanTemplateCases() {
    return [
        {
            shape: 'rectangle',
            field_length: 100,
            field_width: 50,
            focal_x: 0,
            focal_y: 0
        },
        {
            shape: 'rounded_rect',
            field_length: 200,
            field_width: 85,
            corner_radius: 28,
            focal_x: 0,
            focal_y: -42.5
        },
        {
            shape: 'oval',
            straight_length: 580.5,
            field_width: 303.6,
            corner_radius: 120,
            focal_x: 0,
            focal_y: 0
        },
        {
            shape: 'arc',
            field_radius: 325,
            arc_angle: 90,
            focal_x: 0,
            focal_y: 0
        }
    ];
}

describe('buildProfileDxf', () => {
    test('writes a complete R12 DXF document with normalized layer names', () => {
        const dxf = buildProfileDxf({
            solvers: [createSolver()],
            structuralDepthFt: 0,
            focalPointFt: { x: 0, z: 0 }
        });

        expect(dxf).toContain('SECTION\n2\nHEADER');
        expect(dxf).toContain('AC1009');
        expect(dxf).toContain('TABLE\n2\nLAYER');
        expect(dxf).toContain('Focal_Point');
        expect(dxf).toContain('Tier_1_Profile');
        expect(dxf).toContain('Tier_1_Sightlines');
        expect(dxf).toContain('Tier_1_Metrics');
        expect(dxf).not.toContain('SECTION\n2\nBLOCKS');
        expect(dxf).toContain('EOF');
    });

    test('skips invalid profile geometry instead of emitting NaN values', () => {
        const dxf = buildProfileDxf({
            solvers: [
                {
                    tierIndex: 0,
                    treadDepthFt: 2,
                    rows: [
                        {
                            x: 10,
                            z: 1,
                            tread_depth: 2,
                            riser_height: 1,
                            eye_x: Number.NaN,
                            eye_z: 4.5,
                            c_value: 3.25
                        }
                    ],
                    getStepGeometry() {
                        return [[{ x: 8, z: 1 }, { x: Number.NaN, z: 1 }]];
                    }
                }
            ]
        });

        expect(dxf).not.toContain('NaN');
        expect(dxf).not.toContain('Infinity');
    });

    test('uses the shared structural profile geometry for sloped exports', () => {
        const dxf = buildProfileDxf({
            solvers: [{
                tierIndex: 1,
                treadDepthFt: 2,
                rows: [
                    {
                        x: 10,
                        z: 6,
                        tread_depth: 2,
                        riser_height: 1,
                        eye_x: 9.5,
                        eye_z: 9.5,
                        c_value: 3.25
                    },
                    {
                        x: 12,
                        z: 7,
                        tread_depth: 2,
                        riser_height: 1,
                        eye_x: 11.5,
                        eye_z: 10.5,
                        c_value: 3.5
                    }
                ],
                getStepGeometry() {
                    return [
                        [{ x: 8, z: 6 }, { x: 10, z: 6 }],
                        [{ x: 10, z: 6 }, { x: 10, z: 7 }],
                        [{ x: 10, z: 7 }, { x: 12, z: 7 }]
                    ];
                }
            }],
            structuralDepthFt: 1.5,
            structuralProfileMode: 'sloped',
            focalPointFt: { x: 0, z: 0 }
        });

        expect(dxf).toContain('Tier_1_Profile');
        expect(dxf).not.toContain('NaN');
        expect(dxf).not.toContain('Infinity');
    });
});

describe('buildProfileDxfExportDescriptor', () => {
    test('wraps profile DXF content in a download descriptor', () => {
        const descriptor = buildProfileDxfExportDescriptor({
            solvers: [createSolver()],
            structuralDepthFt: 0,
            structuralProfileMode: 'stepped',
            focalPointFt: { x: 0, z: 0 },
            sportName: 'Football'
        });

        expect(descriptor).toMatchObject({
            filename: 'SeatingProfile_football.dxf',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('Tier_1_Profile');
    });
});

describe('buildPlanDxf', () => {
    test('writes supported shared field shapes without invalid entities', () => {
        createPlanTemplateCases().forEach((template) => {
            const dxf = buildPlanDxf({
                template,
                runoffFt: 10,
                visualFocalXFt: 0,
                tierPlanArtifacts: [],
                fieldEdgeSegments: buildFieldGeometrySegments(template, 0),
                runoffSegments: buildFieldGeometrySegments(template, 10)
            });

            expect(dxf).toContain('Field_Edge');
            expect(dxf).toContain('Runoff');
            expect(dxf).not.toContain('NaN');
            expect(dxf).not.toContain('Infinity');
            expect(dxf).toContain('EOF');
        });
    });

    test('writes field and runoff layers from passed arguments', () => {
        const dxf = buildPlanDxf({
            template: {
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: -80
            },
            runoffFt: 10,
            visualFocalXFt: 15,
            fieldEdgeSegments: buildFieldGeometrySegments({
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: -80
            }, 0),
            runoffSegments: buildFieldGeometrySegments({
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: -80
            }, 10),
            tierPlanArtifacts: [
                {
                    tierIndex: 0,
                    rowGeometries: [[
                        { cmd: 'moveTo', x: 0, y: 0 },
                        { cmd: 'lineTo', x: 10, y: 0 },
                        { cmd: 'closePath' }
                    ]],
                    aislePolygons: [
                        {
                            points: [
                                { x: 1, y: 1 },
                                { x: 2, y: 1 },
                                { x: 2, y: 2 },
                                { x: 1, y: 2 }
                            ]
                        }
                    ],
                    overlayData: {
                        sectionLabels: [],
                        rowSeatLabels: []
                    }
                }
            ]
        });

        expect(dxf).toContain('Field_Edge');
        expect(dxf).toContain('Runoff');
        expect(dxf).toContain('20\n-1140.0000');
        expect(dxf).toContain('Tier_1_Plan');
        expect(dxf).toContain('Tier_1_Aisles');
    });

    test('skips malformed plan entities instead of poisoning the file', () => {
        const dxf = buildPlanDxf({
            template: {
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: 0
            },
            runoffFt: 10,
            visualFocalXFt: 0,
            fieldEdgeSegments: buildFieldGeometrySegments({
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: 0
            }, 0),
            runoffSegments: buildFieldGeometrySegments({
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: 0
            }, 10),
            tierPlanArtifacts: [
                {
                    tierIndex: 0,
                    rowGeometries: [[
                        { cmd: 'moveTo', x: 0, y: 0 },
                        { cmd: 'lineTo', x: Number.NaN, y: 0 },
                        { cmd: 'arc', x: 0, y: 0, r: Infinity, sa: 0, ea: Math.PI / 2, ccw: false },
                        { cmd: 'closePath' }
                    ]],
                    aislePolygons: [],
                    overlayData: {
                        sectionLabels: [],
                        rowSeatLabels: []
                    }
                }
            ]
        });

        expect(dxf).not.toContain('NaN');
        expect(dxf).not.toContain('Infinity');
        expect(dxf).toContain('EOF');
    });
});

describe('buildPlanDxfExportDescriptor', () => {
    test('wraps plan DXF content in a download descriptor', () => {
        const descriptor = buildPlanDxfExportDescriptor({
            template: {
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: 0
            },
            runoffFt: 10,
            visualFocalXFt: 0,
            fieldEdgeSegments: buildFieldGeometrySegments({
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: 0
            }, 0),
            runoffSegments: buildFieldGeometrySegments({
                shape: 'rectangle',
                field_length: 100,
                field_width: 50,
                focal_x: 0,
                focal_y: 0
            }, 10),
            tierPlanArtifacts: [
                {
                    tierIndex: 0,
                    rowGeometries: [[
                        { cmd: 'moveTo', x: 0, y: 0 },
                        { cmd: 'lineTo', x: 10, y: 0 },
                        { cmd: 'closePath' }
                    ]],
                    aislePolygons: [],
                    overlayData: {
                        sectionLabels: [],
                        rowSeatLabels: []
                    }
                }
            ],
            sportName: 'Soccer'
        });

        expect(descriptor).toMatchObject({
            filename: 'SeatingPlan_soccer.dxf',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('Tier_1_Plan');
    });
});
