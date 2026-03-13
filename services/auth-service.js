const LOCAL_SESSION_KEY = 'jlg-phase5-auth-session';

function normalizeSession(rawSession) {
    if (!rawSession || typeof rawSession !== 'object') return null;

    const userId = typeof rawSession.userId === 'string' ? rawSession.userId.trim() : '';
    const displayName = typeof rawSession.displayName === 'string'
        ? rawSession.displayName.trim()
        : '';
    const email = typeof rawSession.email === 'string' ? rawSession.email.trim().toLowerCase() : '';

    if (!userId || !displayName || !email) return null;

    return {
        userId,
        displayName,
        email
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

function readLocalSession() {
    try {
        const raw = localStorage.getItem(LOCAL_SESSION_KEY);
        return normalizeSession(raw ? JSON.parse(raw) : null);
    } catch (_) {
        return null;
    }
}

function writeLocalSession(session) {
    try {
        if (!session) {
            localStorage.removeItem(LOCAL_SESSION_KEY);
            return;
        }

        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
    } catch (_) {
        // Ignore storage failures so network-backed auth can still work.
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

export function createAuthService({ baseUrl = '/api/auth' } = {}) {
    return {
        async getSession() {
            try {
                const response = await fetch(`${baseUrl}/session`, {
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json'
                    }
                });

                if (response.status === 401) {
                    writeLocalSession(null);
                    return null;
                }

                const payload = await parseResponse(response);
                const session = normalizeSession(payload?.session);
                writeLocalSession(session);
                return session;
            } catch (_) {
                return readLocalSession();
            }
        },

        async signIn(credentials) {
            const payload = normalizeSignInPayload(credentials);

            try {
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

                writeLocalSession(session);
                return session;
            } catch (error) {
                const fallbackSession = normalizeSession({
                    userId: payload.email,
                    displayName: payload.displayName,
                    email: payload.email
                });

                if (!fallbackSession) {
                    throw error;
                }

                writeLocalSession(fallbackSession);
                return fallbackSession;
            }
        },

        async signOut() {
            try {
                await fetch(`${baseUrl}/logout`, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json'
                    }
                });
            } catch (_) {
                // Local fallback sign-out still clears the client session.
            }

            writeLocalSession(null);
        }
    };
}
