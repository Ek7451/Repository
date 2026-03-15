import { afterEach, describe, expect, test, vi } from 'vitest';

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
            focalZ: 0,
            sightlineVisuals: true,
            sectionMetrics: false
        },
        bowl: {
            type: 'Full',
            clipEnabled: false,
            clipAxis: 'X',
            clipPosition: 0,
            clipSide: 'positive'
        },
        occupancy: {
            showSeatCubes3D: false
        },
        ui: {
            activeViewTab: 'profile',
            activeResultsTab: 'statsTab'
        },
        tiers: [
            { enabled: true, profileType: 'Parabolic' },
            { enabled: false, firstRowDist: 10, firstRowElev: 0, riserHeight: 10, profileType: 'Parabolic' },
            { enabled: false, firstRowDist: 12, firstRowElev: 2, riserHeight: 10, profileType: 'Parabolic' }
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
            bowlType: createElement(),
            enableClipPlane: createElement(),
            enableTier1: createElement(),
            enableTier2: createElement(),
            enableTier3: createElement(),
            sideLengthRow: createElement(),
            clipPlaneControls: createElement(),
            tier1Section: createElement(),
            tier2Section: createElement(),
            tier3Section: createElement()
        };
        const state = createState();
        state.sport = 'Soccer';
        state.setup.customRunoff = null;
        state.bowl.type = 'Side1';
        state.bowl.clipEnabled = true;

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            getTemplate: () => ({ field_length: 360, field_width: 180 }),
            getRunoffDistance: () => 30
        });

        controls.init();
        controls.syncFromState();

        expect(elements.sportSelect.value).toBe('Soccer');
        expect(elements.customRunoffInput.value).toBe('');
        expect(elements.customRunoffSlider.value).toBe('30');
        expect(
            elements.sportSelect.children.find((option) => option.value === 'Football')?.textContent
        ).toBe("Football (360' L - 160' W)");
        expect(elements.sideLengthRow.style.display).toBe('flex');
        expect(elements.clipPlaneControls.style.display).toBe('block');
        expect(elements.tier1Section.classList.contains('tier-disabled')).toBe(false);
        expect(elements.tier2Section.classList.contains('tier-disabled')).toBe(true);
    });

    test('owns clip position control range sync for the shared AppState UI', () => {
        const elements = {
            clipPositionSlider: createElement(),
            clipPositionInput: createElement()
        };

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state: createState()
        });

        controls.syncClipPositionRange({ min: -24, max: 88, value: 42 });

        expect(elements.clipPositionSlider.min).toBe('-24');
        expect(elements.clipPositionSlider.max).toBe('88');
        expect(elements.clipPositionSlider.value).toBe('42');
        expect(elements.clipPositionInput.min).toBe('-24');
        expect(elements.clipPositionInput.max).toBe('88');
        expect(elements.clipPositionInput.value).toBe('42');
    });

    test('owns control bindings while mutating only the single shared AppState object', () => {
        const elements = {
            sportSelect: createElement(),
            customRunoffInput: createElement({ value: '25' }),
            customRunoffSlider: createElement({ value: '25' }),
            enableTier2: createElement(),
            enableTier3: createElement(),
            tier2Section: createElement(),
            tier3Section: createElement(),
            toggleSightlinesBtn: createElement({ checked: true }),
            toggleSightlinesBtnField: createElement({ checked: true })
        };
        const state = createState();
        const onSportChanged = vi.fn();
        const onStateChanged = vi.fn();
        const getTierDefaults = vi.fn((tierNum) => (
            tierNum === 2
                ? { firstRowDist: 140, firstRowElev: 28, riserHeight: 12 }
                : { firstRowDist: 180, firstRowElev: 44, riserHeight: 12 }
        ));

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            getRunoffDistance: () => 25,
            onSportChanged,
            onStateChanged,
            getTierDefaults
        });

        controls.init();

        elements.sportSelect.value = 'Soccer';
        elements.sportSelect.dispatch('change');
        expect(state.sport).toBe('Soccer');
        expect(onSportChanged).toHaveBeenCalledTimes(1);

        onStateChanged.mockClear();
        elements.customRunoffInput.value = '';
        elements.customRunoffInput.dispatch('input');
        expect(state.setup.customRunoff).toBeNull();
        expect(elements.customRunoffSlider.value).toBe('25');
        expect(onStateChanged).toHaveBeenCalledTimes(1);

        onStateChanged.mockClear();
        elements.enableTier2.checked = true;
        elements.enableTier2.dispatch('change');
        expect(state.tiers[1]).toMatchObject({
            enabled: true,
            firstRowDist: 140,
            firstRowElev: 28,
            riserHeight: 12
        });
        expect(getTierDefaults).toHaveBeenCalledWith(2);
        expect(elements.tier2Section.classList.contains('tier-disabled')).toBe(false);
        expect(onStateChanged).toHaveBeenCalledTimes(1);

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
        expect(getTierDefaults).not.toHaveBeenCalledWith(3);
    });
});
