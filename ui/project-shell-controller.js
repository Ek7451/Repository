import {
    buildProjectChromeSnapshot,
    buildProjectSaveRequest,
    cloneProjectMetadata,
    cloneSessionDto,
    deriveProjectNameFromSport,
    normalizeProjectStatus
} from '../state/project.js';

export class ProjectShellController {
    constructor(options = {}) {
        const config = /** @type {{
            getSportName?: (() => string),
            onProjectChromeChanged?: ((chrome: object) => void),
            onStatusChanged?: ((status: object) => void)
        }} */ (options && typeof options === 'object' ? options : {});

        this._getSportName = typeof config.getSportName === 'function'
            ? config.getSportName
            : () => '';
        this._onProjectChromeChanged = typeof config.onProjectChromeChanged === 'function'
            ? config.onProjectChromeChanged
            : null;
        this._onStatusChanged = typeof config.onStatusChanged === 'function'
            ? config.onStatusChanged
            : null;
        this._session = null;
        this._projectMetadata = cloneProjectMetadata();
        this._projectStatus = normalizeProjectStatus();
    }

    destroy() {
        this._onProjectChromeChanged = null;
        this._onStatusChanged = null;
    }

    refreshProjectChrome() {
        this._emitProjectChromeChanged();
    }

    setSession(session) {
        this._session = cloneSessionDto(session);
        this._emitProjectChromeChanged();
    }

    setProjectMetadata(project = null) {
        this._projectMetadata = cloneProjectMetadata(project);
        this._emitProjectChromeChanged();
    }

    setProjectName(name = '') {
        this._projectMetadata.name = typeof name === 'string' ? name : '';
        this._emitProjectChromeChanged();
    }

    getProjectMetadata() {
        return cloneProjectMetadata(this._projectMetadata);
    }

    getProjectChrome() {
        return buildProjectChromeSnapshot({
            name: this._projectMetadata.name || deriveProjectNameFromSport(this._getSportName()),
            projectMetadata: this._projectMetadata,
            session: this._session
        });
    }

    getProjectStatus() {
        return { ...this._projectStatus };
    }

    getProjectSaveRequest(stateJson) {
        const name = typeof this._projectMetadata.name === 'string' && this._projectMetadata.name.trim()
            ? this._projectMetadata.name.trim()
            : deriveProjectNameFromSport(this._getSportName());
        this._projectMetadata.name = name;
        this._emitProjectChromeChanged();

        return buildProjectSaveRequest({
            name,
            state: stateJson
        });
    }

    setProjectStatus(message, tone = 'default') {
        this._projectStatus = normalizeProjectStatus(message, tone);
        this._emitStatusChanged();
    }

    _emitProjectChromeChanged() {
        this._onProjectChromeChanged?.(this.getProjectChrome());
    }

    _emitStatusChanged() {
        this._onStatusChanged?.(this.getProjectStatus());
    }
}
