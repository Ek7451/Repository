const DEV_LOCAL_SESSION_KEY = 'sbg-dev-auth-session';
const DEV_LOCAL_PROJECTS_KEY = 'sbg-dev-projects';
const DEV_LOCAL_LAST_ACTIVE_PROJECTS_KEY = 'sbg-dev-last-active-projects';

function getBrowserStorage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeOwnerId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeProjectRevision(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    return normalizedValue || null;
}

function normalizeProjectId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function cloneProjectAccess(access = null) {
    return access && typeof access === 'object'
        ? cloneJson(access)
        : null;
}

function resolveSessionOwnerId(session) {
    const userId = normalizeOwnerId(session?.userId);
    const email = normalizeEmail(session?.email);
    return userId || email;
}

function matchesProjectOwner(project, session) {
    const ownerId = normalizeOwnerId(project?.ownerId);
    if (!ownerId) return false;

    const sessionOwnerId = resolveSessionOwnerId(session);
    const sessionEmail = normalizeEmail(session?.email);
    return ownerId === sessionOwnerId || (Boolean(sessionEmail) && ownerId === sessionEmail);
}

function readLocalSession() {
    const storage = getBrowserStorage();
    if (!storage) return null;

    try {
        const raw = storage.getItem(DEV_LOCAL_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function normalizeProjectSummary(rawProject) {
    if (!rawProject || typeof rawProject !== 'object') return null;

    const id = typeof rawProject.id === 'string' ? rawProject.id.trim() : '';
    const name = typeof rawProject.name === 'string' ? rawProject.name.trim() : '';
    const stateSport = typeof rawProject.state?.sport === 'string' ? rawProject.state.sport.trim() : '';
    const sport = typeof rawProject.sport === 'string' ? rawProject.sport.trim() : '';
    const createdAt = typeof rawProject.createdAt === 'string' ? rawProject.createdAt : '';
    const updatedAt = typeof rawProject.updatedAt === 'string' ? rawProject.updatedAt : '';

    if (!id || !name || !createdAt || !updatedAt) return null;

    const summary = {
        id,
        name,
        sport: sport || stateSport || 'Football',
        createdAt,
        updatedAt
    };

    const ownerId = normalizeOwnerId(rawProject.ownerId);
    const tenantId = typeof rawProject.tenantId === 'string' ? rawProject.tenantId.trim() : '';
    const lastSyncedAt = typeof rawProject.lastSyncedAt === 'string' ? rawProject.lastSyncedAt : '';
    const revision = normalizeProjectRevision(rawProject.revision);
    const access = cloneProjectAccess(rawProject.access);

    if (ownerId) {
        summary.ownerId = ownerId;
    }
    if (tenantId) {
        summary.tenantId = tenantId;
    }
    if (lastSyncedAt) {
        summary.lastSyncedAt = lastSyncedAt;
    }
    if (revision !== null) {
        summary.revision = revision;
    }
    if (access) {
        summary.access = access;
    }

    return summary;
}

function normalizeProjectDetail(rawProject) {
    const summary = normalizeProjectSummary(rawProject);
    if (!summary || !rawProject || typeof rawProject !== 'object') return null;

    return {
        ...summary,
        state: cloneJson(rawProject.state ?? {})
    };
}

function normalizeSaveRequest(payload = {}) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
        throw new Error('Project name is required.');
    }

    const request = {
        name,
        state: cloneJson(payload.state ?? {})
    };

    const revision = normalizeProjectRevision(payload.revision);
    if (revision !== null) {
        request.revision = revision;
    }

    return request;
}

async function parseResponse(response) {
    let payload = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    if (!response.ok) {
        const message = typeof payload?.error === 'string'
            ? payload.error
            : `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    return payload;
}

function readLocalProjects() {
    const storage = getBrowserStorage();
    if (!storage) return [];

    try {
        const raw = storage.getItem(DEV_LOCAL_PROJECTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function readLocalLastActiveProjects() {
    const storage = getBrowserStorage();
    if (!storage) return {};

    try {
        const raw = storage.getItem(DEV_LOCAL_LAST_ACTIVE_PROJECTS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeLocalLastActiveProjects(lastActiveProjects) {
    const storage = getBrowserStorage();
    if (!storage) return;

    try {
        storage.setItem(DEV_LOCAL_LAST_ACTIVE_PROJECTS_KEY, JSON.stringify(lastActiveProjects));
    } catch {
        // Ignore storage failures in explicit local-dev mode.
    }
}

function getLastActiveProjectIdForSession(session) {
    const ownerId = resolveSessionOwnerId(session);
    if (!ownerId) return '';

    return normalizeProjectId(readLocalLastActiveProjects()[ownerId]);
}

function setLastActiveProjectIdForSession(session, projectId) {
    const ownerId = resolveSessionOwnerId(session);
    if (!ownerId) return;

    const normalizedProjectId = normalizeProjectId(projectId);
    const lastActiveProjects = readLocalLastActiveProjects();
    if (normalizedProjectId) {
        lastActiveProjects[ownerId] = normalizedProjectId;
    } else {
        delete lastActiveProjects[ownerId];
    }
    writeLocalLastActiveProjects(lastActiveProjects);
}

function writeLocalProjects(projects) {
    const storage = getBrowserStorage();
    if (!storage) return;

    try {
        storage.setItem(DEV_LOCAL_PROJECTS_KEY, JSON.stringify(projects));
    } catch {
        // Ignore storage failures in explicit local-dev mode.
    }
}

function requireLocalSession() {
    const session = readLocalSession();
    if (!resolveSessionOwnerId(session)) {
        throw new Error('You must sign in before working with projects.');
    }
    return session;
}

function createLocalProjectId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `project_${Date.now().toString(36)}_${randomPart}`;
}

function createApiProjectsService({ baseUrl }) {
    return {
        async listProjects() {
            const response = await fetch(baseUrl, {
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json'
                }
            });
            const payload = await parseResponse(response);
            return (Array.isArray(payload?.projects)
                ? payload.projects.map(normalizeProjectSummary).filter(Boolean)
                : [])
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        },

        async createProject(projectRequest) {
            const payload = normalizeSaveRequest(projectRequest);
            const response = await fetch(baseUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await parseResponse(response);
            const project = normalizeProjectDetail(data?.project);
            if (!project) {
                throw new Error('Project creation did not return a valid project payload.');
            }
            return project;
        },

        async getProject(projectId) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const response = await fetch(`${baseUrl}/${encodeURIComponent(projectId)}`, {
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json'
                }
            });
            const payload = await parseResponse(response);
            const project = normalizeProjectDetail(payload?.project);
            if (!project) {
                throw new Error('Project payload was invalid.');
            }
            return project;
        },

        async updateProject(projectId, projectRequest) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const payload = normalizeSaveRequest(projectRequest);
            const response = await fetch(`${baseUrl}/${encodeURIComponent(projectId)}`, {
                method: 'PUT',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await parseResponse(response);
            const project = normalizeProjectDetail(data?.project);
            if (!project) {
                throw new Error('Project update did not return a valid project payload.');
            }
            return project;
        },

        async deleteProject(projectId) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const response = await fetch(`${baseUrl}/${encodeURIComponent(projectId)}`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json'
                }
            });

            await parseResponse(response);
        },

        async getLastActiveProjectId() {
            return null;
        },

        async setLastActiveProjectId(_projectId) {
            return;
        },

        async clearLastActiveProjectId() {
            return;
        }
    };
}

function createLocalProjectsService() {
    return {
        async listProjects() {
            const session = requireLocalSession();
            return readLocalProjects()
                .filter((project) => matchesProjectOwner(project, session))
                .map(normalizeProjectSummary)
                .filter(Boolean)
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        },

        async createProject(projectRequest) {
            const payload = normalizeSaveRequest(projectRequest);
            const session = requireLocalSession();
            const ownerId = resolveSessionOwnerId(session);
            const now = new Date().toISOString();
            const projects = readLocalProjects();
            const project = {
                id: createLocalProjectId(),
                ownerId,
                name: payload.name,
                sport: typeof payload.state?.sport === 'string' ? payload.state.sport : 'Football',
                createdAt: now,
                updatedAt: now,
                revision: 1,
                state: payload.state
            };

            projects.push(project);
            writeLocalProjects(projects);
            return normalizeProjectDetail(project);
        },

        async getProject(projectId) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const session = requireLocalSession();
            const project = readLocalProjects().find((entry) =>
                entry.id === projectId && matchesProjectOwner(entry, session)
            );
            const normalized = normalizeProjectDetail(project);
            if (!normalized) {
                throw new Error('Project not found.');
            }
            return normalized;
        },

        async updateProject(projectId, projectRequest) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const payload = normalizeSaveRequest(projectRequest);
            const session = requireLocalSession();
            const projects = readLocalProjects();
            const index = projects.findIndex((entry) =>
                entry.id === projectId && matchesProjectOwner(entry, session)
            );

            if (index < 0) {
                throw new Error('Project not found.');
            }

            const nextProject = {
                ...projects[index],
                name: payload.name,
                sport: typeof payload.state?.sport === 'string'
                    ? payload.state.sport
                    : projects[index].sport,
                updatedAt: new Date().toISOString(),
                revision: typeof projects[index].revision === 'number'
                    ? projects[index].revision + 1
                    : 1,
                state: payload.state
            };

            projects[index] = nextProject;
            writeLocalProjects(projects);
            return normalizeProjectDetail(nextProject);
        },

        async deleteProject(projectId) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const session = requireLocalSession();
            const projects = readLocalProjects();
            const lastActiveProjectId = getLastActiveProjectIdForSession(session);
            const index = projects.findIndex((entry) =>
                entry.id === projectId && matchesProjectOwner(entry, session)
            );

            if (index < 0) {
                throw new Error('Project not found.');
            }

            projects.splice(index, 1);
            writeLocalProjects(projects);
            if (lastActiveProjectId === projectId) {
                setLastActiveProjectIdForSession(session, '');
            }
        },

        async getLastActiveProjectId() {
            const session = requireLocalSession();
            const projectId = getLastActiveProjectIdForSession(session);
            if (!projectId) {
                return null;
            }

            const exists = readLocalProjects().some((entry) => (
                entry.id === projectId && matchesProjectOwner(entry, session)
            ));
            if (!exists) {
                setLastActiveProjectIdForSession(session, '');
                return null;
            }

            return projectId;
        },

        async setLastActiveProjectId(projectId) {
            const session = requireLocalSession();
            setLastActiveProjectIdForSession(session, projectId);
        },

        async clearLastActiveProjectId(projectId = '') {
            const session = requireLocalSession();
            const currentProjectId = getLastActiveProjectIdForSession(session);
            const normalizedProjectId = normalizeProjectId(projectId);
            if (normalizedProjectId && currentProjectId !== normalizedProjectId) {
                return;
            }
            setLastActiveProjectIdForSession(session, '');
        }
    };
}

export function createProjectsService({ baseUrl = '/api/projects', devBackend = null } = {}) {
    return devBackend === 'local'
        ? createLocalProjectsService()
        : createApiProjectsService({ baseUrl });
}
