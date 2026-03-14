import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
});
