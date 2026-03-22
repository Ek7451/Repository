import fs from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    bootAppShell,
    buildConfiguratorUrl,
    getCurrentPage
} from '../../app.js';
import {
    buildDuplicateProjectName
} from '../../state/project.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const layerRules = {
    core: new Set(['core']),
    state: new Set(['state', 'core']),
    ui: new Set(['ui', 'core', 'state', 'viz', 'export']),
    viz: new Set(['viz', 'core']),
    export: new Set(['export', 'core']),
    services: new Set(['services']),
    pages: new Set(['pages', 'ui', 'services', 'state'])
};
const layerDirs = Object.keys(layerRules);
const relativeImportPatterns = [
    /\bimport\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];
const liveStateCouplingChecks = [
    {
        pattern: /document\.documentElement/,
        reason: 'reads theme or page state from document.documentElement'
    },
    {
        pattern: /getAttribute\(\s*['"]data-theme['"]\s*\)/,
        reason: 'reads theme via the DOM data-theme attribute'
    },
    {
        pattern: /\blocalStorage\b/,
        reason: 'reads persisted UI state directly'
    }
];
const nonCoreAisleTruthSymbols = [
    'computeAssignedAisleWidthIn',
    'computeRequiredAisleWidthIn',
    'computeAisleTributaryOccupancies',
    'countSeatsFromCenterlineGapFt'
];

function collectJsFiles(dirPath) {
    if (!fs.existsSync(dirPath)) return [];

    const files = [];
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const nextPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectJsFiles(nextPath));
            continue;
        }
        if (entry.isFile() && nextPath.endsWith('.js')) {
            files.push(nextPath);
        }
    }

    return files.sort();
}

function getLayerForFile(filePath) {
    const relativePath = path.relative(repoRoot, filePath);
    const [firstSegment] = relativePath.split(path.sep);
    return layerDirs.includes(firstSegment) ? firstSegment : null;
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function extractRelativeImports(sourceText) {
    const specifiers = new Set();

    for (const pattern of relativeImportPatterns) {
        pattern.lastIndex = 0;
        let match = pattern.exec(sourceText);
        while (match) {
            const specifier = match[1];
            if (specifier && specifier.startsWith('.')) {
                specifiers.add(specifier);
            }
            match = pattern.exec(sourceText);
        }
    }

    return Array.from(specifiers);
}

function resolveImport(sourceFile, specifier) {
    const resolvedBase = path.resolve(path.dirname(sourceFile), specifier);
    const candidates = [
        resolvedBase,
        `${resolvedBase}.js`,
        path.join(resolvedBase, 'index.js')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
    }

    return null;
}

function collectLayerImportViolations() {
    const violations = [];

    for (const layerName of layerDirs) {
        const allowedTargets = layerRules[layerName];
        const files = collectJsFiles(path.join(repoRoot, layerName));

        for (const filePath of files) {
            const sourceText = fs.readFileSync(filePath, 'utf8');
            const imports = extractRelativeImports(sourceText);

            for (const specifier of imports) {
                const resolved = resolveImport(filePath, specifier);
                if (!resolved) continue;

                const targetLayer = getLayerForFile(resolved);
                if (!targetLayer) continue;

                if (!allowedTargets.has(targetLayer)) {
                    violations.push(
                        `${toRepoPath(filePath)} -> ${toRepoPath(resolved)} (${layerName} cannot import ${targetLayer})`
                    );
                }
            }
        }
    }

    return violations;
}

function extractInlineScript(filePath) {
    const sourceText = fs.readFileSync(filePath, 'utf8');
    const match = sourceText.match(/<script>\s*([\s\S]*?)<\/script>/i);

    if (!match) {
        throw new Error(`No inline script found in ${toRepoPath(filePath)}`);
    }

    return match[1];
}

function createRouteDocument(page) {
    return {
        body: {
            dataset: {
                page
            }
        },
        getElementById: vi.fn(() => null)
    };
}

function createLocation(href) {
    const url = new URL(href);

    return {
        href: url.toString(),
        search: url.search,
        hash: url.hash,
        replace: vi.fn(),
        assign: vi.fn()
    };
}

function createProjectStateDocument({
    sport = 'Football',
    activeOptionId = 'option-1',
    options = null
} = {}) {
    return {
        _projectVersion: 'dashboard-cutover-v1',
        sport,
        activeOptionId,
        options: options ?? [
            {
                id: 'option-1',
                name: 'Option 1',
                color: '#7aae1a',
                createdAt: '2026-03-16T00:00:00.000Z',
                updatedAt: '2026-03-16T00:00:00.000Z',
                state: { sport }
            }
        ]
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('architecture layer boundaries', () => {
    it('only allows imports across approved layers', () => {
        expect(collectLayerImportViolations()).toEqual([]);
    });

    it('keeps services decoupled from state', () => {
        const violations = [];
        const serviceFiles = collectJsFiles(path.join(repoRoot, 'services'));

        for (const filePath of serviceFiles) {
            const sourceText = fs.readFileSync(filePath, 'utf8');
            const imports = extractRelativeImports(sourceText);

            for (const specifier of imports) {
                const resolved = resolveImport(filePath, specifier);
                if (!resolved) continue;

                if (getLayerForFile(resolved) === 'state') {
                    violations.push(`${toRepoPath(filePath)} -> ${toRepoPath(resolved)}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('keeps viz and export free of live theme and persistence state reads', () => {
        const violations = [];

        for (const layerName of ['viz', 'export']) {
            const files = collectJsFiles(path.join(repoRoot, layerName));

            for (const filePath of files) {
                const sourceText = fs.readFileSync(filePath, 'utf8');

                for (const check of liveStateCouplingChecks) {
                    if (check.pattern.test(sourceText)) {
                        violations.push(`${toRepoPath(filePath)} ${check.reason}`);
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('keeps authoritative aisle math calls inside core only', () => {
        const violations = [];

        for (const layerName of layerDirs.filter((layerName) => layerName !== 'core')) {
            const files = collectJsFiles(path.join(repoRoot, layerName));

            for (const filePath of files) {
                const sourceText = fs.readFileSync(filePath, 'utf8');

                for (const symbolName of nonCoreAisleTruthSymbols) {
                    if (new RegExp(`\\b${symbolName}\\b`).test(sourceText)) {
                        violations.push(`${toRepoPath(filePath)} references ${symbolName}`);
                    }
                }
            }
        }

        expect(violations).toEqual([]);
    });

    it('reads total occupancy in the stats view model from configurationSummary instead of reducing UI metrics', () => {
        const sourceText = fs.readFileSync(
            path.join(repoRoot, 'ui', 'stats-view-model.js'),
            'utf8'
        );

        expect(sourceText).toContain('configurationSummary?.reportedOccupancyAllTiers');
        expect(sourceText).not.toContain('Array.from(tierMetricsByIndex.values()).reduce');
    });
});

describe('entry routing and bootstrap', () => {
    it('routes root entry directly to the configurator while preserving search and hash', () => {
        const location = {
            search: '?project=project-7&devBackend=local',
            hash: '#recent',
            replace: vi.fn()
        };

        runInNewContext(
            extractInlineScript(path.join(repoRoot, 'index.html')),
            {
                window: { location }
            }
        );

        expect(location.replace).toHaveBeenCalledWith(
            './pages/configurator/index.html?project=project-7&devBackend=local#recent'
        );
    });

    it('only recognizes the configurator page shell as a live route', () => {
        expect(getCurrentPage(/** @type {Document} */ (/** @type {unknown} */ (createRouteDocument('configurator'))))).toBe('configurator');
        expect(getCurrentPage(/** @type {Document} */ (/** @type {unknown} */ (createRouteDocument('dashboard'))))).toBeNull();
    });

    it('removes the legacy dashboard route artifacts from the live application path', () => {
        expect(fs.existsSync(path.join(repoRoot, 'pages/dashboard/dashboard.html'))).toBe(false);
        expect(fs.existsSync(path.join(repoRoot, 'pages/dashboard/dashboard.css'))).toBe(false);
        expect(fs.existsSync(path.join(repoRoot, 'pages/dashboard/dashboard.js'))).toBe(false);
        expect(fs.existsSync(path.join(repoRoot, 'ui/project-dashboard.js'))).toBe(false);
    });

    it('signs in and creates one untitled project when direct entry has no project query', async () => {
        const location = createLocation('http://localhost/pages/configurator/index.html?devBackend=local');
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(null),
            signInWithMicrosoft: vi.fn().mockResolvedValue(session)
        };
        const projectApi = {
            createProject: vi.fn().mockResolvedValue({
                id: 'project-1'
            })
        };
        const appFactory = vi.fn();

        await bootAppShell({
            document: createRouteDocument('configurator'),
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        expect(authService.getSession).toHaveBeenCalledTimes(1);
        expect(authService.signInWithMicrosoft).toHaveBeenCalledTimes(1);
        expect(projectApi.createProject).toHaveBeenCalledTimes(1);
        expect(projectApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Untitled Project',
            state: expect.objectContaining({
                _projectVersion: 'dashboard-cutover-v1',
                activeOptionId: 'option-1',
                sport: 'Ice Hockey'
            })
        }));
        expect(location.replace).toHaveBeenCalledWith(
            buildConfiguratorUrl('project-1', { devBackend: 'local' })
        );
        expect(appFactory).not.toHaveBeenCalled();
    });

    it('loads an existing project into the configurator when a project query is present', async () => {
        const document = createRouteDocument('configurator');
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const project = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: { sport: 'Football' }
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        const projectApi = {
            getProject: vi.fn().mockResolvedValue(project)
        };
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            loadProject: vi.fn(),
            setProjectStatus: vi.fn(),
            setSession: vi.fn()
        };
        const appFactory = vi.fn(() => app);

        await bootAppShell({
            document,
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        expect(authService.getSession).toHaveBeenCalledTimes(1);
        expect(authService.signInWithMicrosoft).not.toHaveBeenCalled();
        expect(projectApi.getProject).toHaveBeenCalledWith('project-1');
        expect(projectApi.getProject.mock.invocationCallOrder[0]).toBeLessThan(appFactory.mock.invocationCallOrder[0]);
        expect(appFactory).toHaveBeenCalledTimes(1);
        expect(appFactory).toHaveBeenCalledWith(expect.objectContaining({
            projectActions: expect.any(Object),
            document,
            initialProject: project
        }));
        expect(app.setSession).toHaveBeenCalledWith(session);
        expect(app.init).toHaveBeenCalledTimes(1);
        expect(app.loadProject).not.toHaveBeenCalled();
        expect(location.replace).not.toHaveBeenCalled();
    });

    it('redirects without creating the app when the initial project preload fails', async () => {
        const document = createRouteDocument('configurator');
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        const projectApi = {
            getProject: vi.fn().mockRejectedValue(new Error('Missing project'))
        };
        const appFactory = vi.fn();
        const setTimeoutFn = vi.fn((callback) => {
            callback();
            return 1;
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await bootAppShell({
            document,
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory,
            setTimeoutFn
        });

        expect(errorSpy).toHaveBeenCalledWith('Project load failed:', expect.any(Error));
        expect(appFactory).not.toHaveBeenCalled();
        expect(location.assign).toHaveBeenCalledWith(
            buildConfiguratorUrl(null, { devBackend: 'local' })
        );
    });

    it('keeps import and export owned by the configurator toolbar instead of the legacy left rail', () => {
        const configuratorMarkup = fs.readFileSync(
            path.join(repoRoot, 'pages/configurator/index.html'),
            'utf8'
        );
        const editorShellSource = fs.readFileSync(
            path.join(repoRoot, 'ui/editor-shell.js'),
            'utf8'
        );

        expect(configuratorMarkup).toContain('data-toolbar-export-kind="json"');
        expect(configuratorMarkup).toContain('id="configFileInput"');
        expect(configuratorMarkup).not.toContain('id="loadConfigBtn"');
        expect(configuratorMarkup).not.toContain('class="export-menu-body"');
        expect(editorShellSource).not.toContain('loadConfigBtn');
        expect(editorShellSource).not.toContain('.export-menu-panel');
        expect(editorShellSource).not.toContain('.export-menu-header');
    });

    it('starts the configurator sidebar in its minimized-slider state to avoid first-paint slider flicker', () => {
        const configuratorMarkup = fs.readFileSync(
            path.join(repoRoot, 'pages/configurator/index.html'),
            'utf8'
        );

        expect(configuratorMarkup).toContain('class="sidebar left-sidebar slider-minimized"');
    });

    it('exposes every supported rectangular bowl family in the configurator bowl type picker', () => {
        const configuratorMarkup = fs.readFileSync(
            path.join(repoRoot, 'pages/configurator/index.html'),
            'utf8'
        );

        expect(configuratorMarkup).toContain('option value="Full"');
        expect(configuratorMarkup).toContain('option value="U-End1"');
        expect(configuratorMarkup).toContain('option value="U-End2"');
        expect(configuratorMarkup).toContain('option value="Sides"');
        expect(configuratorMarkup).toContain('option value="Side1"');
    });

    it('injects project actions that save, rename, and duplicate through project-document DTOs', async () => {
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const loadedProject = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: createProjectStateDocument()
        };
        const savedProject = {
            ...loadedProject,
            updatedAt: '2026-03-16T00:05:00.000Z'
        };
        const renamedProject = {
            ...loadedProject,
            name: 'Renamed Study',
            updatedAt: '2026-03-16T00:10:00.000Z'
        };
        const duplicatedProject = {
            ...loadedProject,
            id: 'project-2',
            name: 'Arena Study Copy'
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        let currentProjectState = createProjectStateDocument();
        const projectApi = {
            getProject: vi.fn().mockResolvedValue(loadedProject),
            updateProject: vi.fn()
                .mockResolvedValueOnce(savedProject)
                .mockResolvedValueOnce(renamedProject),
            createProject: vi.fn().mockResolvedValue(duplicatedProject)
        };
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            loadProject: vi.fn(),
            setProjectMetadata: vi.fn(),
            setProjectName: vi.fn(),
            setProjectSaveBusy: vi.fn(),
            setProjectStateDocument: vi.fn((projectStateDocument) => {
                currentProjectState = projectStateDocument;
            }),
            setProjectStatus: vi.fn(),
            setSession: vi.fn(),
            captureStateSnapshot: vi.fn(() => ({
                sport: 'Football'
            })),
            getProjectMetadata: vi.fn(() => ({
                id: 'project-1',
                name: 'Arena Study'
            })),
            getProjectStateDocument: vi.fn(() => currentProjectState),
            getProjectSaveRequest: vi.fn((projectStateDocument) => ({
                name: 'Arena Study',
                state: projectStateDocument
            }))
        };
        let projectActions = /** @type {any} */ (null);
        const appFactory = vi.fn((options) => {
            projectActions = options.projectActions;
            return app;
        });

        await bootAppShell({
            document: createRouteDocument('configurator'),
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        if (!projectActions) {
            throw new Error('projectActions were not injected');
        }

        await projectActions.saveCurrentProject();
        await projectActions.renameCurrentProject('  Renamed Study  ');
        await projectActions.duplicateProject('project-1');

        expect(projectApi.updateProject).toHaveBeenNthCalledWith(1, 'project-1', expect.objectContaining({
            name: 'Arena Study',
            state: expect.objectContaining({
                _projectVersion: 'dashboard-cutover-v1',
                activeOptionId: 'option-1',
                sport: 'Football'
            })
        }));
        expect(projectApi.updateProject).toHaveBeenNthCalledWith(2, 'project-1', expect.objectContaining({
            name: 'Arena Study',
            state: expect.objectContaining({
                _projectVersion: 'dashboard-cutover-v1',
                activeOptionId: 'option-1',
                sport: 'Football'
            })
        }));
        expect(app.setProjectSaveBusy).toHaveBeenCalledWith(true);
        expect(app.setProjectSaveBusy).toHaveBeenCalledWith(false);
        expect(app.setProjectName).toHaveBeenCalledWith('  Renamed Study  ');
        expect(app.setProjectMetadata).toHaveBeenCalledWith(savedProject);
        expect(app.setProjectMetadata).toHaveBeenCalledWith(renamedProject);
        expect(app.setProjectStateDocument).toHaveBeenCalledWith(savedProject.state);
        expect(app.setProjectStateDocument).toHaveBeenCalledWith(renamedProject.state);
        expect(projectApi.createProject).toHaveBeenCalledWith({
            name: buildDuplicateProjectName(loadedProject.name),
            state: loadedProject.state
        });
        expect(app.setProjectStatus).toHaveBeenCalledWith('Saving project...', 'pending');
        expect(app.setProjectStatus).toHaveBeenCalledWith('Duplicating project...', 'pending');
        expect(app.setProjectStatus).toHaveBeenCalledWith(`Duplicated ${duplicatedProject.name}`, 'success');
    });

    it('injects project actions that rename a non-current saved project via getProject and updateProject without loading it', async () => {
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const initialProject = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: { sport: 'Football' }
        };
        const detachedProject = {
            id: 'project-2',
            name: 'Harbor Study',
            createdAt: '2026-03-16T01:00:00.000Z',
            updatedAt: '2026-03-16T01:00:00.000Z',
            state: { sport: 'Soccer' }
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        const projectApi = {
            getProject: vi.fn()
                .mockResolvedValueOnce(initialProject)
                .mockResolvedValueOnce(detachedProject),
            updateProject: vi.fn().mockResolvedValue({
                ...detachedProject,
                name: 'Renamed Detached Study'
            })
        };
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            loadProject: vi.fn(),
            setProjectStatus: vi.fn(),
            setSession: vi.fn(),
            getProjectMetadata: vi.fn(() => ({
                id: 'project-1',
                name: 'Arena Study'
            }))
        };
        let projectActions = /** @type {any} */ (null);
        const appFactory = vi.fn((options) => {
            projectActions = options.projectActions;
            return app;
        });

        await bootAppShell({
            document: createRouteDocument('configurator'),
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        if (!projectActions) {
            throw new Error('projectActions were not injected');
        }

        await projectActions.renameProject('project-2', '  Renamed Detached Study  ');

        expect(projectActions.renameProject).toEqual(expect.any(Function));
        expect(projectApi.getProject).toHaveBeenNthCalledWith(2, 'project-2');
        expect(projectApi.updateProject).toHaveBeenCalledWith('project-2', {
            name: 'Renamed Detached Study',
            state: detachedProject.state
        });
        expect(app.loadProject).not.toHaveBeenCalled();
        expect(app.setProjectStatus).toHaveBeenCalledWith('Renaming project...', 'pending');
        expect(app.setProjectStatus).toHaveBeenCalledWith('Renamed Renamed Detached Study', 'success');
    });

    it('routes current-project renameProject calls through the current project save path', async () => {
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const loadedProject = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: createProjectStateDocument()
        };
        const renamedProject = {
            ...loadedProject,
            name: 'Renamed Study',
            updatedAt: '2026-03-16T00:10:00.000Z'
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        let currentProjectState = createProjectStateDocument();
        const projectApi = {
            getProject: vi.fn().mockResolvedValue(loadedProject),
            updateProject: vi.fn().mockResolvedValue(renamedProject)
        };
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            loadProject: vi.fn(),
            setProjectMetadata: vi.fn(),
            setProjectName: vi.fn(),
            setProjectSaveBusy: vi.fn(),
            setProjectStateDocument: vi.fn((projectStateDocument) => {
                currentProjectState = projectStateDocument;
            }),
            setProjectStatus: vi.fn(),
            setSession: vi.fn(),
            captureStateSnapshot: vi.fn(() => ({ sport: 'Football' })),
            getProjectMetadata: vi.fn(() => ({
                id: 'project-1',
                name: 'Arena Study'
            })),
            getProjectStateDocument: vi.fn(() => currentProjectState),
            getProjectSaveRequest: vi.fn((projectStateDocument) => ({
                name: 'Arena Study',
                state: projectStateDocument
            }))
        };
        let projectActions = /** @type {any} */ (null);
        const appFactory = vi.fn((options) => {
            projectActions = options.projectActions;
            return app;
        });

        await bootAppShell({
            document: createRouteDocument('configurator'),
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        if (!projectActions) {
            throw new Error('projectActions were not injected');
        }

        await projectActions.renameProject('project-1', '  Renamed Study  ');

        expect(projectApi.getProject).toHaveBeenCalledTimes(1);
        expect(projectApi.updateProject).toHaveBeenCalledWith('project-1', expect.objectContaining({
            name: 'Arena Study',
            state: expect.objectContaining({
                _projectVersion: 'dashboard-cutover-v1',
                activeOptionId: 'option-1',
                sport: 'Football'
            })
        }));
        expect(app.setProjectName).toHaveBeenCalledWith('  Renamed Study  ');
        expect(app.setProjectSaveBusy).toHaveBeenCalledWith(true);
        expect(app.setProjectSaveBusy).toHaveBeenCalledWith(false);
    });

    it('injects option actions that stage the active snapshot before persisting and reload the selected option', async () => {
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const currentProjectState = createProjectStateDocument({
            sport: 'Football',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    createdAt: '2026-03-16T00:00:00.000Z',
                    updatedAt: '2026-03-16T00:00:00.000Z',
                    state: { sport: 'Football' }
                },
                {
                    id: 'option-2',
                    name: 'Option 2',
                    color: '#37996e',
                    createdAt: '2026-03-16T00:05:00.000Z',
                    updatedAt: '2026-03-16T00:05:00.000Z',
                    state: { sport: 'Soccer' }
                }
            ]
        });
        const loadedProject = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: currentProjectState
        };
        const selectedProject = {
            ...loadedProject,
            updatedAt: '2026-03-16T00:10:00.000Z',
            state: {
                ...currentProjectState,
                sport: 'Soccer',
                activeOptionId: 'option-2',
                options: [
                    {
                        ...currentProjectState.options[0],
                        updatedAt: '2026-03-16T00:09:00.000Z',
                        state: { sport: 'Baseball' }
                    },
                    currentProjectState.options[1]
                ]
            }
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        const projectApi = {
            getProject: vi.fn().mockResolvedValue(loadedProject),
            updateProject: vi.fn().mockResolvedValue(selectedProject)
        };
        let liveProjectState = currentProjectState;
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            loadProject: vi.fn(),
            replaceLiveState: vi.fn(),
            setProjectMetadata: vi.fn(),
            setProjectStateDocument: vi.fn((projectStateDocument) => {
                liveProjectState = projectStateDocument;
            }),
            setProjectSaveBusy: vi.fn(),
            setProjectStatus: vi.fn(),
            setSession: vi.fn(),
            captureStateSnapshot: vi.fn(() => ({ sport: 'Baseball' })),
            getProjectMetadata: vi.fn(() => ({
                id: 'project-1',
                name: 'Arena Study'
            })),
            getProjectStateDocument: vi.fn(() => liveProjectState),
            getProjectSaveRequest: vi.fn((projectStateDocument) => ({
                name: 'Arena Study',
                state: projectStateDocument
            }))
        };
        let projectActions = /** @type {any} */ (null);
        const appFactory = vi.fn((options) => {
            projectActions = options.projectActions;
            return app;
        });

        await bootAppShell({
            document: createRouteDocument('configurator'),
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        if (!projectActions) {
            throw new Error('projectActions were not injected');
        }

        await projectActions.selectOption('option-2');

        expect(projectApi.updateProject).toHaveBeenCalledWith('project-1', expect.objectContaining({
            name: 'Arena Study',
            state: expect.objectContaining({
                activeOptionId: 'option-2',
                sport: 'Soccer',
                options: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'option-1',
                        state: expect.objectContaining({
                            sport: 'Baseball'
                        })
                    }),
                    expect.objectContaining({
                        id: 'option-2',
                        state: expect.objectContaining({
                            sport: 'Soccer'
                        })
                    })
                ])
            })
        }));
        expect(app.setProjectStateDocument).toHaveBeenCalledWith(selectedProject.state);
        expect(app.replaceLiveState).toHaveBeenCalledWith(expect.objectContaining({
            sport: 'Soccer',
            setup: expect.any(Object),
            bowl: expect.any(Object),
            occupancy: expect.any(Object),
            ui: expect.any(Object),
            tiers: expect.any(Array),
            bookmarks: expect.any(Array),
            _version: expect.any(String)
        }));
        expect(app.setProjectStatus).toHaveBeenCalledWith('Switching option...', 'pending');
        expect(app.setProjectStatus).toHaveBeenCalledWith('Switched to Option 2', 'success');
    });

    it('injects project actions that open projects in-place and replace the deleted current project', async () => {
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const history = {
            replaceState: vi.fn()
        };
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const initialProject = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: { sport: 'Football' }
        };
        const openedProject = {
            id: 'project-2',
            name: 'Soccer Study',
            createdAt: '2026-03-16T01:00:00.000Z',
            updatedAt: '2026-03-16T01:00:00.000Z',
            state: { sport: 'Soccer' }
        };
        const replacementProject = {
            id: 'project-3',
            name: 'Untitled Project',
            createdAt: '2026-03-16T02:00:00.000Z',
            updatedAt: '2026-03-16T02:00:00.000Z',
            state: { sport: 'Football' }
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        const projectApi = {
            getProject: vi.fn()
                .mockResolvedValueOnce(initialProject)
                .mockResolvedValueOnce(openedProject),
            deleteProject: vi.fn().mockResolvedValue(),
            createProject: vi.fn().mockResolvedValue(replacementProject)
        };
        let currentProjectId = 'project-1';
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            loadProject: vi.fn((project) => {
                currentProjectId = project.id;
            }),
            setProjectStatus: vi.fn(),
            setSession: vi.fn(),
            getProjectMetadata: vi.fn(() => ({
                id: currentProjectId,
                name: currentProjectId === 'project-2' ? 'Soccer Study' : 'Arena Study'
            }))
        };
        let projectActions = /** @type {any} */ (null);
        const appFactory = vi.fn((options) => {
            projectActions = options.projectActions;
            return app;
        });

        await bootAppShell({
            document: createRouteDocument('configurator'),
            history,
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        if (!projectActions) {
            throw new Error('projectActions were not injected');
        }

        await projectActions.openProject('project-2');
        await projectActions.deleteProject('project-2');

        expect(projectApi.getProject).toHaveBeenNthCalledWith(2, 'project-2');
        expect(app.loadProject).toHaveBeenCalledWith(openedProject);
        expect(app.loadProject).toHaveBeenCalledWith(replacementProject);
        expect(projectApi.deleteProject).toHaveBeenCalledWith('project-2');
        expect(projectApi.createProject).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Untitled Project',
            state: expect.objectContaining({
                _projectVersion: 'dashboard-cutover-v1',
                activeOptionId: 'option-1',
                sport: 'Ice Hockey'
            })
        }));
        expect(history.replaceState).toHaveBeenNthCalledWith(
            1,
            null,
            '',
            buildConfiguratorUrl('project-2', { devBackend: 'local' })
        );
        expect(history.replaceState).toHaveBeenNthCalledWith(
            2,
            null,
            '',
            buildConfiguratorUrl('project-3', { devBackend: 'local' })
        );
    });

    it('injects project actions that bulk delete via the existing single-delete project API', async () => {
        const location = createLocation(
            'http://localhost/pages/configurator/index.html?project=project-1&devBackend=local'
        );
        const history = {
            replaceState: vi.fn()
        };
        const session = {
            userId: 'pat@example.com',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II'
        };
        const initialProject = {
            id: 'project-1',
            name: 'Arena Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:00:00.000Z',
            state: { sport: 'Football' }
        };
        const authService = {
            getSession: vi.fn().mockResolvedValue(session),
            signInWithMicrosoft: vi.fn()
        };
        const projectApi = {
            getProject: vi.fn().mockResolvedValue(initialProject),
            deleteProject: vi.fn().mockResolvedValue(),
            createProject: vi.fn()
        };
        const app = {
            destroy: vi.fn(),
            init: vi.fn().mockResolvedValue(),
            setProjectStatus: vi.fn(),
            setSession: vi.fn(),
            getProjectMetadata: vi.fn(() => ({
                id: 'project-1',
                name: 'Arena Study'
            }))
        };
        let projectActions = /** @type {any} */ (null);
        const appFactory = vi.fn((options) => {
            projectActions = options.projectActions;
            return app;
        });

        await bootAppShell({
            document: createRouteDocument('configurator'),
            history,
            location,
            runtimeConfig: { devBackend: 'local' },
            authService,
            projectApi,
            appFactory
        });

        if (!projectActions) {
            throw new Error('projectActions were not injected');
        }

        await projectActions.deleteProjects(['project-2', 'project-3', 'project-2']);

        expect(projectActions.deleteProjects).toEqual(expect.any(Function));
        expect(projectApi.deleteProject).toHaveBeenNthCalledWith(1, 'project-2');
        expect(projectApi.deleteProject).toHaveBeenNthCalledWith(2, 'project-3');
        expect(projectApi.deleteProject).toHaveBeenCalledTimes(2);
        expect(projectApi.createProject).not.toHaveBeenCalled();
        expect(history.replaceState).not.toHaveBeenCalled();
        expect(app.setProjectStatus).toHaveBeenCalledWith('Deleting 2 projects...', 'pending');
        expect(app.setProjectStatus).toHaveBeenCalledWith('Deleted 2 projects', 'success');
    });
});
