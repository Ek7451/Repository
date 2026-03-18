import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceShell } from '../../ui/workspace-shell.js';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function createClassList(initialValues = []) {
    const values = new Set(initialValues);

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

function createTabButton(attributeName, attributeValue) {
    return {
        classList: createClassList(),
        getAttribute(name) {
            return name === attributeName ? attributeValue : null;
        }
    };
}

function createPanel(id) {
    return {
        id,
        scrollTop: 99,
        classList: createClassList()
    };
}

function createCanvas(width, height) {
    return {
        width: 0,
        height: 0,
        parentElement: {
            getBoundingClientRect: () => ({ width, height })
        }
    };
}

describe('Workspace shell characterization', () => {
    it('initializes from the saved theme and persists explicit theme changes', () => {
        const onThemeChanged = vi.fn();
        const documentElement = {
            setAttribute: vi.fn(),
            getAttribute: vi.fn(() => 'light')
        };
        const body = {
            classList: createClassList()
        };
        vi.stubGlobal('document', {
            documentElement,
            body
        });
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => 'dark'),
            setItem: vi.fn()
        });

        const shell = new WorkspaceShell({ onThemeChanged });
        shell._refreshThemeToggleButton = vi.fn();
        shell._bindThemeToggle = vi.fn();
        shell._bindSidebarChrome = vi.fn();
        shell._bindTabs = vi.fn();
        shell._bindFeedbackButton = vi.fn();
        shell._bindWindowResize = vi.fn();
        shell._bindCollapsibleSections = vi.fn();
        shell._initTooltips = vi.fn();

        shell.init();
        shell.applyTheme('light');

        expect(documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
        expect(documentElement.setAttribute).toHaveBeenLastCalledWith('data-theme', 'light');
        expect(localStorage.getItem).toHaveBeenCalledWith('jlg-seating-theme');
        expect(localStorage.setItem).toHaveBeenCalledWith('jlg-seating-theme', 'light');
        expect(onThemeChanged).toHaveBeenNthCalledWith(1, 'dark', { rerender: false });
        expect(onThemeChanged).toHaveBeenNthCalledWith(2, 'light', { rerender: true });
        expect(shell.getTheme()).toBe('light');
    });

    it('activates view and results tabs through explicit shell methods', () => {
        vi.useFakeTimers();

        const onViewTabChanged = vi.fn();
        const onResultsTabChanged = vi.fn();
        const viewButtons = [
            createTabButton('data-tab', 'profile'),
            createTabButton('data-tab', 'field'),
            createTabButton('data-tab', 'scene3d')
        ];
        const viewPanels = [
            createPanel('profilePanel'),
            createPanel('fieldPanel'),
            createPanel('scene3dPanel')
        ];
        const resultButtons = [
            createTabButton('data-target', 'statsTab'),
            createTabButton('data-target', 'detailsTab')
        ];
        const resultPanels = [
            createPanel('statsTab'),
            createPanel('detailsTab')
        ];
        const rightSidebar = {
            classList: createClassList(['collapsed'])
        };
        vi.stubGlobal('document', {
            querySelectorAll: vi.fn((selector) => {
                if (selector === '.view-tab-btn') return viewButtons;
                if (selector === '.view-panel') return viewPanels;
                if (selector === '.results-tab-btn') return resultButtons;
                if (selector === '.results-tab-panel') return resultPanels;
                return [];
            }),
            querySelector: vi.fn((selector) => (
                selector === '.right-sidebar' ? rightSidebar : null
            ))
        });
        vi.stubGlobal('window', {
            dispatchEvent: vi.fn()
        });

        const shell = new WorkspaceShell({
            onViewTabChanged,
            onResultsTabChanged
        });
        shell._notifyScene3DResize = vi.fn();

        shell.setViewTab('field');
        shell.setResultsTab('detailsTab');
        vi.runAllTimers();

        expect(viewButtons[1].classList.contains('active')).toBe(true);
        expect(viewPanels[1].classList.contains('active')).toBe(true);
        expect(viewButtons[0].classList.contains('active')).toBe(false);
        expect(resultButtons[1].classList.contains('active')).toBe(true);
        expect(resultPanels[1].classList.contains('active')).toBe(true);
        expect(resultPanels[1].scrollTop).toBe(0);
        expect(rightSidebar.classList.contains('collapsed')).toBe(false);
        expect(onViewTabChanged).toHaveBeenCalledWith('field');
        expect(onResultsTabChanged).toHaveBeenCalledWith('detailsTab');
        expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
        expect(shell._notifyScene3DResize).toHaveBeenCalledTimes(1);
    });

    it('connects canvases and resizes them through a ResizeObserver-backed hookup', () => {
        const fieldCanvas = createCanvas(640, 320);
        const profileCanvas = createCanvas(480, 240);
        const onResize = vi.fn();
        const observedTargets = [];
        /** @type {{ callback: () => void } | null} */
        let observerInstance = null;

        class FakeResizeObserver {
            constructor(callback) {
                observerInstance = { callback };
            }

            observe(target) {
                observedTargets.push(target);
            }

            disconnect() {}
        }

        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => {
                if (id === 'fieldCanvas') return fieldCanvas;
                if (id === 'profileCanvas') return profileCanvas;
                return null;
            })
        });
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);

        const shell = new WorkspaceShell();
        const canvases = shell.connectViewCanvases({ onResize });

        observerInstance?.callback();

        expect(canvases).toEqual({ fieldCanvas, profileCanvas });
        expect(fieldCanvas.width).toBe(640);
        expect(fieldCanvas.height).toBe(320);
        expect(profileCanvas.width).toBe(480);
        expect(profileCanvas.height).toBe(240);
        expect(observedTargets).toEqual([
            fieldCanvas.parentElement,
            profileCanvas.parentElement
        ]);
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    it('routes per-view resize side effects through the active workspace tab', () => {
        const fieldCanvas = createCanvas(500, 250);
        const profileCanvas = createCanvas(700, 350);
        const onFieldActivated = vi.fn();
        const onProfileActivated = vi.fn();
        const onScene3DActivated = vi.fn();

        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const shell = new WorkspaceShell();
        shell.ensure3DContainerSize = vi.fn();

        shell.handleViewTabChanged('field', { fieldCanvas, onFieldActivated });
        shell.handleViewTabChanged('profile', { profileCanvas, onProfileActivated });
        shell.handleViewTabChanged('scene3d', { onScene3DActivated });

        expect(fieldCanvas.width).toBe(500);
        expect(fieldCanvas.height).toBe(250);
        expect(profileCanvas.width).toBe(700);
        expect(profileCanvas.height).toBe(350);
        expect(onFieldActivated).toHaveBeenCalledTimes(1);
        expect(onProfileActivated).toHaveBeenCalledTimes(1);
        expect(shell.ensure3DContainerSize).toHaveBeenCalledTimes(1);
        expect(onScene3DActivated).toHaveBeenCalledTimes(1);
    });
});
