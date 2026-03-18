import { describe, expect, it, vi } from 'vitest';

import { afterEach } from 'vitest';
import { SeatingBowlApp } from '../../ui/app.js';
import * as editorShellModule from '../../ui/editor-shell.js';
import * as scene3DControllerModule from '../../ui/scene3d-controller.js';
import * as statsPanelModule from '../../ui/stats-panel.js';
import * as fieldRendererModule from '../../viz/field-renderer.js';
import * as profileRendererModule from '../../viz/profile-renderer.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

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

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.hidden = false;
        this.disabled = false;
        this.textContent = '';
        this.innerHTML = '';
        this.dataset = {};
        this.attributes = new Map();
        this.classList = createClassList();
        this.ownerDocument = null;
        this.style = {
            setProperty: vi.fn(),
            removeProperty: vi.fn()
        };
        this.focus = vi.fn(() => {
            if (this.ownerDocument) {
                this.ownerDocument.activeElement = this;
            }
        });
        this.select = vi.fn();
        this.blur = vi.fn(() => {
            if (this.ownerDocument?.activeElement === this) {
                this.ownerDocument.activeElement = null;
            }
        });
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }
}

function createEditorShellOptionManagerHarness() {
    const elements = {
        projectOptionTrigger: new FakeElement('projectOptionTrigger'),
        projectOptionLabel: new FakeElement('projectOptionLabel'),
        projectOptionMenu: new FakeElement('projectOptionMenu'),
        projectOptionManagerModal: new FakeElement('projectOptionManagerModal'),
        projectOptionManagerCloseBtn: new FakeElement('projectOptionManagerCloseBtn'),
        projectOptionManagerSearchInput: new FakeElement('projectOptionManagerSearchInput'),
        projectOptionManagerCreateBtn: new FakeElement('projectOptionManagerCreateBtn'),
        projectOptionManagerList: new FakeElement('projectOptionManagerList'),
        projectPickerModal: new FakeElement('projectPickerModal'),
        projectPickerCloseBtn: new FakeElement('projectPickerCloseBtn'),
        projectPickerSearchInput: new FakeElement('projectPickerSearchInput'),
        projectPickerCreateBtn: new FakeElement('projectPickerCreateBtn'),
        projectPickerError: new FakeElement('projectPickerError'),
        projectPickerList: new FakeElement('projectPickerList'),
        'projectOptionNameInput-option-1': new FakeElement('projectOptionNameInput-option-1'),
        'projectOptionNameInput-option-2': new FakeElement('projectOptionNameInput-option-2')
    };
    const leftSidebar = new FakeElement('leftSidebar');
    const mainArea = new FakeElement('mainArea');
    const rightSidebar = new FakeElement('rightSidebar');
    const body = new FakeElement('body');
    const documentStub = {
        activeElement: null,
        body,
        getElementById: vi.fn((id) => {
            const element = elements[id] ?? null;
            if (element) {
                element.ownerDocument = documentStub;
            }
            return element;
        }),
        querySelector: vi.fn((selector) => {
            if (selector === '.left-sidebar') return leftSidebar;
            if (selector === '.main-area') return mainArea;
            if (selector === '.right-sidebar') return rightSidebar;
            return null;
        })
    };
    body.ownerDocument = documentStub;
    leftSidebar.ownerDocument = documentStub;
    mainArea.ownerDocument = documentStub;
    rightSidebar.ownerDocument = documentStub;
    Object.values(elements).forEach((element) => {
        element.ownerDocument = documentStub;
    });

    const projectActions = {
        createOption: vi.fn(),
        renameOption: vi.fn().mockResolvedValue(undefined),
        duplicateOption: vi.fn().mockResolvedValue(undefined),
        deleteOption: vi.fn().mockResolvedValue(undefined),
        selectOption: vi.fn().mockResolvedValue(undefined),
        createProject: vi.fn().mockResolvedValue(undefined),
        listProjects: vi.fn().mockResolvedValue([]),
        openProject: vi.fn().mockResolvedValue(undefined),
        duplicateProject: vi.fn().mockResolvedValue(undefined),
        deleteProject: vi.fn().mockResolvedValue(undefined)
    };

    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal('requestAnimationFrame', (callback) => {
        callback();
        return 1;
    });

    const shell = new editorShellModule.EditorShell({
        projectActions
    });

    shell.renderOptionChrome({
        activeOptionId: 'option-1',
        activeLabel: 'Option 1',
        activeColor: '#7aae1a',
        items: [
            {
                id: 'option-1',
                label: 'Option 1',
                color: '#b9c7a2',
                isActive: true,
                canDelete: true
            },
            {
                id: 'option-2',
                label: 'Option 2',
                color: '#7aae1a',
                isActive: false,
                canDelete: true
            }
        ],
        canCreate: true,
        canManage: true,
        canDelete: true
    });
    shell._projectOptionManagerOpen = true;
    shell._renderOptionManager();

    return {
        shell,
        projectActions,
        elements,
        leftSidebar,
        mainArea,
        rightSidebar,
        body
    };
}

describe('SeatingBowlApp shell callbacks', () => {
    it('emits project chrome updates as plain data', () => {
        const chromeUpdates = [];
        const app = new SeatingBowlApp({
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        app.state.sport = 'Soccer';
        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });
        app.setProjectMetadata({
            id: 'project-1',
            name: '',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });

        const lastUpdate = chromeUpdates.at(-1);
        expect(lastUpdate).toMatchObject({
            name: 'Soccer Study',
            canSave: true,
            metadata: { id: 'project-1' },
            session: { displayName: 'Pat Example' }
        });

        lastUpdate.metadata.id = 'mutated';
        lastUpdate.session.displayName = 'Changed';
        expect(app.getProjectMetadata().id).toBe('project-1');
    });

    it('exposes shell-facing chrome and status snapshots through explicit getters', () => {
        const app = new SeatingBowlApp();

        expect(app.getProjectChrome()).toEqual({
            name: 'Football Study',
            metadata: {
                id: null,
                name: '',
                createdAt: '',
                updatedAt: ''
            },
            session: null,
            canSave: false,
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    label: 'Option 1',
                    color: '#7aae1a',
                    isActive: true
                }
            ],
            canCreateOption: false,
            canManageOptions: false,
            canDeleteOption: false
        });
        expect(app.getProjectStatus()).toEqual({
            message: 'Project persistence ready',
            tone: 'default'
        });

        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com'
        });
        app.setProjectMetadata({
            id: 'project-1',
            name: 'Custom Study',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });
        app.setProjectStatus('Saved project', 'success');

        const chrome = app.getProjectChrome();
        const status = app.getProjectStatus();

        expect(chrome).toMatchObject({
            name: 'Custom Study',
            metadata: { id: 'project-1', name: 'Custom Study' },
            session: { displayName: 'Pat Example' },
            canSave: true
        });
        expect(status).toEqual({
            message: 'Saved project',
            tone: 'success'
        });

        chrome.metadata.name = 'Mutated';
        status.message = 'Changed';
        expect(app.getProjectChrome().metadata.name).toBe('Custom Study');
        expect(app.getProjectStatus().message).toBe('Saved project');
    });

    it('emits normalized status updates', () => {
        const statusUpdates = [];
        const app = new SeatingBowlApp({
            onStatusChanged: (status) => statusUpdates.push(status)
        });

        app.setProjectStatus('', '');
        app.setProjectStatus('Saved project', 'success');

        expect(statusUpdates).toEqual([
            { message: 'Project persistence ready', tone: 'default' },
            { message: 'Saved project', tone: 'success' }
        ]);
    });

    it('routes project chrome, status, and save-busy updates through the editor shell API', () => {
        const renderProjectChrome = vi.fn();
        const renderOptionChrome = vi.fn();
        const renderProjectStatus = vi.fn();
        const setProjectSaveBusy = vi.fn();
        const app = new SeatingBowlApp();

        app.editorShell = /** @type {any} */ ({
            renderProjectChrome,
            renderOptionChrome,
            renderProjectStatus,
            setProjectSaveBusy
        });

        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        });
        app.setProjectMetadata({
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });
        app.setProjectStatus('Saved project', 'success');
        app.setProjectSaveBusy(true);

        expect(renderProjectChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                session: expect.objectContaining({
                    displayName: 'Pat Example',
                    jobTitle: 'Design Technology Specialist II'
                })
            }),
            expect.objectContaining({ isSaveBusy: false })
        );
        expect(renderProjectStatus).toHaveBeenCalledWith({
            message: 'Saved project',
            tone: 'success'
        });
        expect(setProjectSaveBusy).toHaveBeenCalledWith(true);
    });

    it('forwards the structured project action port into the editor shell constructor', async () => {
        const projectActions = {
            saveCurrentProject: vi.fn()
        };
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas: { id: 'fieldCanvas' },
                profileCanvas: { id: 'profileCanvas' }
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ ({
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        }));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const app = new SeatingBowlApp({ projectActions });
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn()
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        await app.init();

        expect(editorShellModule.EditorShell).toHaveBeenCalledWith(expect.objectContaining({
            projectActions
        }));
    });

    it('locks project-picker actions while a prior action is still running', async () => {
        const shell = new editorShellModule.EditorShell();
        shell._renderProjectPicker = vi.fn();

        /** @type {(value?: unknown) => void} */
        let resolveFirstAction = () => {};
        const firstAction = new Promise((resolve) => {
            resolveFirstAction = resolve;
        });
        const firstCallback = vi.fn(() => firstAction);
        const secondCallback = vi.fn();

        const firstPromise = shell._runProjectPickerAction('open', 'project-1', firstCallback);
        const secondPromise = shell._runProjectPickerAction('delete', 'project-1', secondCallback);

        expect(firstCallback).toHaveBeenCalledTimes(1);
        expect(secondCallback).not.toHaveBeenCalled();
        expect(shell._projectPicker.busyAction).toBe('open');
        expect(shell._projectPicker.busyProjectId).toBe('project-1');

        resolveFirstAction();
        await firstPromise;
        await secondPromise;

        expect(shell._projectPicker.busyAction).toBe('');
        expect(shell._projectPicker.busyProjectId).toBe('');
    });

    it('opens config import from the toolbar file input instead of a legacy rail button proxy', async () => {
        const configFileInput = {
            click: vi.fn()
        };
        vi.stubGlobal('document', {
            getElementById: vi.fn((id) => (id === 'configFileInput' ? configFileInput : null))
        });

        const shell = new editorShellModule.EditorShell();
        shell._renderProjectMenu = vi.fn();

        await shell._handleProjectMenuAction('import-config');

        expect(configFileInput.click).toHaveBeenCalledTimes(1);
        expect(document.getElementById).toHaveBeenCalledWith('configFileInput');
        expect(document.getElementById).not.toHaveBeenCalledWith('loadConfigBtn');
    });

    it('replays pre-init session chrome into the editor shell during init', async () => {
        const renderProjectChrome = vi.fn();
        const renderOptionChrome = vi.fn();
        const renderProjectStatus = vi.fn();
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas: { id: 'fieldCanvas' },
                profileCanvas: { id: 'profileCanvas' }
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome,
            renderOptionChrome,
            renderProjectStatus,
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        const mockScene3DController = {
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        };

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ (mockScene3DController));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const app = new SeatingBowlApp();
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn()
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        app.setSession({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        });

        await app.init();

        expect(renderProjectChrome).toHaveBeenCalledWith(
            expect.objectContaining({
                session: expect.objectContaining({
                    displayName: 'Pat Example',
                    jobTitle: 'Design Technology Specialist II'
                })
            }),
            expect.objectContaining({ isSaveBusy: false })
        );
        expect(renderProjectStatus).toHaveBeenCalledWith({
            message: 'Project persistence ready',
            tone: 'default'
        });
    });

    it('wires the profile renderer drag callback through editor controls only', async () => {
        const fieldCanvas = { id: 'fieldCanvas' };
        const profileCanvas = { id: 'profileCanvas' };
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas,
                profileCanvas
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        const profileRendererInstance = {};
        /** @type {{
         *   onTierPositionChanged: (payload: { tierIndex: number, firstRowDist: number, firstRowElev: number }) => unknown,
         *   onTierRowCountChanged: (payload: { tierIndex: number, numRows: number }) => unknown
         * } | null} */
        let receivedOptions = null;

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation((_canvas, options) => {
            receivedOptions = /** @type {any} */ (options);
            return /** @type {any} */ (profileRendererInstance);
        });
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ ({
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        }));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const app = new SeatingBowlApp();
        const applyTierCanvasPosition = vi.fn(() => true);
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn(),
            applyTierCanvasPosition
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        await app.init();

        expect(profileRendererModule.ProfileRenderer).toHaveBeenCalledWith(
            profileCanvas,
            expect.objectContaining({
                theme: 'light',
                onTierPositionChanged: expect.any(Function)
            })
        );
        if (!receivedOptions) {
            throw new Error('ProfileRenderer options were not captured');
        }

        receivedOptions.onTierPositionChanged({
            tierIndex: 1,
            firstRowDist: 88,
            firstRowElev: 24
        });

        expect(applyTierCanvasPosition).toHaveBeenCalledWith({
            tierIndex: 1,
            firstRowDist: 88,
            firstRowElev: 24
        });
    });

    it('wires the profile renderer row-count callback through editor controls only', async () => {
        const fieldCanvas = { id: 'fieldCanvas' };
        const profileCanvas = { id: 'profileCanvas' };
        const mockShell = {
            init: vi.fn(),
            connectViewCanvases: vi.fn(() => ({
                fieldCanvas,
                profileCanvas
            })),
            getTheme: vi.fn(() => 'light'),
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            applyUrlViewOverride: vi.fn(),
            isScene3DActive: vi.fn(() => false)
        };
        /** @type {{
         *   onTierPositionChanged: (payload: { tierIndex: number, firstRowDist: number, firstRowElev: number }) => unknown,
         *   onTierRowCountChanged: (payload: { tierIndex: number, numRows: number }) => unknown
         * } | null} */
        let receivedOptions = null;

        vi.spyOn(editorShellModule, 'EditorShell').mockImplementation(() => /** @type {any} */ (mockShell));
        vi.spyOn(fieldRendererModule, 'FieldRenderer').mockImplementation(() => /** @type {any} */ ({}));
        vi.spyOn(profileRendererModule, 'ProfileRenderer').mockImplementation((_canvas, options) => {
            receivedOptions = /** @type {any} */ (options);
            return /** @type {any} */ ({});
        });
        vi.spyOn(scene3DControllerModule, 'Scene3DController').mockImplementation(() => /** @type {any} */ ({
            renderBookmarks: vi.fn(),
            applyTheme: vi.fn(),
            update: vi.fn(),
            destroy: vi.fn()
        }));
        vi.spyOn(statsPanelModule, 'StatsPanel').mockImplementation(() => /** @type {any} */ ({ update: vi.fn() }));
        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });

        const app = new SeatingBowlApp();
        const applyTierCanvasPosition = vi.fn(() => true);
        const applyTierCanvasRowCount = vi.fn(() => true);
        app.editorControls = /** @type {any} */ ({
            init: vi.fn(),
            syncFromState: vi.fn(),
            destroy: vi.fn(),
            applyTierCanvasPosition,
            applyTierCanvasRowCount
        });
        vi.spyOn(app, 'update').mockImplementation(() => {});

        await app.init();

        expect(profileRendererModule.ProfileRenderer).toHaveBeenCalledWith(
            profileCanvas,
            expect.objectContaining({
                theme: 'light',
                onTierRowCountChanged: expect.any(Function)
            })
        );
        if (!receivedOptions) {
            throw new Error('ProfileRenderer options were not captured');
        }

        receivedOptions.onTierRowCountChanged({
            tierIndex: 1,
            numRows: 18
        });

        expect(applyTierCanvasRowCount).toHaveBeenCalledWith({
            tierIndex: 1,
            numRows: 18
        });
        expect(applyTierCanvasPosition).not.toHaveBeenCalled();
    });

    it('captures live AppState snapshots separately from project save requests', () => {
        const chromeUpdates = [];
        const app = new SeatingBowlApp({
            onProjectChromeChanged: (chrome) => chromeUpdates.push(chrome)
        });

        app.state.sport = 'Basketball';
        const saveRequest = app.getProjectSaveRequest({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-16T00:00:00.000Z',
                    updatedAt: '2026-03-16T00:00:00.000Z',
                    state: { sport: 'Basketball' }
                }
            ]
        });

        expect(saveRequest.name).toBe('Basketball Study');
        expect(saveRequest.state).toMatchObject({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Basketball'
        });
        expect(app.captureStateSnapshot().sport).toBe('Basketball');
        expect(chromeUpdates.at(-1)?.name).toBe('Basketball Study');
    });

    it('only normalizes whitespace-only project names when building a save request', () => {
        const app = new SeatingBowlApp();
        app.state.sport = 'Baseball';
        app.setProjectMetadata({
            id: 'project-1',
            name: '   ',
            createdAt: '2026-03-14T00:00:00.000Z',
            updatedAt: '2026-03-14T01:00:00.000Z'
        });

        expect(app.getProjectChrome().name).toBe('');

        const saveRequest = app.getProjectSaveRequest({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Baseball',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-16T00:00:00.000Z',
                    updatedAt: '2026-03-16T00:00:00.000Z',
                    state: { sport: 'Baseball' }
                }
            ]
        });
        expect(saveRequest.name).toBe('Baseball Study');
        expect(app.getProjectMetadata().name).toBe('Baseball Study');
    });

    it('builds export context DTOs through the render runtime public API', () => {
        const app = new SeatingBowlApp();

        app.state.setup.customRunoff = null;
        app.state.setup.focalX = 18;
        app.state.setup.focalZ = 9;
        app.state.bowl.type = 'Side1';
        app.state.bowl.cornerRad = 24;
        app.state.bowl.sideLength = 280;
        app.state.bowl.structuralDepth = 18;
        app.state.occupancy.seatWidth = 22;
        app.state.occupancy.minAisle = 44;
        app.state.occupancy.maxAisle = 66;
        app.state.occupancy.seatsBetweenAisles = 18;
        app.state.occupancy.egressFactor = 0.3;

        const exportContext = app.renderRuntime.getExportContext(app.state);

        expect(exportContext.runoffDistance).toBe(25);
        expect(exportContext.focalPointFt).toEqual({ x: 18, z: 9 });
        expect(exportContext.egressParams).toEqual({
            seatWidthIn: 22,
            maxAisleWidthIn: 66,
            minAisleWidthIn: 44,
            egressFactor: 0.3,
            seatsBetweenAisles: 18
        });
        expect(exportContext.primaryTierParameters).toEqual({
            targetCValue: 4,
            firstRowDistance: 45,
            firstRowElevation: 6,
            treadDepth: 33,
            riserHeight: 10,
            numRows: 30,
            eyeHeight: 3.75,
            eyeSetback: 6
        });
        expect(exportContext.bowlConfig).toMatchObject({
            width: 160,
            length: 360,
            shape: 'rectangle',
            type: 'Side1',
            corner: 'Chamfer',
            radius: 24,
            sideLength: 280,
            structuralDepth: 18
        });
        expect(exportContext.bowlConfig).not.toHaveProperty('clip');
    });

    it('pushes explicit theme state into visualizers without requiring viz to read the DOM', () => {
        const app = new SeatingBowlApp();
        const fieldRenderer = { setTheme: vi.fn() };
        const profileRenderer = { setTheme: vi.fn() };
        const scene3DController = { applyTheme: vi.fn() };

        app.fieldRenderer = /** @type {any} */ (fieldRenderer);
        app.profileRenderer = /** @type {any} */ (profileRenderer);
        app.scene3DController = /** @type {any} */ (scene3DController);
        app.update = vi.fn();

        app.applyTheme('dark');

        expect(fieldRenderer.setTheme).toHaveBeenCalledWith('dark');
        expect(profileRenderer.setTheme).toHaveBeenCalledWith('dark');
        expect(scene3DController.applyTheme).toHaveBeenCalledWith('dark');
        expect(app.update).toHaveBeenCalledTimes(1);
    });

    it('routes view-tab canvas lookup through the shell viewport controller', () => {
        const app = new SeatingBowlApp();
        const fieldCanvas = { parentElement: { id: 'fieldParent' } };
        const profileCanvas = { parentElement: { id: 'profileParent' } };
        const update = vi.spyOn(app, 'update').mockImplementation(() => {});

        app.editorShell = /** @type {any} */ ({
            getViewCanvases: vi.fn(() => ({
                fieldCanvas,
                profileCanvas
            })),
            handleViewTabChanged: vi.fn((tab, handlers) => {
                handlers.onFieldActivated();
            })
        });

        app.setViewTab('field');

        expect(app.editorShell.getViewCanvases).toHaveBeenCalledTimes(1);
        expect(app.editorShell.handleViewTabChanged).toHaveBeenCalledWith('field', expect.objectContaining({
            fieldCanvas,
            profileCanvas
        }));
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('routes scene export access through the scene3d controller when building public export descriptors', async () => {
        const app = new SeatingBowlApp();
        const exportSceneData = {
            bowlMeshes: [
                {
                    type: 'Mesh',
                    geometry: {
                        attributes: {
                            position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] }
                        },
                        index: { array: [0, 1, 2] }
                    }
                }
            ],
            aisleMeshes: [],
            seatMeshes: [],
            THREE: { Scene: function Scene() {} }
        };

        app.scene3DController = /** @type {any} */ ({
            getGeometryPort: vi.fn(() => ({
                getExportSceneData: vi.fn(() => exportSceneData),
                getBowlGeometrySegments: vi.fn()
            }))
        });

        const descriptor = await app.exportController.buildDescriptor('obj');

        expect(app.scene3DController.getGeometryPort).toHaveBeenCalledTimes(1);
        expect(descriptor).toMatchObject({
            filename: 'seating - study - football.obj',
            type: 'text/plain'
        });
        expect(descriptor.content).toContain('f 1 2 3');
    });

    it('renders field updates without clip control sync side effects', () => {
        const app = new SeatingBowlApp();
        const getOffsetCorrection = vi.fn(() => 0);
        const renderField = vi.fn();
        const geometryPort = {
            getOffsetCorrection,
            getVisualFocalY: vi.fn(() => 0),
            buildTierAisleLayouts: vi.fn(() => []),
            calculateRowLength: vi.fn(() => 100)
        };
        app.fieldRenderer = /** @type {any} */ ({
            ...geometryPort,
            getGeometryPort: vi.fn(() => geometryPort),
            render: renderField
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: vi.fn()
        });
        app.statsPanel = /** @type {any} */ ({
            update: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive: vi.fn(() => false)
        });
        app.state.sport = 'Football';

        app.update();

        expect(getOffsetCorrection).toHaveBeenCalledWith(expect.objectContaining({ width: 160 }), 'Football');
        expect(renderField).toHaveBeenCalledTimes(1);
        expect(app.renderRuntime.getSnapshot()).not.toHaveProperty('clipRange');
    });

    it('does not initialize rhino when there is no scene export geometry', async () => {
        const app = new SeatingBowlApp();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        app.scene3DController = /** @type {any} */ ({
            getGeometryPort: vi.fn(() => ({
                getExportSceneData: () => null
            }))
        });

        await expect(app.exportController.buildDescriptor('rhino')).resolves.toBeNull();
        expect(app.scene3DController.getGeometryPort).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith('No 3D data to export');
    });

    it('uses shell visibility state when updating the scene3d controller', () => {
        const app = new SeatingBowlApp();
        const isScene3DActive = vi.fn(() => true);
        const updateScene3D = vi.fn();

        const geometryPort = {
            getOffsetCorrection: vi.fn(() => 0),
            getVisualFocalY: vi.fn(() => 12),
            buildTierAisleLayouts: vi.fn(() => []),
            calculateRowLength: vi.fn(() => 100)
        };
        app.fieldRenderer = /** @type {any} */ ({
            ...geometryPort,
            getGeometryPort: vi.fn(() => geometryPort),
            render: vi.fn()
        });
        app.profileRenderer = /** @type {any} */ ({
            renderMulti: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            isScene3DActive
        });
        app.scene3DController = /** @type {any} */ ({
            update: updateScene3D
        });
        app.statsPanel = /** @type {any} */ ({
            update: vi.fn()
        });

        app.update();

        expect(isScene3DActive).toHaveBeenCalledTimes(1);
        expect(updateScene3D).toHaveBeenCalledWith(
            expect.objectContaining({
                template: app.renderRuntime.getSnapshot()?.template,
                focalPointFt: app.renderRuntime.getSnapshot()?.focalPointFt,
                focalZ: app.state.setup.focalZ,
                bowlConfig: expect.objectContaining({
                    width: 160
                })
            }),
            { isActive: true }
        );
    });

    it('replays the scene3d side effects when restored state opens directly to the 3D tab', () => {
        const app = new SeatingBowlApp();
        app.editorControls = /** @type {any} */ ({
            applyImportedConfig: vi.fn(),
            syncFromState: vi.fn()
        });
        app.editorShell = /** @type {any} */ ({
            syncFromState: vi.fn(),
            renderProjectChrome: vi.fn(),
            renderOptionChrome: vi.fn(),
            renderProjectStatus: vi.fn(),
            isScene3DActive: vi.fn(() => false),
            getViewCanvases: vi.fn(() => ({
                fieldCanvas: null,
                profileCanvas: null
            })),
            handleViewTabChanged: vi.fn((tab, handlers) => {
                handlers.onScene3DActivated();
            })
        });
        app.scene3DController = /** @type {any} */ ({
            activate: vi.fn().mockResolvedValue(),
            renderBookmarks: vi.fn(),
            update: vi.fn()
        });

        app.loadState({
            ui: {
                activeViewTab: 'scene3d',
                activeResultsTab: 'statsTab'
            }
        });

        expect(app.editorShell.syncFromState).toHaveBeenCalledWith({
            activeViewTab: 'scene3d',
            activeResultsTab: 'statsTab'
        });
        expect(app.editorShell.handleViewTabChanged).toHaveBeenCalledWith('scene3d', expect.any(Object));
        expect(app.scene3DController.activate).toHaveBeenCalledTimes(1);
    });
});

describe('EditorShell manage options', () => {
    it('renders icon-only manager actions with accessible labels', () => {
        const { elements } = createEditorShellOptionManagerHarness();

        expect(elements.projectOptionManagerList.innerHTML).toContain('project-option-manager-icon-btn');
        expect(elements.projectOptionManagerList.innerHTML).toContain('aria-label="Rename Option 1"');
        expect(elements.projectOptionManagerList.innerHTML).toContain('aria-label="Duplicate Option 1"');
        expect(elements.projectOptionManagerList.innerHTML).toContain('aria-label="Delete Option 1"');
    });

    it('selects an option from the manager row action', async () => {
        const { shell, projectActions, elements } = createEditorShellOptionManagerHarness();

        expect(elements.projectOptionManagerList.innerHTML).toContain('data-project-option-manager-row-action="select"');

        await shell._handleProjectOptionManagerAction('select', 'option-2');

        expect(projectActions.selectOption).toHaveBeenCalledWith('option-2');
    });

    it('filters option manager rows from the search field value', () => {
        const { shell, elements } = createEditorShellOptionManagerHarness();

        shell._projectOptionManagerSearch = '2';
        shell._renderOptionManager();

        expect(elements.projectOptionManagerList.innerHTML).toContain('Option 2');
        expect(elements.projectOptionManagerList.innerHTML).not.toContain('Option 1');
    });

    it('enters option rename mode from the pencil action without selecting the row', async () => {
        const { shell, projectActions, elements } = createEditorShellOptionManagerHarness();

        await shell._handleProjectOptionManagerAction('edit', 'option-1');

        expect(projectActions.selectOption).not.toHaveBeenCalled();
        expect(shell._projectOptionEditingId).toBe('option-1');
        expect(elements['projectOptionNameInput-option-1'].focus).toHaveBeenCalledTimes(1);
        expect(elements['projectOptionNameInput-option-1'].select).toHaveBeenCalledTimes(1);
    });

    it('commits and cancels option rename edits', async () => {
        const { shell, projectActions } = createEditorShellOptionManagerHarness();

        shell._projectOptionEditingId = 'option-1';
        shell._projectOptionNameDrafts['option-1'] = 'Renamed Option';
        await shell._commitOptionNameEdit('option-1');

        expect(projectActions.renameOption).toHaveBeenCalledWith('option-1', 'Renamed Option');
        expect(shell._projectOptionEditingId).toBe('');

        shell._projectOptionEditingId = 'option-1';
        shell._projectOptionNameDrafts['option-1'] = 'Draft Name';
        shell._cancelProjectOptionNameEdit('option-1');

        expect(shell._projectOptionEditingId).toBe('');
        expect(shell._projectOptionNameDrafts['option-1']).toBe('Option 1');
    });

    it('locks and unlocks the full shell background while the manager is open', () => {
        const { shell, leftSidebar, mainArea, rightSidebar, body } = createEditorShellOptionManagerHarness();

        expect(body.classList.contains('project-option-manager-open')).toBe(true);
        expect(leftSidebar.hasAttribute('inert')).toBe(true);
        expect(mainArea.hasAttribute('inert')).toBe(true);
        expect(rightSidebar.hasAttribute('inert')).toBe(true);

        shell._closeProjectOptionManager();

        expect(body.classList.contains('project-option-manager-open')).toBe(false);
        expect(leftSidebar.hasAttribute('inert')).toBe(false);
        expect(mainArea.hasAttribute('inert')).toBe(false);
        expect(rightSidebar.hasAttribute('inert')).toBe(false);

        shell._projectOptionManagerOpen = true;
        shell._renderOptionManager();
        shell.destroy();

        expect(body.classList.contains('project-option-manager-open')).toBe(false);
        expect(leftSidebar.hasAttribute('inert')).toBe(false);
        expect(mainArea.hasAttribute('inert')).toBe(false);
        expect(rightSidebar.hasAttribute('inert')).toBe(false);
    });

    it('locks and unlocks the full shell background while the project picker is open', () => {
        const { shell, leftSidebar, mainArea, rightSidebar, body } = createEditorShellOptionManagerHarness();

        shell._projectOptionManagerOpen = false;
        shell._projectPicker.isOpen = true;
        shell._renderProjectPicker();

        expect(body.classList.contains('project-picker-open')).toBe(true);
        expect(leftSidebar.hasAttribute('inert')).toBe(true);
        expect(mainArea.hasAttribute('inert')).toBe(true);
        expect(rightSidebar.hasAttribute('inert')).toBe(true);

        shell._closeProjectPicker();

        expect(body.classList.contains('project-picker-open')).toBe(false);
        expect(leftSidebar.hasAttribute('inert')).toBe(false);
        expect(mainArea.hasAttribute('inert')).toBe(false);
        expect(rightSidebar.hasAttribute('inert')).toBe(false);

        shell._projectPicker.isOpen = true;
        shell._renderProjectPicker();
        shell.destroy();

        expect(body.classList.contains('project-picker-open')).toBe(false);
        expect(leftSidebar.hasAttribute('inert')).toBe(false);
        expect(mainArea.hasAttribute('inert')).toBe(false);
        expect(rightSidebar.hasAttribute('inert')).toBe(false);
    });
});
