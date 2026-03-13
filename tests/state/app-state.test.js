import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_STARTUP_PROFILE } from '../../core/default-starting-profile.js';
import { APP_STATE_VERSION, AppState } from '../../state/app-state.js';

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
});
