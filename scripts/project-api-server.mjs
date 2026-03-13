import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, 'data');
const dataFile = path.join(dataDir, 'projects-store.json');
const port = Number(process.env.PORT || 8001);

const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm'
};

function createEmptyStore() {
    return { projects: [] };
}

async function ensureStore() {
    await fs.mkdir(dataDir, { recursive: true });

    try {
        await fs.access(dataFile);
    } catch {
        await fs.writeFile(dataFile, JSON.stringify(createEmptyStore(), null, 2));
    }
}

async function readStore() {
    await ensureStore();
    const raw = await fs.readFile(dataFile, 'utf8');

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
            return createEmptyStore();
        }
        return parsed;
    } catch {
        return createEmptyStore();
    }
}

async function writeStore(store) {
    await ensureStore();
    await fs.writeFile(dataFile, JSON.stringify(store, null, 2));
}

function parseCookies(request) {
    const header = request.headers.cookie;
    if (!header) return {};

    return header.split(';').reduce((cookies, pair) => {
        const [rawKey, ...rest] = pair.split('=');
        const key = rawKey?.trim();
        if (!key) return cookies;

        cookies[key] = decodeURIComponent(rest.join('=').trim());
        return cookies;
    }, {});
}

function normalizeSession(rawSession) {
    if (!rawSession || typeof rawSession !== 'object') return null;

    const email = typeof rawSession.email === 'string' ? rawSession.email.trim().toLowerCase() : '';
    const displayName = typeof rawSession.displayName === 'string'
        ? rawSession.displayName.trim()
        : '';

    if (!email || !displayName) return null;

    return {
        userId: email,
        displayName,
        email
    };
}

function readSessionFromCookie(request) {
    const cookies = parseCookies(request);
    if (!cookies.sbg_session) return null;

    try {
        const parsed = JSON.parse(Buffer.from(cookies.sbg_session, 'base64url').toString('utf8'));
        return normalizeSession(parsed);
    } catch {
        return null;
    }
}

function serializeSessionCookie(session) {
    const encoded = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    return `sbg_session=${encoded}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
    return 'sbg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function sendJson(response, statusCode, payload, headers = {}) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers
    });
    response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
    sendJson(response, statusCode, { error: message });
}

async function readJsonBody(request) {
    const chunks = [];

    for await (const chunk of request) {
        chunks.push(chunk);
    }

    if (!chunks.length) return {};

    const rawBody = Buffer.concat(chunks).toString('utf8');
    if (!rawBody) return {};

    return JSON.parse(rawBody);
}

function sanitizeProjectRequest(payload = {}) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';

    if (!name) {
        throw new Error('Project name is required.');
    }

    return {
        name,
        state: JSON.parse(JSON.stringify(payload.state ?? {}))
    };
}

function toProjectSummary(project) {
    return {
        id: project.id,
        name: project.name,
        sport: project.sport,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
    };
}

function toProjectDetail(project) {
    return {
        ...toProjectSummary(project),
        state: JSON.parse(JSON.stringify(project.state))
    };
}

function routeMatch(urlPath, routePrefix) {
    if (!urlPath.startsWith(routePrefix)) return null;
    const remainder = urlPath.slice(routePrefix.length);
    return remainder.startsWith('/') ? remainder.slice(1) : remainder;
}

async function handleAuthRequest(request, response, pathname) {
    if (request.method === 'GET' && pathname === '/api/auth/session') {
        const session = readSessionFromCookie(request);
        if (!session) {
            sendError(response, 401, 'No active session.');
            return true;
        }

        sendJson(response, 200, { session });
        return true;
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
        let body;

        try {
            body = await readJsonBody(request);
        } catch {
            sendError(response, 400, 'Request body must be valid JSON.');
            return true;
        }

        const session = normalizeSession(body);
        if (!session) {
            sendError(response, 400, 'Display name and email are required.');
            return true;
        }

        sendJson(response, 200, { session }, {
            'Set-Cookie': serializeSessionCookie(session)
        });
        return true;
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
        sendJson(response, 200, { success: true }, {
            'Set-Cookie': clearSessionCookie()
        });
        return true;
    }

    return false;
}

async function handleProjectsRequest(request, response, pathname) {
    if (!pathname.startsWith('/api/projects')) return false;

    const session = readSessionFromCookie(request);
    if (!session) {
        sendError(response, 401, 'Sign in is required.');
        return true;
    }

    const store = await readStore();
    const projectId = routeMatch(pathname, '/api/projects');

    if (request.method === 'GET' && (projectId === '' || projectId === null)) {
        const projects = store.projects
            .filter((project) => project.ownerId === session.userId)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map(toProjectSummary);

        sendJson(response, 200, { projects });
        return true;
    }

    if (request.method === 'POST' && (projectId === '' || projectId === null)) {
        let payload;

        try {
            payload = sanitizeProjectRequest(await readJsonBody(request));
        } catch (error) {
            sendError(response, 400, error instanceof Error ? error.message : 'Invalid project payload.');
            return true;
        }

        const timestamp = new Date().toISOString();
        const project = {
            id: `project_${crypto.randomUUID()}`,
            ownerId: session.userId,
            name: payload.name,
            sport: typeof payload.state?.sport === 'string' ? payload.state.sport : 'Football',
            createdAt: timestamp,
            updatedAt: timestamp,
            state: payload.state
        };

        store.projects.push(project);
        await writeStore(store);
        sendJson(response, 201, { project: toProjectDetail(project) });
        return true;
    }

    if (!projectId) {
        sendError(response, 404, 'Project not found.');
        return true;
    }

    const project = store.projects.find((entry) =>
        entry.id === projectId && entry.ownerId === session.userId
    );

    if (!project) {
        sendError(response, 404, 'Project not found.');
        return true;
    }

    if (request.method === 'GET') {
        sendJson(response, 200, { project: toProjectDetail(project) });
        return true;
    }

    if (request.method === 'PUT') {
        let payload;

        try {
            payload = sanitizeProjectRequest(await readJsonBody(request));
        } catch (error) {
            sendError(response, 400, error instanceof Error ? error.message : 'Invalid project payload.');
            return true;
        }

        project.name = payload.name;
        project.sport = typeof payload.state?.sport === 'string' ? payload.state.sport : project.sport;
        project.state = payload.state;
        project.updatedAt = new Date().toISOString();

        await writeStore(store);
        sendJson(response, 200, { project: toProjectDetail(project) });
        return true;
    }

    sendError(response, 405, 'Method not allowed.');
    return true;
}

async function serveStaticFile(response, pathname) {
    let relativePath = pathname === '/' ? '/index.html' : pathname;
    relativePath = relativePath.replace(/^\/+/, '');
    const filePath = path.resolve(repoRoot, relativePath);

    if (!filePath.startsWith(repoRoot)) {
        sendError(response, 403, 'Forbidden.');
        return;
    }

    try {
        const stats = await fs.stat(filePath);
        const actualPath = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
        const content = await fs.readFile(actualPath);
        const extension = path.extname(actualPath).toLowerCase();

        response.writeHead(200, {
            'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        response.end(content);
    } catch {
        sendError(response, 404, 'Not found.');
    }
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    try {
        if (await handleAuthRequest(request, response, pathname)) return;
        if (await handleProjectsRequest(request, response, pathname)) return;
        await serveStaticFile(response, pathname);
    } catch (error) {
        sendError(
            response,
            500,
            error instanceof Error ? error.message : 'Unexpected server error.'
        );
    }
});

await ensureStore();

server.listen(port, () => {
    console.log(`Phase 5 server listening at http://localhost:${port}`);
});

export { server };
