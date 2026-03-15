import { describe, expect, it } from 'vitest';

import {
    buildProjectChromeSnapshot,
    buildDuplicateProjectName,
    cloneSessionDto,
    deriveProjectNameFromSport,
    normalizeProjectStatus
} from '../../state/project.js';

describe('project state helpers', () => {
    it('derives a study name from the active sport', () => {
        expect(deriveProjectNameFromSport('Basketball')).toBe('Basketball Study');
        expect(deriveProjectNameFromSport('  Soccer  ')).toBe('Soccer Study');
    });

    it('falls back to Seating when sport is empty', () => {
        expect(deriveProjectNameFromSport('')).toBe('Seating Study');
        expect(deriveProjectNameFromSport('   ')).toBe('Seating Study');
        expect(deriveProjectNameFromSport(null)).toBe('Seating Study');
    });

    it('normalizes project status message and tone', () => {
        expect(normalizeProjectStatus('', '')).toEqual({
            message: 'Project persistence ready',
            tone: 'default'
        });
        expect(normalizeProjectStatus('  Saved project  ', '  success  ')).toEqual({
            message: 'Saved project',
            tone: 'success'
        });
    });

    it('builds a readable duplicate project name', () => {
        expect(buildDuplicateProjectName('Lower Bowl Study')).toBe('Lower Bowl Study Copy');
        expect(buildDuplicateProjectName('   ')).toBe('Untitled Seating Study Copy');
    });

    it('clones optional session profile fields without retaining the original reference', () => {
        const session = {
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II',
            photoUrl: 'https://example.com/avatar.png'
        };

        const clone = cloneSessionDto(session);

        expect(clone).toEqual(session);
        expect(clone).not.toBe(session);
    });

    it('preserves optional session profile fields in project chrome snapshots', () => {
        const chrome = buildProjectChromeSnapshot({
            name: 'Arena Study',
            projectMetadata: {
                id: 'project-1',
                name: 'Arena Study',
                createdAt: '2026-03-15T00:00:00.000Z',
                updatedAt: '2026-03-15T01:00:00.000Z'
            },
            session: {
                userId: 'user-1',
                displayName: 'Pat Example',
                email: 'pat@example.com',
                jobTitle: 'Design Technology Specialist II',
                photoUrl: 'https://example.com/avatar.png'
            }
        });

        expect(chrome.session).toEqual({
            userId: 'user-1',
            displayName: 'Pat Example',
            email: 'pat@example.com',
            jobTitle: 'Design Technology Specialist II',
            photoUrl: 'https://example.com/avatar.png'
        });
    });
});
