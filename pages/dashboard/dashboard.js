import { buildDefaultProjectCreateRequest } from '../../state/project.js';
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

        this.dashboard = new ProjectDashboard({
            root,
            onSignIn: (credentials) => this._handleSignIn(credentials),
            onSignOut: () => this._handleSignOut(),
            onRefresh: () => this.refresh(),
            onCreateProject: (project) => this._handleCreateProject(project),
            onOpenProject: (projectId) => this._handleOpenProject(projectId)
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
            runtimeConfig: this.runtimeConfig
        });
    }

    async _handleSignIn(credentials) {
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
        this.loading = true;
        this.busyAction = 'create';
        this.error = '';
        this._render();

        try {
            const createdProject = await this.projectsService.createProject(
                buildDefaultProjectCreateRequest(project)
            );

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
        this.onOpenProject?.(projectId);
    }
}
