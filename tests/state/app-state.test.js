import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_STARTUP_PROFILE } from '../../core/default-starting-profile.js';
import {
    APP_STATE_VERSION,
    AppState,
    buildBowlConfig,
    buildEgressParams,
    buildFieldVisibility,
    buildFocalPointFt,
    buildPrimaryTierParameters,
    buildSceneSeatPreviewOptions,
    createDefaultAppStateData,
    getCustomRunoff,
    getRunoffDistance
} from '../../state/app-state.js';

describe('AppState', () => {
    beforeEach(() => {
        AppState.reset();
    });

    test('hydrates legacy phase5 configs into the single AppState object', () => {
        const legacyConfig = {
            ...DEFAULT_STARTUP_PROFILE,
            _version: 'phase5',
            bowl: {
                ...DEFAULT_STARTUP_PROFILE.bowl,
                type: 'Side2'
            },
            setup: {
                ...DEFAULT_STARTUP_PROFILE.setup,
                customRunoff: null
            },
            bookmarks: [
                {
                    name: 'Corner View',
                    position: { x: '1', y: 2, z: 3 },
                    target: { x: 4, y: '5', z: 6 },
                    thumbnail: 42
                }
            ]
        };

        const state = AppState.fromJSON(legacyConfig);
        const exported = AppState.toJSON();

        expect(state).toBe(AppState);
        expect(AppState.bowl.type).toBe('Side1');
        expect(AppState.setup.customRunoff).toBeNull();
        expect(AppState.bookmarks[0]).toEqual({
            name: 'Corner View',
            position: { x: 1, y: 2, z: 3 },
            target: { x: 4, y: 5, z: 6 },
            thumbnail: ''
        });
        expect(exported._version).toBe(APP_STATE_VERSION);
        expect(exported.ui.activeViewTab).toBe(DEFAULT_STARTUP_PROFILE.ui.activeViewTab);
    });

    test('applies sport template defaults without creating a parallel state tree', () => {
        AppState.fromJSON(DEFAULT_STARTUP_PROFILE);
        AppState.tiers[1].numRows = 18;

        const state = AppState.applySportDefaults({
            sport: 'Soccer',
            template: {
                runoff: 20,
                field_length: 345,
                defaults: {
                    setup: { customRunoff: 20, focalZ: 1.5 },
                    bowl: { radius: 2 },
                    tier1: {
                        targetCValue: 3.5,
                        numRows: 30,
                        firstRowDist: 32,
                        firstRowElev: 2,
                        treadDepth: 33,
                        riserHeight: 8,
                        eyeHeight: 3.75,
                        eyeSetback: 6
                    }
                }
            }
        });

        expect(state).toBe(AppState);
        expect(AppState.sport).toBe('Soccer');
        expect(AppState.setup.customRunoff).toBe(20);
        expect(AppState.setup.focalZ).toBe(1.5);
        expect(AppState.bowl.cornerRad).toBe(2);
        expect(AppState.bowl.sideLength).toBe(345);
        expect(AppState.tiers[0].cValue).toBe(3.5);
        expect(AppState.tiers[1].numRows).toBe(18);
    });

    test('creates a fresh default app state payload for project creation flows', () => {
        const first = createDefaultAppStateData();
        const second = createDefaultAppStateData();

        expect(first).not.toBe(second);
        expect(first._version).toBe(APP_STATE_VERSION);
        expect(second.tiers[0].enabled).toBe(true);

        first.tiers[0].numRows = 99;
        expect(second.tiers[0].numRows).toBe(30);
    });

    test('builds state-derived DTO selectors with the existing bowl and scene shapes', () => {
        const state = createDefaultAppStateData();
        const template = {
            runoff: 18,
            field_width: 160,
            field_length: 360,
            shape: 'rectangle',
            field_radius: 12,
            arc_angle: 90
        };

        state.setup.customRunoff = null;
        state.setup.focalZ = 7.5;
        state.setup.sightlineVisuals = false;
        state.setup.sectionMetrics = true;
        state.bowl.type = 'Side1';
        state.bowl.cornerRad = 24;
        state.bowl.sideLength = 280;
        state.bowl.structuralDepth = 18;
        state.bowl.clipEnabled = true;
        state.bowl.clipAxis = 'Y';
        state.bowl.clipPosition = 42;
        state.bowl.clipSide = 'negative';
        state.occupancy.seatWidth = 22;
        state.occupancy.minAisle = 44;
        state.occupancy.maxAisle = 66;
        state.occupancy.seatsBetweenAisles = 18;
        state.occupancy.egressFactor = 0.3;
        state.occupancy.showSeatCubes3D = true;
        state.tiers[1].enabled = true;
        state.tiers[2].enabled = false;

        expect(getCustomRunoff(state)).toBeNull();
        expect(getRunoffDistance(state, template)).toBe(18);
        expect(buildFocalPointFt(state)).toEqual({ x: 0, z: 7.5 });
        expect(buildEgressParams(state)).toEqual({
            seatWidthIn: 22,
            maxAisleWidthIn: 66,
            minAisleWidthIn: 44,
            egressFactor: 0.3,
            seatsBetweenAisles: 18
        });
        expect(buildPrimaryTierParameters(state)).toEqual({
            targetCValue: 4,
            firstRowDistance: 45,
            firstRowElevation: 6,
            treadDepth: 33,
            riserHeight: 10,
            numRows: 30,
            eyeHeight: 3.75,
            eyeSetback: 6
        });
        expect(buildBowlConfig(state, template)).toEqual({
            width: 160,
            length: 360,
            shape: 'rectangle',
            radius_arc: 12,
            arc_angle: 90,
            type: 'Side1',
            corner: 'Chamfer',
            radius: 24,
            sideLength: 280,
            structuralDepth: 18,
            clip: {
                enabled: true,
                axis: 'Y',
                position: 42,
                side: 'negative'
            }
        });
        expect(buildFieldVisibility(state)).toEqual({
            showSeating: true,
            t1: true,
            t2: true,
            t3: false,
            colorByCValue: false,
            showSectionMetrics: true
        });
        expect(buildSceneSeatPreviewOptions(state)).toEqual({
            showSeatCubes: true,
            seatWidthIn: 22
        });
    });

    test('tolerates partial state and template inputs when building selector DTOs', () => {
        const partialState = {
            setup: {},
            bowl: {},
            occupancy: {},
            tiers: []
        };

        expect(getCustomRunoff(partialState)).toBeNull();
        expect(getRunoffDistance(partialState, null)).toBe(0);
        expect(buildFocalPointFt(partialState)).toEqual({ x: 0, z: 0 });
        expect(buildEgressParams(partialState)).toEqual({
            seatWidthIn: 0,
            maxAisleWidthIn: 0,
            minAisleWidthIn: 0,
            egressFactor: 0,
            seatsBetweenAisles: 0
        });
        expect(buildPrimaryTierParameters(partialState)).toEqual({
            targetCValue: 0,
            firstRowDistance: 0,
            firstRowElevation: 0,
            treadDepth: 0,
            riserHeight: 0,
            numRows: 0,
            eyeHeight: 0,
            eyeSetback: 0
        });
        expect(buildBowlConfig(partialState, null)).toEqual({
            width: undefined,
            length: undefined,
            shape: undefined,
            radius_arc: undefined,
            arc_angle: undefined,
            type: undefined,
            corner: 'Chamfer',
            radius: undefined,
            sideLength: undefined,
            structuralDepth: 0,
            clip: { enabled: false }
        });
        expect(buildFieldVisibility(partialState)).toEqual({
            showSeating: true,
            t1: false,
            t2: false,
            t3: false,
            colorByCValue: false,
            showSectionMetrics: false
        });
        expect(buildSceneSeatPreviewOptions(partialState)).toEqual({
            showSeatCubes: false,
            seatWidthIn: 0
        });
    });
});
