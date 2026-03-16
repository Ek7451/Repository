import { afterEach, describe, expect, test, vi } from 'vitest';

import { getTemplate } from '../../core/sports-templates.js';
import { buildNextTierDefaultsFromTiers } from '../../core/profile-solver.js';
import { buildFocalPointFt } from '../../state/app-state.js';
import { EditorControls } from '../../ui/editor-controls.js';

function createClassList() {
    const values = new Set();

    return {
        add(className) {
            values.add(className);
        },
        remove(className) {
            values.delete(className);
        },
        toggle(className, force) {
            if (force === undefined) {
                if (values.has(className)) {
                    values.delete(className);
                    return false;
                }
                values.add(className);
                return true;
            }

            if (force) {
                values.add(className);
                return true;
            }

            values.delete(className);
            return false;
        },
        contains(className) {
            return values.has(className);
        }
    };
}

function createElement({ id = '', value = '', checked = false } = {}) {
    const listeners = new Map();
    const element = {
        id,
        value,
        checked,
        style: {},
        dataset: {},
        textContent: '',
        classList: createClassList(),
        children: [],
        appendChild: vi.fn((child) => {
            element.children.push(child);
        }),
        addEventListener: vi.fn((eventName, handler) => {
            const existing = listeners.get(eventName) || [];
            existing.push(handler);
            listeners.set(eventName, existing);
        }),
        removeEventListener: vi.fn((eventName, handler) => {
            const existing = listeners.get(eventName) || [];
            listeners.set(eventName, existing.filter((entry) => entry !== handler));
        }),
        dispatch(eventName, overrides = {}) {
            const event = {
                target: element,
                ...overrides
            };
            (listeners.get(eventName) || []).forEach((handler) => handler(event));
        }
    };

    return element;
}

function createDocumentStub(elements) {
    return {
        getElementById: vi.fn((id) => elements[id] ?? null),
        createElement: vi.fn(() => createElement())
    };
}

function createState() {
    return {
        sport: 'Football',
        setup: {
            customRunoff: 25,
            focalX: 0,
            focalZ: 0,
            sightlineVisuals: true,
            sectionMetrics: false
        },
        bowl: {
            type: 'Full'
        },
        occupancy: {
            showSeatCubes3D: false
        },
        ui: {
            activeViewTab: 'profile',
            activeResultsTab: 'statsTab'
        },
        tiers: [
            {
                enabled: true,
                profileType: 'Parabolic',
                cValue: 4,
                numRows: 30,
                firstRowDist: 45,
                firstRowElev: 6,
                treadDepth: 33,
                riserHeight: 10,
                eyeHeight: 3.75,
                eyeSetback: 6
            },
            {
                enabled: false,
                profileType: 'Parabolic',
                cValue: 4,
                numRows: 10,
                firstRowDist: 10,
                firstRowElev: 0,
                treadDepth: 33,
                riserHeight: 10,
                eyeHeight: 3.75,
                eyeSetback: 6
            },
            {
                enabled: false,
                profileType: 'Parabolic',
                cValue: 4,
                numRows: 10,
                firstRowDist: 10,
                firstRowElev: 0,
                treadDepth: 33,
                riserHeight: 10,
                eyeHeight: 3.75,
                eyeSetback: 6
            }
        ]
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('EditorControls', () => {
    test('syncs the live AppState into editor DOM controls only', () => {
        const elements = {
            sportSelect: createElement(),
            customRunoffInput: createElement(),
            customRunoffSlider: createElement(),
            focalXInput: createElement(),
            focalXSlider: createElement(),
            bowlType: createElement(),
            enableTier1: createElement(),
            enableTier2: createElement(),
            enableTier3: createElement(),
            sideLengthRow: createElement(),
            tier1Section: createElement(),
            tier2Section: createElement(),
            tier3Section: createElement()
        };
        const state = createState();
        state.sport = 'Soccer';
        state.setup.customRunoff = null;
        state.setup.focalX = -30.2;
        state.bowl.type = 'Side1';

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state
        });

        controls.init();
        controls.syncFromState();

        expect(elements.sportSelect.value).toBe('Soccer');
        expect(elements.customRunoffInput.value).toBe('');
        expect(elements.customRunoffSlider.value).toBe(String(getTemplate('Soccer')?.runoff || 0));
        expect(elements.focalXInput.value).toBe('-30.2');
        expect(elements.focalXSlider.value).toBe('-30.2');
        expect(elements.focalXInput.min).toBe('-111.5');
        expect(elements.focalXInput.max).toBe('100');
        expect(elements.focalXInput.step).toBe('0.1');
        expect(elements.focalXSlider.min).toBe('-111.5');
        expect(
            elements.sportSelect.children.find((option) => option.value === 'Football')?.textContent
        ).toContain('Football');
        expect(elements.sideLengthRow.style.display).not.toBe('none');
        expect(elements.tier1Section.classList.contains('tier-disabled')).toBe(false);
        expect(elements.tier2Section.classList.contains('tier-disabled')).toBe(true);
    });

    test('owns control bindings while mutating only the single shared AppState object', () => {
        const elements = {
            sportSelect: createElement(),
            customRunoffInput: createElement({ value: '25' }),
            customRunoffSlider: createElement({ value: '25' }),
            focalXInput: createElement({ value: '0' }),
            focalXSlider: createElement({ value: '0' }),
            enableTier2: createElement(),
            enableTier3: createElement(),
            tier2Section: createElement(),
            tier3Section: createElement(),
            toggleSightlinesBtn: createElement({ checked: true }),
            toggleSightlinesBtnField: createElement({ checked: true })
        };
        const state = createState();
        const onChange = vi.fn();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            onChange
        });

        controls.init();
        controls.syncFromState();

        elements.sportSelect.value = 'Soccer';
        elements.sportSelect.dispatch('change');
        expect(state.sport).toBe('Soccer');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'sport',
            controlId: 'sportSelect'
        });

        controls.syncFromState();
        expect(elements.focalXInput.min).toBe('-111.5');
        expect(elements.focalXSlider.min).toBe('-111.5');

        onChange.mockClear();
        elements.customRunoffInput.value = '';
        elements.customRunoffInput.dispatch('input');
        expect(state.setup.customRunoff).toBeNull();
        expect(elements.customRunoffSlider.value).toBe(String(getTemplate('Soccer')?.runoff || 0));
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'customRunoffInput'
        });

        onChange.mockClear();
        elements.focalXInput.value = '-500';
        elements.focalXInput.dispatch('input');
        expect(state.setup.focalX).toBe(-111.5);
        expect(elements.focalXInput.value).toBe('-111.5');
        expect(elements.focalXSlider.value).toBe('-111.5');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'focalXInput'
        });

        onChange.mockClear();
        elements.focalXSlider.value = '150';
        elements.focalXSlider.dispatch('input');
        expect(state.setup.focalX).toBe(100);
        expect(elements.focalXInput.value).toBe('100');
        expect(elements.focalXSlider.value).toBe('100');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'focalXSlider'
        });

        const tier2Defaults = buildNextTierDefaultsFromTiers(state.tiers, buildFocalPointFt(state), 2);
        onChange.mockClear();
        elements.enableTier2.checked = true;
        elements.enableTier2.dispatch('change');
        expect(state.tiers[1]).toMatchObject({
            enabled: true,
            firstRowDist: tier2Defaults.firstRowDist,
            firstRowElev: tier2Defaults.firstRowElev,
            riserHeight: 12
        });
        expect(elements.tier2Section.classList.contains('tier-disabled')).toBe(false);
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'enableTier2'
        });

        state.tiers[2].firstRowDist = 12;
        state.tiers[2].firstRowElev = 2;
        const tier3ManualEditTarget = {
            id: 't3FirstRowDistInput',
            closest: (selector) => (selector === '.section-body' ? {} : null)
        };
        elements.tier3Section.dispatch('input', { target: tier3ManualEditTarget });

        elements.enableTier3.checked = true;
        elements.enableTier3.dispatch('change');
        expect(state.tiers[2]).toMatchObject({
            enabled: true,
            firstRowDist: 12,
            firstRowElev: 2,
            riserHeight: 10
        });
    });

    test('applies tier defaults only on first enable and preserves later user positions', () => {
        const elements = {
            enableTier2: createElement(),
            enableTier3: createElement(),
            tier2Section: createElement(),
            tier3Section: createElement()
        };
        const state = createState();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state
        });

        controls.init();
        controls.syncFromState();
        controls.applyImportedConfig({ tiers: state.tiers });

        const tier2Defaults = buildNextTierDefaultsFromTiers(state.tiers, buildFocalPointFt(state), 2);
        elements.enableTier2.checked = true;
        elements.enableTier2.dispatch('change');
        expect(state.tiers[1]).toMatchObject({
            enabled: true,
            firstRowDist: tier2Defaults.firstRowDist,
            firstRowElev: tier2Defaults.firstRowElev,
            riserHeight: 12
        });

        state.tiers[1].firstRowDist = tier2Defaults.firstRowDist + 7;
        state.tiers[1].firstRowElev = tier2Defaults.firstRowElev + 4;
        elements.enableTier2.checked = false;
        elements.enableTier2.dispatch('change');
        elements.enableTier2.checked = true;
        elements.enableTier2.dispatch('change');
        expect(state.tiers[1]).toMatchObject({
            enabled: true,
            firstRowDist: tier2Defaults.firstRowDist + 7,
            firstRowElev: tier2Defaults.firstRowElev + 4,
            riserHeight: 12
        });

        const tier3Defaults = buildNextTierDefaultsFromTiers(state.tiers, buildFocalPointFt(state), 3);
        elements.enableTier3.checked = true;
        elements.enableTier3.dispatch('change');
        expect(state.tiers[2]).toMatchObject({
            enabled: true,
            firstRowDist: tier3Defaults.firstRowDist,
            firstRowElev: tier3Defaults.firstRowElev,
            riserHeight: 12
        });

        state.tiers[2].firstRowDist = tier3Defaults.firstRowDist + 9;
        state.tiers[2].firstRowElev = tier3Defaults.firstRowElev + 5;
        elements.enableTier3.checked = false;
        elements.enableTier3.dispatch('change');
        elements.enableTier3.checked = true;
        elements.enableTier3.dispatch('change');
        expect(state.tiers[2]).toMatchObject({
            enabled: true,
            firstRowDist: tier3Defaults.firstRowDist + 9,
            firstRowElev: tier3Defaults.firstRowElev + 5,
            riserHeight: 12
        });
    });

    test('preserves imported custom tier settings when a disabled upper tier is re-enabled', () => {
        const elements = {
            enableTier2: createElement(),
            tier2Section: createElement()
        };
        const state = createState();
        state.tiers[1].firstRowDist = 84;
        state.tiers[1].firstRowElev = 52;
        state.tiers[1].riserHeight = 14;

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state
        });

        controls.init();
        controls.syncFromState();
        controls.applyImportedConfig({ tiers: state.tiers });

        elements.enableTier2.checked = true;
        elements.enableTier2.dispatch('change');

        expect(state.tiers[1]).toMatchObject({
            enabled: true,
            firstRowDist: 84,
            firstRowElev: 52,
            riserHeight: 14
        });
    });

    test('applies tier canvas positions through the shared AppState and syncs the paired inputs', () => {
        const elements = {
            t2FirstRowDistInput: createElement(),
            t2FirstRowDistSlider: createElement(),
            t2FirstRowElevInput: createElement(),
            t2FirstRowElevSlider: createElement()
        };
        elements.t2FirstRowDistInput.min = '0';
        elements.t2FirstRowDistInput.max = '200';
        elements.t2FirstRowDistInput.step = '1';
        elements.t2FirstRowDistSlider.min = '0';
        elements.t2FirstRowDistSlider.max = '200';
        elements.t2FirstRowDistSlider.step = '5';
        elements.t2FirstRowElevInput.min = '0';
        elements.t2FirstRowElevInput.max = '30';
        elements.t2FirstRowElevInput.step = '0.5';
        elements.t2FirstRowElevSlider.min = '0';
        elements.t2FirstRowElevSlider.max = '30';
        elements.t2FirstRowElevSlider.step = '0.5';

        const state = createState();
        state.tiers[1].enabled = true;
        const onChange = vi.fn();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            onChange
        });

        expect(controls.applyTierCanvasPosition({
            tierIndex: 1,
            firstRowDist: 83.7,
            firstRowElev: 31
        })).toBe(true);
        expect(state.tiers[1]).toMatchObject({
            firstRowDist: 84,
            firstRowElev: 30
        });
        expect(elements.t2FirstRowDistInput.value).toBe('84');
        expect(elements.t2FirstRowDistSlider.value).toBe('84');
        expect(elements.t2FirstRowElevInput.value).toBe('30');
        expect(elements.t2FirstRowElevSlider.value).toBe('30');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'profileCanvasTierDrag'
        });
        onChange.mockClear();
        expect(controls.applyTierCanvasPosition({
            tierIndex: 1,
            firstRowDist: 84,
            firstRowElev: 30
        })).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });
});
