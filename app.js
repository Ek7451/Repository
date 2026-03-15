import { DashboardPage } from './pages/dashboard/dashboard.js';
import { createAuthService } from './services/auth-service.js';
import { createProjectsService } from './services/project-api.js';
import { SeatingBowlApp } from './ui/app.js';

function getButtonElement(id) {
    return /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
}

function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
}

function normalizeDevBackend(value) {
    return value === 'local' ? 'local' : null;
}

function resolveRuntimeConfig() {
    const url = new URL(window.location.href);

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

function buildDashboardUrl(runtimeConfig) {
    return buildRouteUrl('./pages/dashboard/dashboard.html', runtimeConfig);
}

function buildConfiguratorUrl(projectId, runtimeConfig) {
    return buildRouteUrl('./pages/configurator/index.html', runtimeConfig, (url) => {
        if (projectId) {
            url.searchParams.set('project', projectId);
        }
    });
}

function getCurrentPage() {
    const page = document.body?.dataset?.page;
    return page === 'dashboard' || page === 'configurator' ? page : null;
}

function wireProjectShellControls(app, authService, projectApi, runtimeConfig) {
    const backBtn = getButtonElement('backToDashboardBtn');
    const saveBtn = getButtonElement('saveProjectBtn');
    const signOutBtn = getButtonElement('editorSignOutBtn');
    const projectNameInput = getInputElement('projectNameInput');

    backBtn?.addEventListener('click', () => {
        app.destroy?.();
        window.location.assign(buildDashboardUrl(runtimeConfig));
    });

    signOutBtn?.addEventListener('click', async () => {
        try {
            await authService.signOut();
        } catch (error) {
            console.error('Sign-out failed:', error);
        } finally {
            app.destroy?.();
            window.location.assign(buildDashboardUrl(runtimeConfig));
        }
    });

    projectNameInput?.addEventListener('input', () => {
        app.setProjectName(projectNameInput.value);
    });

    saveBtn?.addEventListener('click', async () => {
        const metadata = app.getProjectMetadata();
        if (!metadata.id) return;

        app.setProjectSaveBusy(true);
        app.setProjectStatus('Saving project...', 'pending');

        try {
            const savedProject = await projectApi.updateProject(
                metadata.id,
                app.getProjectSaveRequest()
            );
            app.setProjectMetadata(savedProject);
            app.setProjectStatus(`Saved ${savedProject.name}`, 'success');
        } catch (error) {
            console.error('Project save failed:', error);
            app.setProjectStatus(
                error instanceof Error ? error.message : 'Project save failed.',
                'error'
            );
        } finally {
            app.setProjectSaveBusy(false);
        }
    });
}

async function bootDashboardPage(runtimeConfig, authService, projectApi) {
    const projectId = new URLSearchParams(window.location.search).get('project');
    if (projectId) {
        window.location.replace(buildConfiguratorUrl(projectId, runtimeConfig));
        return;
    }

    const dashboardPage = new DashboardPage({
        root: document.getElementById('dashboardPageRoot'),
        authService,
        projectsService: projectApi,
        runtimeConfig,
        onOpenProject: (nextProjectId) => {
            window.location.assign(buildConfiguratorUrl(nextProjectId, runtimeConfig));
        }
    });

    await dashboardPage.show();
}

async function bootConfiguratorPage(runtimeConfig, authService, projectApi) {
    const projectId = new URLSearchParams(window.location.search).get('project');
    if (!projectId) {
        window.location.replace(buildDashboardUrl(runtimeConfig));
        return;
    }

    let session = null;

    try {
        session = await authService.getSession();
    } catch (error) {
        console.error('Session bootstrap failed:', error);
        window.location.replace(buildDashboardUrl(runtimeConfig));
        return;
    }

    if (!session) {
        window.location.replace(buildDashboardUrl(runtimeConfig));
        return;
    }

    const app = new SeatingBowlApp();
    wireProjectShellControls(app, authService, projectApi, runtimeConfig);
    app.setSession(session);
    await app.init();
    app.setProjectStatus('Loading project...', 'pending');

    try {
        const project = await projectApi.getProject(projectId);
        app.loadProject(project);
    } catch (error) {
        console.error('Project load failed:', error);
        app.setProjectStatus(
            error instanceof Error ? error.message : 'Project load failed.',
            'error'
        );
        window.setTimeout(() => {
            app.destroy?.();
            window.location.assign(buildDashboardUrl(runtimeConfig));
        }, 900);
    }
}

async function bootAppShell() {
    const currentPage = getCurrentPage();
    if (!currentPage) return;

    const runtimeConfig = resolveRuntimeConfig();
    const authService = createAuthService({ devBackend: runtimeConfig.devBackend });
    const projectApi = createProjectsService({ devBackend: runtimeConfig.devBackend });

    if (currentPage === 'dashboard') {
        await bootDashboardPage(runtimeConfig, authService, projectApi);
        return;
    }

    await bootConfiguratorPage(runtimeConfig, authService, projectApi);
}

bootAppShell().catch((error) => console.error('App init failed:', error));
