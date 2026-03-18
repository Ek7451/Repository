import { describe, expect, test, vi } from 'vitest';

import {
    buildConfigExportDescriptor,
    buildObjExportDescriptor,
    buildObjText,
    buildStudyResultsJsonExportDescriptor,
    buildStudyResultsJsonPayload,
    buildTierMetricsCsv,
    buildTierMetricsCsvExportDescriptor
} from '../../export/obj-csv-exporter.js';

function createSolver() {
    return {
        tierIndex: 0,
        rows: [
            {
                row_number: 1,
                x: 10,
                z: 1,
                tread_depth: 2,
                riser_height: 1,
                c_value: 12,
                sightline_angle: 30,
                eye_x: 9.5,
                eye_z: 5,
                computedLength: 40,
                computedSeats: 19
            },
            {
                row_number: 2,
                x: 12,
                z: 2,
                tread_depth: 2,
                riser_height: 1,
                c_value: 2.5,
                sightline_angle: 31,
                eye_x: 11.5,
                eye_z: 6,
                computedLength: 42,
                computedSeats: 21
            }
        ]
    };
}

describe('buildStudyResultsJsonPayload', () => {
    test('builds study results from explicit tier artifacts', () => {
        const solver = createSolver();
        const tierArtifacts = [{
            tierIndex: 0,
            tierMetrics: {
                capacity: 22,
                requiredWidth: 48,
                aisleWidth: 48,
                numAisles: 2,
                numSections: 1,
                seatsPerRow: 22,
                occupantsPerSection: 22
            },
            tierLayout: {
                tierIndex: 0,
                aisleWidthFt: 4,
                seatWidthIn: 20,
                aisles: [{ pathIndex: 0 }, { pathIndex: 0 }],
                targetAisles: 2,
                forcedCount: 0,
                sectionSummary: {
                    actualAisles: 2,
                    actualSections: 1,
                    allSectionPathsClosed: true,
                    avgBackRowSeatsPerSection: 12
                }
            },
            overlayData: {
                sectionLabels: [
                    { sectionNumber: 100, pathIndex: 0, slotIndex: 0, x: 1, y: 2 }
                ],
                rowSeatLabels: [
                    { rowIndex: 0, sectionNumber: 100, pathIndex: 0, slotIndex: 0, seatCount: 10 },
                    { rowIndex: 1, sectionNumber: 100, pathIndex: 0, slotIndex: 0, seatCount: 12 }
                ]
            }
        }];

        const payload = buildStudyResultsJsonPayload({
            solvers: [solver],
            sportName: 'Football',
            profileType: 'Parabolic',
            template: {
                name: 'Football',
                shape: 'rectangle',
                field_length: 360,
                field_width: 160,
                runoff: 20
            },
            bowlConfig: {
                width: 160,
                type: 'end'
            },
            egressParams: {
                seatWidthIn: 20,
                minAisleWidthIn: 48,
                maxAisleWidthIn: 72,
                egressFactor: 0.2,
                seatsBetweenAisles: 20
            },
            focalPointFt: { x: 0, z: 1 },
            primaryTierParameters: {
                targetCValue: 12,
                firstRowDistance: 8,
                firstRowElevation: 1,
                treadDepth: 24,
                riserHeight: 12,
                numRows: 2,
                eyeHeight: 4,
                eyeSetback: 6
            },
            tierArtifacts
        });

        expect(payload).toMatchObject({
            sport: 'Football',
            profileType: 'Parabolic',
            totals: {
                enabledTierCount: 1,
                totalOccupancy: 22,
                totalAisleCenterlines: 2,
                totalSections: 1
            },
            parameters: {
                targetCValue: 12,
                focalX: 0,
                focalZ: 1
            }
        });
        expect(payload.template).toMatchObject({
            name: 'Football',
            shape: 'rectangle',
            fieldLengthFt: 360,
            fieldWidthFt: 160
        });
        expect(payload.tiers[0].rows[0]).toMatchObject({
            rowNumber: 1,
            linearLengthFt: 40,
            estimatedLinearSeats: 19
        });
        expect(payload.tiers[0].sections[0]).toMatchObject({
            sectionNumber: 100,
            occupancy: 22,
            rowsInSection: 2,
            frontRowSeats: 10,
            backRowSeats: 12
        });
        expect(payload.tiers[0].egressEstimate).toMatchObject({
            requiredWidthIn: 48,
            estimatedNumAisles: 2,
            estimatedNumSections: 1
        });
    });
});

describe('buildStudyResultsJsonExportDescriptor', () => {
    test('wraps the study payload in a download descriptor', () => {
        const descriptor = buildStudyResultsJsonExportDescriptor({
            solvers: [createSolver()],
            sportName: 'Football',
            profileType: 'Parabolic',
            template: {
                name: 'Football',
                shape: 'rectangle',
                field_length: 360,
                field_width: 160,
                runoff: 20
            },
            bowlConfig: {
                width: 160,
                type: 'end'
            },
            egressParams: {
                seatWidthIn: 20,
                minAisleWidthIn: 48,
                maxAisleWidthIn: 72,
                egressFactor: 0.2,
                seatsBetweenAisles: 20
            },
            focalPointFt: { x: 0, z: 1 },
            primaryTierParameters: {
                targetCValue: 12,
                firstRowDistance: 8,
                firstRowElevation: 1,
                treadDepth: 24,
                riserHeight: 12,
                numRows: 2,
                eyeHeight: 4,
                eyeSetback: 6
            },
            tierArtifacts: []
        });

        expect(descriptor).toMatchObject({
            filename: 'seating - study - football.json',
            type: 'application/json'
        });
        expect(descriptor.content).toContain('"sport": "Football"');
    });

    test('returns null when there is no solver data', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(buildStudyResultsJsonExportDescriptor({
            solvers: [],
            sportName: 'Football'
        })).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('No solver data to export');

        warnSpy.mockRestore();
    });
});

describe('buildObjText', () => {
    test('writes bowl mesh vertices and faces with stable index offsets', () => {
        const obj = buildObjText({
            bowlMeshes: [
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                },
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 1, 1, 0, 1, 0, 1, 1] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                }
            ]
        });

        expect(obj).toContain('# Seating Bowl Study - OBJ Export');
        expect(obj).toContain('o SeatingBowl');
        expect(obj).toContain('v 0.0000 0.0000 0.0000');
        expect(obj).toContain('v 0.0000 0.0000 1.0000');
        expect(obj).toContain('f 1 2 3');
        expect(obj).toContain('f 4 5 6');
    });

    test('skips malformed mesh data instead of emitting invalid coordinates', () => {
        const obj = buildObjText({
            bowlMeshes: [
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 0, Number.NaN, 0, 0, 0, 1, 0] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                },
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 1, 1, 0, 1, 0, 1, 1] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                }
            ]
        });

        expect(obj).not.toContain('NaN');
        expect(obj).not.toContain('Infinity');
        expect(obj).toContain('f 1 2 3');
    });
});

describe('buildObjExportDescriptor', () => {
    test('wraps OBJ content with a stable filename', () => {
        const descriptor = buildObjExportDescriptor({
            sportName: 'Ice Hockey',
            bowlMeshes: [
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                }
            ]
        });

        expect(descriptor).toMatchObject({
            filename: 'seating - study - ice-hockey.obj',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('o SeatingBowl');
    });
});

describe('buildTierMetricsCsv', () => {
    test('writes tier row metrics from passed solver data', () => {
        const csv = buildTierMetricsCsv({
            solvers: [
                {
                    rows: [
                        {
                            row_number: 1,
                            x: 10,
                            z: 1,
                            tread_depth: 2,
                            riser_height: 1,
                            c_value: 12,
                            sightline_angle: 30,
                            computedLength: 40,
                            computedSeats: 24
                        },
                        {
                            row_number: 2,
                            x: 12,
                            z: 2,
                            tread_depth: 2,
                            riser_height: 1,
                            c_value: 2.5,
                            sightline_angle: 31,
                            computedLength: 42,
                            computedSeats: 26
                        }
                    ]
                }
            ],
            focalPointFt: { x: 0 }
        });

        expect(csv).toContain('Tier,Row,Riser (in),Elevation (ft),C-Value (in)');
        expect(csv).toContain('1,1,12.00,1.00,N/A,24.00,8.00,30.00,40,24');
        expect(csv).toContain('1,2,12.00,2.00,2.50,24.00,10.00,31.00,42,26');
    });
});

describe('buildTierMetricsCsvExportDescriptor', () => {
    test('wraps CSV content with the sport-based filename', () => {
        const descriptor = buildTierMetricsCsvExportDescriptor({
            solvers: [{ rows: [{ row_number: 1, x: 10, z: 1, tread_depth: 2, riser_height: 1, computedLength: 40, computedSeats: 24 }] }],
            focalPointFt: { x: 0 },
            sportName: 'Soccer'
        });

        expect(descriptor).toMatchObject({
            filename: 'tier-metrics-soccer.csv',
            type: 'text/csv'
        });
        expect(descriptor.content).toContain('Tier,Row,Riser (in),Elevation (ft),C-Value (in)');
    });
});

describe('buildConfigExportDescriptor', () => {
    test('serializes passed config data without reading AppState directly', () => {
        const descriptor = buildConfigExportDescriptor({
            config: {
                sport: 'Basketball',
                tiers: [{ enabled: true }]
            }
        });

        expect(descriptor).toMatchObject({
            filename: 'bowl-config-basketball.json',
            type: 'application/json'
        });
        expect(descriptor.content).toContain('"sport": "Basketball"');
    });
});
