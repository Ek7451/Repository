import { ProjectChromeShell } from './project-chrome-shell.js';
import { WorkspaceShell } from './workspace-shell.js';

function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
}

function getErrorReason(error) {
    if (error && typeof error === 'object' && typeof error.message === 'string') {
        return error.message;
    }
    return String(error);
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

        this._onExportRequested = typeof settings.onExportRequested === 'function'
            ? settings.onExportRequested
            : null;
        this._onConfigImported = typeof settings.onConfigImported === 'function'
            ? settings.onConfigImported
            : null;
        this._cleanup = [];
        this._projectChromeShell = new ProjectChromeShell({
            projectActions: settings.projectActions,
            onExportRequested: (kind) => this._handleExportRequest(kind),
            isScene3DActive: () => this.isScene3DActive()
        });
        this._workspaceShell = new WorkspaceShell({
            themeStorageKey: settings.themeStorageKey,
            onThemeChanged: settings.onThemeChanged,
            onViewTabChanged: settings.onViewTabChanged,
            onResultsTabChanged: settings.onResultsTabChanged,
            onScene3DResizeRequested: settings.onScene3DResizeRequested
        });
    }

    init() {
        this._projectChromeShell.init();
        this._workspaceShell.init();
        this._bindConfigImport();
    }

    destroy() {
        this._cleanup.forEach((dispose) => dispose());
        this._cleanup = [];
        this._projectChromeShell.destroy();
        this._workspaceShell.destroy();
    }

    getTheme() {
        return this._workspaceShell.getTheme();
    }

    applyTheme(theme, options = {}) {
        this._workspaceShell.applyTheme(theme, options);
    }

    renderProjectChrome(chrome = {}, options = {}) {
        this._projectChromeShell.renderProjectChrome(chrome, options);
    }

    renderProjectStatus(status = {}) {
        this._projectChromeShell.renderProjectStatus(status);
    }

    setProjectSaveBusy(isBusy = false) {
        this._projectChromeShell.setProjectSaveBusy(isBusy);
    }

    renderOptionChrome(optionChrome = {}) {
        this._projectChromeShell.renderOptionChrome(optionChrome);
    }

    syncFromState(state = {}) {
        this._workspaceShell.syncFromState(state);
    }

    getViewCanvases() {
        return this._workspaceShell.getViewCanvases();
    }

    connectViewCanvases(options = {}) {
        return this._workspaceShell.connectViewCanvases(options);
    }

    applyUrlViewOverride() {
        this._workspaceShell.applyUrlViewOverride();
    }

    setViewTab(tab, options = {}) {
        this._workspaceShell.setViewTab(tab, options);
        this._projectChromeShell.refreshProjectMenu();
    }

    setResultsTab(targetId, options = {}) {
        this._workspaceShell.setResultsTab(targetId, options);
    }

    ensure3DContainerSize() {
        this._workspaceShell.ensure3DContainerSize();
    }

    observeViewCanvases(options = {}) {
        this._workspaceShell.observeViewCanvases(options);
    }

    handleViewTabChanged(tab, options = {}) {
        this._workspaceShell.handleViewTabChanged(tab, options);
    }

    isScene3DActive() {
        return this._workspaceShell.isScene3DActive();
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
