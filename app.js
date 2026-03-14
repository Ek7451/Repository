import { DashboardPage } from './pages/dashboard-page.js';
import { createAuthService } from './services/auth-service.js';
import { createProjectsService } from './services/projects-service.js';
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

function cloneProjectMetadata(project = null) {
    return {
        id: typeof project?.id === 'string' ? project.id : null,
        name: typeof project?.name === 'string' ? project.name : '',
        createdAt: typeof project?.createdAt === 'string' ? project.createdAt : '',
        updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : ''
    };
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

function buildDashboardUrl() {
    const url = new URL(window.location.href);
    url.search = '';
    return `${url.pathname}${url.search}${url.hash}`;
}

function buildEditorUrl(projectId) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('project', projectId);
    return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

function setShellMode(mode) {
    const dashboardShell = document.getElementById('dashboardShell');
    const editorShell = document.getElementById('editorShell');
    const showDashboard = mode === 'dashboard';

    if (dashboardShell) dashboardShell.hidden = !showDashboard;
    if (editorShell) editorShell.hidden = showDashboard;
    document.body.classList.toggle('dashboard-mode', showDashboard);
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

function wireProjectShellControls(app, authService, projectsService, shellState) {
    const backBtn = getButtonElement('backToDashboardBtn');
    const saveBtn = getButtonElement('saveProjectBtn');
    const signOutBtn = getButtonElement('editorSignOutBtn');
    const projectNameInput = getInputElement('projectNameInput');
    const syncChrome = () => renderProjectChrome(shellState.chrome, shellState);

    backBtn?.addEventListener('click', () => {
        app.destroy?.();
        window.location.assign(buildDashboardUrl());
    });

    signOutBtn?.addEventListener('click', async () => {
        try {
            await authService.signOut();
        } catch (error) {
            console.error('Sign-out failed:', error);
        } finally {
            app.destroy?.();
            window.location.assign(buildDashboardUrl());
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
            const savedProject = await projectsService.updateProject(
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

async function bootAppShell() {
    const authService = createAuthService();
    const projectsService = createProjectsService();
    const dashboardPage = new DashboardPage({
        root: document.getElementById('dashboardPageRoot'),
        authService,
        projectsService,
        onOpenProject: (projectId) => {
            window.location.assign(buildEditorUrl(projectId));
        }
    });
    const projectId = new URLSearchParams(window.location.search).get('project');

    if (!projectId) {
        setShellMode('dashboard');
        await dashboardPage.show();
        return;
    }

    const session = await authService.getSession();
    if (!session) {
        window.location.assign(buildDashboardUrl());
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

    setShellMode('editor');
    shellState.chrome = app.getProjectChrome();
    renderProjectChrome(shellState.chrome, shellState);
    renderProjectStatus(app.getProjectStatus());
    wireProjectShellControls(app, authService, projectsService, shellState);
    app.setSession(session);
    await app.init();
    app.setProjectStatus('Loading project...', 'pending');

    try {
        const project = await projectsService.getProject(projectId);
        app.loadProject(project);
    } catch (error) {
        console.error('Project load failed:', error);
        app.setProjectStatus(
            error instanceof Error ? error.message : 'Project load failed.',
            'error'
        );
        window.setTimeout(() => {
            app.destroy?.();
            window.location.assign(buildDashboardUrl());
        }, 900);
    }
}

bootAppShell().catch((err) => console.error('App init failed:', err));
