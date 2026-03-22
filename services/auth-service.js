const DEV_LOCAL_SESSION_KEY = 'sbg-dev-auth-session';

const LOCAL_DEV_JOB_TITLE = 'Design Technology Specialist II';
const LOCAL_DEV_MICROSOFT_SESSION = Object.freeze({
    userId: 'pat@example.com',
    displayName: 'Pat Example',
    email: 'pat@example.com',
    jobTitle: LOCAL_DEV_JOB_TITLE
});
const AUTH_STATUS_VALUES = new Set(['authenticated', 'unauthenticated', 'forbidden', 'error']);
const AUTH_CAPABILITY_KEYS = [
    'canCreateProject',
    'canListProjects',
    'canOpenProject',
    'canRenameProject',
    'canDuplicateProject',
    'canDeleteProject',
    'canSaveProject',
    'canManageProjectOptions'
];

function getBrowserStorage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function normalizeSession(rawSession) {
    if (!rawSession || typeof rawSession !== 'object') return null;

    const userId = typeof rawSession.userId === 'string' ? rawSession.userId.trim() : '';
    const displayName = typeof rawSession.displayName === 'string'
        ? rawSession.displayName.trim()
        : '';
    const email = typeof rawSession.email === 'string' ? rawSession.email.trim().toLowerCase() : '';
    const jobTitle = typeof rawSession.jobTitle === 'string' ? rawSession.jobTitle.trim() : '';
    const photoUrl = typeof rawSession.photoUrl === 'string' ? rawSession.photoUrl.trim() : '';

    if (!userId || !displayName || !email) return null;

    const session = {
        userId,
        displayName,
        email
    };
    if (jobTitle) {
        session.jobTitle = jobTitle;
    }
    if (photoUrl) {
        session.photoUrl = photoUrl;
    }

    return session;
}

function normalizeAuthStatus(status, fallback = 'unauthenticated') {
    const normalizedFallback = AUTH_STATUS_VALUES.has(fallback) ? fallback : 'unauthenticated';
    const normalizedStatus = typeof status === 'string' ? status.trim() : '';
    return AUTH_STATUS_VALUES.has(normalizedStatus) ? normalizedStatus : normalizedFallback;
}

function createDefaultCapabilities({ authenticated = false } = {}) {
    const isAuthenticated = Boolean(authenticated);
    return {
        canCreateProject: isAuthenticated,
        canListProjects: isAuthenticated,
        canOpenProject: isAuthenticated,
        canRenameProject: isAuthenticated,
        canDuplicateProject: isAuthenticated,
        canDeleteProject: isAuthenticated,
        canSaveProject: isAuthenticated,
        canManageProjectOptions: isAuthenticated
    };
}

function normalizeCapabilities(rawCapabilities = null, { authenticated = false } = {}) {
    const capabilities = createDefaultCapabilities({ authenticated });

    if (!rawCapabilities || typeof rawCapabilities !== 'object') {
        return capabilities;
    }

    AUTH_CAPABILITY_KEYS.forEach((key) => {
        if (typeof rawCapabilities[key] === 'boolean') {
            capabilities[key] = rawCapabilities[key];
        }
    });

    return capabilities;
}

function buildAuthState({ status = 'unauthenticated', session = null, capabilities = null, reason = '' } = {}) {
    const normalizedSession = normalizeSession(session);
    const fallbackStatus = normalizedSession ? 'authenticated' : 'unauthenticated';
    const normalizedStatus = normalizeAuthStatus(status, fallbackStatus);
    const resolvedStatus = normalizedStatus === 'authenticated' && !normalizedSession
        ? 'unauthenticated'
        : normalizedStatus;

    return {
        status: resolvedStatus,
        reason: typeof reason === 'string' ? reason.trim() : '',
        session: normalizedSession,
        capabilities: normalizeCapabilities(capabilities, {
            authenticated: resolvedStatus === 'authenticated'
        })
    };
}

function extractAuthStatePayload(payload = null, fallbackStatus = 'authenticated') {
    const authPayload = payload?.auth && typeof payload.auth === 'object'
        ? payload.auth
        : null;
    const source = authPayload ?? payload;
    const session = source?.session ?? payload?.session ?? null;
    const capabilities = source?.capabilities ?? payload?.capabilities ?? null;
    const reason = source?.reason ?? payload?.reason ?? payload?.error ?? '';
    const status = source?.status ?? payload?.status ?? fallbackStatus;

    return buildAuthState({
        status,
        session,
        capabilities,
        reason
    });
}

async function readJsonPayload(response) {
    try {
        return await response.json();
    } catch {
        return null;
    }
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

function readLocalSession() {
    const storage = getBrowserStorage();
    if (!storage) return null;

    try {
        const raw = storage.getItem(DEV_LOCAL_SESSION_KEY);
        return normalizeSession(raw ? JSON.parse(raw) : null);
    } catch {
        return null;
    }
}

function writeLocalSession(session) {
    const storage = getBrowserStorage();
    if (!storage) return;

    try {
        if (!session) {
            storage.removeItem(DEV_LOCAL_SESSION_KEY);
            return;
        }

        storage.setItem(DEV_LOCAL_SESSION_KEY, JSON.stringify(session));
    } catch {
        // Ignore storage failures in explicit local-dev mode.
    }
}

function normalizeSignInPayload(credentials = {}) {
    const displayName = typeof credentials.displayName === 'string'
        ? credentials.displayName.trim()
        : '';
    const email = typeof credentials.email === 'string'
        ? credentials.email.trim().toLowerCase()
        : '';

    if (!displayName || !email) {
        throw new Error('Display name and email are required.');
    }

    return { displayName, email };
}

function buildLocalMicrosoftSession() {
    const session = normalizeSession(LOCAL_DEV_MICROSOFT_SESSION);
    if (!session) {
        throw new Error('Local Microsoft sign-in did not produce a valid session.');
    }
    return session;
}

function createApiAuthService({ baseUrl }) {
    async function getAuthState() {
        const response = await fetch(`${baseUrl}/session`, {
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json'
            }
        });

        if (response.status === 401) {
            return buildAuthState({
                status: 'unauthenticated'
            });
        }

        if (response.status === 403) {
            return extractAuthStatePayload(await readJsonPayload(response), 'forbidden');
        }

        const payload = await parseResponse(response);
        return extractAuthStatePayload(payload, 'authenticated');
    }

    return {
        async getAuthState() {
            return getAuthState();
        },

        async getSession() {
            const authState = await getAuthState();
            return authState.session;
        },

        async signIn(credentials) {
            const payload = normalizeSignInPayload(credentials);
            const response = await fetch(`${baseUrl}/login`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await parseResponse(response);
            const session = normalizeSession(data?.session);
            if (!session) {
                throw new Error('Sign-in succeeded but no session was returned.');
            }

            return session;
        },

        async signInWithMicrosoft() {
            throw new Error('Microsoft SSO is not implemented in this build.');
        },

        async signOut() {
            const response = await fetch(`${baseUrl}/logout`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json'
                }
            });

            await parseResponse(response);
        }
    };
}

function createLocalAuthService() {
    async function getAuthState() {
        const session = readLocalSession();
        return buildAuthState({
            status: session ? 'authenticated' : 'unauthenticated',
            session
        });
    }

    return {
        async getAuthState() {
            return getAuthState();
        },

        async getSession() {
            const authState = await getAuthState();
            return authState.session;
        },

        async signIn(credentials) {
            const payload = normalizeSignInPayload(credentials);
            const session = normalizeSession({
                userId: payload.email,
                displayName: payload.displayName,
                email: payload.email,
                jobTitle: LOCAL_DEV_JOB_TITLE
            });

            if (!session) {
                throw new Error('Sign-in succeeded but no session was returned.');
            }

            writeLocalSession(session);
            return session;
        },

        async signInWithMicrosoft() {
            const existingSession = readLocalSession();
            if (existingSession) {
                return existingSession;
            }

            const session = buildLocalMicrosoftSession();
            writeLocalSession(session);
            return session;
        },

        async signOut() {
            writeLocalSession(null);
        }
    };
}

export async function ensureSession(authService) {
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

export async function resolveAuthContext(authService) {
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

export function createAuthService({ baseUrl = '/api/auth', devBackend = null } = {}) {
    return devBackend === 'local'
        ? createLocalAuthService()
        : createApiAuthService({ baseUrl });
}
