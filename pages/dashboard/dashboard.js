import {
    buildDefaultProjectCreateRequest,
    buildDuplicateProjectName
} from '../../state/project.js';
import { ProjectDashboard } from '../../ui/project-dashboard.js';

export class DashboardPage {
    constructor({ root, authService, projectsService, runtimeConfig = null, onOpenProject }) {
        this.root = root;
        this.authService = authService;
        this.projectsService = projectsService;
        this.runtimeConfig = runtimeConfig;
        this.onOpenProject = onOpenProject;
        this.session = null;
        this.projects = [];
        this.loading = false;
        this.error = '';
        this.busyAction = '';
        this.openMenuProjectId = '';
        this.pendingDeleteProjectId = '';
        this.busyProjectId = '';

        this.dashboard = new ProjectDashboard({
            root,
            onSignIn: (credentials) => this._handleSignIn(credentials),
            onSignOut: () => this._handleSignOut(),
            onRefresh: () => this.refresh(),
            onCreateProject: (project) => this._handleCreateProject(project),
            onOpenProject: (projectId) => this._handleOpenProject(projectId),
            onToggleProjectMenu: (projectId) => this._handleToggleProjectMenu(projectId),
            onDuplicateProject: (projectId) => this._handleDuplicateProject(projectId),
            onRequestDeleteProject: (projectId) => this._handleRequestDeleteProject(projectId),
            onCancelDeleteProject: () => this._handleCancelDeleteProject(),
            onDeleteProject: (projectId) => this._handleDeleteProject(projectId)
        });
    }

    async show() {
        if (this.root) {
            this.root.hidden = false;
        }
        await this.refresh();
    }

    hide() {
        if (this.root) {
            this.root.hidden = true;
        }
    }

    async refresh() {
        this._resetProjectCardState();
        this.loading = true;
        this.busyAction = 'refresh';
        this.error = '';
        this._render();

        try {
            this.session = await this.authService.getSession();
            this.projects = this.session
                ? await this.projectsService.listProjects()
                : [];
        } catch (error) {
            this.error = error instanceof Error ? error.message : 'Unable to load the dashboard.';
        } finally {
            this.loading = false;
            this.busyAction = '';
            this._render();
        }
    }

    _render() {
        this.dashboard.render({
            session: this.session,
            projects: this.projects,
            loading: this.loading,
            error: this.error,
            busyAction: this.busyAction,
            openMenuProjectId: this.openMenuProjectId,
            pendingDeleteProjectId: this.pendingDeleteProjectId,
            busyProjectId: this.busyProjectId,
            runtimeConfig: this.runtimeConfig
        });
    }

    async _handleSignIn(credentials) {
        this._resetProjectCardState();
        this.loading = true;
        this.busyAction = 'signin';
        this.error = '';
        this._render();

        try {
            this.session = await this.authService.signIn(credentials);
            this.projects = await this.projectsService.listProjects();
        } catch (error) {
            this.error = error instanceof Error ? error.message : 'Unable to sign in.';
        } finally {
            this.loading = false;
            this.busyAction = '';
            this._render();
        }
    }

    async _handleSignOut() {
        this._resetProjectCardState();
        this.loading = true;
        this.busyAction = 'signout';
        this.error = '';
        this._render();

        try {
            await this.authService.signOut();
            this.session = null;
            this.projects = [];
        } catch (error) {
            this.error = error instanceof Error ? error.message : 'Unable to sign out.';
        } finally {
            this.loading = false;
            this.busyAction = '';
            this._render();
        }
    }

    async _handleCreateProject(project) {
        this._resetProjectCardState();
        this.loading = true;
        this.busyAction = 'create';
        this.error = '';
        this._render();

        try {
            const createdProject = await this.projectsService.createProject(
                buildDefaultProjectCreateRequest(project)
            );

            this._resetProjectCardState();
            this.onOpenProject?.(createdProject.id);
        } catch (error) {
            this.loading = false;
            this.busyAction = '';
            this.error = error instanceof Error ? error.message : 'Unable to create the project.';
            this._render();
        }
    }

    _handleOpenProject(projectId) {
        if (!projectId) return;
        this._resetProjectCardState();
        this.onOpenProject?.(projectId);
    }

    _handleToggleProjectMenu(projectId) {
        if (!projectId || this.loading) return;

        this.pendingDeleteProjectId = '';
        this.openMenuProjectId = this.openMenuProjectId === projectId ? '' : projectId;
        this._render();
    }

    async _handleDuplicateProject(projectId) {
        if (!projectId) return;

        this.loading = true;
        this.busyAction = 'duplicate';
        this.busyProjectId = projectId;
        this.error = '';
        this._render();

        try {
            const sourceProject = await this.projectsService.getProject(projectId);
            const duplicatedProject = await this.projectsService.createProject({
                name: buildDuplicateProjectName(sourceProject.name),
                state: sourceProject.state
            });

            this.projects = [duplicatedProject, ...this.projects];
            this._resetProjectCardState();
        } catch (error) {
            this.error = error instanceof Error ? error.message : 'Unable to duplicate the project.';
            this._resetProjectCardState();
        } finally {
            this.loading = false;
            this.busyAction = '';
            this._render();
        }
    }

    _handleRequestDeleteProject(projectId) {
        if (!projectId || this.loading) return;
        this.openMenuProjectId = '';
        this.pendingDeleteProjectId = projectId;
        this._render();
    }

    _handleCancelDeleteProject() {
        if (!this.pendingDeleteProjectId || this.loading) return;
        this._resetDeleteState();
        this._render();
    }

    async _handleDeleteProject(projectId) {
        if (!projectId) return;

        this.loading = true;
        this.busyAction = 'delete';
        this.busyProjectId = projectId;
        this.error = '';
        this._render();

        try {
            await this.projectsService.deleteProject(projectId);
            this.projects = this.projects.filter((project) => project.id !== projectId);
            this._resetProjectCardState();
        } catch (error) {
            this.error = error instanceof Error ? error.message : 'Unable to delete the project.';
            this.busyProjectId = '';
        } finally {
            this.loading = false;
            this.busyAction = '';
            this._render();
        }
    }

    _resetDeleteState() {
        this.pendingDeleteProjectId = '';
        this.busyProjectId = '';
    }

    _resetProjectCardState() {
        this.openMenuProjectId = '';
        this._resetDeleteState();
    }
}
