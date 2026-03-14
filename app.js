import { DashboardPage } from './pages/dashboard/dashboard.js';
import { createAuthService } from './services/auth-service.js';
import { createProjectsService } from './services/project-api.js';
import { cloneProjectMetadata } from './state/project.js';
import { SeatingBowlApp } from './ui/app.js';

function getButtonElement(id) {
    return /** @type {HTMLButtonElement | null} */ (document.getElementById(id));
}

function getInputElement(id) {
    return /** @type {HTMLInputElement | null} */ (document.getElementById(id));
}

function getHtmlElement(id) {
    return /** @type {HTMLElement | null} */ (document.getElementById(id));
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

function normalizeProjectStatus(status = {}) {
    const message = typeof status?.message === 'string' && status.message.trim()
        ? status.message.trim()
        : 'Project persistence ready';
    const tone = typeof status?.tone === 'string' && status.tone.trim()
        ? status.tone.trim()
        : 'default';

    return { message, tone };
}

function renderProjectStatus(status = {}) {
    const statusEl = getHtmlElement('projectStatusMessage');
    if (!statusEl) return;

    const nextStatus = normalizeProjectStatus(status);
    statusEl.textContent = nextStatus.message;
    statusEl.dataset.tone = nextStatus.tone;
}

function renderProjectChrome(chrome = {}, shellState = {}) {
    const nextName = typeof chrome?.name === 'string' ? chrome.name.trim() : '';
    const metadata = cloneProjectMetadata(chrome?.metadata);
    const session = chrome?.session && typeof chrome.session === 'object'
        ? { ...chrome.session }
        : null;
    const canSave = Boolean(chrome?.canSave);
    const isSaveBusy = Boolean(shellState?.isSaveBusy);

    const nameInput = getInputElement('projectNameInput');
    if (nameInput && document.activeElement !== nameInput) {
        nameInput.value = nextName;
    }

    const metaEl = getHtmlElement('editorProjectMeta');
    if (metaEl) {
        const updatedAt = metadata.updatedAt
            ? new Date(metadata.updatedAt).toLocaleString()
            : 'Not yet saved';
        metaEl.textContent = metadata.id
            ? `Updated ${updatedAt}`
            : 'Create or open a project from the dashboard';
    }

    const sessionEl = getHtmlElement('editorSessionLabel');
    if (sessionEl) {
        sessionEl.textContent = session?.displayName
            ? `Signed in as ${session.displayName}`
            : 'Signed out';
    }

    const saveBtn = getButtonElement('saveProjectBtn');
    if (!saveBtn) return;

    saveBtn.dataset.busy = isSaveBusy ? 'true' : 'false';
    saveBtn.textContent = isSaveBusy ? 'Saving...' : 'Save Project';
    saveBtn.disabled = isSaveBusy || !canSave;
}

function wireProjectShellControls(app, authService, projectApi, shellState, runtimeConfig) {
    const backBtn = getButtonElement('backToDashboardBtn');
    const saveBtn = getButtonElement('saveProjectBtn');
    const signOutBtn = getButtonElement('editorSignOutBtn');
    const projectNameInput = getInputElement('projectNameInput');
    const syncChrome = () => renderProjectChrome(shellState.chrome, shellState);

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

        shellState.isSaveBusy = true;
        syncChrome();
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
            shellState.isSaveBusy = false;
            syncChrome();
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

    const shellState = {
        chrome: null,
        isSaveBusy: false
    };
    const app = new SeatingBowlApp({
        onProjectChromeChanged: (chrome) => {
            shellState.chrome = {
                ...chrome,
                metadata: cloneProjectMetadata(chrome?.metadata)
            };
            renderProjectChrome(shellState.chrome, shellState);
        },
        onStatusChanged: (status) => {
            renderProjectStatus(status);
        }
    });

    shellState.chrome = app.getProjectChrome();
    renderProjectChrome(shellState.chrome, shellState);
    renderProjectStatus(app.getProjectStatus());
    wireProjectShellControls(app, authService, projectApi, shellState, runtimeConfig);
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
