import { describe, expect, it } from 'vitest';

import {
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
});
