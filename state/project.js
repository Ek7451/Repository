import { createDefaultAppStateData } from './app-state.js';

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

export function deriveProjectNameFromSport(sport, fallback = 'Seating') {
    const fallbackName = typeof fallback === 'string' && fallback.trim()
        ? fallback.trim()
        : 'Seating';
    const sportName = typeof sport === 'string' && sport.trim()
        ? sport.trim()
        : fallbackName;
    return `${sportName} Study`;
}

export function normalizeProjectName(name, fallback = 'Untitled Seating Study') {
    return typeof name === 'string' && name.trim()
        ? name.trim()
        : fallback;
}

export function normalizeProjectStatus(message, tone = 'default') {
    return {
        message: typeof message === 'string' && message.trim()
            ? message.trim()
            : 'Project persistence ready',
        tone: typeof tone === 'string' && tone.trim()
            ? tone.trim()
            : 'default'
    };
}

export function cloneProjectMetadata(project = null) {
    return {
        id: typeof project?.id === 'string' ? project.id : null,
        name: typeof project?.name === 'string' ? project.name : '',
        createdAt: typeof project?.createdAt === 'string' ? project.createdAt : '',
        updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : ''
    };
}

export function cloneSessionDto(session) {
    return session && typeof session === 'object'
        ? { ...session }
        : null;
}

export function buildProjectChromeSnapshot({ name = '', projectMetadata = null, session = null } = {}) {
    const metadata = cloneProjectMetadata(projectMetadata);
    return {
        name: typeof name === 'string' ? name.trim() : '',
        metadata,
        session: cloneSessionDto(session),
        canSave: Boolean(metadata.id && session)
    };
}

export function normalizeProjectEnvelope(project = null, fallbackState = null) {
    const metadata = cloneProjectMetadata(project);
    const defaultState = fallbackState && typeof fallbackState === 'object'
        ? fallbackState
        : createDefaultAppStateData();

    return {
        ...metadata,
        sport: typeof project?.sport === 'string' ? project.sport : '',
        state: cloneJson(project?.state ?? defaultState) ?? createDefaultAppStateData()
    };
}

export function buildProjectSaveRequest({ name = '', state = {} } = {}) {
    return {
        name: normalizeProjectName(name),
        state: cloneJson(state ?? {}) ?? {}
    };
}

export function buildDefaultProjectCreateRequest(project = {}) {
    return buildProjectSaveRequest({
        name: project?.name,
        state: createDefaultAppStateData()
    });
}
