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

function getTargetElement(target) {
    return target instanceof Element ? target : null;
}

function normalizeViewTab(tab) {
    return ['profile', 'field', 'scene3d'].includes(tab) ? tab : 'profile';
}

function normalizeResultsTab(targetId) {
    return targetId === 'detailsTab' ? 'detailsTab' : 'statsTab';
}

function getErrorReason(error) {
    if (error && typeof error === 'object' && typeof error.message === 'string') {
        return error.message;
    }
    return String(error);
}

function isScene3DPanelActive() {
    return !!getHtmlElement('scene3dPanel')?.classList.contains('active');
}

function dispatchShellResize() {
    window.dispatchEvent(new Event('resize'));
}

function setSidebarWidth(sidebar, width) {
    if (!sidebar || !Number.isFinite(width) || width <= 0) return;
    const nextWidth = `${width}px`;
    sidebar.style.width = nextWidth;
    sidebar.style.minWidth = nextWidth;
}

function syncLeftSidebarSliderState(sidebar, minWidth, currentWidth = null) {
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.contains('collapsed');
    const sidebarWidth = Number.isFinite(currentWidth)
        ? currentWidth
        : sidebar.getBoundingClientRect().width;
    const isSliderMinimized = !isCollapsed && Number.isFinite(sidebarWidth) && sidebarWidth <= (minWidth + 0.5);
    sidebar.classList.toggle('slider-minimized', isSliderMinimized);
}

function resizeCanvasToParent(canvas) {
    const parent = canvas?.parentElement;
    const rect = parent?.getBoundingClientRect?.();
    if (!canvas || !rect) return;
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderProjectOptionManagerActionIcon(action) {
    if (action === 'edit') {
        return `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
            </svg>
        `;
    }

    if (action === 'duplicate') {
        return `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="10" height="10" rx="2"></rect>
                <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
            </svg>
        `;
    }

    return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 6h18"></path>
            <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
        </svg>
    `;
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
        'saveCurrentProject',
        'renameCurrentProject',
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

export class EditorShell {
    constructor(options = {}) {
        const settings = /** @type {{
            themeStorageKey?: string,
            projectActions?: object | null,
            onThemeChanged?: ((theme: string, options?: { rerender?: boolean }) => void),
            onViewTabChanged?: ((tab: string) => void),
            onResultsTabChanged?: ((tab: string) => void),
            onExportRequested?: ((kind: string) => Promise<object | null> | object | null),
            onConfigImported?: ((payload: { file: File, text: string }) => Promise<void> | void),
            onScene3DResizeRequested?: (() => void)
        }} */ (options && typeof options === 'object' ? options : {});

        this._themeStorageKey = typeof settings.themeStorageKey === 'string' && settings.themeStorageKey.trim()
            ? settings.themeStorageKey.trim()
            : 'jlg-seating-theme';
        this._onThemeChanged = typeof settings.onThemeChanged === 'function'
            ? settings.onThemeChanged
            : null;
        this._onViewTabChanged = typeof settings.onViewTabChanged === 'function'
            ? settings.onViewTabChanged
            : null;
        this._onResultsTabChanged = typeof settings.onResultsTabChanged === 'function'
            ? settings.onResultsTabChanged
            : null;
        this._onExportRequested = typeof settings.onExportRequested === 'function'
            ? settings.onExportRequested
            : null;
        this._onConfigImported = typeof settings.onConfigImported === 'function'
            ? settings.onConfigImported
            : null;
        this._onScene3DResizeRequested = typeof settings.onScene3DResizeRequested === 'function'
            ? settings.onScene3DResizeRequested
            : null;
        this._projectActions = normalizeProjectActions(settings.projectActions);

        this._cleanup = [];
        this._theme = 'light';
        this._initialized = false;
        this._feedbackBtnCopyFallbackTimer = null;
        this._feedbackBtnResetTimer = null;
        this._viewResizeObserver = null;
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
            openRowMenuProjectId: '',
            projects: []
        };
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this.applyTheme(this._getSavedTheme(), { persist: false, rerender: false });
        this._renderProjectMenu();
        this._renderOptionChrome();
        this._renderProjectNameField();
        this._renderProjectPicker();
        this._bindThemeToggle();
        this._bindProjectChrome();
        this._bindSidebarChrome();
        this._bindTabs();
        this._bindConfigImport();
        this._bindFeedbackButton();
        this._bindWindowResize();
        this._bindCollapsibleSections();
        this._initTooltips();
    }

    destroy() {
        this._cleanup.forEach((dispose) => dispose());
        this._cleanup = [];
        clearTimeout(this._feedbackBtnCopyFallbackTimer);
        clearTimeout(this._feedbackBtnResetTimer);
        this._disconnectViewCanvasObserver();
        this._projectOptionManagerOpen = false;
        this._projectPicker.isOpen = false;
        document.body?.classList?.remove('project-picker-open');
        document.body?.classList?.remove('project-option-manager-open');
        this._syncModalBackgroundLock();
        this._initialized = false;
    }

    getTheme() {
        return this._theme;
    }

    applyTheme(theme, { persist = true, rerender = true } = {}) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        this._theme = nextTheme;

        document.documentElement.setAttribute('data-theme', nextTheme);
        if (document.body) {
            document.body.classList.toggle('theme-dark', nextTheme === 'dark');
        }

        if (persist) {
            try {
                localStorage.setItem(this._themeStorageKey, nextTheme);
            } catch {
                // Ignore localStorage access errors.
            }
        }

        this._refreshThemeToggleButton();
        this._onThemeChanged?.(nextTheme, { rerender });
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
        this._renderSaveButton();
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
        this._renderSaveButton();
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

    syncFromState({ activeViewTab = 'profile', activeResultsTab = 'statsTab' } = {}) {
        this.setViewTab(activeViewTab, { notify: false });
        this.setResultsTab(activeResultsTab, { notify: false });
    }

    getViewCanvases() {
        return {
            fieldCanvas: /** @type {HTMLCanvasElement | null} */ (document.getElementById('fieldCanvas')),
            profileCanvas: /** @type {HTMLCanvasElement | null} */ (document.getElementById('profileCanvas'))
        };
    }

    connectViewCanvases({ onResize = null } = {}) {
        const { fieldCanvas, profileCanvas } = this.getViewCanvases();
        if (!fieldCanvas || !profileCanvas) {
            return { fieldCanvas, profileCanvas };
        }

        this.observeViewCanvases({
            fieldCanvas,
            profileCanvas,
            onResize
        });

        return {
            fieldCanvas,
            profileCanvas
        };
    }

    applyUrlViewOverride() {
        try {
            const params = new URLSearchParams(window.location.search);
            const view = params.get('view');
            if (!view) return;
            this.setViewTab(view, { notify: true });
        } catch {
            // Ignore malformed URLs.
        }
    }

    setViewTab(tab, { notify = true } = {}) {
        const nextTab = normalizeViewTab(tab);

        document.querySelectorAll('.view-tab-btn').forEach((button) => {
            button.classList.toggle('active', button.getAttribute('data-tab') === nextTab);
        });

        document.querySelectorAll('.view-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.id === `${nextTab}Panel`);
        });

        const toggle = (id, show) => {
            const el = getHtmlElement(id);
            if (el) el.style.display = show ? 'block' : 'none';
        };

        if (nextTab === 'profile') {
            toggle('fieldSetupSection', true);
            toggle('profileParamsSection', true);
            toggle('focalPointSection', true);
            toggle('additionalTiersSection', true);
            toggle('planViewControls', false);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        } else if (nextTab === 'field') {
            toggle('fieldSetupSection', true);
            toggle('profileParamsSection', false);
            toggle('focalPointSection', true);
            toggle('additionalTiersSection', false);
            toggle('planViewControls', true);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        } else {
            toggle('fieldSetupSection', true);
            toggle('profileParamsSection', false);
            toggle('focalPointSection', false);
            toggle('additionalTiersSection', false);
            toggle('planViewControls', false);
            toggle('resultsSection', true);
            toggle('bowlConfigSection', true);
        }

        this._renderProjectMenu();

        if (notify) {
            this._onViewTabChanged?.(nextTab);
        }
    }

    setResultsTab(targetId, { notify = true } = {}) {
        const nextTarget = normalizeResultsTab(targetId);

        document.querySelectorAll('.results-tab-btn').forEach((button) => {
            button.classList.toggle('active', button.getAttribute('data-target') === nextTarget);
        });
        document.querySelectorAll('.results-tab-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.id === nextTarget);
            if (panel.id === nextTarget) {
                panel.scrollTop = 0;
            }
        });

        const rightSidebar = /** @type {HTMLElement | null} */ (document.querySelector('.right-sidebar'));
        if (rightSidebar && rightSidebar.classList.contains('collapsed')) {
            rightSidebar.classList.remove('collapsed');
            setTimeout(() => {
                dispatchShellResize();
                this._notifyScene3DResize();
            }, 300);
        }

        if (notify) {
            this._onResultsTabChanged?.(nextTarget);
        }
    }

    ensure3DContainerSize() {
        const panel = getHtmlElement('scene3dPanel');
        const container = getHtmlElement('scene3dContainer');
        if (!panel || !container) return;

        const bar = getHtmlElement('cameraBookmarksBar');
        const panelRect = panel.getBoundingClientRect();
        const barRect = bar ? bar.getBoundingClientRect() : null;
        const panelHeight = Math.floor(panelRect.height || 0);
        const barHeight = Math.ceil(barRect ? barRect.height : 0);
        const targetHeight = Math.max(120, panelHeight - barHeight);
        if (panelHeight > 50) {
            container.style.height = `${targetHeight}px`;
            return;
        }

        const viewContainer = document.querySelector('.view-container');
        const rect = viewContainer ? viewContainer.getBoundingClientRect() : null;
        const fallbackHeight = Math.floor((rect && rect.height) ? rect.height : window.innerHeight);
        const fallbackTarget = Math.max(120, fallbackHeight - barHeight);
        if (fallbackTarget > 50) {
            container.style.height = `${fallbackTarget}px`;
        }
    }

    observeViewCanvases({ fieldCanvas = null, profileCanvas = null, onResize = null } = {}) {
        this._disconnectViewCanvasObserver();

        resizeCanvasToParent(fieldCanvas);
        resizeCanvasToParent(profileCanvas);

        if (typeof ResizeObserver !== 'function') return;

        const resizeHandler = typeof onResize === 'function' ? onResize : () => {};
        this._viewResizeObserver = new ResizeObserver(() => {
            resizeCanvasToParent(fieldCanvas);
            resizeCanvasToParent(profileCanvas);
            resizeHandler();
        });

        [fieldCanvas, profileCanvas].forEach((canvas) => {
            const parent = canvas?.parentElement;
            if (parent) {
                this._viewResizeObserver.observe(parent);
            }
        });
    }

    handleViewTabChanged(tab, {
        fieldCanvas = null,
        profileCanvas = null,
        onFieldActivated = null,
        onProfileActivated = null,
        onScene3DActivated = null
    } = {}) {
        const nextTab = normalizeViewTab(tab);

        requestAnimationFrame(() => {
            if (nextTab === 'field') {
                resizeCanvasToParent(fieldCanvas);
                onFieldActivated?.();
                return;
            }

            if (nextTab === 'profile') {
                resizeCanvasToParent(profileCanvas);
                onProfileActivated?.();
                return;
            }

            this.ensure3DContainerSize();
            onScene3DActivated?.();
        });
    }

    isScene3DActive() {
        return isScene3DPanelActive();
    }

    download(descriptor = null) {
        if (!descriptor || typeof descriptor !== 'object') return false;

        const filename = typeof descriptor.filename === 'string' ? descriptor.filename.trim() : '';
        if (!filename) return false;

        if (typeof descriptor.dataUrl === 'string' && descriptor.dataUrl) {
            const anchor = document.createElement('a');
            anchor.href = descriptor.dataUrl;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            return true;
        }

        const blob = descriptor.blob instanceof Blob
            ? descriptor.blob
            : new Blob(
                Array.isArray(descriptor.parts)
                    ? descriptor.parts
                    : [descriptor.content ?? descriptor.bytes ?? ''],
                { type: descriptor.type || 'application/octet-stream' }
            );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        return true;
    }

    _bindProjectChrome() {
        const saveBtn = getButtonElement('saveProjectBtn');
        if (saveBtn) {
            const handleSaveClick = async () => {
                if (!this._projectActions?.saveCurrentProject) return;
                if (this._projectNameEditing) {
                    await this._commitProjectNameEdit();
                    return;
                }
                await this._runToolbarProjectAction('save', () => this._projectActions.saveCurrentProject());
            };
            saveBtn.addEventListener('click', handleSaveClick);
            this._cleanup.push(() => saveBtn.removeEventListener('click', handleSaveClick));
        }

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
                    void this._handleExportRequest(exportAction.getAttribute('data-toolbar-export-kind'));
                }
            };
            projectMenuPanel.addEventListener('click', handleProjectMenuPanelClick);
            this._cleanup.push(() => projectMenuPanel.removeEventListener('click', handleProjectMenuPanelClick));
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
                this._projectPicker.openRowMenuProjectId = '';
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

        const projectPickerList = getHtmlElement('projectPickerList');
        if (projectPickerList) {
            const handleProjectPickerListClick = (event) => {
                if (this._isProjectPickerInteractionLocked()) return;
                const target = getTargetElement(event.target);
                if (!target) return;

                const rowMenuTrigger = target.closest('[data-project-picker-menu-trigger]');
                if (rowMenuTrigger) {
                    event.stopPropagation();
                    this._toggleProjectPickerRowMenu(rowMenuTrigger.getAttribute('data-project-picker-menu-trigger'));
                    return;
                }

                const rowAction = target.closest('[data-project-picker-action]');
                if (rowAction) {
                    event.stopPropagation();
                    void this._handleProjectPickerAction(
                        rowAction.getAttribute('data-project-picker-action'),
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
            projectPickerList.addEventListener('click', handleProjectPickerListClick);
            this._cleanup.push(() => projectPickerList.removeEventListener('click', handleProjectPickerListClick));
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

            if (
                this._projectPicker.openRowMenuProjectId
                && !target.closest('.project-picker-row-menu')
                && !target.closest('[data-project-picker-menu-trigger]')
            ) {
                this._projectPicker.openRowMenuProjectId = '';
                this._renderProjectPicker();
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
        projectOptionMenu.innerHTML = [
            ...this._optionChrome.items.map((item) => `
                <button
                    class="project-option-item ${item.isActive ? 'active' : ''}"
                    type="button"
                    data-project-option-action="select"
                    data-project-option-id="${escapeHtml(item.id)}"
                    ${this._projectSaveBusy || item.isActive || !this._projectActions?.selectOption ? 'disabled' : ''}
                >
                    <span class="project-option-item-leading">
                        <span class="project-option-dot" style="--option-color:${escapeHtml(item.color)}" aria-hidden="true"></span>
                        <span>${escapeHtml(item.label)}</span>
                    </span>
                    ${item.isActive ? '<span class="project-option-pill">Active</span>' : ''}
                </button>
            `),
            '<div class="project-menu-divider"></div>',
            `
                <button
                    class="project-option-item"
                    type="button"
                    data-project-option-action="create"
                    ${this._projectSaveBusy || !this._optionChrome.canCreate || !this._projectActions?.createOption ? 'disabled' : ''}
                >
                    <span class="project-option-item-leading">
                        <span class="project-option-plus" aria-hidden="true">+</span>
                        <span>Option</span>
                    </span>
                </button>
            `,
            `
                <button
                    class="project-option-item"
                    type="button"
                    data-project-option-action="manage"
                    ${this._projectSaveBusy || !this._optionChrome.canManage ? 'disabled' : ''}
                >
                    <span class="project-option-item-leading">
                        <span class="project-option-plus" aria-hidden="true">&#9881;</span>
                        <span>Manage</span>
                    </span>
                </button>
            `
        ].join('');
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

        if (!visibleItems.length) {
            projectOptionManagerList.innerHTML = '<div class="project-option-manager-empty">No options match your search.</div>';
            return;
        }

        projectOptionManagerList.innerHTML = visibleItems.map((item) => `
            <div class="project-option-manager-row ${item.isActive ? 'active' : ''}" role="listitem">
                ${this._projectOptionEditingId === item.id ? `
                    <div class="project-option-manager-main project-option-manager-main-editing">
                        <span class="project-option-dot" style="--option-color:${escapeHtml(item.color)}" aria-hidden="true"></span>
                        <div class="project-option-manager-copy">
                            <label class="sr-only" for="projectOptionNameInput-${escapeHtml(item.id)}">${escapeHtml(item.label)} option name</label>
                            <input
                                id="projectOptionNameInput-${escapeHtml(item.id)}"
                                class="project-option-manager-name-input"
                                type="text"
                                maxlength="80"
                                value="${escapeHtml(this._projectOptionNameDrafts[item.id] ?? item.label)}"
                                data-project-option-name-id="${escapeHtml(item.id)}"
                                ${this._projectSaveBusy || !this._projectActions?.renameOption ? 'disabled' : ''}
                            >
                        </div>
                    </div>
                ` : `
                    <button
                        class="project-option-manager-main"
                        type="button"
                        data-project-option-manager-row-action="select"
                        data-project-option-id="${escapeHtml(item.id)}"
                        aria-label="Open ${escapeHtml(item.label)}"
                        ${this._projectSaveBusy || item.isActive || !this._projectActions?.selectOption ? 'disabled' : ''}
                    >
                        <span class="project-option-dot" style="--option-color:${escapeHtml(item.color)}" aria-hidden="true"></span>
                        <span class="project-option-manager-name">${escapeHtml(item.label)}</span>
                    </button>
                `}
                <div class="project-option-manager-actions">
                    <button
                        class="project-option-manager-icon-btn"
                        type="button"
                        data-project-option-manager-action="edit"
                        data-project-option-id="${escapeHtml(item.id)}"
                        aria-label="Rename ${escapeHtml(item.label)}"
                        title="Rename ${escapeHtml(item.label)}"
                        ${this._projectSaveBusy || !this._projectActions?.renameOption ? 'disabled' : ''}
                    >
                        ${renderProjectOptionManagerActionIcon('edit')}
                    </button>
                    <button
                        class="project-option-manager-icon-btn"
                        type="button"
                        data-project-option-manager-action="duplicate"
                        data-project-option-id="${escapeHtml(item.id)}"
                        aria-label="Duplicate ${escapeHtml(item.label)}"
                        title="Duplicate ${escapeHtml(item.label)}"
                        ${this._projectSaveBusy || !this._projectActions?.duplicateOption ? 'disabled' : ''}
                    >
                        ${renderProjectOptionManagerActionIcon('duplicate')}
                    </button>
                    <button
                        class="project-option-manager-icon-btn project-option-manager-icon-btn-danger"
                        type="button"
                        data-project-option-manager-action="delete"
                        data-project-option-id="${escapeHtml(item.id)}"
                        aria-label="Delete ${escapeHtml(item.label)}"
                        title="Delete ${escapeHtml(item.label)}"
                        ${this._projectSaveBusy || !item.canDelete || !this._projectActions?.deleteOption ? 'disabled' : ''}
                    >
                        ${renderProjectOptionManagerActionIcon('delete')}
                    </button>
                </div>
            </div>
        `).join('');
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
            exportButton.disabled = isBusy || (requiresScene3D && !this.isScene3DActive());
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
        this._projectPicker.openRowMenuProjectId = '';
        this._renderProjectPicker();
        getInputElement('projectPickerSearchInput')?.focus();
        await this._refreshProjectPickerProjects();
    }

    _closeProjectPicker() {
        this._projectPicker.isOpen = false;
        this._projectPicker.error = '';
        this._projectPicker.openRowMenuProjectId = '';
        this._renderProjectPicker();
    }

    async _refreshProjectPickerProjects() {
        if (!this._projectActions?.listProjects) {
            this._projectPicker.projects = [];
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
            this._projectPicker.error = '';
        } catch (error) {
            this._projectPicker.error = getErrorReason(error);
        } finally {
            this._projectPicker.isLoading = false;
            this._renderProjectPicker();
        }
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

        if (this._projectPicker.isLoading && !visibleProjects.length) {
            projectPickerList.innerHTML = '<div class="project-picker-row-status">Loading projects...</div>';
            return;
        }

        if (!visibleProjects.length) {
            projectPickerList.innerHTML = searchValue
                ? '<div class="project-picker-empty">No projects match your search.</div>'
                : '<div class="project-picker-empty">No saved projects yet.</div>';
            return;
        }

        projectPickerList.innerHTML = visibleProjects.map((project) => {
            const projectId = escapeHtml(project.id);
            const isMenuOpen = this._projectPicker.openRowMenuProjectId === project.id;
            const isBusyDuplicate = this._projectPicker.busyAction === 'duplicate' && this._projectPicker.busyProjectId === project.id;
            const isBusyDelete = this._projectPicker.busyAction === 'delete' && this._projectPicker.busyProjectId === project.id;
            const isBusyOpen = this._projectPicker.busyAction === 'open' && this._projectPicker.busyProjectId === project.id;
            const isDisabled = isInteractionLocked ? 'disabled' : '';

            return `
                <article class="project-picker-row" role="listitem">
                    <button class="project-picker-row-main" type="button" data-open-project-id="${projectId}" ${isDisabled}>
                        <svg class="project-picker-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H11l2 2h4.5A2.5 2.5 0 0 1 20 9.5v8A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10z"></path>
                        </svg>
                        <span class="project-picker-row-copy">
                            <span class="project-picker-row-name">${escapeHtml(project.name || 'Untitled Project')}</span>
                            <span class="project-picker-row-sport">${escapeHtml(project.sport || 'Football')}</span>
                            ${isBusyOpen ? '<span class="project-picker-row-status">Opening...</span>' : ''}
                        </span>
                    </button>
                    <div class="project-picker-row-updated">${escapeHtml(formatProjectListUpdatedAt(project.updatedAt))}</div>
                    <button class="project-picker-row-menu-trigger"
                        type="button"
                        aria-label="Project actions for ${escapeHtml(project.name || 'Untitled Project')}"
                        aria-expanded="${isMenuOpen ? 'true' : 'false'}"
                        data-project-picker-menu-trigger="${projectId}"
                        ${isDisabled}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle cx="12" cy="5" r="1.25"></circle>
                            <circle cx="12" cy="12" r="1.25"></circle>
                            <circle cx="12" cy="19" r="1.25"></circle>
                        </svg>
                    </button>
                    ${isMenuOpen
                        ? `
                            <div class="project-picker-row-menu">
                                <button class="project-picker-row-menu-item" type="button" data-project-picker-action="duplicate" data-project-id="${projectId}" ${isDisabled}>
                                    <span>${isBusyDuplicate ? 'Duplicating...' : 'Duplicate project'}</span>
                                </button>
                                <button class="project-picker-row-menu-item project-picker-row-menu-item-danger" type="button" data-project-picker-action="delete" data-project-id="${projectId}" ${isDisabled}>
                                    <span>${isBusyDelete ? 'Deleting...' : 'Delete project'}</span>
                                </button>
                            </div>
                        `
                        : ''}
                </article>
            `;
        }).join('');
    }

    _toggleProjectPickerRowMenu(projectId) {
        if (this._isProjectPickerInteractionLocked()) return;
        const nextProjectId = typeof projectId === 'string' ? projectId : '';
        this._projectPicker.openRowMenuProjectId = this._projectPicker.openRowMenuProjectId === nextProjectId
            ? ''
            : nextProjectId;
        this._renderProjectPicker();
    }

    async _handleProjectPickerAction(action, projectId) {
        if (this._isProjectPickerInteractionLocked()) return;
        const nextProjectId = typeof projectId === 'string' ? projectId : '';
        if (!nextProjectId) return;

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
                this._projectPicker.openRowMenuProjectId = '';
                await this._refreshProjectPickerProjects();
            });
            return;
        }

        if (action === 'delete' && this._projectActions?.deleteProject) {
            const shouldDelete = typeof window.confirm === 'function'
                ? window.confirm('Delete this project?')
                : true;
            if (!shouldDelete) return;

            const isCurrentProject = this._projectChrome.metadata?.id === nextProjectId;
            await this._runProjectPickerAction('delete', nextProjectId, async () => {
                await this._projectActions.deleteProject(nextProjectId);
                this._projectPicker.openRowMenuProjectId = '';
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

    _getSavedTheme() {
        try {
            const stored = localStorage.getItem(this._themeStorageKey);
            if (stored === 'dark' || stored === 'light') return stored;
        } catch {
            // Ignore localStorage access errors.
        }

        const domTheme = document.documentElement?.getAttribute('data-theme');
        return domTheme === 'dark' ? 'dark' : 'light';
    }

    _refreshThemeToggleButton() {
        const themeToggleBtn = getButtonElement('themeToggleBtn');
        if (!themeToggleBtn) return;

        const isDark = this._theme === 'dark';
        const nextModeLabel = isDark ? 'light' : 'dark';
        themeToggleBtn.setAttribute('aria-pressed', String(isDark));
        themeToggleBtn.setAttribute('aria-label', `Toggle dark mode (currently ${this._theme})`);
        themeToggleBtn.setAttribute('title', `Switch to ${nextModeLabel} mode`);

        const label = themeToggleBtn.querySelector('.theme-toggle-label');
        if (label) {
            label.textContent = `Switch to ${nextModeLabel} mode`;
        }
    }

    _bindThemeToggle() {
        const themeToggleBtn = getButtonElement('themeToggleBtn');
        if (!themeToggleBtn) return;

        const handleThemeToggle = (event) => {
            event.stopPropagation();
            this.applyTheme(this._theme === 'dark' ? 'light' : 'dark');
        };

        themeToggleBtn.addEventListener('click', handleThemeToggle);
        this._cleanup.push(() => themeToggleBtn.removeEventListener('click', handleThemeToggle));
    }

    _bindSidebarChrome() {
        const leftCollapsedWidth = 200;
        const rightCollapsedWidth = 200;

        const leftSidebar = /** @type {HTMLElement | null} */ (document.querySelector('.left-sidebar'));
        const toggleControlsBtn = getButtonElement('toggleControlsBtn');
        syncLeftSidebarSliderState(leftSidebar, 350);
        if (toggleControlsBtn && leftSidebar) {
            const handleToggleControls = () => {
                const isCollapsed = leftSidebar.classList.toggle('collapsed');
                if (isCollapsed) {
                    setSidebarWidth(leftSidebar, leftCollapsedWidth);
                } else {
                    leftSidebar.style.removeProperty('width');
                    leftSidebar.style.removeProperty('min-width');
                }
                syncLeftSidebarSliderState(leftSidebar, 350);
                setTimeout(() => {
                    syncLeftSidebarSliderState(leftSidebar, 350);
                    dispatchShellResize();
                    this._notifyScene3DResize();
                }, 300);
            };
            toggleControlsBtn.addEventListener('click', handleToggleControls);
            this._cleanup.push(() => toggleControlsBtn.removeEventListener('click', handleToggleControls));
        }

        const rightSidebar = /** @type {HTMLElement | null} */ (document.querySelector('.right-sidebar'));
        const toggleResultsBtn = getButtonElement('toggleResultsBtn');
        if (toggleResultsBtn && rightSidebar) {
            const handleToggleResults = () => {
                const isCollapsed = rightSidebar.classList.toggle('collapsed');
                if (isCollapsed) {
                    setSidebarWidth(rightSidebar, rightCollapsedWidth);
                } else {
                    rightSidebar.style.removeProperty('width');
                    rightSidebar.style.removeProperty('min-width');
                }
                setTimeout(() => {
                    dispatchShellResize();
                    this._notifyScene3DResize();
                }, 300);
            };
            toggleResultsBtn.dataset.resultsToggleBound = 'editor-shell';
            toggleResultsBtn.addEventListener('click', handleToggleResults);
            this._cleanup.push(() => toggleResultsBtn.removeEventListener('click', handleToggleResults));
        }

        this._bindSidebarResizer({
            resizer: getHtmlElement('leftSidebarResizer'),
            sidebar: leftSidebar,
            collapsedWidth: leftCollapsedWidth,
            minWidth: 350,
            maxWidth: 450,
            getWidthFromPointer: (event) => event.clientX,
            onWidthChanged: (width) => syncLeftSidebarSliderState(leftSidebar, 350, width)
        });
        this._bindSidebarResizer({
            resizer: getHtmlElement('rightSidebarResizer'),
            sidebar: rightSidebar,
            collapsedWidth: rightCollapsedWidth,
            minWidth: 400,
            maxWidth: 800,
            getWidthFromPointer: (event) => window.innerWidth - event.clientX
        });
    }

    _bindSidebarResizer({
        resizer = null,
        sidebar = null,
        collapsedWidth = 0,
        minWidth = 0,
        maxWidth = Number.POSITIVE_INFINITY,
        getWidthFromPointer = null,
        onWidthChanged = null
    } = {}) {
        if (!resizer || !sidebar || typeof getWidthFromPointer !== 'function') return;

        let activePointerId = null;

        const stopResize = () => {
            if (activePointerId === null) return;
            activePointerId = null;
            resizer.classList.remove('resizing');
            document.body.classList.remove('sidebar-resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            onWidthChanged?.(sidebar.getBoundingClientRect().width);
            dispatchShellResize();
            this._notifyScene3DResize();
        };

        const handlePointerDown = (event) => {
            if (typeof event.button === 'number' && event.button !== 0) return;
            activePointerId = event.pointerId;
            resizer.classList.add('resizing');
            document.body.classList.add('sidebar-resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            if (sidebar.classList.contains('collapsed') && collapsedWidth > 0) {
                sidebar.classList.remove('collapsed');
                sidebar.style.removeProperty('width');
                sidebar.style.removeProperty('min-width');
                onWidthChanged?.(minWidth);
            }
            resizer.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        };

        const handlePointerMove = (event) => {
            if (activePointerId === null || event.pointerId !== activePointerId) return;
            const rawWidth = Number(getWidthFromPointer(event));
            if (!Number.isFinite(rawWidth)) return;
            const nextWidth = Math.min(maxWidth, Math.max(minWidth, rawWidth));
            setSidebarWidth(sidebar, nextWidth);
            onWidthChanged?.(nextWidth);
        };

        const handlePointerUp = (event) => {
            if (activePointerId === null || event.pointerId !== activePointerId) return;
            resizer.releasePointerCapture?.(event.pointerId);
            stopResize();
        };

        const handlePointerCancel = (event) => {
            if (activePointerId === null || event.pointerId !== activePointerId) return;
            stopResize();
        };

        resizer.addEventListener('pointerdown', handlePointerDown);
        resizer.addEventListener('pointermove', handlePointerMove);
        resizer.addEventListener('pointerup', handlePointerUp);
        resizer.addEventListener('pointercancel', handlePointerCancel);
        this._cleanup.push(() => resizer.removeEventListener('pointerdown', handlePointerDown));
        this._cleanup.push(() => resizer.removeEventListener('pointermove', handlePointerMove));
        this._cleanup.push(() => resizer.removeEventListener('pointerup', handlePointerUp));
        this._cleanup.push(() => resizer.removeEventListener('pointercancel', handlePointerCancel));
    }

    _bindTabs() {
        document.querySelectorAll('.view-tab-btn').forEach((button) => {
            const handleClick = () => this.setViewTab(button.getAttribute('data-tab'), { notify: true });
            button.addEventListener('click', handleClick);
            this._cleanup.push(() => button.removeEventListener('click', handleClick));
        });

        document.querySelectorAll('.results-tab-btn').forEach((button) => {
            const handleClick = () => this.setResultsTab(button.getAttribute('data-target'), { notify: true });
            button.addEventListener('click', handleClick);
            this._cleanup.push(() => button.removeEventListener('click', handleClick));
        });
    }

    _bindConfigImport() {
        const configFileInput = getInputElement('configFileInput');

        if (configFileInput) {
            const handleChange = (event) => {
                void this._handleConfigImportChange(event);
            };
            configFileInput.addEventListener('change', handleChange);
            this._cleanup.push(() => configFileInput.removeEventListener('change', handleChange));
        }
    }

    _bindFeedbackButton() {
        const feedbackBtn = /** @type {HTMLAnchorElement | null} */ (document.getElementById('feedbackBtn'));
        if (!feedbackBtn) return;

        const feedbackEmail = 'eklinger@jlgarchitects.com';
        const baseLabel = feedbackBtn.textContent?.trim() || 'Feedback';
        const feedbackHref = feedbackBtn.getAttribute('href') || `mailto:${feedbackEmail}`;

        const handleClick = (event) => {
            event.preventDefault();
            try {
                window.location.href = feedbackHref;
            } catch {
                // Ignore and fall through to clipboard fallback.
            }

            clearTimeout(this._feedbackBtnCopyFallbackTimer);
            this._feedbackBtnCopyFallbackTimer = setTimeout(async () => {
                if (!document.hasFocus()) return;
                let copied = false;
                try {
                    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                        await navigator.clipboard.writeText(feedbackEmail);
                        copied = true;
                    }
                } catch {
                    copied = false;
                }
                if (!copied) return;
                feedbackBtn.textContent = 'Email Copied';
                clearTimeout(this._feedbackBtnResetTimer);
                this._feedbackBtnResetTimer = setTimeout(() => {
                    feedbackBtn.textContent = baseLabel;
                }, 1600);
            }, 700);
        };

        feedbackBtn.addEventListener('click', handleClick);
        this._cleanup.push(() => feedbackBtn.removeEventListener('click', handleClick));
    }

    _bindWindowResize() {
        const handleResize = () => {
            if (!isScene3DPanelActive()) return;
            this._notifyScene3DResize();
        };
        window.addEventListener('resize', handleResize);
        this._cleanup.push(() => window.removeEventListener('resize', handleResize));
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

    _renderSaveButton() {
        const saveBtn = getButtonElement('saveProjectBtn');
        if (!saveBtn) return;

        saveBtn.dataset.busy = this._projectSaveBusy ? 'true' : 'false';
        saveBtn.setAttribute('title', this._projectSaveBusy ? 'Saving project' : 'Save project');
        saveBtn.setAttribute('aria-label', this._projectSaveBusy ? 'Saving project' : 'Save project');
        const label = saveBtn.querySelector('.save-project-label');
        if (label) {
            label.textContent = this._projectSaveBusy ? 'Saving Project' : 'Save Project';
        }
        saveBtn.disabled = this._projectSaveBusy || !this._projectChrome.canSave || !this._projectActions?.saveCurrentProject;
    }

    _bindCollapsibleSections() {
        const handleClick = (event) => {
            const target = getTargetElement(event.target);
            if (!target) return;
            if (target.closest('.header-toggle')) return;

            const header = target.closest('.section-header');
            if (header && header.parentElement?.classList.contains('collapsible')) {
                header.parentElement.classList.toggle('collapsed');
            }
        };

        document.body.addEventListener('click', handleClick);
        this._cleanup.push(() => document.body.removeEventListener('click', handleClick));
    }

    _initTooltips() {
        let tooltip = getHtmlElement('tooltip-container');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'tooltip-container';
            document.body.appendChild(tooltip);
        }

        let activeIcon = null;

        const handleMouseOver = (event) => {
            const target = getTargetElement(event.target);
            if (!target) return;
            const icon = target.closest('.info-icon');
            if (!icon) return;

            const text = icon.getAttribute('data-tooltip');
            if (!text) return;

            activeIcon = icon;
            tooltip.innerHTML = text;
            tooltip.classList.add('visible');

            const rect = icon.getBoundingClientRect();
            const tipRect = tooltip.getBoundingClientRect();

            let top = rect.top - tipRect.height - 8;
            let left = rect.left + ((rect.width - tipRect.width) / 2);

            if (top < 10) {
                top = rect.bottom + 8;
            }
            if (left < 10) {
                left = 10;
            } else if ((left + tipRect.width) > (window.innerWidth - 10)) {
                left = window.innerWidth - tipRect.width - 10;
            }

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        };

        const handleMouseOut = (event) => {
            const target = getTargetElement(event.target);
            if (!target) return;
            const icon = target.closest('.info-icon');
            if (icon && icon === activeIcon) {
                tooltip.classList.remove('visible');
                activeIcon = null;
            }
        };

        document.body.addEventListener('mouseover', handleMouseOver);
        document.body.addEventListener('mouseout', handleMouseOut);
        this._cleanup.push(() => document.body.removeEventListener('mouseover', handleMouseOver));
        this._cleanup.push(() => document.body.removeEventListener('mouseout', handleMouseOut));
    }

    _notifyScene3DResize() {
        if (!isScene3DPanelActive()) return;
        this.ensure3DContainerSize();
        this._onScene3DResizeRequested?.();
    }

    _disconnectViewCanvasObserver() {
        if (this._viewResizeObserver) {
            this._viewResizeObserver.disconnect();
            this._viewResizeObserver = null;
        }
    }

    async _handleExportRequest(kind) {
        if (!this._onExportRequested) return;

        try {
            const descriptor = await this._onExportRequested(kind);
            if (descriptor) {
                this.download(descriptor);
            }
        } catch (error) {
            console.error(`${kind} export failed:`, error);
            alert(`Export failed: ${getErrorReason(error)}`);
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
}
