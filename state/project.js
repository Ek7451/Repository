import { createAppState, createDefaultAppStateData } from './app-state.js';

export const PROJECT_STATE_VERSION = 'dashboard-cutover-v1';

const OPTION_COLOR_PALETTE = [
    '#7aae1a',
    '#37996e',
    '#de850a',
    '#2563eb',
    '#d1433d',
    '#7c3aed'
];
const AUTH_STATUS_VALUES = new Set(['authenticated', 'unauthenticated', 'forbidden', 'error']);
const PROJECT_CAPABILITY_KEYS = [
    'canCreateProject',
    'canListProjects',
    'canOpenProject',
    'canRenameProject',
    'canDuplicateProject',
    'canDeleteProject',
    'canSaveProject',
    'canManageProjectOptions'
];

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeString(value, fallback = '') {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : fallback;
}

function normalizeProjectRevision(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    const normalizedValue = normalizeString(value);
    return normalizedValue || null;
}

function cloneProjectAccess(access = null) {
    return access && typeof access === 'object'
        ? cloneJson(access)
        : null;
}

function resolveTimestamp(value = '', fallback = '') {
    const normalizedValue = normalizeString(value);
    if (normalizedValue) {
        return normalizedValue;
    }

    const normalizedFallback = normalizeString(fallback);
    return normalizedFallback || new Date().toISOString();
}

function normalizeAppStateSnapshot(rawState = {}, fallbackState = null) {
    const appState = createAppState();
    if (fallbackState && typeof fallbackState === 'object') {
        return appState.fromJSON(rawState, { base: fallbackState }).toJSON();
    }
    return appState.fromJSON(rawState).toJSON();
}

function normalizeOptionId(value, fallback) {
    return normalizeString(value, fallback);
}

function buildOptionId(sequenceNumber) {
    const nextSequence = Math.max(1, Math.round(Number(sequenceNumber) || 1));
    return `option-${nextSequence}`;
}

function extractOptionSequence(value) {
    const match = String(value ?? '').trim().match(/^option-(\d+)$/i);
    return match ? Math.max(1, Number(match[1])) : 0;
}

function buildDefaultOptionName(sequenceNumber) {
    const nextSequence = Math.max(1, Math.round(Number(sequenceNumber) || 1));
    return `Option ${nextSequence}`;
}

function buildDuplicateOptionName(name, fallback = 'Option') {
    return `${normalizeString(name, fallback)} Copy`;
}

function normalizeOptionColor(color, fallbackIndex = 0) {
    const nextColor = normalizeString(color);
    if (OPTION_COLOR_PALETTE.includes(nextColor)) {
        return nextColor;
    }

    const paletteIndex = Math.abs(Math.round(Number(fallbackIndex) || 0)) % OPTION_COLOR_PALETTE.length;
    return OPTION_COLOR_PALETTE[paletteIndex];
}

function normalizeOptionName(name, fallback) {
    return normalizeString(name, fallback);
}

function getProjectSportFromState(state) {
    return normalizeString(state?.sport, 'Football');
}

function getProjectOptionIndex(projectStateDocument, optionId) {
    if (!Array.isArray(projectStateDocument?.options)) {
        return -1;
    }

    return projectStateDocument.options.findIndex((option) => option.id === optionId);
}

function getNextOptionSequenceNumber(options = []) {
    return options.reduce((maxSequence, option, index) => {
        const idSequence = extractOptionSequence(option?.id);
        const nameMatch = normalizeString(option?.name).match(/^Option\s+(\d+)$/i);
        const nameSequence = nameMatch ? Math.max(1, Number(nameMatch[1])) : 0;
        return Math.max(maxSequence, idSequence, nameSequence, index + 1);
    }, 0) + 1;
}

function ensureUniqueOptionId(candidateId, usedIds, nextSequenceRef) {
    let nextCandidateId = normalizeOptionId(candidateId, buildOptionId(nextSequenceRef.value));
    while (!nextCandidateId || usedIds.has(nextCandidateId)) {
        nextSequenceRef.value += 1;
        nextCandidateId = buildOptionId(nextSequenceRef.value);
    }

    usedIds.add(nextCandidateId);
    nextSequenceRef.value = Math.max(nextSequenceRef.value, extractOptionSequence(nextCandidateId));
    return nextCandidateId;
}

/**
 * @param {{
 *   id?: string,
 *   name?: string,
 *   color?: string,
 *   state?: object,
 *   createdAt?: string,
 *   updatedAt?: string
 * }} [option]
 * @param {{
 *   fallbackState?: object | null,
 *   sequenceNumber?: number
 * }} [context]
 */
function createProjectOptionRecord(option = {}, context = {}) {
    const {
        id,
        name,
        color,
        state,
        createdAt = '',
        updatedAt = ''
    } = option;
    const {
        fallbackState = null,
        sequenceNumber = 1
    } = context;
    const normalizedState = normalizeAppStateSnapshot(
        state,
        fallbackState && typeof fallbackState === 'object'
            ? fallbackState
            : createDefaultAppStateData()
    );
    const normalizedCreatedAt = resolveTimestamp(createdAt, updatedAt);
    const normalizedUpdatedAt = resolveTimestamp(updatedAt, normalizedCreatedAt);

    return {
        id: normalizeOptionId(id, buildOptionId(sequenceNumber)),
        name: normalizeOptionName(name, buildDefaultOptionName(sequenceNumber)),
        color: normalizeOptionColor(color, sequenceNumber - 1),
        createdAt: normalizedCreatedAt,
        updatedAt: normalizedUpdatedAt,
        state: normalizedState
    };
}

export function deriveProjectNameFromSport(sport, fallback = 'Seating') {
    const fallbackName = normalizeString(fallback, 'Seating');
    const sportName = normalizeString(sport, fallbackName);
    return `${sportName} Study`;
}

export function normalizeProjectName(name, fallback = 'Untitled Seating Study') {
    return normalizeString(name, fallback);
}

export function buildDuplicateProjectName(name, fallback = 'Untitled Seating Study') {
    return `${normalizeProjectName(name, fallback)} Copy`;
}

export function normalizeProjectStatus(message, tone = 'default') {
    return {
        message: normalizeString(message, 'Project persistence ready'),
        tone: normalizeString(tone, 'default')
    };
}

export function normalizeAuthStatus(status, fallback = 'unauthenticated') {
    const normalizedFallback = AUTH_STATUS_VALUES.has(fallback) ? fallback : 'unauthenticated';
    const normalizedStatus = normalizeString(status, normalizedFallback);
    return AUTH_STATUS_VALUES.has(normalizedStatus) ? normalizedStatus : normalizedFallback;
}

function createDefaultProjectCapabilities({ authenticated = false } = {}) {
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

export function cloneProjectCapabilities(capabilities = null, { authenticated = false } = {}) {
    const clone = createDefaultProjectCapabilities({ authenticated });

    if (!capabilities || typeof capabilities !== 'object') {
        return clone;
    }

    PROJECT_CAPABILITY_KEYS.forEach((key) => {
        if (typeof capabilities[key] === 'boolean') {
            clone[key] = capabilities[key];
        }
    });

    return clone;
}

export function cloneProjectMetadata(project = null) {
    const metadata = {
        id: typeof project?.id === 'string' ? project.id : null,
        name: typeof project?.name === 'string' ? project.name : '',
        createdAt: typeof project?.createdAt === 'string' ? project.createdAt : '',
        updatedAt: typeof project?.updatedAt === 'string' ? project.updatedAt : ''
    };

    const ownerId = normalizeString(project?.ownerId);
    const tenantId = normalizeString(project?.tenantId);
    const lastSyncedAt = normalizeString(project?.lastSyncedAt);
    const revision = normalizeProjectRevision(project?.revision);
    const access = cloneProjectAccess(project?.access);

    if (ownerId) {
        metadata.ownerId = ownerId;
    }
    if (tenantId) {
        metadata.tenantId = tenantId;
    }
    if (lastSyncedAt) {
        metadata.lastSyncedAt = lastSyncedAt;
    }
    if (revision !== null) {
        metadata.revision = revision;
    }
    if (access) {
        metadata.access = access;
    }

    return metadata;
}

export function cloneSessionDto(session) {
    if (!session || typeof session !== 'object') {
        return null;
    }

    const clone = {
        userId: typeof session.userId === 'string' ? session.userId : '',
        displayName: typeof session.displayName === 'string' ? session.displayName : '',
        email: typeof session.email === 'string' ? session.email : ''
    };
    const jobTitle = typeof session.jobTitle === 'string' ? session.jobTitle.trim() : '';
    const photoUrl = typeof session.photoUrl === 'string' ? session.photoUrl.trim() : '';

    if (jobTitle) {
        clone.jobTitle = jobTitle;
    }
    if (photoUrl) {
        clone.photoUrl = photoUrl;
    }

    return clone;
}

export function cloneAuthContext(authContext = null) {
    const hasExplicitSession = Boolean(
        authContext
        && typeof authContext === 'object'
        && Object.prototype.hasOwnProperty.call(authContext, 'session')
    );
    const session = cloneSessionDto(hasExplicitSession ? authContext.session : authContext);
    const fallbackStatus = session ? 'authenticated' : 'unauthenticated';
    const status = normalizeAuthStatus(authContext?.status, fallbackStatus);
    const normalizedStatus = status === 'authenticated' && !session
        ? 'unauthenticated'
        : status;
    const reason = normalizeString(authContext?.reason);

    return {
        status: normalizedStatus,
        reason,
        session,
        capabilities: cloneProjectCapabilities(authContext?.capabilities, {
            authenticated: normalizedStatus === 'authenticated'
        })
    };
}

export function buildProjectChromeSnapshot({
    name = '',
    projectMetadata = null,
    authContext = null,
    session = null
} = {}) {
    const metadata = cloneProjectMetadata(projectMetadata);
    const normalizedAuthContext = authContext
        ? cloneAuthContext(authContext)
        : cloneAuthContext(session ? { status: 'authenticated', session } : null);

    return {
        name: typeof name === 'string' ? name.trim() : '',
        metadata,
        authStatus: normalizedAuthContext.status,
        authReason: normalizedAuthContext.reason,
        capabilities: normalizedAuthContext.capabilities,
        session: normalizedAuthContext.session,
        canSave: Boolean(metadata.id && normalizedAuthContext.capabilities.canSaveProject)
    };
}

export function isProjectStateDocument(projectState = null) {
    return Boolean(
        projectState
        && typeof projectState === 'object'
        && projectState._projectVersion === PROJECT_STATE_VERSION
        && Array.isArray(projectState.options)
    );
}

export function createDefaultProjectStateDocument(options = {}) {
    const baseState = options?.fallbackState && typeof options.fallbackState === 'object'
        ? normalizeAppStateSnapshot(options.fallbackState)
        : createDefaultAppStateData();
    const timestamp = resolveTimestamp(options?.createdAt, options?.updatedAt);
    const option = createProjectOptionRecord({
        id: options?.optionId,
        name: options?.optionName,
        color: options?.color,
        state: options?.state ?? baseState,
        createdAt: options?.createdAt ?? timestamp,
        updatedAt: options?.updatedAt ?? timestamp
    }, {
        fallbackState: baseState,
        sequenceNumber: 1
    });

    return {
        _projectVersion: PROJECT_STATE_VERSION,
        sport: getProjectSportFromState(option.state),
        activeOptionId: option.id,
        options: [option]
    };
}

export function normalizeProjectStateDocument(projectState = null, options = {}) {
    const fallbackState = options?.fallbackState && typeof options.fallbackState === 'object'
        ? normalizeAppStateSnapshot(options.fallbackState)
        : createDefaultAppStateData();

    if (!isProjectStateDocument(projectState)) {
        return createDefaultProjectStateDocument({
            state: projectState,
            fallbackState,
            createdAt: options?.createdAt,
            updatedAt: options?.updatedAt
        });
    }

    const rawOptions = Array.isArray(projectState.options) && projectState.options.length
        ? projectState.options
        : [null];
    const usedIds = new Set();
    const nextSequenceRef = {
        value: rawOptions.reduce((maxSequence, option, index) => Math.max(
            maxSequence,
            extractOptionSequence(option?.id),
            index + 1
        ), 0)
    };
    const normalizedOptions = rawOptions.map((rawOption, index) => {
        const fallbackSequence = extractOptionSequence(rawOption?.id) || index + 1;
        const optionId = ensureUniqueOptionId(rawOption?.id, usedIds, nextSequenceRef);
        const sequenceNumber = extractOptionSequence(optionId) || fallbackSequence;

        return createProjectOptionRecord({
            id: optionId,
            name: rawOption?.name,
            color: rawOption?.color,
            state: rawOption?.state,
            createdAt: rawOption?.createdAt ?? options?.createdAt,
            updatedAt: rawOption?.updatedAt ?? options?.updatedAt
        }, {
            fallbackState,
            sequenceNumber
        });
    });

    const requestedActiveOptionId = normalizeOptionId(projectState.activeOptionId, '');
    const activeOption = normalizedOptions.find((option) => option.id === requestedActiveOptionId)
        ?? normalizedOptions[0];

    return {
        _projectVersion: PROJECT_STATE_VERSION,
        sport: getProjectSportFromState(activeOption?.state),
        activeOptionId: activeOption.id,
        options: normalizedOptions
    };
}

export function cloneProjectStateDocument(projectState = null, options = {}) {
    return normalizeProjectStateDocument(projectState, options);
}

export function getProjectOption(projectState = null, optionId = '') {
    const projectStateDocument = normalizeProjectStateDocument(projectState);
    const targetOptionId = normalizeOptionId(optionId, projectStateDocument.activeOptionId);
    const option = projectStateDocument.options.find((entry) => entry.id === targetOptionId)
        ?? projectStateDocument.options[0];
    return cloneJson(option);
}

export function getActiveProjectOption(projectState = null) {
    return getProjectOption(projectState);
}

export function getActiveProjectStateSnapshot(projectState = null, fallbackState = null) {
    const projectStateDocument = normalizeProjectStateDocument(projectState, { fallbackState });
    return cloneJson(getActiveProjectOption(projectStateDocument)?.state ?? createDefaultAppStateData());
}

export function stageActiveProjectOptionState(projectState = null, activeStateSnapshot = {}, options = {}) {
    const projectStateDocument = normalizeProjectStateDocument(projectState, {
        fallbackState: activeStateSnapshot
    });
    const activeOptionIndex = getProjectOptionIndex(projectStateDocument, projectStateDocument.activeOptionId);
    if (activeOptionIndex < 0) {
        return projectStateDocument;
    }

    const activeOption = projectStateDocument.options[activeOptionIndex];
    const normalizedState = normalizeAppStateSnapshot(activeStateSnapshot, activeOption.state);
    const timestamp = resolveTimestamp(options?.timestamp);

    return {
        ...projectStateDocument,
        sport: getProjectSportFromState(normalizedState),
        options: projectStateDocument.options.map((option, optionIndex) => optionIndex === activeOptionIndex
            ? {
                ...option,
                updatedAt: timestamp,
                state: normalizedState
            }
            : option)
    };
}

export function selectProjectOption(projectState = null, optionId = '') {
    const projectStateDocument = normalizeProjectStateDocument(projectState);
    const nextOption = projectStateDocument.options.find((option) => option.id === optionId);
    if (!nextOption) {
        return projectStateDocument;
    }

    return {
        ...projectStateDocument,
        sport: getProjectSportFromState(nextOption.state),
        activeOptionId: nextOption.id
    };
}

export function renameProjectOption(projectState = null, optionId = '', name = '', options = {}) {
    const projectStateDocument = normalizeProjectStateDocument(projectState);
    const optionIndex = getProjectOptionIndex(projectStateDocument, optionId);
    if (optionIndex < 0) {
        return projectStateDocument;
    }

    const currentOption = projectStateDocument.options[optionIndex];
    const fallbackName = currentOption.name || buildDefaultOptionName(optionIndex + 1);
    const nextName = normalizeOptionName(name, fallbackName);
    if (nextName === currentOption.name) {
        return projectStateDocument;
    }

    const timestamp = resolveTimestamp(options?.timestamp);
    return {
        ...projectStateDocument,
        options: projectStateDocument.options.map((option, index) => index === optionIndex
            ? {
                ...option,
                name: nextName,
                updatedAt: timestamp
            }
            : option)
    };
}

export function createProjectOption(projectState = null, options = {}) {
    const projectStateDocument = normalizeProjectStateDocument(projectState);
    const nextSequenceNumber = getNextOptionSequenceNumber(projectStateDocument.options);
    const timestamp = resolveTimestamp(options?.timestamp);
    const nextOption = createProjectOptionRecord({
        id: options?.optionId ?? buildOptionId(nextSequenceNumber),
        name: options?.name ?? buildDefaultOptionName(nextSequenceNumber),
        color: options?.color,
        state: options?.state ?? createDefaultAppStateData(),
        createdAt: options?.createdAt ?? timestamp,
        updatedAt: options?.updatedAt ?? timestamp
    }, {
        sequenceNumber: nextSequenceNumber
    });

    return {
        ...projectStateDocument,
        sport: getProjectSportFromState(nextOption.state),
        activeOptionId: nextOption.id,
        options: [...projectStateDocument.options, nextOption]
    };
}

export function duplicateProjectOption(projectState = null, optionId = '', options = {}) {
    const projectStateDocument = normalizeProjectStateDocument(projectState);
    const sourceOption = getProjectOption(projectStateDocument, optionId);
    if (!sourceOption) {
        return projectStateDocument;
    }

    const nextSequenceNumber = getNextOptionSequenceNumber(projectStateDocument.options);
    const timestamp = resolveTimestamp(options?.timestamp);
    const nextOption = createProjectOptionRecord({
        id: options?.optionId ?? buildOptionId(nextSequenceNumber),
        name: options?.name ?? buildDuplicateOptionName(sourceOption.name, buildDefaultOptionName(nextSequenceNumber)),
        color: options?.color,
        state: sourceOption.state,
        createdAt: options?.createdAt ?? timestamp,
        updatedAt: options?.updatedAt ?? timestamp
    }, {
        fallbackState: sourceOption.state,
        sequenceNumber: nextSequenceNumber
    });

    return {
        ...projectStateDocument,
        sport: getProjectSportFromState(nextOption.state),
        activeOptionId: nextOption.id,
        options: [...projectStateDocument.options, nextOption]
    };
}

export function deleteProjectOption(projectState = null, optionId = '') {
    const projectStateDocument = normalizeProjectStateDocument(projectState);
    if (projectStateDocument.options.length <= 1) {
        throw new Error('Cannot delete the last remaining option.');
    }

    const optionIndex = getProjectOptionIndex(projectStateDocument, optionId);
    if (optionIndex < 0) {
        return projectStateDocument;
    }

    const nextOptions = projectStateDocument.options.filter((option) => option.id !== optionId);
    const nextActiveOptionId = projectStateDocument.activeOptionId === optionId
        ? nextOptions[Math.min(optionIndex, nextOptions.length - 1)]?.id ?? nextOptions[0].id
        : projectStateDocument.activeOptionId;
    const nextActiveOption = nextOptions.find((option) => option.id === nextActiveOptionId) ?? nextOptions[0];

    return {
        ...projectStateDocument,
        sport: getProjectSportFromState(nextActiveOption.state),
        activeOptionId: nextActiveOption.id,
        options: nextOptions
    };
}

export function normalizeProjectEnvelope(project = null, fallbackState = null) {
    const metadata = cloneProjectMetadata(project);
    const projectStateDocument = normalizeProjectStateDocument(project?.state ?? null, {
        fallbackState,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt
    });

    return {
        ...metadata,
        sport: projectStateDocument.sport,
        state: projectStateDocument
    };
}

export function buildProjectLoadSnapshot(project = null, fallbackState = null) {
    const normalizedProject = normalizeProjectEnvelope(project, fallbackState);
    return {
        normalizedProject,
        activeStateSnapshot: getActiveProjectStateSnapshot(normalizedProject.state, fallbackState)
    };
}

export function buildProjectSaveRequest({ name = '', state = {}, projectMetadata = null } = {}) {
    const request = {
        name: normalizeProjectName(name),
        state: cloneJson(state ?? {}) ?? {}
    };

    const revision = normalizeProjectRevision(projectMetadata?.revision);
    if (revision !== null) {
        request.revision = revision;
    }

    return request;
}

export function buildDefaultProjectCreateRequest(project = {}) {
    return buildProjectSaveRequest({
        name: project?.name,
        state: createDefaultProjectStateDocument()
    });
}

export function buildUntitledProjectCreateRequest() {
    return buildDefaultProjectCreateRequest({
        name: 'Untitled Project'
    });
}
