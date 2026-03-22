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

function createElement({
    id = '',
    value = '',
    checked = false,
    type = 'number',
    min = '',
    max = '',
    step = '',
    hidden = false
} = {}) {
    const listeners = new Map();
    const element = {
        id,
        value,
        checked,
        type,
        min,
        max,
        step,
        hidden,
        inputMode: '',
        autocomplete: '',
        spellcheck: true,
        style: {},
        dataset: {},
        textContent: '',
        classList: createClassList(),
        children: [],
        appendChild: vi.fn((child) => {
            element.children.push(child);
        }),
        removeChild: vi.fn((child) => {
            element.children = element.children.filter((entry) => entry !== child);
        }),
        replaceChildren: vi.fn((...children) => {
            element.children = [...children];
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
                preventDefault: vi.fn(),
                ...overrides
            };
            (listeners.get(eventName) || []).forEach((handler) => handler(event));
        }
    };

    return element;
}

function createDocumentStub(elements) {
    const listeners = new Map();

    return {
        activeElement: null,
        getElementById: vi.fn((id) => {
            const element = elements[id] ?? null;
            if (element && !element.id) {
                element.id = id;
            }
            return element;
        }),
        createElement: vi.fn(() => createElement()),
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
                target: null,
                preventDefault: vi.fn(),
                ...overrides
            };
            (listeners.get(eventName) || []).forEach((handler) => handler(event));
        }
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
            type: 'Full',
            structuralProfileMode: 'stepped',
            straightAisleMode: 'radial',
            chamferAisleMode: 'radial'
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
            numRowsInput: createElement(),
            numRowsSlider: createElement(),
            t2NumRowsInput: createElement(),
            t2NumRowsSlider: createElement(),
            t3NumRowsInput: createElement(),
            t3NumRowsSlider: createElement(),
            bowlType: createElement(),
            straightAisleMode: createElement(),
            chamferAisleMode: createElement(),
            enableTier1: createElement(),
            enableTier2: createElement(),
            enableTier3: createElement(),
            sideLengthRow: createElement(),
            sideLengthRowLabel: createElement(),
            sideLength34Row: createElement(),
            sideLength34RowLabel: createElement(),
            bowlSideLengthInput: createElement(),
            bowlSideLengthSlider: createElement(),
            bowlEndLengthInput: createElement(),
            bowlEndLengthSlider: createElement(),
            tier1Section: createElement(),
            tier2Section: createElement(),
            tier3Section: createElement()
        };
        const state = createState();
        state.sport = 'Soccer';
        state.setup.customRunoff = null;
        state.setup.focalX = -30.2;
        state.bowl.type = 'Side1';
        state.bowl.sideLength = 280;
        state.bowl.endLength = 340;
        state.bowl.straightAisleMode = 'perpendicular';
        state.bowl.chamferAisleMode = 'radial';

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
        expect(elements.numRowsInput.min).toBe('5');
        expect(elements.numRowsInput.max).toBe('80');
        expect(elements.numRowsInput.step).toBe('1');
        expect(elements.t2NumRowsInput.min).toBe('3');
        expect(elements.t2NumRowsInput.max).toBe('60');
        expect(elements.t3NumRowsSlider.max).toBe('60');
        expect(elements.straightAisleMode.value).toBe('perpendicular');
        expect(elements.chamferAisleMode.value).toBe('radial');
        expect(elements.bowlSideLengthInput.value).toBe('280');
        expect(elements.bowlEndLengthInput.value).toBe('340');
        expect(elements.sideLengthRow.hidden).toBe(false);
        expect(elements.sideLength34Row.hidden).toBe(true);
        expect(
            elements.sportSelect.children.find((option) => option.value === 'Football')?.textContent
        ).toContain('Football');
        expect(elements.sportSelect.children.map((option) => option.value)).toEqual([
            'Ice Hockey',
            'Football',
            'Soccer',
            'Basketball',
            'Baseball',
            'Track'
        ]);
        expect(elements.tier1Section.classList.contains('tier-disabled')).toBe(false);
        expect(elements.tier2Section.classList.contains('tier-disabled')).toBe(true);
    });

    test('repopulates bowl type options from real sport templates and switches visibility for the new bowl families', () => {
        const elements = {
            sportSelect: createElement(),
            bowlType: createElement(),
            sideLengthRow: createElement(),
            sideLengthRowLabel: createElement(),
            sideLength34Row: createElement(),
            sideLength34RowLabel: createElement(),
            bowlSideLengthInput: createElement(),
            bowlSideLengthSlider: createElement(),
            bowlEndLengthInput: createElement(),
            bowlEndLengthSlider: createElement()
        };
        const state = createState();
        state.sport = 'Football';
        state.bowl.type = 'Sides3';
        state.bowl.sideLength = 300;
        state.bowl.endLength = 325;

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state
        });

        controls.init();
        controls.syncFromState();
        controls._populateBowlTypes(getTemplate('Football'));

        expect(elements.bowlType.children.map((option) => option.value)).toEqual([
            'Full',
            'U-End1',
            'U-End2',
            'Side1',
            'Sides',
            'Sides3',
            'Sides4'
        ]);
        expect(elements.sideLengthRow.hidden).toBe(false);
        expect(elements.sideLength34Row.hidden).toBe(false);
        expect(elements.sideLengthRowLabel.textContent).toBe('Sides Length 1/2');
        expect(elements.sideLength34RowLabel.textContent).toBe('Sides Length 3/4');

        controls._populateBowlTypes(getTemplate('Track'));
        expect(elements.bowlType.children.map((option) => option.value)).toEqual([
            'Full',
            'U-End1',
            'U-End2',
            'Side1',
            'Sides',
            'Sides3',
            'Sides4'
        ]);

        controls._syncBowlLengthVisibility('U-End1');
        expect(elements.sideLengthRow.hidden).toBe(true);
        expect(elements.sideLength34Row.hidden).toBe(false);
        expect(elements.sideLength34RowLabel.textContent).toBe('Open Ends Length');

        controls._syncBowlLengthVisibility('Full');
        expect(elements.sideLengthRow.hidden).toBe(true);
        expect(elements.sideLength34Row.hidden).toBe(true);
    });

    test('switches baseball controls to the baseball-only bowl palette and relabels the leg-length inputs', () => {
        const elements = {
            sportSelect: createElement(),
            bowlType: createElement(),
            bowlCornerRadLabel: createElement(),
            sideLengthRow: createElement(),
            sideLengthRowLabel: createElement(),
            sideLength34Row: createElement(),
            sideLength34RowLabel: createElement(),
            bowlSideLengthInput: createElement(),
            bowlSideLengthSlider: createElement(),
            bowlEndLengthInput: createElement(),
            bowlEndLengthSlider: createElement()
        };
        const state = createState();
        state.sport = 'Baseball';
        state.bowl.type = 'BaseballStandard';
        state.bowl.sideLength = 325;
        state.bowl.endLength = 325;

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state
        });

        controls.init();
        controls.syncFromState();
        controls._populateBowlTypes(getTemplate('Baseball'));

        expect(elements.bowlType.children.map((option) => option.value)).toEqual([
            'Side1',
            'Sides',
            'BaseballStandard'
        ]);
        expect(elements.bowlType.children.map((option) => option.textContent)).toEqual([
            '1-Sided',
            '2-Sided',
            'Standard'
        ]);
        expect(elements.sideLengthRow.hidden).toBe(false);
        expect(elements.sideLength34Row.hidden).toBe(true);
        expect(elements.sideLengthRowLabel.textContent).toBe('Leg Length');
        expect(elements.bowlCornerRadLabel.textContent).toBe('Chamfer');
    });

    test('owns control bindings while mutating only the single shared AppState object', () => {
        const elements = {
            sportSelect: createElement(),
            customRunoffInput: createElement({ value: '25' }),
            customRunoffSlider: createElement({ value: '25' }),
            focalXInput: createElement({ value: '0' }),
            focalXSlider: createElement({ value: '0' }),
            bowlEndLengthInput: createElement({ value: '300' }),
            bowlEndLengthSlider: createElement({ value: '300' }),
            straightAisleMode: createElement({ value: 'radial' }),
            chamferAisleMode: createElement({ value: 'radial' }),
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
        expect(onChange).not.toHaveBeenCalled();
        elements.customRunoffInput.dispatch('blur');
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
        expect(onChange).not.toHaveBeenCalled();
        const focalXEnterEvent = {
            key: 'Enter',
            preventDefault: vi.fn()
        };
        elements.focalXInput.dispatch('keydown', focalXEnterEvent);
        expect(focalXEnterEvent.preventDefault).toHaveBeenCalledTimes(1);
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

        onChange.mockClear();
        elements.straightAisleMode.value = 'perpendicular';
        elements.straightAisleMode.dispatch('change');
        expect(state.bowl.straightAisleMode).toBe('perpendicular');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'straightAisleMode'
        });

        onChange.mockClear();
        elements.bowlEndLengthInput.value = '355';
        elements.bowlEndLengthInput.dispatch('input');
        expect(state.bowl.endLength).toBe(355);
        expect(elements.bowlEndLengthSlider.value).toBe('355');
        expect(onChange).not.toHaveBeenCalled();
        elements.bowlEndLengthInput.dispatch('blur');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'bowlEndLengthInput'
        });

        onChange.mockClear();
        elements.chamferAisleMode.value = 'perpendicular';
        elements.chamferAisleMode.dispatch('change');
        expect(state.bowl.chamferAisleMode).toBe('perpendicular');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'chamferAisleMode'
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

    test('preserves fractional input strings while keeping paired controls synced', () => {
        const elements = {
            focalZInput: createElement({ value: '0', step: '0.5' }),
            focalZSlider: createElement({ value: '0', step: '0.5' })
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

        elements.focalZInput.value = '0.';
        elements.focalZInput.dispatch('input');
        expect(state.setup.focalZ).toBe(0);
        expect(elements.focalZInput.value).toBe('0.');
        expect(elements.focalZSlider.value).toBe('0');
        expect(onChange).not.toHaveBeenCalled();

        onChange.mockClear();
        elements.focalZInput.value = '0.05';
        elements.focalZInput.dispatch('input');
        expect(state.setup.focalZ).toBe(0.05);
        expect(elements.focalZInput.value).toBe('0.05');
        expect(elements.focalZSlider.value).toBe('0.05');
        expect(onChange).not.toHaveBeenCalled();
        elements.focalZInput.dispatch('blur');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'focalZInput'
        });
    });

    test('keeps fractional controls as native number inputs and restores canonical values on blur', () => {
        const elements = {
            focalZInput: createElement({ value: '0', step: '0.5' }),
            focalZSlider: createElement({ value: '0', step: '0.5' }),
            numRowsInput: createElement({ value: '30', step: '1' }),
            numRowsSlider: createElement({ value: '30', step: '1' })
        };
        const state = createState();
        const onChange = vi.fn();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            onChange
        });

        controls.init();

        expect(elements.focalZInput.type).toBe('number');
        expect(elements.focalZInput.inputMode).toBe('');
        expect(elements.focalZInput.autocomplete).toBe('');
        expect(elements.focalZInput.spellcheck).toBe(true);
        expect(elements.focalZInput.classList.contains('numeric-text-input')).toBe(false);
        expect(elements.numRowsInput.type).toBe('number');
        expect(elements.numRowsInput.classList.contains('numeric-text-input')).toBe(false);

        elements.focalZInput.value = '.';
        elements.focalZInput.dispatch('input');
        expect(state.setup.focalZ).toBe(0);
        expect(onChange).not.toHaveBeenCalled();
        elements.focalZInput.dispatch('blur');
        expect(elements.focalZInput.value).toBe('0');
        expect(elements.focalZSlider.value).toBe('0');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'focalZInput'
        });
    });

    test('commits manual number entry only once when Enter is followed by blur', () => {
        const elements = {
            seatWidthInput: createElement({ value: '20', step: '0.5' }),
            seatWidthSlider: createElement({ value: '20', step: '0.5' })
        };
        const state = createState();
        state.occupancy.seatWidth = 20;
        const onChange = vi.fn();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            onChange
        });

        controls.init();

        elements.seatWidthInput.value = '21.5';
        elements.seatWidthInput.dispatch('input');
        expect(state.occupancy.seatWidth).toBe(21.5);
        expect(onChange).not.toHaveBeenCalled();

        elements.seatWidthInput.dispatch('keydown', {
            key: 'Enter',
            preventDefault: vi.fn()
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({
            reason: 'state',
            controlId: 'seatWidthInput'
        });

        elements.seatWidthInput.dispatch('blur');
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    test('commits number input changes immediately when using the native stepper arrows', () => {
        const elements = {
            seatWidthInput: createElement({ value: '20', step: '0.5' }),
            seatWidthSlider: createElement({ value: '20', step: '0.5' })
        };
        const state = createState();
        state.occupancy.seatWidth = 20;
        const onChange = vi.fn();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            onChange
        });

        controls.init();

        elements.seatWidthInput.dispatch('pointerdown');
        elements.seatWidthInput.value = '20.5';
        elements.seatWidthInput.dispatch('input');

        expect(state.occupancy.seatWidth).toBe(20.5);
        expect(elements.seatWidthSlider.value).toBe('20.5');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({
            reason: 'state',
            controlId: 'seatWidthInput'
        });
    });

    test('commits pending manual input when clicking anywhere else on the screen', () => {
        const elements = {
            seatWidthInput: createElement({ value: '20', step: '0.5' }),
            seatWidthSlider: createElement({ value: '20', step: '0.5' }),
            outsideTarget: createElement({ id: 'outsideTarget', type: 'button' })
        };
        const state = createState();
        state.occupancy.seatWidth = 20;
        const onChange = vi.fn();
        const documentStub = createDocumentStub(elements);

        vi.stubGlobal('document', documentStub);

        const controls = new EditorControls({
            state,
            onChange
        });

        controls.init();

        documentStub.activeElement = elements.seatWidthInput;
        elements.seatWidthInput.value = '21.5';
        elements.seatWidthInput.dispatch('input');
        expect(onChange).not.toHaveBeenCalled();

        documentStub.dispatch('pointerdown', { target: elements.outsideTarget });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({
            reason: 'state',
            controlId: 'seatWidthInput'
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

    test('applies tier canvas row counts through the shared AppState and syncs the paired inputs', () => {
        const elements = {
            t2NumRowsInput: createElement(),
            t2NumRowsSlider: createElement()
        };
        elements.t2NumRowsInput.min = '3';
        elements.t2NumRowsInput.max = '60';
        elements.t2NumRowsInput.step = '1';
        elements.t2NumRowsSlider.min = '3';
        elements.t2NumRowsSlider.max = '60';
        elements.t2NumRowsSlider.step = '1';

        const state = createState();
        state.tiers[1].enabled = true;
        const onChange = vi.fn();

        vi.stubGlobal('document', createDocumentStub(elements));

        const controls = new EditorControls({
            state,
            onChange
        });

        expect(controls.applyTierCanvasRowCount({
            tierIndex: 1,
            numRows: 61.7
        })).toBe(true);
        expect(state.tiers[1].numRows).toBe(60);
        expect(elements.t2NumRowsInput.value).toBe('60');
        expect(elements.t2NumRowsSlider.value).toBe('60');
        expect(onChange).toHaveBeenCalledWith({
            reason: 'state',
            controlId: 'profileCanvasTierRowCountDrag'
        });

        onChange.mockClear();
        expect(controls.applyTierCanvasRowCount({
            tierIndex: 1,
            numRows: 60
        })).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
    });
});
