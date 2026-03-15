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

function resizeCanvasToParent(canvas) {
    const parent = canvas?.parentElement;
    const rect = parent?.getBoundingClientRect?.();
    if (!canvas || !rect) return;
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
}

export class EditorShell {
    constructor(options = {}) {
        const settings = /** @type {{
            themeStorageKey?: string,
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

        this._cleanup = [];
        this._theme = 'light';
        this._initialized = false;
        this._feedbackBtnCopyFallbackTimer = null;
        this._feedbackBtnResetTimer = null;
        this._viewResizeObserver = null;
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        this.applyTheme(this._getSavedTheme(), { persist: false, rerender: false });
        this._bindThemeToggle();
        this._bindSidebarChrome();
        this._bindTabs();
        this._bindExportButtons();
        this._bindConfigImport();
        this._bindExportMenu();
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

        this._set3DExportButtonState(nextTab === 'scene3d');

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
        const leftSidebar = /** @type {HTMLElement | null} */ (document.querySelector('.left-sidebar'));
        const toggleControlsBtn = getButtonElement('toggleControlsBtn');
        if (toggleControlsBtn && leftSidebar) {
            const handleToggleControls = () => {
                const isCollapsed = leftSidebar.classList.toggle('collapsed');
                if (isCollapsed) {
                    leftSidebar.style.setProperty('width', '36px', 'important');
                    leftSidebar.style.setProperty('min-width', '36px', 'important');
                } else {
                    leftSidebar.style.removeProperty('width');
                    leftSidebar.style.removeProperty('min-width');
                }
                setTimeout(() => {
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
                rightSidebar.classList.toggle('collapsed');
                setTimeout(() => {
                    dispatchShellResize();
                    this._notifyScene3DResize();
                }, 300);
            };
            toggleResultsBtn.dataset.resultsToggleBound = 'editor-shell';
            toggleResultsBtn.addEventListener('click', handleToggleResults);
            this._cleanup.push(() => toggleResultsBtn.removeEventListener('click', handleToggleResults));
        }

        const leftResizer = getHtmlElement('leftSidebarResizer');
        if (leftResizer && leftSidebar) {
            let isResizing = false;
            const handleMouseDown = (event) => {
                isResizing = true;
                leftResizer.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                event.preventDefault();
            };
            const handleMouseMove = (event) => {
                if (!isResizing) return;
                let nextWidth = event.clientX;
                if (nextWidth < 250) nextWidth = 250;
                if (nextWidth > 500) nextWidth = 500;
                leftSidebar.style.width = `${nextWidth}px`;
                leftSidebar.style.minWidth = `${nextWidth}px`;
            };
            const handleMouseUp = () => {
                if (!isResizing) return;
                isResizing = false;
                leftResizer.classList.remove('resizing');
                document.body.style.cursor = '';
                dispatchShellResize();
                this._notifyScene3DResize();
            };

            leftResizer.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            this._cleanup.push(() => leftResizer.removeEventListener('mousedown', handleMouseDown));
            this._cleanup.push(() => document.removeEventListener('mousemove', handleMouseMove));
            this._cleanup.push(() => document.removeEventListener('mouseup', handleMouseUp));
        }

        const rightResizer = getHtmlElement('rightSidebarResizer');
        if (rightResizer && rightSidebar) {
            let isResizing = false;
            const handleMouseDown = (event) => {
                isResizing = true;
                rightResizer.classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                event.preventDefault();
            };
            const handleMouseMove = (event) => {
                if (!isResizing) return;
                let nextWidth = window.innerWidth - event.clientX;
                if (nextWidth < 250) nextWidth = 250;
                if (nextWidth > 1000) nextWidth = 1000;
                if (nextWidth > 250 && rightSidebar.classList.contains('collapsed')) {
                    rightSidebar.classList.remove('collapsed');
                }
                rightSidebar.style.width = `${nextWidth}px`;
                rightSidebar.style.minWidth = `${nextWidth}px`;
            };
            const handleMouseUp = () => {
                if (!isResizing) return;
                isResizing = false;
                rightResizer.classList.remove('resizing');
                document.body.style.cursor = '';
                dispatchShellResize();
                this._notifyScene3DResize();
            };

            rightResizer.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            this._cleanup.push(() => rightResizer.removeEventListener('mousedown', handleMouseDown));
            this._cleanup.push(() => document.removeEventListener('mousemove', handleMouseMove));
            this._cleanup.push(() => document.removeEventListener('mouseup', handleMouseUp));
        }
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

    _bindExportButtons() {
        const exportBindings = [
            ['exportBtn', 'json'],
            ['exportObjBtn', 'obj'],
            ['exportRhinoBtn', 'rhino'],
            ['exportDxfBtn', 'profile-dxf'],
            ['exportPlanDxfBtn', 'plan-dxf'],
            ['exportCsvBtn', 'csv'],
            ['exportConfigBtn', 'config']
        ];

        exportBindings.forEach(([id, kind]) => {
            const button = getButtonElement(id);
            if (!button) return;
            const handleClick = () => {
                void this._handleExportRequest(kind);
            };
            button.addEventListener('click', handleClick);
            this._cleanup.push(() => button.removeEventListener('click', handleClick));
        });
    }

    _bindConfigImport() {
        const loadConfigBtn = getButtonElement('loadConfigBtn');
        const configFileInput = getInputElement('configFileInput');

        if (loadConfigBtn && configFileInput) {
            const handleLoadClick = () => configFileInput.click();
            loadConfigBtn.addEventListener('click', handleLoadClick);
            this._cleanup.push(() => loadConfigBtn.removeEventListener('click', handleLoadClick));
        }

        if (configFileInput) {
            const handleChange = (event) => {
                void this._handleConfigImportChange(event);
            };
            configFileInput.addEventListener('change', handleChange);
            this._cleanup.push(() => configFileInput.removeEventListener('change', handleChange));
        }
    }

    _bindExportMenu() {
        const exportMenuPanel = /** @type {HTMLElement | null} */ (document.querySelector('.export-menu-panel'));
        const exportMenuHeader = /** @type {HTMLButtonElement | null} */ (document.querySelector('.export-header-btn'));
        if (!exportMenuHeader || !exportMenuPanel) return;

        const handleHeaderClick = (event) => {
            event.stopPropagation();
            exportMenuPanel.classList.toggle('collapsed');
        };
        exportMenuHeader.addEventListener('click', handleHeaderClick);
        this._cleanup.push(() => exportMenuHeader.removeEventListener('click', handleHeaderClick));

        exportMenuPanel.querySelectorAll('.export-item').forEach((item) => {
            const handleItemClick = () => {
                setTimeout(() => exportMenuPanel.classList.add('collapsed'), 150);
            };
            item.addEventListener('click', handleItemClick);
            this._cleanup.push(() => item.removeEventListener('click', handleItemClick));
        });

        const handleDocumentClick = (event) => {
            if (!(event.target instanceof Node)) return;
            if (!exportMenuPanel.classList.contains('collapsed') && !exportMenuPanel.contains(event.target)) {
                exportMenuPanel.classList.add('collapsed');
            }
        };
        document.addEventListener('click', handleDocumentClick);
        this._cleanup.push(() => document.removeEventListener('click', handleDocumentClick));

        const handlePanelClick = (event) => event.stopPropagation();
        exportMenuPanel.addEventListener('click', handlePanelClick);
        this._cleanup.push(() => exportMenuPanel.removeEventListener('click', handlePanelClick));
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

    _set3DExportButtonState(enabled) {
        ['exportObjBtn', 'exportRhinoBtn'].forEach((id) => {
            const button = getButtonElement(id);
            if (!button) return;
            button.disabled = !enabled;
            button.style.opacity = enabled ? '1' : '0.5';
            button.style.cursor = enabled ? 'pointer' : 'not-allowed';
        });
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
