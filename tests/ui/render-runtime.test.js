import { describe, expect, test, vi } from 'vitest';

import { getTemplate } from '../../core/sports-templates.js';
import { AppState } from '../../state/app-state.js';
import { RenderRuntime } from '../../ui/render-runtime.js';

function createTierLayout(tierIndex) {
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
            avgBackRowSeatsPerSection: 18,
            maxBackRowSeatsPerSection: 18,
            minBackRowSeatsPerSection: 18
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
                showCLabels: true,
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
                totalRows: expect.any(Number)
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
                straightAisleMode: 'radial',
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
});
