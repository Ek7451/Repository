import { describe, expect, test, vi } from 'vitest';

import { getTemplate } from '../../core/sports-templates.js';
import { AppState } from '../../state/app-state.js';
import { RenderRuntime } from '../../ui/render-runtime.js';

function createFieldRenderer() {
    return {
        getOffsetCorrection: vi.fn(() => 6),
        getClipPositionRange: vi.fn(() => ({ min: -4, max: 48 })),
        getVisualFocalY: vi.fn(() => 120),
        calculateRowLength: vi.fn(() => 140),
        buildTierAisleLayouts: vi.fn((solvers) => solvers.map((solver, index) => ({
            tierIndex: solver.tierIndex ?? index,
            aisles: [],
            sectionSummary: {
                actualAisles: 2,
                actualSections: 2
            }
        })))
    };
}

describe('RenderRuntime', () => {
    test('recompute assembles the current render snapshot and caches tier layouts', () => {
        const state = AppState.reset();
        const runtime = new RenderRuntime();
        const fieldRenderer = createFieldRenderer();

        state.setup.customRunoff = 30;
        state.setup.focalZ = 9;
        state.bowl.structuralDepth = 18;
        state.occupancy.showSeatCubes3D = true;
        state.occupancy.seatWidth = 22;
        state.tiers[1].enabled = true;
        state.tiers[1].numRows = 12;

        const snapshot = runtime.recompute({ state, fieldRenderer });

        expect(snapshot.template).toBe(getTemplate('Football'));
        expect(snapshot.customRunoff).toBe(30);
        expect(snapshot.focalPointFt).toEqual({ x: 0, z: 9 });
        expect(snapshot.structuralDepth).toBe(18);
        expect(snapshot.solvers).toHaveLength(2);
        expect(snapshot.activeSolvers).toHaveLength(2);
        expect(snapshot.bowlConfig).toEqual(expect.objectContaining({
            width: 160,
            structuralDepth: 18
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
        expect(snapshot.seatPreviewOptions).toEqual({
            showSeatCubes: true,
            seatWidthIn: 22
        });
        expect(snapshot.clipRange).toEqual({
            min: -4,
            max: 48,
            value: 0
        });
        expect(snapshot.scene3DInput).toEqual({
            template: snapshot.template,
            customRunoff: 30,
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
            bowlConfig: snapshot.bowlConfig,
            egressParams: snapshot.egressParams,
            focalPointFt: snapshot.focalPointFt,
            runoffDistance: 30,
            tierAisleLayouts: snapshot.tierAisleLayouts,
            structuralDepthFt: 1.5,
            offsetCorrection: 6
        }));
    });

    test('recompute normalizes sport names, clamps clip position, and derives next-tier defaults from solved rows', () => {
        const state = AppState.reset();
        const runtime = new RenderRuntime();
        const fieldRenderer = createFieldRenderer();

        state.sport = 'Invalid Sport';
        state.bowl.clipAxis = 'Y';
        state.bowl.clipPosition = 500;
        state.tiers[1].enabled = true;

        const snapshot = runtime.recompute({ state, fieldRenderer });
        const tierDefaults = runtime.getTierDefaults(2);

        expect(state.sport).toBe('Football');
        expect(snapshot.template).toBe(getTemplate('Football'));
        expect(state.bowl.clipPosition).toBe(48);
        expect(snapshot.clipRange).toEqual({
            min: -4,
            max: 48,
            value: 48
        });
        expect(fieldRenderer.getClipPositionRange).toHaveBeenCalledWith(
            snapshot.solvers,
            snapshot.bowlConfig,
            'Y',
            6
        );
        expect(tierDefaults).toEqual(expect.objectContaining({
            firstRowDist: expect.any(Number),
            firstRowElev: expect.any(Number),
            riserHeight: 12
        }));
    });
});
