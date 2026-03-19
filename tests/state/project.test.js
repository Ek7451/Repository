import { describe, expect, it } from 'vitest';

import {
    buildDuplicateProjectName,
    buildProjectChromeSnapshot,
    buildUntitledProjectCreateRequest,
    cloneSessionDto,
    createDefaultProjectStateDocument,
    createProjectOption,
    deleteProjectOption,
    deriveProjectNameFromSport,
    duplicateProjectOption,
    getActiveProjectOption,
    normalizeProjectEnvelope,
    normalizeProjectStatus,
    selectProjectOption,
    stageActiveProjectOptionState
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

    it('builds an untitled bootstrap project request as a one-option project document', () => {
        const request = buildUntitledProjectCreateRequest();

        expect(request.name).toBe('Untitled Project');
        expect(request.state).toMatchObject({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Ice Hockey',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    color: '#7aae1a',
                    state: {
                        sport: 'Ice Hockey'
                    }
                }
            ]
        });
        expect(request.state.options[0].createdAt).toBeTruthy();
        expect(request.state.options[0].updatedAt).toBeTruthy();
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

    it('normalizes legacy raw app-state projects into one-option project documents', () => {
        const envelope = normalizeProjectEnvelope({
            id: 'project-1',
            name: 'Legacy Study',
            createdAt: '2026-03-16T00:00:00.000Z',
            updatedAt: '2026-03-16T00:10:00.000Z',
            state: {
                sport: 'Soccer',
                ui: {
                    activeViewTab: 'field'
                }
            }
        });

        expect(envelope.state).toMatchObject({
            _projectVersion: 'dashboard-cutover-v1',
            sport: 'Soccer',
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1',
                    state: {
                        sport: 'Soccer',
                        ui: {
                            activeViewTab: 'field'
                        }
                    }
                }
            ]
        });
        expect(envelope.state.options[0].createdAt).toBe('2026-03-16T00:00:00.000Z');
        expect(envelope.state.options[0].updatedAt).toBe('2026-03-16T00:10:00.000Z');
    });

    it('creates a new empty option from the default app-state snapshot and makes it active', () => {
        const nextProjectState = createProjectOption(
            createDefaultProjectStateDocument({
                createdAt: '2026-03-16T00:00:00.000Z',
                updatedAt: '2026-03-16T00:00:00.000Z'
            }),
            {
                timestamp: '2026-03-16T00:10:00.000Z'
            }
        );

        expect(nextProjectState.activeOptionId).toBe('option-2');
        expect(nextProjectState.options).toHaveLength(2);
        expect(getActiveProjectOption(nextProjectState)).toMatchObject({
            id: 'option-2',
            name: 'Option 2',
            state: {
                sport: 'Ice Hockey',
                ui: {
                    activeViewTab: 'profile'
                }
            }
        });
    });

    it('stages the active option snapshot before switching the active option', () => {
        const startingProjectState = createProjectOption(
            createDefaultProjectStateDocument({
                state: { sport: 'Football' },
                createdAt: '2026-03-16T00:00:00.000Z',
                updatedAt: '2026-03-16T00:00:00.000Z'
            }),
            {
                state: { sport: 'Basketball' },
                timestamp: '2026-03-16T00:05:00.000Z'
            }
        );

        const stagedProjectState = stageActiveProjectOptionState(
            startingProjectState,
            { sport: 'Baseball' },
            { timestamp: '2026-03-16T00:06:00.000Z' }
        );
        const switchedProjectState = selectProjectOption(stagedProjectState, 'option-1');

        expect(stagedProjectState.options[1]).toMatchObject({
            id: 'option-2',
            state: {
                sport: 'Baseball'
            },
            updatedAt: '2026-03-16T00:06:00.000Z'
        });
        expect(switchedProjectState.activeOptionId).toBe('option-1');
        expect(switchedProjectState.sport).toBe('Football');
        expect(switchedProjectState.options[1].state.sport).toBe('Baseball');
    });

    it('duplicates options, makes the duplicate active, and forbids deleting the last option', () => {
        const duplicatedProjectState = duplicateProjectOption(
            createDefaultProjectStateDocument({
                state: { sport: 'Football' },
                createdAt: '2026-03-16T00:00:00.000Z',
                updatedAt: '2026-03-16T00:00:00.000Z'
            }),
            'option-1',
            { timestamp: '2026-03-16T00:05:00.000Z' }
        );

        expect(duplicatedProjectState.activeOptionId).toBe('option-2');
        expect(getActiveProjectOption(duplicatedProjectState)).toMatchObject({
            id: 'option-2',
            name: 'Option 1 Copy',
            state: {
                sport: 'Football'
            }
        });

        const deletedProjectState = deleteProjectOption(duplicatedProjectState, 'option-2');
        expect(deletedProjectState).toMatchObject({
            activeOptionId: 'option-1',
            options: [
                {
                    id: 'option-1',
                    name: 'Option 1'
                }
            ]
        });

        expect(() => deleteProjectOption(createDefaultProjectStateDocument(), 'option-1')).toThrow(
            'Cannot delete the last remaining option.'
        );
    });
});
