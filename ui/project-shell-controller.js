import {
    buildProjectChromeSnapshot,
    buildProjectSaveRequest,
    cloneProjectMetadata,
    cloneProjectStateDocument,
    cloneSessionDto,
    deriveProjectNameFromSport,
    getActiveProjectOption,
    normalizeProjectStateDocument,
    normalizeProjectStatus
} from '../state/project.js';

export class ProjectShellController {
    constructor(options = {}) {
        const config = /** @type {{
            getSportName?: (() => string),
            onProjectChromeChanged?: ((chrome: object) => void),
            onProjectOptionChromeChanged?: ((chrome: object) => void),
            onStatusChanged?: ((status: object) => void)
        }} */ (options && typeof options === 'object' ? options : {});

        this._getSportName = typeof config.getSportName === 'function'
            ? config.getSportName
            : () => '';
        this._onProjectChromeChanged = typeof config.onProjectChromeChanged === 'function'
            ? config.onProjectChromeChanged
            : null;
        this._onProjectOptionChromeChanged = typeof config.onProjectOptionChromeChanged === 'function'
            ? config.onProjectOptionChromeChanged
            : null;
        this._onStatusChanged = typeof config.onStatusChanged === 'function'
            ? config.onStatusChanged
            : null;
        this._session = null;
        this._projectMetadata = cloneProjectMetadata();
        this._projectStateDocument = normalizeProjectStateDocument();
        this._projectStatus = normalizeProjectStatus();
    }

    destroy() {
        this._onProjectChromeChanged = null;
        this._onProjectOptionChromeChanged = null;
        this._onStatusChanged = null;
    }

    refreshProjectChrome() {
        this._emitProjectChromeChanged();
        this._emitProjectOptionChromeChanged();
    }

    setSession(session) {
        this._session = cloneSessionDto(session);
        this.refreshProjectChrome();
    }

    setProjectMetadata(project = null) {
        this._projectMetadata = cloneProjectMetadata(project);
        this.refreshProjectChrome();
    }

    setProjectName(name = '') {
        this._projectMetadata.name = typeof name === 'string' ? name : '';
        this.refreshProjectChrome();
    }

    setProjectStateDocument(projectState = null) {
        this._projectStateDocument = normalizeProjectStateDocument(projectState);
        this.refreshProjectChrome();
    }

    getProjectMetadata() {
        return cloneProjectMetadata(this._projectMetadata);
    }

    getProjectStateDocument() {
        return cloneProjectStateDocument(this._projectStateDocument);
    }

    getProjectChrome() {
        const optionChrome = this.getProjectOptionChrome();
        const fallbackSport = this._getSportName() || this._projectStateDocument.sport;

        return {
            ...buildProjectChromeSnapshot({
                name: this._projectMetadata.name || deriveProjectNameFromSport(fallbackSport),
                projectMetadata: this._projectMetadata,
                session: this._session
            }),
            activeOptionId: optionChrome.activeOptionId,
            options: optionChrome.items.map((item) => ({
                id: item.id,
                label: item.label,
                color: item.color,
                isActive: item.isActive
            })),
            canCreateOption: optionChrome.canCreate,
            canManageOptions: optionChrome.canManage,
            canDeleteOption: optionChrome.canDelete
        };
    }

    getProjectOptionChrome() {
        const projectStateDocument = normalizeProjectStateDocument(this._projectStateDocument);
        const activeOption = getActiveProjectOption(projectStateDocument);
        const canPersist = Boolean(this._projectMetadata.id && this._session);

        return {
            activeOptionId: activeOption?.id ?? '',
            activeLabel: activeOption?.name ?? 'Option 1',
            activeColor: activeOption?.color ?? '#7aae1a',
            items: projectStateDocument.options.map((option) => ({
                id: option.id,
                label: option.name,
                color: option.color,
                isActive: option.id === projectStateDocument.activeOptionId,
                canDelete: projectStateDocument.options.length > 1
            })),
            canCreate: canPersist,
            canManage: canPersist && projectStateDocument.options.length > 0,
            canDelete: canPersist && projectStateDocument.options.length > 1
        };
    }

    getProjectStatus() {
        return { ...this._projectStatus };
    }

    getProjectSaveRequest(projectState = this._projectStateDocument) {
        const fallbackSport = this._getSportName() || this._projectStateDocument.sport;
        const name = typeof this._projectMetadata.name === 'string' && this._projectMetadata.name.trim()
            ? this._projectMetadata.name.trim()
            : deriveProjectNameFromSport(fallbackSport);
        this._projectMetadata.name = name;
        this.refreshProjectChrome();

        return buildProjectSaveRequest({
            name,
            state: cloneProjectStateDocument(projectState)
        });
    }

    setProjectStatus(message, tone = 'default') {
        this._projectStatus = normalizeProjectStatus(message, tone);
        this._emitStatusChanged();
    }

    _emitProjectChromeChanged() {
        this._onProjectChromeChanged?.(this.getProjectChrome());
    }

    _emitProjectOptionChromeChanged() {
        this._onProjectOptionChromeChanged?.(this.getProjectOptionChrome());
    }

    _emitStatusChanged() {
        this._onStatusChanged?.(this.getProjectStatus());
    }
}
