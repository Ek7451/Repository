import { describe, expect, test, vi } from 'vitest';

import { buildStatsViewModel } from '../../ui/stats-view-model.js';
import { StatsPanel } from '../../ui/stats-panel.js';

function createRow(overrides = {}) {
    return {
        row_number: 1,
        x: 10,
        z: 1,
        tread_depth: 2,
        riser_height: 1,
        c_value: 3.25,
        sightline_angle: 30,
        computedLength: 40,
        computedSeats: 20,
        computedLengthPerSide: 20,
        computedSeatsPerSide: 10,
        ...overrides
    };
}

function createSolver({ tierIndex = 0, rows = [createRow()] } = {}) {
    return {
        tierIndex,
        rows
    };
}

function createMetrics(overrides = {}) {
    return {
        capacity: 120,
        totalRowLength: '120',
        totalSeatingLength: '96',
        totalAisleLength: '24',
        numAisles: 3,
        numSections: 3,
        seatsPerRow: 40,
        seatsPerBlock: '12.0',
        occupantsPerSection: 40,
        occupantsPerAisleLine: 20,
        capacityWidth: '4.0',
        aisleWidth: '48.0',
        minimumWidth: '36.0',
        maximumWidth: '72.0',
        governingWidth: '48.0',
        mirroredSideRuns: 1,
        blocksAddedForEgress: 0,
        converged: true,
        ...overrides
    };
}

function buildStatsDto(input = {}) {
    return buildStatsViewModel(input);
}

describe('StatsPanel', () => {
    test('renders summary and details markup from an explicit view model DTO', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics()]])
        });
        const statsEl = { innerHTML: '' };
        const detailsEl = {
            innerHTML: '',
            querySelectorAll: vi.fn(() => [])
        };
        const panel = new StatsPanel({
            statsEl: /** @type {any} */ (statsEl),
            detailsEl: /** @type {any} */ (detailsEl)
        });

        panel.update(viewModel);

        expect(statsEl.innerHTML).toContain('TOTAL OCCUPANCY');
        expect(statsEl.innerHTML).toContain('EGRESS ANALYSIS');
        expect(detailsEl.innerHTML).toContain('Tier 1 Details');
        expect(detailsEl.innerHTML).toContain('row-table-row');
    });

    test('renders largest section occupancy wording from canonical metrics', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({ occupantsPerSection: 57 })]])
        });
        const statsEl = { innerHTML: '' };
        const detailsEl = {
            innerHTML: '',
            querySelectorAll: vi.fn(() => [])
        };
        const panel = new StatsPanel({
            statsEl: /** @type {any} */ (statsEl),
            detailsEl: /** @type {any} */ (detailsEl)
        });

        panel.update(viewModel);

        expect(statsEl.innerHTML).toContain('Largest Section');
        expect(statsEl.innerHTML).toContain('57');
        expect(statsEl.innerHTML).toContain('largest section 57 seats');
    });

    test('preserves expanded detail sections across rerenders', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics()]])
        });
        const statsEl = { innerHTML: '' };
        const detailsEl = {
            innerHTML: '',
            querySelectorAll: vi.fn(() => [
                { classList: ['results-details', 'tier-section-1'] }
            ])
        };
        const panel = new StatsPanel({
            statsEl: /** @type {any} */ (statsEl),
            detailsEl: /** @type {any} */ (detailsEl)
        });

        panel.update(viewModel);

        expect(detailsEl.querySelectorAll).toHaveBeenCalledWith('.results-details:not(.collapsed)');
        const tierSectionClasses = detailsEl.innerHTML.match(/class="([^"]*tier-section-1[^"]*)"/)?.[1] ?? '';
        expect(tierSectionClasses).toContain('results-details');
        expect(tierSectionClasses).not.toContain('collapsed');
    });
});
