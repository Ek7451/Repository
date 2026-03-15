function formatDateLabel(value) {
    if (typeof value !== 'string' || !value) return 'Unknown';

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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class ProjectDashboard {
    constructor(options = {}) {
        const {
            root,
            onSignIn,
            onSignOut,
            onRefresh,
            onCreateProject,
            onOpenProject,
            onToggleProjectMenu,
            onDuplicateProject,
            onRequestDeleteProject,
            onCancelDeleteProject,
            onDeleteProject
        } = options;

        this.root = root;
        this.onSignIn = onSignIn;
        this.onSignOut = onSignOut;
        this.onRefresh = onRefresh;
        this.onCreateProject = onCreateProject;
        this.onOpenProject = onOpenProject;
        this.onToggleProjectMenu = onToggleProjectMenu;
        this.onDuplicateProject = onDuplicateProject;
        this.onRequestDeleteProject = onRequestDeleteProject;
        this.onCancelDeleteProject = onCancelDeleteProject;
        this.onDeleteProject = onDeleteProject;
    }

    render(model = {}) {
        if (!this.root) return;

        const session = model.session ?? null;
        const projects = Array.isArray(model.projects) ? model.projects : [];
        const loading = !!model.loading;
        const busyAction = model.busyAction ?? '';
        const openMenuProjectId = typeof model.openMenuProjectId === 'string'
            ? model.openMenuProjectId
            : '';
        const pendingDeleteProjectId = typeof model.pendingDeleteProjectId === 'string'
            ? model.pendingDeleteProjectId
            : '';
        const busyProjectId = typeof model.busyProjectId === 'string'
            ? model.busyProjectId
            : '';
        const error = typeof model.error === 'string' ? model.error.trim() : '';
        const isLocalDevMode = model.runtimeConfig?.devBackend === 'local';
        const localDevNotice = isLocalDevMode
            ? `
                <p class="dashboard-copy">
                    Local browser-storage mode is active via <code>devBackend=local</code>. Auth and projects stay on this machine until an API backend is configured.
                </p>
            `
            : '';

        if (!session) {
            this.root.innerHTML = `
                <section class="dashboard-card dashboard-auth-card">
                    <h2>Project dashboard</h2>
                    <p class="dashboard-copy">
                        Sign in to create, reopen, and update saved seating bowl studies without moving study state out of AppState.
                    </p>
                    ${localDevNotice}
                    ${error ? `<p class="dashboard-error" role="alert">${escapeHtml(error)}</p>` : ''}
                    <form id="dashboardSignInForm" class="dashboard-form">
                        <label>
                            <span>Display name</span>
                            <input id="dashboardDisplayNameInput" name="displayName" type="text" maxlength="80" placeholder="Elliott Example" required>
                        </label>
                        <label>
                            <span>Email</span>
                            <input id="dashboardEmailInput" name="email" type="email" maxlength="120" placeholder="elliott@example.com" required>
                        </label>
                        <button class="dashboard-primary-btn" type="submit" ${loading ? 'disabled' : ''}>
                            ${loading && busyAction === 'signin' ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>
                </section>
            `;

            const signInForm = this.root.querySelector('#dashboardSignInForm');
            signInForm?.addEventListener('submit', (event) => {
                event.preventDefault();
                const form = new FormData(signInForm);
                this.onSignIn?.({
                    displayName: String(form.get('displayName') ?? ''),
                    email: String(form.get('email') ?? '')
                });
            });
            return;
        }

        const projectCards = projects.length
            ? projects.map((project) => {
                const isMenuOpen = openMenuProjectId === project.id;
                const isPendingDelete = pendingDeleteProjectId === project.id;
                const isDeleting = busyAction === 'delete' && busyProjectId === project.id;
                const isDuplicating = busyAction === 'duplicate' && busyProjectId === project.id;

                return `
                <article
                    class="project-card ${loading ? 'project-card-busy' : 'project-card-interactive'}"
                    role="button"
                    tabindex="${loading ? '-1' : '0'}"
                    data-open-project="${escapeHtml(project.id)}"
                    aria-label="Open ${escapeHtml(project.name)}"
                    ${loading ? 'aria-disabled="true"' : ''}
                >
                    <div class="project-card-header">
                        <div>
                            <h3>${escapeHtml(project.name)}</h3>
                            <p>${escapeHtml(project.sport || 'Football')}</p>
                        </div>
                        <div class="project-card-menu-anchor">
                            <button
                                class="project-card-menu-btn"
                                type="button"
                                aria-label="Project actions for ${escapeHtml(project.name)}"
                                aria-expanded="${isMenuOpen ? 'true' : 'false'}"
                                data-toggle-project-menu="${escapeHtml(project.id)}"
                                ${loading ? 'disabled' : ''}
                            >
                                <span></span>
                                <span></span>
                                <span></span>
                            </button>
                            ${isMenuOpen
                                ? `
                                    <div class="project-card-menu" data-project-menu="${escapeHtml(project.id)}">
                                        <button
                                            class="project-card-menu-item"
                                            type="button"
                                            data-duplicate-project="${escapeHtml(project.id)}"
                                            ${loading ? 'disabled' : ''}
                                        >
                                            ${isDuplicating ? 'Duplicating...' : 'Duplicate'}
                                        </button>
                                        <button
                                            class="project-card-menu-item project-card-menu-item-danger"
                                            type="button"
                                            data-request-delete-project="${escapeHtml(project.id)}"
                                            ${loading ? 'disabled' : ''}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                `
                                : ''}
                        </div>
                    </div>
                    <dl class="project-card-meta">
                        <div>
                            <dt>Updated</dt>
                            <dd>${escapeHtml(formatDateLabel(project.updatedAt))}</dd>
                        </div>
                        <div>
                            <dt>Created</dt>
                            <dd>${escapeHtml(formatDateLabel(project.createdAt))}</dd>
                        </div>
                    </dl>
                    ${isPendingDelete
                        ? `
                            <div class="project-card-inline-actions">
                                <button
                                    class="dashboard-primary-btn"
                                    type="button"
                                    data-confirm-delete-project="${escapeHtml(project.id)}"
                                    ${loading ? 'disabled' : ''}
                                >
                                    ${isDeleting ? 'Deleting...' : 'Delete'}
                                </button>
                                <button
                                    class="dashboard-secondary-btn"
                                    type="button"
                                    data-cancel-delete-project="${escapeHtml(project.id)}"
                                    ${loading ? 'disabled' : ''}
                                >
                                    Cancel
                                </button>
                            </div>
                        `
                        : ''}
                </article>
            `;
            }).join('')
            : `
                <div class="dashboard-empty-state">
                    <h3>No projects yet</h3>
                    <p>Create a project to save the default study and open it in the editor.</p>
                </div>
            `;

        this.root.innerHTML = `
            <section class="dashboard-card dashboard-overview-card">
                <div class="dashboard-overview-header">
                    <div>
                        <h2>${escapeHtml(session.displayName)}</h2>
                        <p class="dashboard-copy">${escapeHtml(session.email)}</p>
                        ${localDevNotice}
                    </div>
                    <div class="dashboard-actions">
                        <button id="dashboardRefreshBtn" class="dashboard-secondary-btn" type="button" ${loading ? 'disabled' : ''}>
                            ${loading && busyAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button id="dashboardSignOutBtn" class="dashboard-secondary-btn" type="button" ${loading ? 'disabled' : ''}>
                            ${loading && busyAction === 'signout' ? 'Signing out...' : 'Sign Out'}
                        </button>
                    </div>
                </div>
                ${error ? `<p class="dashboard-error" role="alert">${escapeHtml(error)}</p>` : ''}
                <form id="dashboardCreateProjectForm" class="dashboard-form dashboard-inline-form">
                    <label>
                        <span>Project name</span>
                        <input id="dashboardProjectNameInput" name="projectName" type="text" maxlength="120" placeholder="Lower Bowl Study" required>
                    </label>
                    <button class="dashboard-primary-btn" type="submit" ${loading ? 'disabled' : ''}>
                        ${loading && busyAction === 'create' ? 'Creating...' : 'Create Project'}
                    </button>
                </form>
            </section>
            <section class="dashboard-project-grid">
                ${projectCards}
            </section>
        `;

        this.root.querySelector('#dashboardRefreshBtn')?.addEventListener('click', () => {
            this.onRefresh?.();
        });

        this.root.querySelector('#dashboardSignOutBtn')?.addEventListener('click', () => {
            this.onSignOut?.();
        });

        const createProjectForm = this.root.querySelector('#dashboardCreateProjectForm');
        createProjectForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            const form = new FormData(createProjectForm);
            this.onCreateProject?.({
                name: String(form.get('projectName') ?? '')
            });
        });

        this.root.querySelectorAll('[data-open-project]').forEach((card) => {
            card.addEventListener('click', () => {
                if (loading) return;
                this.onOpenProject?.(card.getAttribute('data-open-project'));
            });
            card.addEventListener('keydown', (event) => {
                if (loading) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                this.onOpenProject?.(card.getAttribute('data-open-project'));
            });
        });

        this.root.querySelectorAll('[data-toggle-project-menu]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.onToggleProjectMenu?.(button.getAttribute('data-toggle-project-menu'));
            });
        });

        this.root.querySelectorAll('[data-project-menu]').forEach((menu) => {
            menu.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        });

        this.root.querySelectorAll('[data-duplicate-project]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.onDuplicateProject?.(button.getAttribute('data-duplicate-project'));
            });
        });

        this.root.querySelectorAll('[data-request-delete-project]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.onRequestDeleteProject?.(button.getAttribute('data-request-delete-project'));
            });
        });

        this.root.querySelectorAll('[data-cancel-delete-project]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.onCancelDeleteProject?.();
            });
        });

        this.root.querySelectorAll('[data-confirm-delete-project]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.onDeleteProject?.(button.getAttribute('data-confirm-delete-project'));
            });
        });
    }
}
