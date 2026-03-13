const LOCAL_SESSION_KEY = 'jlg-phase5-auth-session';
const LOCAL_PROJECTS_KEY = 'jlg-phase5-projects';

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function readLocalSession() {
    try {
        const raw = localStorage.getItem(LOCAL_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function normalizeProjectSummary(rawProject) {
    if (!rawProject || typeof rawProject !== 'object') return null;

    const id = typeof rawProject.id === 'string' ? rawProject.id.trim() : '';
    const name = typeof rawProject.name === 'string' ? rawProject.name.trim() : '';
    const sport = typeof rawProject.sport === 'string' ? rawProject.sport.trim() : '';
    const createdAt = typeof rawProject.createdAt === 'string' ? rawProject.createdAt : '';
    const updatedAt = typeof rawProject.updatedAt === 'string' ? rawProject.updatedAt : '';

    if (!id || !name || !createdAt || !updatedAt) return null;

    return {
        id,
        name,
        sport: sport || 'Football',
        createdAt,
        updatedAt
    };
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

    return {
        name,
        state: cloneJson(payload.state ?? {})
    };
}

async function parseResponse(response) {
    let payload = null;

    try {
        payload = await response.json();
    } catch (_) {
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
    try {
        const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (_) {
        return [];
    }
}

function writeLocalProjects(projects) {
    try {
        localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects));
    } catch (_) {
        // Ignore storage failures so network-backed persistence can still work.
    }
}

function requireLocalSession() {
    const session = readLocalSession();
    if (!session?.email) {
        throw new Error('You must sign in before working with projects.');
    }
    return session;
}

function createLocalProjectId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `project_${Date.now().toString(36)}_${randomPart}`;
}

export function createProjectsService({ baseUrl = '/api/projects' } = {}) {
    return {
        async listProjects() {
            try {
                const response = await fetch(baseUrl, {
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json'
                    }
                });
                const payload = await parseResponse(response);
                return Array.isArray(payload?.projects)
                    ? payload.projects.map(normalizeProjectSummary).filter(Boolean)
                    : [];
            } catch (_) {
                const session = requireLocalSession();
                return readLocalProjects()
                    .filter((project) => project.ownerId === session.email)
                    .map(normalizeProjectSummary)
                    .filter(Boolean)
                    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
            }
        },

        async createProject(projectRequest) {
            const payload = normalizeSaveRequest(projectRequest);

            try {
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
            } catch (_) {
                const session = requireLocalSession();
                const now = new Date().toISOString();
                const projects = readLocalProjects();
                const project = {
                    id: createLocalProjectId(),
                    ownerId: session.email,
                    name: payload.name,
                    sport: typeof payload.state?.sport === 'string' ? payload.state.sport : 'Football',
                    createdAt: now,
                    updatedAt: now,
                    state: payload.state
                };

                projects.push(project);
                writeLocalProjects(projects);
                return normalizeProjectDetail(project);
            }
        },

        async getProject(projectId) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            try {
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
            } catch (_) {
                const session = requireLocalSession();
                const project = readLocalProjects().find((entry) =>
                    entry.id === projectId && entry.ownerId === session.email
                );
                const normalized = normalizeProjectDetail(project);
                if (!normalized) {
                    throw new Error('Project not found.');
                }
                return normalized;
            }
        },

        async updateProject(projectId, projectRequest) {
            if (!projectId || typeof projectId !== 'string') {
                throw new Error('Project id is required.');
            }

            const payload = normalizeSaveRequest(projectRequest);

            try {
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
            } catch (_) {
                const session = requireLocalSession();
                const projects = readLocalProjects();
                const index = projects.findIndex((entry) =>
                    entry.id === projectId && entry.ownerId === session.email
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
                    state: payload.state
                };

                projects[index] = nextProject;
                writeLocalProjects(projects);
                return normalizeProjectDetail(nextProject);
            }
        }
    };
}
