import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProjectChromeShell } from '../../ui/project-chrome-shell.js';

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

function createProjectChromeHarness() {
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

    const shell = new ProjectChromeShell({
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

describe('ProjectChrome shell characterization', () => {
    it('locks project-picker actions while a prior action is still running', async () => {
        const shell = new ProjectChromeShell();
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

        const shell = new ProjectChromeShell();
        shell._renderProjectMenu = vi.fn();

        await shell._handleProjectMenuAction('import-config');

        expect(configFileInput.click).toHaveBeenCalledTimes(1);
        expect(document.getElementById).toHaveBeenCalledWith('configFileInput');
        expect(document.getElementById).not.toHaveBeenCalledWith('loadConfigBtn');
    });

    it('reads the selected config file and forwards the payload through the project shell port', async () => {
        const file = {
            text: vi.fn().mockResolvedValue('{"sport":"Football"}')
        };
        const input = {
            files: [file],
            value: 'selected.json'
        };
        const onConfigImported = vi.fn().mockResolvedValue(undefined);
        const shell = new ProjectChromeShell({
            onConfigImported
        });

        await shell._handleConfigImportChange({
            target: input
        });

        expect(file.text).toHaveBeenCalledTimes(1);
        expect(onConfigImported).toHaveBeenCalledWith({
            file,
            text: '{"sport":"Football"}'
        });
        expect(input.value).toBe('');
    });

    it('renders icon-only manager actions with accessible labels', () => {
        const { elements } = createProjectChromeHarness();

        expect(elements.projectOptionManagerList.innerHTML).toContain('project-option-manager-icon-btn');
        expect(elements.projectOptionManagerList.innerHTML).toContain('aria-label="Rename Option 1"');
        expect(elements.projectOptionManagerList.innerHTML).toContain('aria-label="Duplicate Option 1"');
        expect(elements.projectOptionManagerList.innerHTML).toContain('aria-label="Delete Option 1"');
    });

    it('selects an option from the manager row action', async () => {
        const { shell, projectActions, elements } = createProjectChromeHarness();

        expect(elements.projectOptionManagerList.innerHTML).toContain('data-project-option-manager-row-action="select"');

        await shell._handleProjectOptionManagerAction('select', 'option-2');

        expect(projectActions.selectOption).toHaveBeenCalledWith('option-2');
    });

    it('filters option manager rows from the search field value', () => {
        const { shell, elements } = createProjectChromeHarness();

        shell._projectOptionManagerSearch = '2';
        shell._renderOptionManager();

        expect(elements.projectOptionManagerList.innerHTML).toContain('Option 2');
        expect(elements.projectOptionManagerList.innerHTML).not.toContain('Option 1');
    });

    it('enters option rename mode from the pencil action without selecting the row', async () => {
        const { shell, projectActions, elements } = createProjectChromeHarness();

        await shell._handleProjectOptionManagerAction('edit', 'option-1');

        expect(projectActions.selectOption).not.toHaveBeenCalled();
        expect(shell._projectOptionEditingId).toBe('option-1');
        expect(elements['projectOptionNameInput-option-1'].focus).toHaveBeenCalledTimes(1);
        expect(elements['projectOptionNameInput-option-1'].select).toHaveBeenCalledTimes(1);
    });

    it('commits and cancels option rename edits', async () => {
        const { shell, projectActions } = createProjectChromeHarness();

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
        const { shell, leftSidebar, mainArea, rightSidebar, body } = createProjectChromeHarness();

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
        const { shell, leftSidebar, mainArea, rightSidebar, body } = createProjectChromeHarness();

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
