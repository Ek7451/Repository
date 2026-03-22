import { createAuthService } from './services/auth-service.js';
import { createProjectsService } from './services/project-api.js';
import {
    buildDuplicateProjectName,
    buildUntitledProjectCreateRequest,
    createProjectOption,
    deleteProjectOption,
    deriveProjectNameFromSport,
    duplicateProjectOption,
    getActiveProjectOption,
    getActiveProjectStateSnapshot,
    normalizeProjectName,
    renameProjectOption,
    resolveStartupProjectSelection,
    selectProjectOption,
    stageActiveProjectOptionState
} from './state/project.js';
import { SeatingBowlApp } from './ui/app.js';

const AUTOSAVE_DELAY_MS = 400;

function isLocalDevelopmentHost(location = window.location) {
    const url = new URL(location.href);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'file:'
        || hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '::1'
        || hostname === '[::1]';
}

function normalizeDevBackend(value, location = window.location) {
    return value === 'local' && isLocalDevelopmentHost(location)
        ? 'local'
        : null;
}

export function resolveRuntimeConfig(location = window.location) {
    const url = new URL(location.href);

    return {
        devBackend: normalizeDevBackend(url.searchParams.get('devBackend'), location)
    };
}

function applyRuntimeQueryParams(url, runtimeConfig = {}) {
    if (runtimeConfig.devBackend === 'local') {
        url.searchParams.set('devBackend', 'local');
        return;
    }

    url.searchParams.delete('devBackend');
}

function buildRouteUrl(relativePath, runtimeConfig, configure = null) {
    const url = new URL(relativePath, import.meta.url);
    url.search = '';
    applyRuntimeQueryParams(url, runtimeConfig);
    if (typeof configure === 'function') {
        configure(url);
    }
    return url.toString();
}

export function buildConfiguratorUrl(projectId, runtimeConfig) {
    return buildRouteUrl('./pages/configurator/index.html', runtimeConfig, (url) => {
        if (projectId) {
            url.searchParams.set('project', projectId);
        }
    });
}

export function getCurrentPage(doc = document) {
    const page = doc.body?.dataset?.page;
    return page === 'configurator' ? page : null;
}

function getProjectActionErrorMessage(actionLabel, error) {
    const suffix = error instanceof Error && error.message
        ? error.message
        : `${actionLabel} failed.`;
    return suffix;
}

function replaceProjectRoute(projectId, runtimeConfig, location, history) {
    const nextUrl = buildConfiguratorUrl(projectId, runtimeConfig);

    if (typeof history?.replaceState === 'function') {
        history.replaceState(null, '', nextUrl);
        return;
    }

    if (typeof location?.replace === 'function') {
        location.replace(nextUrl);
        return;
    }

    location?.assign?.(nextUrl);
}

function getRequestedProjectId(location) {
    const requestedProjectId = new URLSearchParams(location?.search ?? '').get('project');
    return typeof requestedProjectId === 'string' ? requestedProjectId.trim() : '';
}

async function setLastActiveProjectId(projectApi, projectId) {
    if (typeof projectApi?.setLastActiveProjectId !== 'function') {
        return;
    }

    try {
        await projectApi.setLastActiveProjectId(projectId);
    } catch (error) {
        console.warn('Failed to persist the last active project id:', error);
    }
}

async function clearLastActiveProjectId(projectApi, projectId = '') {
    if (typeof projectApi?.clearLastActiveProjectId !== 'function') {
        return;
    }

    try {
        await projectApi.clearLastActiveProjectId(projectId);
    } catch (error) {
        console.warn('Failed to clear the last active project id:', error);
    }
}

async function getLastActiveProjectId(projectApi) {
    if (typeof projectApi?.getLastActiveProjectId !== 'function') {
        return '';
    }

    try {
        return await projectApi.getLastActiveProjectId() ?? '';
    } catch (error) {
        console.warn('Failed to read the last active project id:', error);
        return '';
    }
}

async function listStartupProjects(projectApi) {
    if (typeof projectApi?.listProjects !== 'function') {
        return [];
    }

    try {
        return await projectApi.listProjects();
    } catch (error) {
        console.warn('Failed to list startup projects:', error);
        return [];
    }
}

async function loadProjectIntoApp({
    app,
    projectApi,
    projectId,
    runtimeConfig,
    location,
    history,
    pendingMessage = 'Loading project...'
}) {
    app.setProjectStatus(pendingMessage, 'pending');
    const project = await projectApi.getProject(projectId);
    app.loadProject(project);
    replaceProjectRoute(project.id, runtimeConfig, location, history);
    await setLastActiveProjectId(projectApi, project.id);
    return project;
}

function stageCurrentProjectStateDocument(app) {
    return stageActiveProjectOptionState(
        app.getProjectStateDocument(),
        app.captureStateSnapshot()
    );
}

function applySavedProject(app, savedProject, { reloadActiveOption = false } = {}) {
    app.setProjectMetadata(savedProject);
    app.setProjectStateDocument(savedProject.state);

    if (reloadActiveOption) {
        app.replaceLiveState(
            getActiveProjectStateSnapshot(savedProject.state, app.captureStateSnapshot())
        );
    }
}

async function persistProjectStateDocument({
    app,
    projectApi,
    projectStateDocument,
    pendingMessage,
    successMessage,
    failureLabel,
    reloadActiveOption = false,
    setBusy = true
}) {
    const metadata = app.getProjectMetadata();
    if (!metadata.id) {
        return null;
    }

    if (setBusy) {
        app.setProjectSaveBusy(true);
    }
    app.setProjectStatus(pendingMessage, 'pending');

    try {
        const savedProject = await projectApi.updateProject(
            metadata.id,
            app.getProjectSaveRequest(projectStateDocument)
        );
        applySavedProject(app, savedProject, { reloadActiveOption });
        await setLastActiveProjectId(projectApi, savedProject.id);
        app.setProjectStatus(
            typeof successMessage === 'function'
                ? successMessage(savedProject)
                : successMessage,
            'success'
        );
        return savedProject;
    } catch (error) {
        console.error(`${failureLabel} failed:`, error);
        app.setProjectStatus(
            getProjectActionErrorMessage(failureLabel, error),
            'error'
        );
        throw error;
    } finally {
        if (setBusy) {
            app.setProjectSaveBusy(false);
        }
    }
}

function createProjectActionPort({
    getApp,
    authService,
    projectApi,
    runtimeConfig,
    location,
    history
}) {
    let autosaveTimer = null;
    let projectOperationChain = Promise.resolve();

    function cancelPendingAutosave() {
        if (!autosaveTimer) {
            return;
        }

        clearTimeout(autosaveTimer);
        autosaveTimer = null;
    }

    function canPersistCurrentProject(app) {
        if (!app || typeof app.getProjectMetadata !== 'function' || !app.getProjectMetadata()?.id) {
            return false;
        }

        if (typeof app.getProjectChrome !== 'function') {
            return true;
        }

        return app.getProjectChrome()?.canSave !== false;
    }

    function enqueueProjectOperation(operation) {
        const nextOperation = projectOperationChain.then(operation, operation);
        projectOperationChain = nextOperation.then(
            () => undefined,
            () => undefined
        );
        return nextOperation;
    }

    async function persistCurrentProject({
        pendingMessage,
        successMessage,
        failureLabel,
        setBusy = true,
        reloadActiveOption = false,
        buildProjectStateDocument = null
    }) {
        return enqueueProjectOperation(async () => {
            const app = getApp();
            if (!canPersistCurrentProject(app)) {
                return null;
            }

            const saveContext = typeof buildProjectStateDocument === 'function'
                ? buildProjectStateDocument(app)
                : null;
            const projectStateDocument = saveContext
                && typeof saveContext === 'object'
                && Object.prototype.hasOwnProperty.call(saveContext, 'projectStateDocument')
                ? saveContext.projectStateDocument
                : (saveContext ?? stageCurrentProjectStateDocument(app));
            const nextReloadActiveOption = saveContext
                && typeof saveContext === 'object'
                && Object.prototype.hasOwnProperty.call(saveContext, 'reloadActiveOption')
                ? saveContext.reloadActiveOption
                : reloadActiveOption;

            return persistProjectStateDocument({
                app,
                projectApi,
                projectStateDocument,
                pendingMessage,
                successMessage,
                failureLabel,
                reloadActiveOption: nextReloadActiveOption,
                setBusy
            });
        });
    }

    function scheduleAutosave() {
        const app = getApp();
        if (!canPersistCurrentProject(app)) {
            return;
        }

        cancelPendingAutosave();
        autosaveTimer = setTimeout(() => {
            autosaveTimer = null;
            void persistCurrentProject({
                pendingMessage: 'Saving changes...',
                successMessage: 'All changes saved',
                failureLabel: 'Autosave',
                setBusy: false
            });
        }, AUTOSAVE_DELAY_MS);
    }

    async function createProject() {
        cancelPendingAutosave();
        await enqueueProjectOperation(async () => {
            const app = getApp();
            app.setProjectStatus('Creating project...', 'pending');

            try {
                const createdProject = await projectApi.createProject(buildUntitledProjectCreateRequest());
                app.loadProject(createdProject);
                replaceProjectRoute(createdProject.id, runtimeConfig, location, history);
                await setLastActiveProjectId(projectApi, createdProject.id);
            } catch (error) {
                console.error('Project creation failed:', error);
                app.setProjectStatus(
                    getProjectActionErrorMessage('Project creation', error),
                    'error'
                );
                throw error;
            }
        });
    }

    /**
     * @param {{
     *   pendingMessage: string,
     *   failureLabel: string,
     *   reloadActiveOption?: boolean | ((previousProjectState: object, nextProjectState: object) => boolean),
     *   successMessage: string | ((savedProject: object) => string),
     *   mutate: (projectStateDocument: object) => object
     * }} options
     */
    async function mutateProjectOptions({
        pendingMessage,
        failureLabel,
        reloadActiveOption = false,
        successMessage,
        mutate
    }) {
        cancelPendingAutosave();
        return persistCurrentProject({
            pendingMessage,
            successMessage,
            failureLabel,
            buildProjectStateDocument: (app) => {
                const stagedProjectState = stageCurrentProjectStateDocument(app);
                const nextProjectState = mutate(stagedProjectState);
                return {
                    projectStateDocument: nextProjectState,
                    reloadActiveOption: typeof reloadActiveOption === 'function'
                        ? reloadActiveOption(stagedProjectState, nextProjectState)
                        : Boolean(reloadActiveOption)
                };
            }
        });
    }

    return {
        handleProjectStateDirty(_change) {
            scheduleAutosave();
        },

        async renameCurrentProject(name) {
            cancelPendingAutosave();
            const app = getApp();
            const previousMetadata = app.getProjectMetadata();
            app.setProjectName(name);

            try {
                await persistCurrentProject({
                    pendingMessage: 'Saving project...',
                    successMessage: (savedProject) => `Saved ${savedProject.name}`,
                    failureLabel: 'Project save'
                });
            } catch (error) {
                app.setProjectMetadata(previousMetadata);
                throw error;
            }
        },

        async renameProject(projectId, name) {
            cancelPendingAutosave();
            const app = getApp();
            const nextProjectId = typeof projectId === 'string' ? projectId : '';
            if (!nextProjectId) {
                throw new Error('Project id is required.');
            }

            const currentProjectId = app.getProjectMetadata().id;
            if (currentProjectId && currentProjectId === nextProjectId) {
                await this.renameCurrentProject(name);
                return;
            }

            await enqueueProjectOperation(async () => {
                const savedProject = await projectApi.getProject(nextProjectId);
                const nextName = normalizeProjectName(
                    name,
                    deriveProjectNameFromSport(savedProject?.state?.sport)
                );

                app.setProjectStatus('Renaming project...', 'pending');

                try {
                    await projectApi.updateProject(nextProjectId, {
                        name: nextName,
                        state: savedProject.state
                    });
                    app.setProjectStatus(`Renamed ${nextName}`, 'success');
                } catch (error) {
                    console.error('Project rename failed:', error);
                    app.setProjectStatus(
                        getProjectActionErrorMessage('Project rename', error),
                        'error'
                    );
                    throw error;
                }
            });
        },

        async createOption() {
            await mutateProjectOptions({
                pendingMessage: 'Creating option...',
                failureLabel: 'Option create',
                reloadActiveOption: true,
                successMessage: (savedProject) => {
                    const activeOption = getActiveProjectOption(savedProject.state);
                    return `Created ${activeOption?.name ?? 'option'}`;
                },
                mutate: (projectStateDocument) => createProjectOption(projectStateDocument)
            });
        },

        async renameOption(optionId, name) {
            await mutateProjectOptions({
                pendingMessage: 'Renaming option...',
                failureLabel: 'Option rename',
                successMessage: (savedProject) => {
                    const renamedOption = getActiveProjectOption(
                        selectProjectOption(savedProject.state, optionId)
                    );
                    return `Renamed ${renamedOption?.name ?? 'option'}`;
                },
                mutate: (projectStateDocument) => renameProjectOption(projectStateDocument, optionId, name)
            });
        },

        async duplicateOption(optionId) {
            await mutateProjectOptions({
                pendingMessage: 'Duplicating option...',
                failureLabel: 'Option duplicate',
                reloadActiveOption: true,
                successMessage: (savedProject) => {
                    const activeOption = getActiveProjectOption(savedProject.state);
                    return `Duplicated ${activeOption?.name ?? 'option'}`;
                },
                mutate: (projectStateDocument) => duplicateProjectOption(projectStateDocument, optionId)
            });
        },

        async deleteOption(optionId) {
            await mutateProjectOptions({
                pendingMessage: 'Deleting option...',
                failureLabel: 'Option delete',
                reloadActiveOption: (previousProjectState, nextProjectState) => (
                    previousProjectState.activeOptionId !== nextProjectState.activeOptionId
                ),
                successMessage: (savedProject) => {
                    const activeOption = getActiveProjectOption(savedProject.state);
                    return `Deleted option. Active option is ${activeOption?.name ?? 'Option 1'}`;
                },
                mutate: (projectStateDocument) => deleteProjectOption(projectStateDocument, optionId)
            });
        },

        async selectOption(optionId) {
            await mutateProjectOptions({
                pendingMessage: 'Switching option...',
                failureLabel: 'Option select',
                reloadActiveOption: (previousProjectState, nextProjectState) => (
                    previousProjectState.activeOptionId !== nextProjectState.activeOptionId
                ),
                successMessage: (savedProject) => {
                    const activeOption = getActiveProjectOption(savedProject.state);
                    return `Switched to ${activeOption?.name ?? 'option'}`;
                },
                mutate: (projectStateDocument) => selectProjectOption(projectStateDocument, optionId)
            });
        },

        async createProject() {
            await createProject();
        },

        async listProjects() {
            try {
                return await projectApi.listProjects();
            } catch (error) {
                const app = getApp();
                console.error('Project list failed:', error);
                app.setProjectStatus(
                    getProjectActionErrorMessage('Project list', error),
                    'error'
                );
                throw error;
            }
        },

        async openProject(projectId) {
            const app = getApp();
            cancelPendingAutosave();

            try {
                await enqueueProjectOperation(() => loadProjectIntoApp({
                    app,
                    projectApi,
                    projectId,
                    runtimeConfig,
                    location,
                    history
                }));
            } catch (error) {
                console.error('Project open failed:', error);
                app.setProjectStatus(
                    getProjectActionErrorMessage('Project open', error),
                    'error'
                );
                throw error;
            }
        },

        async duplicateProject(projectId) {
            const app = getApp();
            cancelPendingAutosave();
            await enqueueProjectOperation(async () => {
                app.setProjectStatus('Duplicating project...', 'pending');

                try {
                    const sourceProject = await projectApi.getProject(projectId);
                    const duplicatedProject = await projectApi.createProject({
                        name: buildDuplicateProjectName(sourceProject.name),
                        state: sourceProject.state
                    });
                    app.setProjectStatus(`Duplicated ${duplicatedProject.name}`, 'success');
                } catch (error) {
                    console.error('Project duplicate failed:', error);
                    app.setProjectStatus(
                        getProjectActionErrorMessage('Project duplicate', error),
                        'error'
                    );
                    throw error;
                }
            });
        },

        async deleteProject(projectId) {
            cancelPendingAutosave();
            const app = getApp();
            const currentProjectId = app.getProjectMetadata().id;
            await enqueueProjectOperation(async () => {
                app.setProjectStatus('Deleting project...', 'pending');

                try {
                    await projectApi.deleteProject(projectId);
                    await clearLastActiveProjectId(projectApi, projectId);
                    if (projectId && currentProjectId === projectId) {
                        const replacementProject = await projectApi.createProject(buildUntitledProjectCreateRequest());
                        app.loadProject(replacementProject);
                        replaceProjectRoute(replacementProject.id, runtimeConfig, location, history);
                        await setLastActiveProjectId(projectApi, replacementProject.id);
                        return;
                    }

                    app.setProjectStatus('Deleted project', 'success');
                } catch (error) {
                    console.error('Project delete failed:', error);
                    app.setProjectStatus(
                        getProjectActionErrorMessage('Project delete', error),
                        'error'
                    );
                    throw error;
                }
            });
        },

        async deleteProjects(projectIds) {
            cancelPendingAutosave();
            const app = getApp();
            const currentProjectId = app.getProjectMetadata().id;
            const uniqueProjectIds = Array.isArray(projectIds)
                ? [...new Set(projectIds.filter((projectId) => typeof projectId === 'string' && projectId))]
                : [];

            if (!uniqueProjectIds.length) {
                return;
            }

            if (currentProjectId && uniqueProjectIds.includes(currentProjectId)) {
                const error = new Error('Current project cannot be deleted from bulk actions.');
                app.setProjectStatus(error.message, 'error');
                throw error;
            }

            const count = uniqueProjectIds.length;
            await enqueueProjectOperation(async () => {
                app.setProjectStatus(
                    count === 1 ? 'Deleting 1 project...' : `Deleting ${count} projects...`,
                    'pending'
                );

                try {
                    for (const projectId of uniqueProjectIds) {
                        await projectApi.deleteProject(projectId);
                        await clearLastActiveProjectId(projectApi, projectId);
                    }
                    app.setProjectStatus(
                        count === 1 ? 'Deleted 1 project' : `Deleted ${count} projects`,
                        'success'
                    );
                } catch (error) {
                    console.error('Project bulk delete failed:', error);
                    app.setProjectStatus(
                        getProjectActionErrorMessage('Project bulk delete', error),
                        'error'
                    );
                    throw error;
                }
            });
        },

        async signOut() {
            cancelPendingAutosave();
            try {
                await authService.signOut();
            } catch (error) {
                console.error('Sign-out failed:', error);
                throw error;
            } finally {
                getApp().destroy?.();
                location?.assign?.(buildConfiguratorUrl(null, runtimeConfig));
            }
        }
    };
}

async function ensureSession(authService) {
    const existingSession = await authService.getSession();
    if (existingSession) {
        return existingSession;
    }

    const session = await authService.signInWithMicrosoft();
    if (!session) {
        throw new Error('Microsoft sign-in did not return a session.');
    }

    return session;
}

async function resolveAuthContext(authService) {
    if (typeof authService?.getAuthState !== 'function') {
        return {
            status: 'authenticated',
            session: await ensureSession(authService)
        };
    }

    const authState = await authService.getAuthState();
    if (authState?.status === 'authenticated' && authState.session) {
        return authState;
    }

    if (authState?.status === 'unauthenticated') {
        const session = await authService.signInWithMicrosoft();
        if (!session) {
            throw new Error('Microsoft sign-in did not return a session.');
        }

        return {
            status: 'authenticated',
            session
        };
    }

    const fallbackMessage = authState?.status === 'forbidden'
        ? 'Access denied.'
        : 'Authentication failed.';
    throw new Error(authState?.reason || fallbackMessage);
}

async function resolveStartupProject({
    projectApi,
    runtimeConfig,
    location,
    history
}) {
    const requestedProjectId = getRequestedProjectId(location);
    if (requestedProjectId) {
        const requestedProject = await projectApi.getProject(requestedProjectId);
        await setLastActiveProjectId(projectApi, requestedProject.id);
        return requestedProject;
    }

    let lastActiveProjectId = await getLastActiveProjectId(projectApi);
    let projectSummaries = await listStartupProjects(projectApi);

    while (true) {
        const selection = resolveStartupProjectSelection({
            lastActiveProjectId,
            projectSummaries
        });
        if (!selection.projectId) {
            break;
        }

        try {
            const startupProject = await projectApi.getProject(selection.projectId);
            replaceProjectRoute(startupProject.id, runtimeConfig, location, history);
            await setLastActiveProjectId(projectApi, startupProject.id);
            return startupProject;
        } catch (error) {
            console.error('Startup project load failed:', error);
            if (selection.source === 'last-active') {
                await clearLastActiveProjectId(projectApi, selection.projectId);
                lastActiveProjectId = '';
            }
            projectSummaries = projectSummaries.filter((project) => project?.id !== selection.projectId);
        }
    }

    const createdProject = await projectApi.createProject(buildUntitledProjectCreateRequest());
    if (!createdProject?.id) {
        throw new Error('Project creation did not return a project id.');
    }

    replaceProjectRoute(createdProject.id, runtimeConfig, location, history);
    await setLastActiveProjectId(projectApi, createdProject.id);
    return createdProject;
}

export async function bootConfiguratorPage(runtimeConfig, authService, projectApi, options = {}) {
    const doc = options.document ?? document;
    const location = options.location ?? window.location;
    const history = options.history
        ?? (typeof window !== 'undefined' ? window.history : null);
    const setTimeoutFn = options.setTimeoutFn
        ?? (typeof window !== 'undefined'
            ? window.setTimeout.bind(window)
            : globalThis.setTimeout.bind(globalThis));
    const appFactory = options.appFactory ?? ((appOptions) => new SeatingBowlApp(appOptions));

    const authContext = await resolveAuthContext(authService);
    let initialProject = null;
    try {
        initialProject = await resolveStartupProject({
            projectApi,
            runtimeConfig,
            location,
            history
        });
    } catch (error) {
        console.error('Project load failed:', error);
        setTimeoutFn(() => {
            location.assign(buildConfiguratorUrl(null, runtimeConfig));
        }, 900);
        return;
    }

    let app = null;
    const projectActions = createProjectActionPort({
        getApp: () => app,
        authService,
        projectApi,
        runtimeConfig,
        location,
        history
    });
    app = appFactory({
        projectActions,
        document: doc,
        initialProject,
        onProjectStateDirty: (change) => projectActions.handleProjectStateDirty(change)
    });
    if (typeof app.setAuthContext === 'function') {
        app.setAuthContext(authContext);
    } else {
        app.setSession(authContext.session);
    }
    await app.init();
}

export async function bootAppShell(options = {}) {
    const doc = options.document ?? document;
    const currentPage = getCurrentPage(doc);
    if (!currentPage) return;

    const location = options.location ?? window.location;
    const runtimeConfig = options.runtimeConfig ?? resolveRuntimeConfig(location);
    const authService = options.authService ?? createAuthService({ devBackend: runtimeConfig.devBackend });
    const projectApi = options.projectApi ?? createProjectsService({ devBackend: runtimeConfig.devBackend });

    await bootConfiguratorPage(runtimeConfig, authService, projectApi, options);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    bootAppShell().catch((error) => console.error('App init failed:', error));
}
