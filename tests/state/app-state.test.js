import { beforeEach, describe, expect, test } from 'vitest';
import {
    APP_STATE_VERSION,
    AppState,
    buildBowlConfig,
    buildEgressParams,
    buildFieldVisibility,
    buildFocalXControlConfig,
    buildFocalPointFt,
    buildProfileRenderOptions,
    buildPrimaryTierParameters,
    buildSceneSeatPreviewOptions,
    buildTierInitializationFlags,
    buildTierRowCountControlConfigs,
    createDefaultAppStateData,
    getCustomRunoff,
    getRunoffDistance
} from '../../state/app-state.js';

describe('AppState', () => {
    beforeEach(() => {
        AppState.reset();
    });

    test('hydrates legacy phase5 configs into the single AppState object', () => {
        const startupProfile = createDefaultAppStateData();
        const legacyBowl = { ...startupProfile.bowl };
        delete legacyBowl.straightAisleMode;
        delete legacyBowl.chamferAisleMode;
        const legacyConfig = {
            ...startupProfile,
            _version: 'phase5',
            bowl: {
                ...legacyBowl,
                type: 'Side2',
                clipEnabled: true,
                clipAxis: 'Y',
                clipPosition: 12,
                clipSide: 'negative'
            },
            setup: {
                ...startupProfile.setup,
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
        expect(AppState.bowl.structuralProfileMode).toBe('stepped');
        expect(AppState.bowl.straightAisleMode).toBe('perpendicular');
        expect(AppState.bowl.chamferAisleMode).toBe('radial');
        expect(AppState.bookmarks[0]).toEqual({
            name: 'Corner View',
            position: { x: 1, y: 2, z: 3 },
            target: { x: 4, y: 5, z: 6 },
            thumbnail: ''
        });
        expect(exported._version).toBe(APP_STATE_VERSION);
        expect(exported.ui.activeViewTab).toBe(startupProfile.ui.activeViewTab);
        expect(exported.bowl.straightAisleMode).toBe('perpendicular');
        expect(exported.bowl.chamferAisleMode).toBe('radial');
        expect(AppState.bowl).not.toHaveProperty('clipEnabled');
        expect(AppState.bowl).not.toHaveProperty('clipAxis');
        expect(AppState.bowl).not.toHaveProperty('clipPosition');
        expect(AppState.bowl).not.toHaveProperty('clipSide');
        expect(exported.bowl).not.toHaveProperty('clipEnabled');
        expect(exported.bowl).not.toHaveProperty('clipAxis');
        expect(exported.bowl).not.toHaveProperty('clipPosition');
        expect(exported.bowl).not.toHaveProperty('clipSide');
    });

    test('applies sport template defaults without creating a parallel state tree', () => {
        AppState.fromJSON(createDefaultAppStateData());
        AppState.tiers[1].numRows = 18;

        const state = AppState.applySportDefaults({
            sport: 'Soccer',
            template: {
                runoff: 20,
                field_length: 345,
                defaults: {
                    setup: { customRunoff: 20, focalZ: 1.5 },
                    bowl: {
                        type: 'Side1',
                        radius: 2,
                        sideLength: 340,
                        structuralDepth: 18,
                        structuralProfileMode: 'sloped',
                        straightAisleMode: 'radial',
                        chamferAisleMode: 'perpendicular'
                    },
                    occupancy: {
                        seatWidth: 21,
                        minAisle: 44,
                        maxAisle: 66,
                        seatsBetweenAisles: 18,
                        egressFactor: 0.3
                    },
                    tier1: {
                        targetCValue: 3.5,
                        numRows: 30,
                        firstRowDistance: 32,
                        firstRowElevation: 2,
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
        expect(AppState.bowl.type).toBe('Side1');
        expect(AppState.bowl.cornerRad).toBe(2);
        expect(AppState.bowl.sideLength).toBe(340);
        expect(AppState.bowl.structuralDepth).toBe(18);
        expect(AppState.bowl.structuralProfileMode).toBe('sloped');
        expect(AppState.bowl.straightAisleMode).toBe('radial');
        expect(AppState.bowl.chamferAisleMode).toBe('perpendicular');
        expect(AppState.occupancy.seatWidth).toBe(21);
        expect(AppState.occupancy.minAisle).toBe(44);
        expect(AppState.occupancy.maxAisle).toBe(66);
        expect(AppState.occupancy.seatsBetweenAisles).toBe(18);
        expect(AppState.occupancy.egressFactor).toBe(0.3);
        expect(AppState.tiers[0].cValue).toBe(3.5);
        expect(AppState.tiers[1].numRows).toBe(18);
    });

    test('creates a fresh default app state payload for project creation flows', () => {
        const first = createDefaultAppStateData();
        const second = createDefaultAppStateData();

        expect(first).not.toBe(second);
        expect(first._version).toBe(APP_STATE_VERSION);
        expect(first.sport).toBe('Ice Hockey');
        expect(second.tiers[0].enabled).toBe(true);
        expect(first.setup.focalX).toBe(-10);
        expect(first.setup.customRunoff).toBe(-10);
        expect(first.setup.focalZ).toBe(2.5);
        expect(first.bowl.cornerRad).toBe(16);
        expect(first.bowl.sideLength).toBe(200);
        expect(first.bowl.structuralDepth).toBe(6);
        expect(first.bowl.structuralProfileMode).toBe('stepped');
        expect(first.bowl.straightAisleMode).toBe('perpendicular');
        expect(first.bowl.chamferAisleMode).toBe('radial');

        first.tiers[0].numRows = 99;
        expect(second.tiers[0].cValue).toBe(3.5);
        expect(second.tiers[0].numRows).toBe(15);
        expect(second.tiers[0].firstRowDist).toBe(0);
        expect(second.tiers[0].firstRowElev).toBe(2);
    });

    test('clamps focalX while hydrating and when the selected sport changes', () => {
        AppState.fromJSON({
            sport: 'Football',
            setup: {
                focalX: -200
            }
        });

        expect(AppState.setup.focalX).toBe(-80);

        AppState.setup.focalX = -80;
        AppState.applySportDefaults({
            sport: 'Basketball',
            template: {
                runoff: 6.5,
                field_length: 94,
                field_width: 50,
                shape: 'rectangle',
                defaults: {
                    setup: { customRunoff: 6.5, focalZ: 2.5 }
                }
            }
        });

        expect(AppState.setup.focalX).toBe(-25);
    });

    test('normalizes removed legacy sport payloads to football during hydration', () => {
        AppState.fromJSON({
            sport: 'Legacy Sport',
            setup: {
                focalX: -200
            }
        });

        expect(AppState.sport).toBe('Football');
        expect(AppState.setup.focalX).toBe(-80);
        expect(AppState.toJSON().sport).toBe('Football');
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

        state.sport = 'Football';
        state.setup.customRunoff = null;
        state.setup.focalX = 12.5;
        state.setup.focalZ = 7.5;
        state.setup.sightlineVisuals = false;
        state.setup.sectionMetrics = true;
        state.bowl.type = 'Side1';
        state.bowl.cornerRad = 24;
        state.bowl.sideLength = 280;
        state.bowl.structuralDepth = 18;
        state.bowl.structuralProfileMode = 'sloped';
        state.bowl.straightAisleMode = 'perpendicular';
        state.bowl.chamferAisleMode = 'radial';
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
        expect(buildFocalXControlConfig(state)).toEqual({
            min: -80,
            max: 100,
            step: 0.1,
            value: 12.5
        });
        expect(buildFocalPointFt(state)).toEqual({ x: 12.5, z: 7.5 });
        expect(buildEgressParams(state)).toEqual({
            seatWidthIn: 22,
            maxAisleWidthIn: 66,
            minAisleWidthIn: 44,
            egressFactor: 0.3,
            seatsBetweenAisles: 18
        });
        expect(buildPrimaryTierParameters(state)).toEqual({
            targetCValue: 3.5,
            firstRowDistance: 0,
            firstRowElevation: 2,
            treadDepth: 33,
            riserHeight: 12,
            numRows: 15,
            eyeHeight: 3.75,
            eyeSetback: 6
        });
        const bowlConfig = buildBowlConfig(state, template);
        expect(bowlConfig).toEqual({
            width: 160,
            length: 360,
            shape: 'rectangle',
            radius_arc: 12,
            arc_angle: 90,
            type: 'Side1',
            corner: 'Chamfer',
            radius: 24,
            chamferReferenceOffset: 0,
            sideLength: 280,
            structuralDepth: 18,
            structuralProfileMode: 'sloped',
            straightAisleMode: 'perpendicular',
            chamferAisleMode: 'radial'
        });
        expect(bowlConfig).not.toHaveProperty('clip');
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
        expect(buildTierRowCountControlConfigs(state)).toEqual([
            { min: 5, max: 80, step: 1 },
            { min: 3, max: 60, step: 1 },
            { min: 3, max: 60, step: 1 }
        ]);
        expect(buildProfileRenderOptions(state, 18)).toEqual({
            structuralDepth: 18,
            structuralProfileMode: 'sloped',
            showSightlines: false,
            showCLabels: false,
            tierRowCountControls: [
                { min: 5, max: 80, step: 1 },
                { min: 3, max: 60, step: 1 },
                { min: 3, max: 60, step: 1 }
            ]
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
        expect(buildFocalXControlConfig(partialState)).toEqual({
            min: -80,
            max: 100,
            step: 0.1,
            value: 0
        });
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
        const bowlConfig = buildBowlConfig(partialState, null);
        expect(bowlConfig).toEqual({
            width: undefined,
            length: undefined,
            shape: undefined,
            radius_arc: undefined,
            arc_angle: undefined,
            type: undefined,
            corner: 'Chamfer',
            radius: undefined,
            chamferReferenceOffset: 0,
            sideLength: undefined,
            structuralDepth: 0,
            structuralProfileMode: 'stepped',
            straightAisleMode: 'radial',
            chamferAisleMode: 'radial'
        });
        expect(bowlConfig).not.toHaveProperty('clip');
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

    test('anchors chamfer reference offset to the first enabled tier front edge', () => {
        const state = createDefaultAppStateData();
        const template = {
            field_width: 160,
            field_length: 360,
            shape: 'rectangle'
        };

        state.tiers[0].enabled = false;
        state.tiers[1].enabled = true;
        state.tiers[1].firstRowDist = 40;
        state.tiers[1].treadDepth = 30;

        const bowlConfig = buildBowlConfig(state, template);

        expect(bowlConfig.chamferReferenceOffset).toBeCloseTo(37.5);
    });

    test('round-trips structural profile and aisle modes through canonical state serialization', () => {
        AppState.fromJSON({
            bowl: {
                structuralDepth: 24,
                structuralProfileMode: 'sloped',
                straightAisleMode: 'perpendicular',
                chamferAisleMode: 'perpendicular'
            }
        });

        expect(AppState.bowl.structuralProfileMode).toBe('sloped');
        expect(AppState.bowl.straightAisleMode).toBe('perpendicular');
        expect(AppState.bowl.chamferAisleMode).toBe('perpendicular');
        expect(AppState.toJSON().bowl.structuralProfileMode).toBe('sloped');
        expect(AppState.toJSON().bowl.straightAisleMode).toBe('perpendicular');
        expect(AppState.toJSON().bowl.chamferAisleMode).toBe('perpendicular');
    });

    test('builds pure tier initialization flags from canonical state without UI ownership', () => {
        const state = createDefaultAppStateData();

        expect(buildTierInitializationFlags(state)).toEqual({
            tier2Initialized: false,
            tier3Initialized: false
        });

        state.tiers[1].firstRowDist = 84;
        state.tiers[1].firstRowElev = 52;
        state.tiers[2].enabled = true;

        expect(buildTierInitializationFlags(state)).toEqual({
            tier2Initialized: true,
            tier3Initialized: true
        });
    });
});
