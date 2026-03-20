import { createAuthService } from './services/auth-service.js';
import { createProjectsService } from './services/project-api.js';
import {
    buildDuplicateProjectName,
    buildUntitledProjectCreateRequest,
    createProjectOption,
    deleteProjectOption,
    duplicateProjectOption,
    getActiveProjectOption,
    getActiveProjectStateSnapshot,
    renameProjectOption,
    selectProjectOption,
    stageActiveProjectOptionState
} from './state/project.js';
import { SeatingBowlApp } from './ui/app.js';

function normalizeDevBackend(value) {
    return value === 'local' ? 'local' : null;
}

export function resolveRuntimeConfig(location = window.location) {
    const url = new URL(location.href);

    return {
        devBackend: normalizeDevBackend(url.searchParams.get('devBackend'))
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

    location?.assign?.(nextUrl);
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
    reloadActiveOption = false
}) {
    const metadata = app.getProjectMetadata();
    if (!metadata.id) {
        return null;
    }

    app.setProjectSaveBusy(true);
    app.setProjectStatus(pendingMessage, 'pending');

    try {
        const savedProject = await projectApi.updateProject(
            metadata.id,
            app.getProjectSaveRequest(projectStateDocument)
        );
        applySavedProject(app, savedProject, { reloadActiveOption });
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
        app.setProjectSaveBusy(false);
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
    async function saveCurrentProject() {
        const app = getApp();
        const projectStateDocument = stageCurrentProjectStateDocument(app);
        await persistProjectStateDocument({
            app,
            projectApi,
            projectStateDocument,
            pendingMessage: 'Saving project...',
            successMessage: (savedProject) => `Saved ${savedProject.name}`,
            failureLabel: 'Project save'
        });
    }

    async function createProject() {
        const app = getApp();
        app.setProjectStatus('Creating project...', 'pending');

        try {
            const createdProject = await projectApi.createProject(buildUntitledProjectCreateRequest());
            app.loadProject(createdProject);
            replaceProjectRoute(createdProject.id, runtimeConfig, location, history);
        } catch (error) {
            console.error('Project creation failed:', error);
            app.setProjectStatus(
                getProjectActionErrorMessage('Project creation', error),
                'error'
            );
            throw error;
        }
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
        const app = getApp();
        const stagedProjectState = stageCurrentProjectStateDocument(app);
        const nextProjectState = mutate(stagedProjectState);
        const shouldReloadActiveOption = typeof reloadActiveOption === 'function'
            ? reloadActiveOption(stagedProjectState, nextProjectState)
            : Boolean(reloadActiveOption);

        return persistProjectStateDocument({
            app,
            projectApi,
            projectStateDocument: nextProjectState,
            pendingMessage,
            successMessage,
            failureLabel,
            reloadActiveOption: shouldReloadActiveOption
        });
    }

    return {
        async saveCurrentProject() {
            await saveCurrentProject();
        },

        async renameCurrentProject(name) {
            const app = getApp();
            const previousMetadata = app.getProjectMetadata();
            app.setProjectName(name);

            try {
                await saveCurrentProject();
            } catch (error) {
                app.setProjectMetadata(previousMetadata);
                throw error;
            }
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

            try {
                await loadProjectIntoApp({
                    app,
                    projectApi,
                    projectId,
                    runtimeConfig,
                    location,
                    history
                });
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
        },

        async deleteProject(projectId) {
            const app = getApp();
            const currentProjectId = app.getProjectMetadata().id;
            app.setProjectStatus('Deleting project...', 'pending');

            try {
                await projectApi.deleteProject(projectId);
                if (projectId && currentProjectId === projectId) {
                    const replacementProject = await projectApi.createProject(buildUntitledProjectCreateRequest());
                    app.loadProject(replacementProject);
                    replaceProjectRoute(replacementProject.id, runtimeConfig, location, history);
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
        },

        async signOut() {
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

async function ensureProjectId(projectApi, runtimeConfig, location) {
    const projectId = new URLSearchParams(location.search).get('project');
    if (projectId) {
        return projectId;
    }

    const createdProject = await projectApi.createProject(buildUntitledProjectCreateRequest());
    if (!createdProject?.id) {
        throw new Error('Project creation did not return a project id.');
    }

    location.replace(buildConfiguratorUrl(createdProject.id, runtimeConfig));
    return null;
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

    const session = await ensureSession(authService);
    const projectId = await ensureProjectId(projectApi, runtimeConfig, location);
    if (!projectId) {
        return;
    }

    let initialProject = null;
    try {
        initialProject = await projectApi.getProject(projectId);
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
    app = appFactory({ projectActions, document: doc, initialProject });
    app.setSession(session);
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
