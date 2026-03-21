import { describe, expect, test, vi } from 'vitest';

import { getTemplate } from '../../core/sports-templates.js';
import { AppState } from '../../state/app-state.js';
import { RenderRuntime } from '../../ui/render-runtime.js';

function createTierLayout(tierIndex) {
    const rowSeatCounts = [17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18];
    const rowSummaries = rowSeatCounts.map((seatCount, rowIndex) => ({
        rowIndex,
        rowNumber: rowIndex + 1,
        seatCount,
        sectionCount: 1,
        maxContinuousSectionSeats: seatCount,
        pathSeatCounts: [{ pathIndex: 0, seatCount }],
        linearLengthFt: 140,
        linearLengthPerRunFt: 140,
        seatCountPerRun: seatCount,
        sectionCountPerRun: 1
    }));

    return {
        tierIndex,
        aisleWidthFt: 4,
        seatWidthIn: 20,
        aisles: [
            {
                pathIndex: 0,
                forced: false,
                anchorType: 'segment_fraction',
                segmentIndex: tierIndex,
                segmentT: 0.5,
                alignmentMode: 'perpendicular'
            }
        ],
        targetAisles: 3,
        forcedCount: 1,
        sectionBoundaries: [[
            {
                aisleIndex: 0,
                u: 0.25,
                forced: false
            }
        ]],
        axisExclusionFt: 2.25,
        sectionSummary: {
            actualAisles: 1,
            actualSections: 1,
            allSectionPathsClosed: true,
            backRowSectionSeatCounts: [18],
            sectionOccupancyTotals: [265],
            aisleOccupancyTotals: [133],
            avgBackRowSeatsPerSection: 18,
            maxBackRowSeatsPerSection: 18,
            minBackRowSeatsPerSection: 17,
            tierSeatCount: 265,
            largestSectionOccupancy: 265,
            largestContinuousRowSeatCount: 18,
            maxRequiredAisleWidthIn: 26.6,
            maxGoverningAisleWidthIn: 48,
            minRenderedAisleWidthIn: 48,
            maxRenderedAisleWidthIn: 48,
            hasVariableRenderedAisleWidths: false,
            renderedWidthSolveConverged: true,
            renderedWidthSolveIterations: 1,
            converged: true,
            compliance: {
                seatCapCompliant: true,
                egressCapCompliant: true,
                renderedWidthCompliant: true,
                isCompliant: true
            },
            rowSummaries,
            sections: [{
                pathIndex: 0,
                slotIndex: 0,
                aisleIndexA: 0,
                aisleIndexB: 0,
                rowSeatCounts,
                occupancy: 265,
                frontRowSeats: 17,
                backRowSeats: 18,
                minSeatsPerRow: 17,
                maxSeatsPerRow: 18,
                avgSeatsPerRow: +(265 / rowSeatCounts.length).toFixed(2)
            }],
            aisles: [{
                aisleIndex: 0,
                pathIndex: 0,
                tributaryOccupancy: 133,
                requiredWidthIn: 26.6,
                governingWidthIn: 48,
                renderedWidthIn: 48,
                renderedWidthFt: 4,
                legalMaxOccupantsPerAisle: 360,
                withinMaxWidth: true,
                renderedWidthCompliant: true
            }]
        }
    };
}

function createFieldGeometryPort() {
    return {
        getOffsetCorrection: vi.fn(() => 6),
        getVisualFocalY: vi.fn(() => 120),
        calculateRowLength: vi.fn(() => 140),
        buildTierAisleLayouts: vi.fn((solvers) => solvers.map((solver, index) => createTierLayout(solver.tierIndex ?? index)))
    };
}

describe('RenderRuntime', () => {
    test('recompute assembles the current render snapshot and caches tier layouts', () => {
        const state = AppState.reset();
        const runtime = new RenderRuntime();
        const fieldGeometryPort = createFieldGeometryPort();

        state.sport = 'Football';
        state.setup.customRunoff = 30;
        state.setup.focalX = 18;
        state.setup.focalZ = 9;
        state.bowl.structuralDepth = 18;
        state.bowl.structuralProfileMode = 'sloped';
        state.bowl.straightAisleMode = 'perpendicular';
        state.bowl.chamferAisleMode = 'radial';
        state.occupancy.showSeatCubes3D = true;
        state.occupancy.seatWidth = 22;
        state.tiers[1].enabled = true;
        state.tiers[1].numRows = 12;

        const snapshot = runtime.recompute({ state, fieldGeometryPort });

        expect(snapshot.template).toBe(getTemplate('Football'));
        expect(snapshot.customRunoff).toBe(30);
        expect(snapshot.focalPointFt).toEqual({ x: 18, z: 9 });
        expect(snapshot.structuralDepth).toBe(18);
        expect(snapshot.solvers).toHaveLength(2);
        expect(snapshot.activeSolvers).toHaveLength(2);
        expect(snapshot.bowlConfig).toEqual(expect.objectContaining({
            width: 160,
            structuralDepth: 18,
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        }));
        expect(snapshot.visibility).toEqual(expect.objectContaining({
            t1: true,
            t2: true,
            t3: false
        }));
        expect(snapshot.visualFocalY).toBe(120);
        expect(snapshot.offsetCorrection).toBe(6);
        expect(snapshot.tierMetricsByIndex).toBeInstanceOf(Map);
        expect(snapshot.tierAisleLayouts).toHaveLength(2);
        expect(snapshot.configurationSummary).toEqual({
            totalOccupancyAllTiers: 530,
            totalAislesAllTiers: 2,
            totalSectionsAllTiers: 2,
            tierSeatCounts: [
                { tierIndex: 0, tierSeatCount: 265 },
                { tierIndex: 1, tierSeatCount: 265 }
            ],
            maxRequiredAisleWidthInOverall: 26.6
        });
        expect(snapshot.tierAisleLayouts[0]).toEqual(expect.objectContaining({
            tierIndex: 0,
            aisleWidthFt: 4,
            seatWidthIn: 20,
            targetAisles: 3,
            forcedCount: 1,
            axisExclusionFt: 2.25,
            sectionBoundaries: [[
                {
                    aisleIndex: 0,
                    u: 0.25,
                    forced: false
                }
            ]],
            sectionSummary: expect.objectContaining({
                actualAisles: 1,
                actualSections: 1,
                allSectionPathsClosed: true
            })
        }));
        expect(snapshot.tierMetricsByIndex.get(0)).toMatchObject({
            capacity: 265,
            numAisles: 1,
            numSections: 1,
            seatsPerBlock: '18.0',
            occupantsPerSection: 265,
            occupantsPerAisleLine: 133
        });
        expect(snapshot.fieldRenderInput).toEqual(expect.objectContaining({
            template: snapshot.template,
            customRunoff: 30,
            solvers: snapshot.solvers
        }));
        expect(snapshot.profileRenderInput).toEqual(expect.objectContaining({
            solvers: snapshot.solvers,
            focalPointFt: { x: 18, z: 9 },
            options: {
                structuralDepth: 18,
                structuralProfileMode: 'sloped',
                showSightlines: true,
                tierRowCountControls: [
                    { min: 5, max: 80, step: 1 },
                    { min: 3, max: 60, step: 1 },
                    { min: 3, max: 60, step: 1 }
                ]
            }
        }));
        expect(snapshot.seatPreviewOptions).toEqual({
            showSeatCubes: true,
            seatWidthIn: 22
        });
        expect(snapshot).not.toHaveProperty('clipRange');
        expect(snapshot.bowlConfig).not.toHaveProperty('clip');
        expect(snapshot.scene3DInput).toEqual({
            template: snapshot.template,
            customRunoff: 30,
            focalPointFt: { x: 18, z: 9 },
            focalZ: 9,
            solvers: snapshot.solvers,
            bowlConfig: snapshot.bowlConfig,
            offsetCorrection: 6,
            tierAisleLayouts: snapshot.tierAisleLayouts,
            seatPreviewOptions: snapshot.seatPreviewOptions
        });
        expect(snapshot.statsViewModel).toEqual(expect.objectContaining({
            summary: expect.objectContaining({
                totalRows: expect.any(Number),
                totalOccupancy: 530
            }),
            tiers: expect.any(Array)
        }));
        expect(runtime.getSnapshot()).toBe(snapshot);
        expect(runtime.getActiveSolvers()).toEqual(snapshot.activeSolvers);
        expect(runtime.getExportContext(state)).toEqual(expect.objectContaining({
            stateJson: state.toJSON(),
            sportName: 'Football',
            template: snapshot.template,
            solvers: snapshot.solvers,
            bowlConfig: expect.objectContaining({
                structuralDepth: 18,
                structuralProfileMode: 'sloped',
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            }),
            egressParams: snapshot.egressParams,
            focalPointFt: snapshot.focalPointFt,
            runoffDistance: 30,
            tierAisleLayouts: snapshot.tierAisleLayouts,
            configurationSummary: snapshot.configurationSummary,
            structuralDepthFt: 1.5,
            offsetCorrection: 6
        }));
        expect(fieldGeometryPort.getVisualFocalY).toHaveBeenCalledWith(
            snapshot.template,
            { x: 18, z: 9 },
            'Football'
        );
    });

    test('recompute keeps runtime normalization pure while deriving next-tier defaults', () => {
        const state = AppState.reset();
        const runtime = new RenderRuntime();
        const fieldGeometryPort = createFieldGeometryPort();

        state.sport = 'Invalid Sport';
        state.tiers[1].enabled = true;

        const snapshot = runtime.recompute({ state, fieldGeometryPort });
        const tierDefaults = runtime.getTierDefaults(2);

        expect(state.sport).toBe('Invalid Sport');
        expect(snapshot.template).toBe(getTemplate('Football'));
        expect(snapshot).not.toHaveProperty('clipRange');
        expect(snapshot.bowlConfig).not.toHaveProperty('clip');
        expect(runtime.getExportContext(state).bowlConfig).not.toHaveProperty('clip');
        expect(fieldGeometryPort.getOffsetCorrection).toHaveBeenCalledWith(
            expect.objectContaining({
                width: 160,
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'radial'
            }),
            'Football'
        );
        expect(tierDefaults).toEqual(expect.objectContaining({
            firstRowDist: expect.any(Number),
            firstRowElev: expect.any(Number),
            riserHeight: 12
        }));
    });

    test('hides baseball seating from plan and 3d display payloads without removing solver data elsewhere', () => {
        const state = AppState.reset();
        const runtime = new RenderRuntime();
        const fieldGeometryPort = createFieldGeometryPort();

        state.sport = 'Baseball';
        state.tiers[1].enabled = true;

        const snapshot = runtime.recompute({ state, fieldGeometryPort });

        expect(snapshot.solvers).toHaveLength(2);
        expect(snapshot.activeSolvers).toHaveLength(2);
        expect(snapshot.visibility).toEqual(expect.objectContaining({
            showSeating: false,
            t1: true,
            t2: true,
            t3: false
        }));
        expect(snapshot.fieldRenderInput).toEqual(expect.objectContaining({
            solvers: snapshot.solvers,
            visibility: snapshot.visibility
        }));
        expect(snapshot.scene3DInput).toEqual(expect.objectContaining({
            solvers: null,
            tierAisleLayouts: []
        }));
        expect(snapshot.statsViewModel).toEqual(expect.objectContaining({
            summary: expect.objectContaining({
                totalRows: expect.any(Number)
            })
        }));
    });
});
