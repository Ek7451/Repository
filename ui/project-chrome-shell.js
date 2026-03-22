import {
    cloneProjectMetadata,
    cloneSessionDto,
    normalizeProjectStatus
} from '../state/project.js';

function getHtmlElement(id) {
    return /** @type {HTMLElement | null} */ (document.getElementById(id));
}

function getButtonElement(id) {
    return /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
}

function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
}

function getTemplateElement(id) {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') {
        return null;
    }
    const template = document.getElementById(id);
    if (typeof HTMLTemplateElement === 'undefined') {
        return null;
    }
    return template instanceof HTMLTemplateElement ? template : null;
}

function cloneTemplateElement(id) {
    const template = getTemplateElement(id);
    const element = template?.content.firstElementChild?.cloneNode(true);
    return element instanceof HTMLElement ? element : null;
}

function getTargetElement(target) {
    return target instanceof Element ? target : null;
}

function getErrorReason(error) {
    if (error && typeof error === 'object' && typeof error.message === 'string') {
        return error.message;
    }
    return String(error);
}

function formatProjectUpdatedAt(value) {
    if (typeof value !== 'string' || !value) return 'Not yet saved';

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleString();
}

function deriveAvatarInitials(value = '') {
    const parts = String(value ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length) return '--';
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
    });
    return element;
}

function createProjectActionIcon(action) {
    const svg = createSvgElement('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.9',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
    });

    if (action === 'edit') {
        svg.appendChild(createSvgElement('path', { d: 'M12 20h9' }));
        svg.appendChild(createSvgElement('path', { d: 'M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z' }));
        return svg;
    }

    if (action === 'duplicate') {
        svg.appendChild(createSvgElement('rect', { x: '9', y: '9', width: '10', height: '10', rx: '2' }));
        svg.appendChild(createSvgElement('path', { d: 'M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2' }));
        return svg;
    }

    svg.appendChild(createSvgElement('path', { d: 'M3 6h18' }));
    svg.appendChild(createSvgElement('path', { d: 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' }));
    svg.appendChild(createSvgElement('path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }));
    svg.appendChild(createSvgElement('path', { d: 'M10 11v6' }));
    svg.appendChild(createSvgElement('path', { d: 'M14 11v6' }));
    return svg;
}

function setOptionDotColor(element, color) {
    if (!element) return;
    element.style.setProperty('--option-color', color);
}

function createTextElement(tagName, text, className = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function canUseDomTemplates(container = null) {
    return Boolean(
        container
        && typeof container.replaceChildren === 'function'
        && typeof document !== 'undefined'
        && document
        && typeof document.createElement === 'function'
        && typeof document.getElementById === 'function'
        && typeof HTMLTemplateElement !== 'undefined'
        && typeof HTMLElement !== 'undefined'
    );
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function serializeDisabled(disabled) {
    return disabled ? ' disabled' : '';
}

function replaceChildren(element, children = []) {
    if (!element) return;
    element.replaceChildren(...children.filter(Boolean));
}

function formatProjectListUpdatedAt(value) {
    if (typeof value !== 'string' || !value) return 'Not yet saved';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function normalizeProjectActions(projectActions = null) {
    if (!projectActions || typeof projectActions !== 'object') {
        return null;
    }

    const actionNames = [
        'renameCurrentProject',
        'renameProject',
        'createOption',
        'renameOption',
        'duplicateOption',
        'deleteOption',
        'selectOption',
        'createProject',
        'listProjects',
        'openProject',
        'duplicateProject',
        'deleteProject',
        'deleteProjects',
        'signOut'
    ];
    const normalized = {};

    actionNames.forEach((actionName) => {
        normalized[actionName] = typeof projectActions[actionName] === 'function'
            ? projectActions[actionName].bind(projectActions)
            : null;
    });

    return normalized;
}

export class ProjectChromeShell {
    constructor(options = {}) {
        const settings = /** @type {{
            projectActions?: object | null,
            onExportRequested?: ((kind: string) => Promise<void> | void),
            onConfigImported?: ((payload: { file: File, text: string }) => Promise<void> | void),
            isScene3DActive?: (() => boolean)
        }} */ (options && typeof options === 'object' ? options : {});

        this._projectActions = normalizeProjectActions(settings.projectActions);
        this._onExportRequested = typeof settings.onExportRequested === 'function'
            ? settings.onExportRequested
            : null;
        this._onConfigImported = typeof settings.onConfigImported === 'function'
            ? settings.onConfigImported
            : null;
        this._isScene3DActive = typeof settings.isScene3DActive === 'function'
            ? settings.isScene3DActive
            : null;

        this._cleanup = [];
        this._initialized = false;
        this._projectChrome = {
            name: '',
            metadata: cloneProjectMetadata(),
            session: null,
            canSave: false
        };
        this._projectStatus = normalizeProjectStatus();
        this._projectSaveBusy = false;
        this._projectMenuOpen = false;
        this._projectMenuSubmenu = '';
        this._projectMenuBusyAction = '';
        this._projectOptionMenuOpen = false;
        this._projectOptionManagerOpen = false;
        this._projectOptionManagerSearch = '';
        this._projectOptionEditingId = '';
        this._projectNameEditing = false;
        this._projectNameDraft = '';
        this._projectOptionNameDrafts = {};
        this._skipNextProjectNameBlur = false;
        this._optionChrome = {
            activeOptionId: 'option-1',
            activeLabel: 'Option 1',
            activeColor: '#7aae1a',
            items: [
                {
                    id: 'option-1',
                    label: 'Option 1',
                    color: '#7aae1a',
                    isActive: true,
                    canDelete: false
                }
            ],
            canCreate: false,
            canManage: false,
            canDelete: false
        };
        this._projectPicker = {
            isOpen: false,
            isLoading: false,
            search: '',
            error: '',
            busyAction: '',
            busyProjectId: '',
            editingProjectId: '',
            projectNameDrafts: {},
            selectedProjectIds: [],
            projects: []
        };
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this._renderProjectMenu();
        this._renderOptionChrome();
        this._renderProjectNameField();
        this._renderProjectPicker();
        this._bindProjectChrome();
    }

    destroy() {
        this._cleanup.forEach((dispose) => dispose());
        this._cleanup = [];
        this._projectOptionManagerOpen = false;
        this._projectPicker.isOpen = false;
        document.body?.classList?.remove('project-picker-open');
        document.body?.classList?.remove('project-option-manager-open');
        this._syncModalBackgroundLock();
        this._initialized = false;
    }

    renderProjectChrome(chrome = {}, { isSaveBusy = this._projectSaveBusy } = {}) {
        const nextName = typeof chrome?.name === 'string' ? chrome.name.trim() : '';
        const metadata = cloneProjectMetadata(chrome?.metadata);
        const session = cloneSessionDto(chrome?.session);

        this._projectChrome = {
            name: nextName,
            metadata,
            session,
            canSave: Boolean(chrome?.canSave)
        };
        this._projectSaveBusy = Boolean(isSaveBusy);
        if (!this._projectNameEditing) {
            this._projectNameDraft = nextName;
        }

        const metaEl = getHtmlElement('editorProjectMeta');
        if (metaEl) {
            metaEl.textContent = metadata.id
                ? `Updated ${formatProjectUpdatedAt(metadata.updatedAt)}`
                : 'Create or open a project';
        }

        this._renderProjectNameField();
        this._renderProjectMenu();
        this._renderOptionChrome();
        this._renderEmployeeIdentity(session);
    }

    renderProjectStatus(status = {}) {
        this._projectStatus = normalizeProjectStatus(status?.message, status?.tone);

        const statusEl = getHtmlElement('projectStatusMessage');
        if (!statusEl) return;

        statusEl.textContent = this._projectStatus.message;
        statusEl.dataset.tone = this._projectStatus.tone;
    }

    setProjectSaveBusy(isBusy = false) {
        this._projectSaveBusy = Boolean(isBusy);
        this._renderProjectMenu();
        this._renderOptionChrome();
        this._renderOptionManager();
    }

    renderOptionChrome(optionChrome = {}) {
        const activeOptionId = typeof optionChrome?.activeOptionId === 'string' && optionChrome.activeOptionId.trim()
            ? optionChrome.activeOptionId.trim()
            : 'option-1';
        const activeLabel = typeof optionChrome?.activeLabel === 'string' && optionChrome.activeLabel.trim()
            ? optionChrome.activeLabel.trim()
            : 'Option 1';
        const items = Array.isArray(optionChrome?.items) && optionChrome.items.length
            ? optionChrome.items
                .map((item, index) => ({
                    id: typeof item?.id === 'string' && item.id.trim()
                        ? item.id.trim()
                        : `option-${index + 1}`,
                    label: typeof item?.label === 'string' && item.label.trim()
                        ? item.label.trim()
                        : `Option ${index + 1}`,
                    color: typeof item?.color === 'string' && item.color.trim()
                        ? item.color.trim()
                        : '#7aae1a',
                    isActive: Boolean(item?.isActive) || item?.id === activeOptionId,
                    canDelete: item?.canDelete !== false
                }))
            : [
                {
                    id: 'option-1',
                    label: activeLabel,
                    color: '#7aae1a',
                    isActive: true,
                    canDelete: false
                }
            ];
        const activeItem = items.find((item) => item.id === activeOptionId || item.isActive) ?? items[0];

        this._optionChrome = {
            activeOptionId: activeItem?.id ?? activeOptionId,
            activeLabel: activeItem?.label ?? activeLabel,
            activeColor: typeof optionChrome?.activeColor === 'string' && optionChrome.activeColor.trim()
                ? optionChrome.activeColor.trim()
                : activeItem?.color ?? '#7aae1a',
            items,
            canCreate: Boolean(optionChrome?.canCreate),
            canManage: Boolean(optionChrome?.canManage),
            canDelete: Boolean(optionChrome?.canDelete)
        };
        this._projectOptionNameDrafts = Object.fromEntries(
            this._optionChrome.items.map((item) => [item.id, item.label])
        );
        this._projectOptionEditingId = this._optionChrome.items.some((item) => item.id === this._projectOptionEditingId)
            ? this._projectOptionEditingId
            : '';
        this._renderOptionChrome();
        this._renderOptionManager();
    }

    refreshProjectMenu() {
        this._renderProjectMenu();
    }

    _bindProjectChrome() {
        const projectMenuTrigger = getButtonElement('projectMenuTrigger');
        if (projectMenuTrigger) {
            const handleProjectMenuClick = (event) => {
                event.stopPropagation();
                this._toggleProjectMenu();
            };
            projectMenuTrigger.addEventListener('click', handleProjectMenuClick);
            this._cleanup.push(() => projectMenuTrigger.removeEventListener('click', handleProjectMenuClick));
        }

        const projectMenuPanel = getHtmlElement('projectMenuPanel');
        if (projectMenuPanel) {
            const handleProjectMenuPanelClick = (event) => {
                const target = getTargetElement(event.target);
                if (!target) return;

                const submenuTrigger = target.closest('[data-project-submenu-trigger]');
                if (submenuTrigger) {
                    event.stopPropagation();
                    this._setProjectMenuSubmenu(submenuTrigger.getAttribute('data-project-submenu-trigger'));
                    return;
                }

                const menuAction = target.closest('[data-project-menu-action]');
                if (menuAction) {
                    event.stopPropagation();
                    void this._handleProjectMenuAction(menuAction.getAttribute('data-project-menu-action'));
                    return;
                }

                const exportAction = target.closest('[data-toolbar-export-kind]');
                if (exportAction) {
                    event.stopPropagation();
                    this._closeProjectMenu();
                    void this._onExportRequested?.(exportAction.getAttribute('data-toolbar-export-kind'));
                }
            };
            projectMenuPanel.addEventListener('click', handleProjectMenuPanelClick);
            this._cleanup.push(() => projectMenuPanel.removeEventListener('click', handleProjectMenuPanelClick));
        }

        const configFileInput = getInputElement('configFileInput');
        if (configFileInput) {
            const handleConfigImportChange = (event) => {
                void this._handleConfigImportChange(event);
            };
            configFileInput.addEventListener('change', handleConfigImportChange);
            this._cleanup.push(() => configFileInput.removeEventListener('change', handleConfigImportChange));
        }

        const projectNameField = getHtmlElement('projectNameField');
        if (projectNameField) {
            const handleProjectNameFieldClick = (event) => {
                const target = getTargetElement(event.target);
                if (!target || target.closest('#projectNameEditBtn')) return;
                this._startProjectNameEdit();
            };
            projectNameField.addEventListener('click', handleProjectNameFieldClick);
            this._cleanup.push(() => projectNameField.removeEventListener('click', handleProjectNameFieldClick));
        }

        const projectNameEditBtn = getButtonElement('projectNameEditBtn');
        if (projectNameEditBtn) {
            const handleProjectNameEditClick = (event) => {
                event.stopPropagation();
                this._startProjectNameEdit();
            };
            projectNameEditBtn.addEventListener('click', handleProjectNameEditClick);
            this._cleanup.push(() => projectNameEditBtn.removeEventListener('click', handleProjectNameEditClick));
        }

        const projectNameInput = getInputElement('projectNameInput');
        if (projectNameInput) {
            const handleProjectNameInput = () => {
                this._projectNameDraft = projectNameInput.value;
            };
            const handleProjectNameBlur = () => {
                if (this._skipNextProjectNameBlur) {
                    this._skipNextProjectNameBlur = false;
                    return;
                }
                void this._commitProjectNameEdit();
            };
            const handleProjectNameKeyDown = (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._skipNextProjectNameBlur = true;
                    void this._commitProjectNameEdit();
                    projectNameInput.blur();
                    return;
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this._skipNextProjectNameBlur = true;
                    this._cancelProjectNameEdit();
                    projectNameInput.blur();
                }
            };
            projectNameInput.addEventListener('input', handleProjectNameInput);
            projectNameInput.addEventListener('blur', handleProjectNameBlur);
            projectNameInput.addEventListener('keydown', handleProjectNameKeyDown);
            this._cleanup.push(() => projectNameInput.removeEventListener('input', handleProjectNameInput));
            this._cleanup.push(() => projectNameInput.removeEventListener('blur', handleProjectNameBlur));
            this._cleanup.push(() => projectNameInput.removeEventListener('keydown', handleProjectNameKeyDown));
        }

        const projectOptionTrigger = getButtonElement('projectOptionTrigger');
        if (projectOptionTrigger) {
            const handleProjectOptionClick = (event) => {
                if (this._projectSaveBusy) return;
                event.stopPropagation();
                this._projectOptionMenuOpen = !this._projectOptionMenuOpen;
                if (this._projectOptionMenuOpen) {
                    this._projectOptionManagerOpen = false;
                }
                this._renderOptionChrome();
                this._renderOptionManager();
            };
            projectOptionTrigger.addEventListener('click', handleProjectOptionClick);
            this._cleanup.push(() => projectOptionTrigger.removeEventListener('click', handleProjectOptionClick));
        }

        const projectOptionMenu = getHtmlElement('projectOptionMenu');
        if (projectOptionMenu) {
            const handleProjectOptionMenuClick = (event) => {
                const target = getTargetElement(event.target);
                if (!target) return;

                const actionButton = target.closest('[data-project-option-action]');
                if (!actionButton) return;

                event.stopPropagation();
                void this._handleProjectOptionMenuAction(
                    actionButton.getAttribute('data-project-option-action'),
                    actionButton.getAttribute('data-project-option-id')
                );
            };
            projectOptionMenu.addEventListener('click', handleProjectOptionMenuClick);
            this._cleanup.push(() => projectOptionMenu.removeEventListener('click', handleProjectOptionMenuClick));
        }

        const projectOptionManagerCloseBtn = getButtonElement('projectOptionManagerCloseBtn');
        if (projectOptionManagerCloseBtn) {
            const handleProjectOptionManagerClose = () => this._closeProjectOptionManager();
            projectOptionManagerCloseBtn.addEventListener('click', handleProjectOptionManagerClose);
            this._cleanup.push(() => projectOptionManagerCloseBtn.removeEventListener('click', handleProjectOptionManagerClose));
        }

        const projectOptionManagerBackdrop = document.querySelector('[data-project-option-manager-close]');
        if (projectOptionManagerBackdrop) {
            const handleProjectOptionManagerBackdropClick = () => this._closeProjectOptionManager();
            projectOptionManagerBackdrop.addEventListener('click', handleProjectOptionManagerBackdropClick);
            this._cleanup.push(() => projectOptionManagerBackdrop.removeEventListener('click', handleProjectOptionManagerBackdropClick));
        }

        const projectOptionManagerCreateBtn = getButtonElement('projectOptionManagerCreateBtn');
        if (projectOptionManagerCreateBtn) {
            const handleProjectOptionManagerCreate = async () => {
                await this._runProjectOptionAction(() => this._projectActions?.createOption?.());
            };
            projectOptionManagerCreateBtn.addEventListener('click', handleProjectOptionManagerCreate);
            this._cleanup.push(() => projectOptionManagerCreateBtn.removeEventListener('click', handleProjectOptionManagerCreate));
        }

        const projectOptionManagerSearchInput = getInputElement('projectOptionManagerSearchInput');
        if (projectOptionManagerSearchInput) {
            const handleProjectOptionManagerSearch = () => {
                this._projectOptionManagerSearch = projectOptionManagerSearchInput.value;
                this._renderOptionManager();
            };
            projectOptionManagerSearchInput.addEventListener('input', handleProjectOptionManagerSearch);
            this._cleanup.push(() => projectOptionManagerSearchInput.removeEventListener('input', handleProjectOptionManagerSearch));
        }

        const projectOptionManagerList = getHtmlElement('projectOptionManagerList');
        if (projectOptionManagerList) {
            const handleProjectOptionManagerClick = (event) => {
                const target = getTargetElement(event.target);
                if (!target) return;

                const actionButton = target.closest('[data-project-option-manager-action]');
                if (!actionButton) return;

                event.stopPropagation();
                void this._handleProjectOptionManagerAction(
                    actionButton.getAttribute('data-project-option-manager-action'),
                    actionButton.getAttribute('data-project-option-id')
                );
                return;
            };

            const handleProjectOptionManagerRowClick = (event) => {
                const target = getTargetElement(event.target);
                if (!target) return;

                const rowButton = target.closest('[data-project-option-manager-row-action]');
                if (!rowButton) return;

                event.stopPropagation();
                void this._handleProjectOptionManagerAction(
                    rowButton.getAttribute('data-project-option-manager-row-action'),
                    rowButton.getAttribute('data-project-option-id')
                );
            };
            const handleProjectOptionManagerInput = (event) => {
                const target = /** @type {HTMLInputElement | null} */ (event.target);
                const optionId = target?.getAttribute?.('data-project-option-name-id');
                if (!target || !optionId) return;
                this._projectOptionNameDrafts[optionId] = target.value;
            };
            const handleProjectOptionManagerFocusOut = (event) => {
                const target = /** @type {HTMLInputElement | null} */ (event.target);
                const optionId = target?.getAttribute?.('data-project-option-name-id');
                if (!target || !optionId) return;
                if (target.dataset.skipCommitOnBlur === 'true') {
                    delete target.dataset.skipCommitOnBlur;
                    return;
                }
                const relatedTarget = getTargetElement(event.relatedTarget);
                if (relatedTarget?.closest('[data-project-option-manager-action]')) {
                    return;
                }
                void this._commitOptionNameEdit(optionId);
            };
            const handleProjectOptionManagerKeyDown = (event) => {
                const target = /** @type {HTMLInputElement | null} */ (event.target);
                const optionId = target?.getAttribute?.('data-project-option-name-id');
                if (!target || !optionId) return;

                if (event.key === 'Enter') {
                    event.preventDefault();
                    target.dataset.skipCommitOnBlur = 'true';
                    void this._commitOptionNameEdit(optionId);
                    target.blur();
                    return;
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    target.dataset.skipCommitOnBlur = 'true';
                    target.blur();
                    this._cancelProjectOptionNameEdit(optionId);
                }
            };
            projectOptionManagerList.addEventListener('click', handleProjectOptionManagerClick);
            projectOptionManagerList.addEventListener('click', handleProjectOptionManagerRowClick);
            projectOptionManagerList.addEventListener('input', handleProjectOptionManagerInput);
            projectOptionManagerList.addEventListener('focusout', handleProjectOptionManagerFocusOut);
            projectOptionManagerList.addEventListener('keydown', handleProjectOptionManagerKeyDown);
            this._cleanup.push(() => projectOptionManagerList.removeEventListener('click', handleProjectOptionManagerClick));
            this._cleanup.push(() => projectOptionManagerList.removeEventListener('click', handleProjectOptionManagerRowClick));
            this._cleanup.push(() => projectOptionManagerList.removeEventListener('input', handleProjectOptionManagerInput));
            this._cleanup.push(() => projectOptionManagerList.removeEventListener('focusout', handleProjectOptionManagerFocusOut));
            this._cleanup.push(() => projectOptionManagerList.removeEventListener('keydown', handleProjectOptionManagerKeyDown));
        }

        const projectPickerCloseBtn = getButtonElement('projectPickerCloseBtn');
        if (projectPickerCloseBtn) {
            const handleProjectPickerClose = () => this._closeProjectPicker();
            projectPickerCloseBtn.addEventListener('click', handleProjectPickerClose);
            this._cleanup.push(() => projectPickerCloseBtn.removeEventListener('click', handleProjectPickerClose));
        }

        const projectPickerBackdrop = document.querySelector('[data-project-picker-close]');
        if (projectPickerBackdrop) {
            const handleProjectPickerBackdropClick = () => this._closeProjectPicker();
            projectPickerBackdrop.addEventListener('click', handleProjectPickerBackdropClick);
            this._cleanup.push(() => projectPickerBackdrop.removeEventListener('click', handleProjectPickerBackdropClick));
        }

        const projectPickerSearchInput = getInputElement('projectPickerSearchInput');
        if (projectPickerSearchInput) {
            const handleProjectPickerSearch = () => {
                this._projectPicker.search = projectPickerSearchInput.value;
                this._renderProjectPicker();
            };
            projectPickerSearchInput.addEventListener('input', handleProjectPickerSearch);
            this._cleanup.push(() => projectPickerSearchInput.removeEventListener('input', handleProjectPickerSearch));
        }

        const projectPickerCreateBtn = getButtonElement('projectPickerCreateBtn');
        if (projectPickerCreateBtn) {
            const handleProjectPickerCreate = async () => {
                if (this._isProjectPickerInteractionLocked()) return;
                if (!this._projectActions?.createProject) return;
                await this._runProjectPickerAction('create', '', async () => {
                    await this._projectActions.createProject();
                    this._closeProjectPicker();
                });
            };
            projectPickerCreateBtn.addEventListener('click', handleProjectPickerCreate);
            this._cleanup.push(() => projectPickerCreateBtn.removeEventListener('click', handleProjectPickerCreate));
        }

        const projectPickerDeleteSelectedBtn = getButtonElement('projectPickerDeleteSelectedBtn');
        if (projectPickerDeleteSelectedBtn) {
            const handleProjectPickerDeleteSelected = () => {
                void this._handleProjectPickerDeleteSelected();
            };
            projectPickerDeleteSelectedBtn.addEventListener('click', handleProjectPickerDeleteSelected);
            this._cleanup.push(() => projectPickerDeleteSelectedBtn.removeEventListener('click', handleProjectPickerDeleteSelected));
        }

        const projectPickerList = getHtmlElement('projectPickerList');
        if (projectPickerList) {
            const handleProjectPickerListClick = (event) => {
                if (this._isProjectPickerInteractionLocked()) return;
                const target = getTargetElement(event.target);
                if (!target) return;

                const rowAction = target.closest('[data-project-picker-row-action]');
                if (rowAction) {
                    event.stopPropagation();
                    void this._handleProjectPickerAction(
                        rowAction.getAttribute('data-project-picker-row-action'),
                        rowAction.getAttribute('data-project-id')
                    );
                    return;
                }

                const openProjectTrigger = target.closest('[data-open-project-id]');
                if (openProjectTrigger) {
                    event.stopPropagation();
                    void this._handleProjectPickerAction('open', openProjectTrigger.getAttribute('data-open-project-id'));
                }
            };
            const handleProjectPickerListChange = (event) => {
                if (this._isProjectPickerInteractionLocked()) return;
                const target = getTargetElement(event.target);
                if (!target) return;

                const selectionToggle = target.closest('[data-project-picker-select]');
                if (!selectionToggle) return;

                this._toggleProjectPickerSelection(selectionToggle.getAttribute('data-project-picker-select'));
            };
            const handleProjectPickerListInput = (event) => {
                const target = /** @type {HTMLInputElement | null} */ (event.target);
                const projectId = target?.getAttribute?.('data-project-picker-name-id');
                if (!target || !projectId) return;
                this._projectPicker.projectNameDrafts[projectId] = target.value;
            };
            const handleProjectPickerListFocusOut = (event) => {
                const target = /** @type {HTMLInputElement | null} */ (event.target);
                const projectId = target?.getAttribute?.('data-project-picker-name-id');
                if (!target || !projectId) return;
                if (target.dataset.skipCommitOnBlur === 'true') {
                    delete target.dataset.skipCommitOnBlur;
                    return;
                }
                const relatedTarget = getTargetElement(event.relatedTarget);
                if (relatedTarget?.closest('[data-project-picker-row-action]')) {
                    return;
                }
                void this._commitProjectPickerNameEdit(projectId);
            };
            const handleProjectPickerListKeyDown = (event) => {
                const target = /** @type {HTMLInputElement | null} */ (event.target);
                const projectId = target?.getAttribute?.('data-project-picker-name-id');
                if (!target || !projectId) return;

                if (event.key === 'Enter') {
                    event.preventDefault();
                    target.dataset.skipCommitOnBlur = 'true';
                    void this._commitProjectPickerNameEdit(projectId);
                    target.blur();
                    return;
                }

                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    target.dataset.skipCommitOnBlur = 'true';
                    target.blur();
                    this._cancelProjectPickerNameEdit(projectId);
                }
            };
            projectPickerList.addEventListener('click', handleProjectPickerListClick);
            projectPickerList.addEventListener('change', handleProjectPickerListChange);
            projectPickerList.addEventListener('input', handleProjectPickerListInput);
            projectPickerList.addEventListener('focusout', handleProjectPickerListFocusOut);
            projectPickerList.addEventListener('keydown', handleProjectPickerListKeyDown);
            this._cleanup.push(() => projectPickerList.removeEventListener('click', handleProjectPickerListClick));
            this._cleanup.push(() => projectPickerList.removeEventListener('change', handleProjectPickerListChange));
            this._cleanup.push(() => projectPickerList.removeEventListener('input', handleProjectPickerListInput));
            this._cleanup.push(() => projectPickerList.removeEventListener('focusout', handleProjectPickerListFocusOut));
            this._cleanup.push(() => projectPickerList.removeEventListener('keydown', handleProjectPickerListKeyDown));
        }

        const handleDocumentClick = (event) => {
            const target = getTargetElement(event.target);
            if (!target) return;

            if (this._projectMenuOpen && !target.closest('.project-menu-shell')) {
                this._closeProjectMenu();
            }

            if (this._projectOptionMenuOpen && !target.closest('.project-option-shell')) {
                this._projectOptionMenuOpen = false;
                this._renderOptionChrome();
            }
        };
        document.addEventListener('click', handleDocumentClick);
        this._cleanup.push(() => document.removeEventListener('click', handleDocumentClick));

        const handleDocumentKeyDown = (event) => {
            if (event.key !== 'Escape') return;

            if (this._projectNameEditing) {
                this._cancelProjectNameEdit();
                return;
            }

            if (this._projectPicker.isOpen) {
                this._closeProjectPicker();
                return;
            }

            if (this._projectOptionManagerOpen) {
                this._closeProjectOptionManager();
                return;
            }

            if (this._projectMenuOpen) {
                this._closeProjectMenu();
            }

            if (this._projectOptionMenuOpen) {
                this._projectOptionMenuOpen = false;
                this._renderOptionChrome();
            }
        };
        document.addEventListener('keydown', handleDocumentKeyDown);
        this._cleanup.push(() => document.removeEventListener('keydown', handleDocumentKeyDown));
    }

    _renderProjectNameField() {
        const projectNameField = getHtmlElement('projectNameField');
        if (projectNameField) {
            projectNameField.dataset.editing = this._projectNameEditing ? 'true' : 'false';
        }

        const projectNameInput = getInputElement('projectNameInput');
        if (projectNameInput) {
            projectNameInput.readOnly = !this._projectNameEditing;
            if (document.activeElement !== projectNameInput || !this._projectNameEditing) {
                projectNameInput.value = this._projectNameDraft || this._projectChrome.name;
            }
        }

        const projectNameEditBtn = getButtonElement('projectNameEditBtn');
        if (projectNameEditBtn) {
            projectNameEditBtn.disabled = !this._projectActions?.renameCurrentProject || this._projectSaveBusy;
        }
    }

    _startProjectNameEdit() {
        if (!this._projectActions?.renameCurrentProject || this._projectSaveBusy) return;

        this._projectNameEditing = true;
        this._projectNameDraft = this._projectChrome.name;
        this._renderProjectNameField();

        const projectNameInput = getInputElement('projectNameInput');
        projectNameInput?.focus();
        projectNameInput?.select();
    }

    _cancelProjectNameEdit() {
        this._projectNameEditing = false;
        this._projectNameDraft = this._projectChrome.name;
        this._renderProjectNameField();
    }

    async _commitProjectNameEdit() {
        if (!this._projectNameEditing) return;
        if (!this._projectActions?.renameCurrentProject) {
            this._cancelProjectNameEdit();
            return;
        }

        const projectNameInput = getInputElement('projectNameInput');
        const nextName = projectNameInput?.value ?? this._projectNameDraft;
        this._projectNameDraft = nextName;

        if (nextName.trim() === this._projectChrome.name.trim()) {
            this._projectNameEditing = false;
            this._projectNameDraft = this._projectChrome.name;
            this._renderProjectNameField();
            return;
        }

        try {
            await this._runToolbarProjectAction('rename', () => this._projectActions.renameCurrentProject(nextName));
        } finally {
            this._projectNameEditing = false;
            this._projectNameDraft = this._projectChrome.name;
            this._renderProjectNameField();
        }
    }

    async _handleProjectOptionMenuAction(action, optionId) {
        if (this._projectSaveBusy) return;

        if (action === 'select' && optionId && this._projectActions?.selectOption) {
            this._projectOptionMenuOpen = false;
            this._renderOptionChrome();
            await this._runProjectOptionAction(() => this._projectActions.selectOption(optionId));
            return;
        }

        if (action === 'create' && this._projectActions?.createOption) {
            this._projectOptionMenuOpen = false;
            this._renderOptionChrome();
            await this._runProjectOptionAction(() => this._projectActions.createOption());
            return;
        }

        if (action === 'manage') {
            this._projectOptionMenuOpen = false;
            this._openProjectOptionManager();
        }
    }

    async _runProjectOptionAction(callback) {
        if (typeof callback !== 'function' || this._projectSaveBusy) return;

        try {
            await callback();
        } catch {
            // Status updates are rendered through the project action port.
        }
    }

    _syncModalBackgroundLock() {
        const shouldLockBackground = this._projectOptionManagerOpen || this._projectPicker.isOpen;
        [
            /** @type {HTMLElement | null} */ (document.querySelector('.left-sidebar')),
            /** @type {HTMLElement | null} */ (document.querySelector('.main-area')),
            /** @type {HTMLElement | null} */ (document.querySelector('.right-sidebar'))
        ].forEach((element) => {
            if (!element) return;
            if (shouldLockBackground) {
                element.setAttribute('inert', '');
                return;
            }
            element.removeAttribute('inert');
        });
    }

    _resetProjectOptionNameDraft(optionId) {
        if (!optionId) return;
        this._projectOptionNameDrafts[optionId] = this._optionChrome.items.find((item) => item.id === optionId)?.label ?? '';
    }

    _resetProjectOptionNameDrafts() {
        this._projectOptionNameDrafts = Object.fromEntries(
            this._optionChrome.items.map((item) => [item.id, item.label])
        );
    }

    _getProjectPickerProject(projectId) {
        if (!projectId) return null;
        return this._projectPicker.projects.find((project) => project.id === projectId) ?? null;
    }

    _resetProjectPickerNameDraft(projectId) {
        if (!projectId) return;
        this._projectPicker.projectNameDrafts[projectId] = this._getProjectPickerProject(projectId)?.name ?? '';
    }

    _resetProjectPickerNameDrafts() {
        this._projectPicker.projectNameDrafts = Object.fromEntries(
            this._projectPicker.projects.map((project) => [project.id, project.name])
        );
    }

    _openProjectOptionManager() {
        this._projectOptionManagerOpen = true;
        this._projectOptionManagerSearch = '';
        this._projectOptionEditingId = '';
        this._resetProjectOptionNameDrafts();
        this._renderOptionManager();
    }

    _closeProjectOptionManager() {
        this._projectOptionManagerOpen = false;
        this._projectOptionManagerSearch = '';
        this._projectOptionEditingId = '';
        this._resetProjectOptionNameDrafts();
        this._renderOptionManager();
    }

    async _handleProjectOptionManagerAction(action, optionId) {
        if (!optionId || this._projectSaveBusy) return;

        if (action === 'edit') {
            this._startProjectOptionNameEdit(optionId);
            return;
        }

        if (action === 'select' && this._projectActions?.selectOption) {
            await this._runProjectOptionAction(() => this._projectActions.selectOption(optionId));
            return;
        }

        if (action === 'duplicate' && this._projectActions?.duplicateOption) {
            await this._runProjectOptionAction(() => this._projectActions.duplicateOption(optionId));
            return;
        }

        if (action === 'delete' && this._projectActions?.deleteOption) {
            const optionLabel = this._optionChrome.items.find((item) => item.id === optionId)?.label ?? 'this option';
            const shouldDelete = typeof window.confirm === 'function'
                ? window.confirm(`Delete "${optionLabel}"?`)
                : true;
            if (!shouldDelete) return;

            await this._runProjectOptionAction(() => this._projectActions.deleteOption(optionId));
        }
    }

    _startProjectOptionNameEdit(optionId) {
        if (!optionId || !this._projectActions?.renameOption || this._projectSaveBusy) return;

        this._projectOptionEditingId = optionId;
        this._resetProjectOptionNameDraft(optionId);
        this._renderOptionManager();

        requestAnimationFrame(() => {
            const optionNameInput = getInputElement(`projectOptionNameInput-${optionId}`);
            optionNameInput?.focus();
            optionNameInput?.select();
        });
    }

    _cancelProjectOptionNameEdit(optionId = this._projectOptionEditingId) {
        if (!optionId) return;

        this._resetProjectOptionNameDraft(optionId);
        if (this._projectOptionEditingId === optionId) {
            this._projectOptionEditingId = '';
        }
        this._renderOptionManager();
    }

    async _commitOptionNameEdit(optionId) {
        if (!optionId || !this._projectActions?.renameOption || this._projectSaveBusy) return;

        const option = this._optionChrome.items.find((item) => item.id === optionId);
        if (!option) return;

        const nextName = (this._projectOptionNameDrafts[optionId] ?? option.label).trim();
        if (!nextName || nextName === option.label.trim()) {
            this._projectOptionEditingId = '';
            this._resetProjectOptionNameDraft(optionId);
            this._renderOptionManager();
            return;
        }

        try {
            await this._runProjectOptionAction(() => this._projectActions.renameOption(optionId, nextName));
        } finally {
            this._projectOptionEditingId = '';
            this._resetProjectOptionNameDraft(optionId);
            this._renderOptionManager();
        }
    }

    _renderOptionChrome() {
        const projectOptionTrigger = getButtonElement('projectOptionTrigger');
        if (projectOptionTrigger) {
            projectOptionTrigger.setAttribute('aria-expanded', String(this._projectOptionMenuOpen));
            projectOptionTrigger.disabled = this._projectSaveBusy || (!this._optionChrome.canManage && !this._optionChrome.canCreate);
            projectOptionTrigger.style.setProperty('--option-color', this._optionChrome.activeColor);
        }

        const projectOptionLabel = getHtmlElement('projectOptionLabel');
        if (projectOptionLabel) {
            projectOptionLabel.textContent = this._optionChrome.activeLabel;
        }

        const projectOptionMenu = getHtmlElement('projectOptionMenu');
        if (!projectOptionMenu) return;

        projectOptionMenu.hidden = !this._projectOptionMenuOpen;
        if (!canUseDomTemplates(projectOptionMenu)) {
            projectOptionMenu.innerHTML = this._buildOptionMenuMarkup();
            return;
        }
        const menuChildren = [];

        this._optionChrome.items.forEach((item) => {
            const optionButton = /** @type {HTMLButtonElement | null} */ (cloneTemplateElement('projectOptionItemTemplate'));
            if (!optionButton) return;

            optionButton.dataset.projectOptionAction = 'select';
            optionButton.dataset.projectOptionId = item.id;
            optionButton.disabled = this._projectSaveBusy || item.isActive || !this._projectActions?.selectOption;
            optionButton.classList.toggle('active', item.isActive);
            optionButton.querySelector('[data-project-option-item-label]')?.replaceChildren(document.createTextNode(item.label));

            const statusPill = optionButton.querySelector('[data-project-option-item-status]');
            if (statusPill instanceof HTMLElement) {
                statusPill.hidden = !item.isActive;
            }

            setOptionDotColor(optionButton.querySelector('.project-option-dot'), item.color);
            menuChildren.push(optionButton);
        });

        const divider = document.createElement('div');
        divider.className = 'project-menu-divider';
        divider.setAttribute('role', 'presentation');
        menuChildren.push(divider);

        [
            {
                action: 'create',
                label: 'Option',
                icon: '+',
                disabled: this._projectSaveBusy || !this._optionChrome.canCreate || !this._projectActions?.createOption
            },
            {
                action: 'manage',
                label: 'Manage',
                icon: '\u2699',
                disabled: this._projectSaveBusy || !this._optionChrome.canManage
            }
        ].forEach((descriptor) => {
            const actionButton = /** @type {HTMLButtonElement | null} */ (cloneTemplateElement('projectOptionMenuActionTemplate'));
            if (!actionButton) return;

            actionButton.dataset.projectOptionAction = descriptor.action;
            actionButton.disabled = descriptor.disabled;
            actionButton.querySelector('[data-project-option-action-label]')?.replaceChildren(document.createTextNode(descriptor.label));
            actionButton.querySelector('[data-project-option-action-icon]')?.replaceChildren(document.createTextNode(descriptor.icon));
            menuChildren.push(actionButton);
        });

        replaceChildren(projectOptionMenu, menuChildren);
    }

    _renderOptionManager() {
        const projectOptionManagerModal = getHtmlElement('projectOptionManagerModal');
        if (projectOptionManagerModal) {
            projectOptionManagerModal.hidden = !this._projectOptionManagerOpen;
        }
        document.body?.classList?.toggle('project-option-manager-open', this._projectOptionManagerOpen);
        this._syncModalBackgroundLock();

        const projectOptionManagerCloseBtn = getButtonElement('projectOptionManagerCloseBtn');
        if (projectOptionManagerCloseBtn) {
            projectOptionManagerCloseBtn.disabled = this._projectSaveBusy;
        }

        const projectOptionManagerCreateBtn = getButtonElement('projectOptionManagerCreateBtn');
        if (projectOptionManagerCreateBtn) {
            projectOptionManagerCreateBtn.disabled = this._projectSaveBusy || !this._optionChrome.canCreate || !this._projectActions?.createOption;
            projectOptionManagerCreateBtn.textContent = 'Create empty option';
        }

        const projectOptionManagerSearchInput = getInputElement('projectOptionManagerSearchInput');
        if (projectOptionManagerSearchInput) {
            projectOptionManagerSearchInput.disabled = this._projectSaveBusy;
            if (document.activeElement !== projectOptionManagerSearchInput) {
                projectOptionManagerSearchInput.value = this._projectOptionManagerSearch;
            }
        }

        const projectOptionManagerList = getHtmlElement('projectOptionManagerList');
        if (!projectOptionManagerList) return;

        const searchValue = this._projectOptionManagerSearch.trim().toLowerCase();
        const visibleItems = this._optionChrome.items.filter((item) => {
            if (!searchValue) return true;
            return item.label.toLowerCase().includes(searchValue);
        });

        if (!canUseDomTemplates(projectOptionManagerList)) {
            projectOptionManagerList.innerHTML = this._buildOptionManagerMarkup(visibleItems);
            return;
        }

        if (!visibleItems.length) {
            replaceChildren(projectOptionManagerList, [
                createTextElement('div', 'No options match your search.', 'project-option-manager-empty')
            ]);
            return;
        }

        const rows = visibleItems.map((item) => {
            const row = cloneTemplateElement('projectOptionManagerRowTemplate');
            if (!row) return null;

            row.classList.toggle('active', item.isActive);

            const isEditing = this._projectOptionEditingId === item.id;
            const editingShell = row.querySelector('[data-project-option-editing]');
            const editingInput = /** @type {HTMLInputElement | null} */ (row.querySelector('[data-project-option-name-input]'));
            const editingLabel = /** @type {HTMLLabelElement | null} */ (row.querySelector('[data-project-option-name-label]'));
            const selectButton = /** @type {HTMLButtonElement | null} */ (row.querySelector('[data-project-option-select]'));
            const displayName = row.querySelector('[data-project-option-name]');

            row.querySelectorAll('.project-option-dot').forEach((dot) => setOptionDotColor(dot, item.color));

            if (editingShell instanceof HTMLElement) {
                editingShell.hidden = !isEditing;
            }
            if (selectButton) {
                selectButton.hidden = isEditing;
                selectButton.dataset.projectOptionManagerRowAction = 'select';
                selectButton.dataset.projectOptionId = item.id;
                selectButton.setAttribute('aria-label', `Open ${item.label}`);
                selectButton.disabled = this._projectSaveBusy || item.isActive || !this._projectActions?.selectOption;
            }
            displayName?.replaceChildren(document.createTextNode(item.label));

            if (editingInput) {
                const inputId = `projectOptionNameInput-${item.id}`;
                editingInput.id = inputId;
                editingInput.dataset.projectOptionNameId = item.id;
                editingInput.value = this._projectOptionNameDrafts[item.id] ?? item.label;
                editingInput.disabled = this._projectSaveBusy || !this._projectActions?.renameOption;
            }
            if (editingLabel && editingInput) {
                editingLabel.htmlFor = editingInput.id;
                editingLabel.textContent = `${item.label} option name`;
            }

            [
                {
                    action: 'edit',
                    label: `Rename ${item.label}`,
                    disabled: this._projectSaveBusy || !this._projectActions?.renameOption
                },
                {
                    action: 'duplicate',
                    label: `Duplicate ${item.label}`,
                    disabled: this._projectSaveBusy || !this._projectActions?.duplicateOption
                },
                {
                    action: 'delete',
                    label: `Delete ${item.label}`,
                    disabled: this._projectSaveBusy || !item.canDelete || !this._projectActions?.deleteOption
                }
            ].forEach((descriptor) => {
                const button = /** @type {HTMLButtonElement | null} */ (
                    row.querySelector(`[data-project-option-manager-action="${descriptor.action}"]`)
                );
                if (!button) return;
                button.dataset.projectOptionId = item.id;
                button.setAttribute('aria-label', descriptor.label);
                button.setAttribute('title', descriptor.label);
                button.disabled = descriptor.disabled;
                button.replaceChildren(createProjectActionIcon(descriptor.action));
            });

            return row;
        });

        replaceChildren(projectOptionManagerList, rows);
    }

    _renderProjectMenu() {
        const projectMenuTrigger = getButtonElement('projectMenuTrigger');
        const projectMenuPanel = getHtmlElement('projectMenuPanel');
        const currentProjectId = this._projectChrome.metadata?.id || '';
        const isBusy = Boolean(this._projectMenuBusyAction) || this._projectSaveBusy;

        if (projectMenuTrigger) {
            projectMenuTrigger.setAttribute('aria-expanded', String(this._projectMenuOpen));
            projectMenuTrigger.disabled = isBusy;
        }

        if (!projectMenuPanel) return;

        projectMenuPanel.hidden = !this._projectMenuOpen;

        projectMenuPanel.querySelectorAll('[data-project-submenu-trigger]').forEach((button) => {
            const submenuName = button.getAttribute('data-project-submenu-trigger');
            button.setAttribute('aria-expanded', String(this._projectMenuSubmenu === submenuName));
            /** @type {HTMLButtonElement} */ (button).disabled = isBusy;
        });

        projectMenuPanel.querySelectorAll('[data-project-submenu-panel]').forEach((panel) => {
            /** @type {HTMLElement} */ (panel).hidden = !this._projectMenuOpen
                || panel.getAttribute('data-project-submenu-panel') !== this._projectMenuSubmenu;
        });

        const createButton = /** @type {HTMLButtonElement | null} */ (
            projectMenuPanel.querySelector('[data-project-menu-action="create-project"]')
        );
        const openButton = /** @type {HTMLButtonElement | null} */ (
            projectMenuPanel.querySelector('[data-project-menu-action="open-project"]')
        );
        const duplicateButton = /** @type {HTMLButtonElement | null} */ (
            projectMenuPanel.querySelector('[data-project-menu-action="duplicate-project"]')
        );
        const deleteButton = /** @type {HTMLButtonElement | null} */ (
            projectMenuPanel.querySelector('[data-project-menu-action="delete-project"]')
        );
        if (createButton) createButton.disabled = isBusy || !this._projectActions?.createProject;
        if (openButton) openButton.disabled = isBusy || !this._projectActions?.listProjects || !this._projectActions?.openProject;
        if (duplicateButton) duplicateButton.disabled = isBusy || !currentProjectId || !this._projectActions?.duplicateProject;
        if (deleteButton) deleteButton.disabled = isBusy || !currentProjectId || !this._projectActions?.deleteProject;

        const importButton = /** @type {HTMLButtonElement | null} */ (
            projectMenuPanel.querySelector('[data-project-menu-action="import-config"]')
        );
        const signOutButton = /** @type {HTMLButtonElement | null} */ (
            projectMenuPanel.querySelector('[data-project-menu-action="sign-out"]')
        );
        if (importButton) importButton.disabled = isBusy;
        if (signOutButton) signOutButton.disabled = isBusy || !this._projectActions?.signOut;

        projectMenuPanel.querySelectorAll('[data-toolbar-export-kind]').forEach((button) => {
            const exportButton = /** @type {HTMLButtonElement} */ (button);
            const kind = exportButton.getAttribute('data-toolbar-export-kind');
            const requiresScene3D = kind === 'obj' || kind === 'rhino';
            exportButton.disabled = isBusy || (requiresScene3D && !this._isScene3DActive?.());
        });
    }

    _toggleProjectMenu() {
        if (this._projectMenuBusyAction || this._projectSaveBusy) return;

        this._projectMenuOpen = !this._projectMenuOpen;
        if (!this._projectMenuOpen) {
            this._projectMenuSubmenu = '';
        }
        this._renderProjectMenu();
    }

    _setProjectMenuSubmenu(submenuName) {
        const nextSubmenu = typeof submenuName === 'string' ? submenuName : '';
        this._projectMenuSubmenu = this._projectMenuSubmenu === nextSubmenu ? '' : nextSubmenu;
        this._renderProjectMenu();
    }

    _closeProjectMenu() {
        this._projectMenuOpen = false;
        this._projectMenuSubmenu = '';
        this._renderProjectMenu();
    }

    async _handleProjectMenuAction(action) {
        const currentProjectId = this._projectChrome.metadata?.id || '';

        if (action === 'open-project') {
            this._closeProjectMenu();
            await this._openProjectPicker();
            return;
        }

        if (action === 'import-config') {
            this._closeProjectMenu();
            getInputElement('configFileInput')?.click();
            return;
        }

        if (action === 'create-project' && this._projectActions?.createProject) {
            this._closeProjectMenu();
            await this._runToolbarProjectAction('create', () => this._projectActions.createProject());
            return;
        }

        if (action === 'sign-out' && this._projectActions?.signOut) {
            this._closeProjectMenu();
            await this._runToolbarProjectAction('signout', () => this._projectActions.signOut());
            return;
        }

        if (action === 'duplicate-project' && currentProjectId && this._projectActions?.duplicateProject) {
            this._closeProjectMenu();
            await this._runToolbarProjectAction('duplicate', () => this._projectActions.duplicateProject(currentProjectId));
            return;
        }

        if (action === 'delete-project' && currentProjectId && this._projectActions?.deleteProject) {
            const shouldDelete = typeof window.confirm === 'function'
                ? window.confirm(`Delete "${this._projectChrome.name || 'this project'}"?`)
                : true;
            if (!shouldDelete) return;

            this._closeProjectMenu();
            await this._runToolbarProjectAction('delete', () => this._projectActions.deleteProject(currentProjectId));
        }
    }

    async _handleConfigImportChange(event) {
        const target = /** @type {HTMLInputElement | null} */ (event.target);
        const file = target?.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            await this._onConfigImported?.({ file, text });
        } finally {
            if (target) {
                target.value = '';
            }
        }
    }

    async _runToolbarProjectAction(actionName, callback) {
        if (typeof callback !== 'function') return;

        this._projectMenuBusyAction = actionName;
        this._renderProjectMenu();

        try {
            await callback();
        } catch {
            // Status updates are rendered through the project action port.
        } finally {
            this._projectMenuBusyAction = '';
            this._renderProjectMenu();
        }
    }

    async _openProjectPicker() {
        this._projectPicker.isOpen = true;
        this._projectPicker.search = '';
        this._projectPicker.error = '';
        this._projectPicker.editingProjectId = '';
        this._projectPicker.selectedProjectIds = [];
        this._resetProjectPickerNameDrafts();
        this._renderProjectPicker();
        getInputElement('projectPickerSearchInput')?.focus();
        await this._refreshProjectPickerProjects();
    }

    _closeProjectPicker() {
        this._projectPicker.isOpen = false;
        this._projectPicker.error = '';
        this._projectPicker.editingProjectId = '';
        this._projectPicker.selectedProjectIds = [];
        this._resetProjectPickerNameDrafts();
        this._renderProjectPicker();
    }

    async _refreshProjectPickerProjects() {
        if (!this._projectActions?.listProjects) {
            this._projectPicker.projects = [];
            this._projectPicker.editingProjectId = '';
            this._projectPicker.selectedProjectIds = [];
            this._renderProjectPicker();
            return;
        }

        this._projectPicker.isLoading = true;
        this._renderProjectPicker();

        try {
            const projects = await this._projectActions.listProjects();
            this._projectPicker.projects = Array.isArray(projects)
                ? projects.map((project) => ({
                    id: typeof project?.id === 'string' ? project.id : '',
                    name: typeof project?.name === 'string' ? project.name : '',
                    sport: typeof project?.sport === 'string' ? project.sport : '',
                    createdAt: typeof project?.createdAt === 'string' ? project.createdAt : '',
                    updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : ''
                }))
                : [];
            this._projectPicker.selectedProjectIds = this._projectPicker.selectedProjectIds.filter((projectId) => (
                this._projectPicker.projects.some((project) => project.id === projectId)
                    && !this._isCurrentProjectPickerProject(projectId)
            ));
            if (!this._getProjectPickerProject(this._projectPicker.editingProjectId)) {
                this._projectPicker.editingProjectId = '';
            }
            this._resetProjectPickerNameDrafts();
            this._projectPicker.error = '';
        } catch (error) {
            this._projectPicker.error = getErrorReason(error);
        } finally {
            this._projectPicker.isLoading = false;
            this._renderProjectPicker();
        }
    }

    _isCurrentProjectPickerProject(projectId) {
        return Boolean(projectId && this._projectChrome.metadata?.id === projectId);
    }

    _toggleProjectPickerSelection(projectId) {
        if (this._isProjectPickerInteractionLocked()) return;
        const nextProjectId = typeof projectId === 'string' ? projectId : '';
        if (
            !nextProjectId
            || this._isCurrentProjectPickerProject(nextProjectId)
            || !this._projectPicker.projects.some((project) => project.id === nextProjectId)
        ) return;

        const selectedProjectIds = new Set(this._projectPicker.selectedProjectIds);
        if (selectedProjectIds.has(nextProjectId)) {
            selectedProjectIds.delete(nextProjectId);
        } else {
            selectedProjectIds.add(nextProjectId);
        }

        this._projectPicker.selectedProjectIds = Array.from(selectedProjectIds);
        this._renderProjectPicker();
    }

    _startProjectPickerNameEdit(projectId) {
        if (!projectId || !this._projectActions?.renameProject || this._isProjectPickerInteractionLocked()) return;

        this._projectPicker.editingProjectId = projectId;
        this._resetProjectPickerNameDraft(projectId);
        this._renderProjectPicker();

        requestAnimationFrame(() => {
            const projectNameInput = getInputElement(`projectPickerNameInput-${projectId}`);
            projectNameInput?.focus();
            projectNameInput?.select();
        });
    }

    _cancelProjectPickerNameEdit(projectId = this._projectPicker.editingProjectId) {
        if (!projectId) return;

        this._resetProjectPickerNameDraft(projectId);
        if (this._projectPicker.editingProjectId === projectId) {
            this._projectPicker.editingProjectId = '';
        }
        this._renderProjectPicker();
    }

    async _commitProjectPickerNameEdit(projectId) {
        if (!projectId || !this._projectActions?.renameProject || this._isProjectPickerInteractionLocked()) return;

        const project = this._getProjectPickerProject(projectId);
        if (!project) return;

        const nextName = (this._projectPicker.projectNameDrafts[projectId] ?? project.name).trim();
        if (!nextName || nextName === project.name.trim()) {
            this._projectPicker.editingProjectId = '';
            this._resetProjectPickerNameDraft(projectId);
            this._renderProjectPicker();
            return;
        }

        try {
            await this._runProjectPickerAction('rename', projectId, async () => {
                await this._projectActions.renameProject(projectId, nextName);
                this._projectPicker.editingProjectId = '';
                await this._refreshProjectPickerProjects();
            });
        } finally {
            this._projectPicker.editingProjectId = '';
            this._resetProjectPickerNameDraft(projectId);
            this._renderProjectPicker();
        }
    }

    async _handleProjectPickerDeleteSelected() {
        if (this._isProjectPickerInteractionLocked() || !this._projectActions?.deleteProjects) return;

        const selectedProjectIds = this._projectPicker.selectedProjectIds.filter((projectId) => (
            typeof projectId === 'string' && projectId && !this._isCurrentProjectPickerProject(projectId)
        ));
        if (!selectedProjectIds.length) return;

        const shouldDelete = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(
                selectedProjectIds.length === 1
                    ? 'Delete 1 selected project?'
                    : `Delete ${selectedProjectIds.length} selected projects?`
            )
            : true;
        if (!shouldDelete) return;

        await this._runProjectPickerAction('delete', '', async () => {
            await this._projectActions.deleteProjects(selectedProjectIds);
            this._projectPicker.selectedProjectIds = [];
            this._projectPicker.editingProjectId = '';
            await this._refreshProjectPickerProjects();
        });
    }

    _renderProjectPicker() {
        const isInteractionLocked = this._isProjectPickerInteractionLocked();
        const projectPickerModal = getHtmlElement('projectPickerModal');
        if (projectPickerModal) {
            projectPickerModal.hidden = !this._projectPicker.isOpen;
        }
        document.body?.classList?.toggle('project-picker-open', this._projectPicker.isOpen);
        this._syncModalBackgroundLock();

        const projectPickerCloseBtn = getButtonElement('projectPickerCloseBtn');
        if (projectPickerCloseBtn) {
            projectPickerCloseBtn.disabled = isInteractionLocked;
        }

        const projectPickerSearchInput = getInputElement('projectPickerSearchInput');
        if (projectPickerSearchInput) {
            projectPickerSearchInput.disabled = isInteractionLocked;
            if (document.activeElement !== projectPickerSearchInput) {
                projectPickerSearchInput.value = this._projectPicker.search;
            }
        }

        const projectPickerCreateBtn = getButtonElement('projectPickerCreateBtn');
        if (projectPickerCreateBtn) {
            projectPickerCreateBtn.disabled = isInteractionLocked || !this._projectActions?.createProject;
            projectPickerCreateBtn.textContent = this._projectPicker.busyAction === 'create'
                ? 'Creating...'
                : 'New project';
        }

        const selectedProjectCount = this._projectPicker.selectedProjectIds.length;
        const projectPickerSelectionSummary = getHtmlElement('projectPickerSelectionSummary');
        if (projectPickerSelectionSummary) {
            const summary = selectedProjectCount === 1
                ? '1 project selected'
                : `${selectedProjectCount} projects selected`;
            projectPickerSelectionSummary.hidden = selectedProjectCount < 1;
            projectPickerSelectionSummary.textContent = summary;
        }

        const projectPickerDeleteSelectedBtn = getButtonElement('projectPickerDeleteSelectedBtn');
        if (projectPickerDeleteSelectedBtn) {
            const isBulkDeleteBusy = this._projectPicker.busyAction === 'delete' && !this._projectPicker.busyProjectId;
            projectPickerDeleteSelectedBtn.disabled = isInteractionLocked
                || selectedProjectCount < 1
                || !this._projectActions?.deleteProjects;
            projectPickerDeleteSelectedBtn.textContent = isBulkDeleteBusy
                ? 'Deleting...'
                : 'Delete selected';
        }

        const projectPickerError = getHtmlElement('projectPickerError');
        if (projectPickerError) {
            const message = this._projectPicker.error.trim();
            projectPickerError.hidden = !message;
            projectPickerError.textContent = message;
        }

        const projectPickerList = getHtmlElement('projectPickerList');
        if (!projectPickerList) return;

        const searchValue = this._projectPicker.search.trim().toLowerCase();
        const visibleProjects = this._projectPicker.projects.filter((project) => {
            if (!searchValue) return true;
            return `${project.name} ${project.sport}`.toLowerCase().includes(searchValue);
        });

        if (!canUseDomTemplates(projectPickerList)) {
            projectPickerList.innerHTML = this._buildProjectPickerMarkup(visibleProjects, searchValue, isInteractionLocked);
            return;
        }

        if (this._projectPicker.isLoading && !visibleProjects.length) {
            replaceChildren(projectPickerList, [
                createTextElement('div', 'Loading projects...', 'project-picker-row-status')
            ]);
            return;
        }

        if (!visibleProjects.length) {
            replaceChildren(projectPickerList, [
                createTextElement(
                    'div',
                    searchValue ? 'No projects match your search.' : 'No saved projects yet.',
                    'project-picker-empty'
                )
            ]);
            return;
        }

        const rows = visibleProjects.map((project) => {
            const row = cloneTemplateElement('projectPickerRowTemplate');
            if (!row) return null;

            const projectId = project.id;
            const projectName = project.name || 'Untitled Project';
            const isCurrentProject = this._isCurrentProjectPickerProject(project.id);
            const isEditing = this._projectPicker.editingProjectId === project.id;
            const projectDraftName = this._projectPicker.projectNameDrafts[project.id] ?? project.name;
            const isBusyRename = this._projectPicker.busyAction === 'rename' && this._projectPicker.busyProjectId === project.id;
            const isBusyDuplicate = this._projectPicker.busyAction === 'duplicate' && this._projectPicker.busyProjectId === project.id;
            const isBusyDelete = this._projectPicker.busyAction === 'delete' && this._projectPicker.busyProjectId === project.id;
            const isBusyOpen = this._projectPicker.busyAction === 'open' && this._projectPicker.busyProjectId === project.id;
            const isSelected = this._projectPicker.selectedProjectIds.includes(project.id);
            const isSelectionDisabled = isInteractionLocked || isCurrentProject;
            const selectionLabel = isSelected ? 'Deselect project' : 'Select project';

            row.classList.toggle('project-picker-row-selected', isSelected);

            const selectionLabelEl = /** @type {HTMLLabelElement | null} */ (row.querySelector('.project-picker-row-select'));
            const selectionInput = /** @type {HTMLInputElement | null} */ (row.querySelector('[data-project-picker-select-input]'));
            if (selectionLabelEl) {
                selectionLabelEl.setAttribute('aria-label', `${selectionLabel} ${projectName}`);
            }
            if (selectionInput) {
                selectionInput.dataset.projectPickerSelect = projectId;
                selectionInput.checked = isSelected;
                selectionInput.disabled = isSelectionDisabled;
            }

            const editingShell = /** @type {HTMLElement | null} */ (row.querySelector('[data-project-picker-editing]'));
            const displayButton = /** @type {HTMLButtonElement | null} */ (row.querySelector('[data-open-project-button]'));
            if (editingShell) editingShell.hidden = !isEditing;
            if (displayButton) {
                displayButton.hidden = isEditing;
                displayButton.dataset.openProjectId = projectId;
                displayButton.disabled = isInteractionLocked;
            }

            const displayName = row.querySelector('[data-project-picker-name]');
            const displaySport = row.querySelector('[data-project-picker-sport]');
            const displayBadge = /** @type {HTMLElement | null} */ (row.querySelector('[data-project-picker-badge]'));
            const displayStatus = /** @type {HTMLElement | null} */ (row.querySelector('[data-project-picker-status]'));
            displayName?.replaceChildren(document.createTextNode(projectName));
            displaySport?.replaceChildren(document.createTextNode(project.sport || 'Football'));
            if (displayBadge) displayBadge.hidden = !isCurrentProject;

            const displayStatusText = isBusyOpen
                ? 'Opening...'
                : isBusyDuplicate
                    ? 'Duplicating...'
                    : isBusyDelete
                        ? 'Deleting...'
                        : '';
            if (displayStatus) {
                displayStatus.hidden = !displayStatusText;
                displayStatus.textContent = displayStatusText;
            }

            const editingInput = /** @type {HTMLInputElement | null} */ (row.querySelector('[data-project-picker-name-input]'));
            const editingLabel = /** @type {HTMLLabelElement | null} */ (row.querySelector('[data-project-picker-name-label]'));
            const editingSport = row.querySelector('[data-project-picker-edit-sport]');
            const editingBadge = /** @type {HTMLElement | null} */ (row.querySelector('[data-project-picker-edit-badge]'));
            const editingStatus = /** @type {HTMLElement | null} */ (row.querySelector('[data-project-picker-edit-status]'));
            if (editingInput) {
                const inputId = `projectPickerNameInput-${projectId}`;
                editingInput.id = inputId;
                editingInput.dataset.projectPickerNameId = projectId;
                editingInput.value = projectDraftName;
                editingInput.disabled = isInteractionLocked;
            }
            if (editingLabel && editingInput) {
                editingLabel.htmlFor = editingInput.id;
                editingLabel.textContent = `${projectName} project name`;
            }
            editingSport?.replaceChildren(document.createTextNode(project.sport || 'Football'));
            if (editingBadge) editingBadge.hidden = !isCurrentProject;
            if (editingStatus) {
                editingStatus.hidden = !isBusyRename;
                editingStatus.textContent = isBusyRename ? 'Renaming...' : '';
            }

            row.querySelector('[data-project-picker-updated]')?.replaceChildren(
                document.createTextNode(formatProjectListUpdatedAt(project.updatedAt))
            );

            [
                {
                    action: 'edit',
                    label: `Rename ${projectName}`,
                    disabled: isInteractionLocked || !this._projectActions?.renameProject
                },
                {
                    action: 'duplicate',
                    label: `Duplicate ${projectName}`,
                    disabled: isInteractionLocked || !this._projectActions?.duplicateProject
                },
                {
                    action: 'delete',
                    label: `Delete ${projectName}`,
                    disabled: isInteractionLocked || !this._projectActions?.deleteProject
                }
            ].forEach((descriptor) => {
                const button = /** @type {HTMLButtonElement | null} */ (
                    row.querySelector(`[data-project-picker-row-action="${descriptor.action}"]`)
                );
                if (!button) return;
                button.dataset.projectId = projectId;
                button.setAttribute('aria-label', descriptor.label);
                button.setAttribute('title', descriptor.label);
                button.disabled = descriptor.disabled;
                button.replaceChildren(createProjectActionIcon(descriptor.action));
            });

            return row;
        });

        replaceChildren(projectPickerList, rows);
    }

    _buildOptionMenuMarkup() {
        const optionItemsMarkup = this._optionChrome.items.map((item) => {
            const isDisabled = this._projectSaveBusy || item.isActive || !this._projectActions?.selectOption;
            return `
                <button class="project-option-item${item.isActive ? ' active' : ''}" type="button" data-project-option-action="select" data-project-option-id="${escapeHtml(item.id)}"${serializeDisabled(isDisabled)}>
                    <span class="project-option-item-leading">
                        <span class="project-option-dot" style="--option-color: ${escapeHtml(item.color)}"></span>
                        <span class="project-option-item-label">${escapeHtml(item.label)}</span>
                    </span>
                    <span class="project-option-item-status"${item.isActive ? '' : ' hidden'}>Active</span>
                </button>
            `;
        }).join('');

        const actionItemsMarkup = [
            {
                action: 'create',
                label: 'Option',
                icon: '+',
                disabled: this._projectSaveBusy || !this._optionChrome.canCreate || !this._projectActions?.createOption
            },
            {
                action: 'manage',
                label: 'Manage',
                icon: '&#9881;',
                disabled: this._projectSaveBusy || !this._optionChrome.canManage
            }
        ].map((descriptor) => `
            <button class="project-option-item project-option-item--action" type="button" data-project-option-action="${descriptor.action}"${serializeDisabled(descriptor.disabled)}>
                <span class="project-option-item-leading">
                    <span class="project-option-action-icon">${descriptor.icon}</span>
                    <span class="project-option-item-label">${descriptor.label}</span>
                </span>
            </button>
        `).join('');

        return `${optionItemsMarkup}<div class="project-menu-divider" role="presentation"></div>${actionItemsMarkup}`;
    }

    _buildOptionManagerMarkup(visibleItems) {
        if (!visibleItems.length) {
            return '<div class="project-option-manager-empty">No options match your search.</div>';
        }

        return visibleItems.map((item) => {
            const isEditing = this._projectOptionEditingId === item.id;
            const inputValue = this._projectOptionNameDrafts[item.id] ?? item.label;
            return `
                <article class="project-option-manager-row${item.isActive ? ' active' : ''}" role="listitem">
                    <div class="project-option-manager-main project-option-manager-main-editing" data-project-option-editing${isEditing ? '' : ' hidden'}>
                        <span class="project-option-dot" style="--option-color: ${escapeHtml(item.color)}"></span>
                        <label class="sr-only" for="projectOptionNameInput-${escapeHtml(item.id)}">${escapeHtml(item.label)} option name</label>
                        <input id="projectOptionNameInput-${escapeHtml(item.id)}" type="text" data-project-option-name-id="${escapeHtml(item.id)}" value="${escapeHtml(inputValue)}"${serializeDisabled(this._projectSaveBusy || !this._projectActions?.renameOption)}>
                    </div>
                    <button class="project-option-manager-main" type="button" data-project-option-select data-project-option-manager-row-action="select" data-project-option-id="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.label)}"${isEditing ? ' hidden' : ''}${serializeDisabled(this._projectSaveBusy || item.isActive || !this._projectActions?.selectOption)}>
                        <span class="project-option-dot" style="--option-color: ${escapeHtml(item.color)}"></span>
                        <span class="project-option-manager-name">${escapeHtml(item.label)}</span>
                    </button>
                    <div class="project-option-manager-actions">
                        <button class="project-option-manager-icon-btn btn btn--icon" type="button" data-project-option-manager-action="edit" data-project-option-id="${escapeHtml(item.id)}" aria-label="Rename ${escapeHtml(item.label)}" title="Rename ${escapeHtml(item.label)}"${serializeDisabled(this._projectSaveBusy || !this._projectActions?.renameOption)}></button>
                        <button class="project-option-manager-icon-btn btn btn--icon" type="button" data-project-option-manager-action="duplicate" data-project-option-id="${escapeHtml(item.id)}" aria-label="Duplicate ${escapeHtml(item.label)}" title="Duplicate ${escapeHtml(item.label)}"${serializeDisabled(this._projectSaveBusy || !this._projectActions?.duplicateOption)}></button>
                        <button class="project-option-manager-icon-btn project-option-manager-icon-btn-danger btn btn--icon" type="button" data-project-option-manager-action="delete" data-project-option-id="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.label)}" title="Delete ${escapeHtml(item.label)}"${serializeDisabled(this._projectSaveBusy || !item.canDelete || !this._projectActions?.deleteOption)}></button>
                    </div>
                </article>
            `;
        }).join('');
    }

    _buildProjectPickerMarkup(visibleProjects, searchValue, isInteractionLocked) {
        if (this._projectPicker.isLoading && !visibleProjects.length) {
            return '<div class="project-picker-row-status">Loading projects...</div>';
        }

        if (!visibleProjects.length) {
            return searchValue
                ? '<div class="project-picker-empty">No projects match your search.</div>'
                : '<div class="project-picker-empty">No saved projects yet.</div>';
        }

        return visibleProjects.map((project) => {
            const projectId = project.id;
            const projectName = project.name || 'Untitled Project';
            const isCurrentProject = this._isCurrentProjectPickerProject(project.id);
            const isEditing = this._projectPicker.editingProjectId === project.id;
            const projectDraftName = this._projectPicker.projectNameDrafts[project.id] ?? project.name;
            const isBusyRename = this._projectPicker.busyAction === 'rename' && this._projectPicker.busyProjectId === project.id;
            const isBusyDuplicate = this._projectPicker.busyAction === 'duplicate' && this._projectPicker.busyProjectId === project.id;
            const isBusyDelete = this._projectPicker.busyAction === 'delete' && this._projectPicker.busyProjectId === project.id;
            const isBusyOpen = this._projectPicker.busyAction === 'open' && this._projectPicker.busyProjectId === project.id;
            const isSelected = this._projectPicker.selectedProjectIds.includes(project.id);
            const isSelectionDisabled = isInteractionLocked || isCurrentProject;
            const selectionLabel = isSelected ? 'Deselect project' : 'Select project';
            const displayStatusText = isBusyOpen
                ? 'Opening...'
                : isBusyDuplicate
                    ? 'Duplicating...'
                    : isBusyDelete
                        ? 'Deleting...'
                        : '';

            return `
                <article class="project-picker-row${isSelected ? ' project-picker-row-selected' : ''}" role="listitem">
                    <label class="project-picker-row-select" aria-label="${escapeHtml(selectionLabel)} ${escapeHtml(projectName)}">
                        <input type="checkbox" data-project-picker-select="${escapeHtml(projectId)}"${isSelected ? ' checked' : ''}${serializeDisabled(isSelectionDisabled)}>
                    </label>
                    <div class="project-picker-row-content">
                        <button class="project-picker-row-main" type="button" data-open-project-button data-open-project-id="${escapeHtml(projectId)}"${isEditing ? ' hidden' : ''}${serializeDisabled(isInteractionLocked)}>
                            <span class="project-picker-row-name">${escapeHtml(projectName)}</span>
                            <span class="project-picker-row-sport">${escapeHtml(project.sport || 'Football')}</span>
                            <span class="project-picker-row-badge"${isCurrentProject ? '' : ' hidden'}>Current project</span>
                            <span class="project-picker-row-status"${displayStatusText ? '' : ' hidden'}>${escapeHtml(displayStatusText)}</span>
                        </button>
                        <div class="project-picker-row-editing" data-project-picker-editing${isEditing ? '' : ' hidden'}>
                            <label class="sr-only" for="projectPickerNameInput-${escapeHtml(projectId)}">${escapeHtml(projectName)} project name</label>
                            <input id="projectPickerNameInput-${escapeHtml(projectId)}" type="text" data-project-picker-name-id="${escapeHtml(projectId)}" value="${escapeHtml(projectDraftName)}"${serializeDisabled(isInteractionLocked)}>
                            <span class="project-picker-row-sport">${escapeHtml(project.sport || 'Football')}</span>
                            <span class="project-picker-row-badge"${isCurrentProject ? '' : ' hidden'}>Current project</span>
                            <span class="project-picker-row-status"${isBusyRename ? '' : ' hidden'}>${isBusyRename ? 'Renaming...' : ''}</span>
                        </div>
                    </div>
                    <span class="project-picker-row-updated">${escapeHtml(formatProjectListUpdatedAt(project.updatedAt))}</span>
                    <div class="project-picker-row-actions">
                        <button class="project-option-manager-icon-btn btn btn--icon" type="button" data-project-picker-row-action="edit" data-project-id="${escapeHtml(projectId)}" aria-label="Rename ${escapeHtml(projectName)}" title="Rename ${escapeHtml(projectName)}"${serializeDisabled(isInteractionLocked || !this._projectActions?.renameProject)}></button>
                        <button class="project-option-manager-icon-btn btn btn--icon" type="button" data-project-picker-row-action="duplicate" data-project-id="${escapeHtml(projectId)}" aria-label="Duplicate ${escapeHtml(projectName)}" title="Duplicate ${escapeHtml(projectName)}"${serializeDisabled(isInteractionLocked || !this._projectActions?.duplicateProject)}></button>
                        <button class="project-option-manager-icon-btn project-option-manager-icon-btn-danger btn btn--icon" type="button" data-project-picker-row-action="delete" data-project-id="${escapeHtml(projectId)}" aria-label="Delete ${escapeHtml(projectName)}" title="Delete ${escapeHtml(projectName)}"${serializeDisabled(isInteractionLocked || !this._projectActions?.deleteProject)}></button>
                    </div>
                </article>
            `;
        }).join('');
    }

    async _handleProjectPickerAction(action, projectId) {
        if (this._isProjectPickerInteractionLocked()) return;
        const nextProjectId = typeof projectId === 'string' ? projectId : '';
        if (!nextProjectId) return;

        if (action === 'edit') {
            this._startProjectPickerNameEdit(nextProjectId);
            return;
        }

        if (action === 'open' && this._projectActions?.openProject) {
            await this._runProjectPickerAction('open', nextProjectId, async () => {
                await this._projectActions.openProject(nextProjectId);
                this._closeProjectPicker();
            });
            return;
        }

        if (action === 'duplicate' && this._projectActions?.duplicateProject) {
            await this._runProjectPickerAction('duplicate', nextProjectId, async () => {
                await this._projectActions.duplicateProject(nextProjectId);
                this._projectPicker.editingProjectId = '';
                await this._refreshProjectPickerProjects();
            });
            return;
        }

        if (action === 'delete' && this._projectActions?.deleteProject) {
            const projectLabel = this._getProjectPickerProject(nextProjectId)?.name ?? 'this project';
            const shouldDelete = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(`Delete "${projectLabel}"?`)
                : true;
            if (!shouldDelete) return;

            const isCurrentProject = this._projectChrome.metadata?.id === nextProjectId;
            await this._runProjectPickerAction('delete', nextProjectId, async () => {
                await this._projectActions.deleteProject(nextProjectId);
                this._projectPicker.editingProjectId = '';
                if (isCurrentProject) {
                    this._closeProjectPicker();
                    return;
                }
                await this._refreshProjectPickerProjects();
            });
        }
    }

    async _runProjectPickerAction(actionName, projectId, callback) {
        if (typeof callback !== 'function' || this._isProjectPickerInteractionLocked()) return;

        this._projectPicker.busyAction = actionName;
        this._projectPicker.busyProjectId = projectId;
        this._renderProjectPicker();

        try {
            await callback();
        } catch {
            // Status updates are rendered through the project action port.
        } finally {
            this._projectPicker.busyAction = '';
            this._projectPicker.busyProjectId = '';
            this._renderProjectPicker();
        }
    }

    _isProjectPickerInteractionLocked() {
        return this._projectPicker.isLoading || Boolean(this._projectPicker.busyAction);
    }

    _renderEmployeeIdentity(session = null) {
        const nextSession = cloneSessionDto(session);
        const avatarImage = /** @type {HTMLImageElement | null} */ (document.getElementById('employeeAvatarImage'));
        const avatarInitials = getHtmlElement('employeeAvatarInitials');
        const displayNameEl = getHtmlElement('employeeDisplayName');
        const jobTitleEl = getHtmlElement('employeeJobTitle');
        const displayName = nextSession?.displayName || 'Signed out';
        const jobTitle = nextSession?.jobTitle || (nextSession ? 'Awaiting directory sync' : 'Directory profile unavailable');
        const initials = deriveAvatarInitials(nextSession?.displayName || nextSession?.email || '');

        if (displayNameEl) {
            displayNameEl.textContent = displayName;
        }
        if (jobTitleEl) {
            jobTitleEl.textContent = jobTitle;
        }
        if (avatarInitials) {
            avatarInitials.textContent = initials;
        }

        if (!avatarImage || !avatarInitials) return;

        avatarImage.onerror = () => {
            avatarImage.hidden = true;
            avatarImage.removeAttribute('src');
            avatarImage.alt = '';
            avatarInitials.hidden = false;
        };

        if (nextSession?.photoUrl) {
            avatarImage.src = nextSession.photoUrl;
            avatarImage.alt = `${displayName} profile photo`;
            avatarImage.hidden = false;
            avatarInitials.hidden = true;
            return;
        }

        avatarImage.hidden = true;
        avatarImage.removeAttribute('src');
        avatarImage.alt = '';
        avatarInitials.hidden = false;
    }

}
