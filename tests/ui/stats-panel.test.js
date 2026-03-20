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
        maxSeatsPerSectionRow: 14,
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
    const tierMetricsByIndex = input.tierMetricsByIndex instanceof Map ? input.tierMetricsByIndex : new Map();
    const totalOccupancyAllTiers = Number.isFinite(Number(input?.configurationSummary?.totalOccupancyAllTiers))
        ? Number(input.configurationSummary.totalOccupancyAllTiers)
        : Array.from(tierMetricsByIndex.values()).reduce((sum, metrics) => (
            sum + Math.max(0, Number(metrics?.capacity) || 0)
        ), 0);

    return buildStatsViewModel({
        ...input,
        configurationSummary: input.configurationSummary ?? {
            totalOccupancyAllTiers
        }
    });
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
    });

    test('renders the max seats per section-row metric instead of the average seats metric', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({ maxSeatsPerSectionRow: 19 })]])
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

        expect(statsEl.innerHTML).toContain('Max Seats/Row/Section');
        expect(statsEl.innerHTML).toContain('19');
        expect(statsEl.innerHTML).not.toContain('Avg. Seats/Row');
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

    test('renders accessibility totals and tier reporting from the shared stats dto', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                accessibility: {
                    wheelchairSpacesRequired: 4,
                    companionSeatsRequired: 4,
                    wheelchairZonesRequired: 2,
                    wheelchairAreaRequiredSqFt: 36,
                    companionAreaRequiredSqFt: 24,
                    totalAccessibilityAreaRequiredSqFt: 60,
                    adjustedOccupancy: 128
                }
            })]]),
            configurationSummary: {
                totalOccupancyAllTiers: 120,
                accessibility: {
                    totalWheelchairSpacesRequired: 4,
                    totalCompanionSeatsRequired: 4,
                    totalWheelchairZonesRequired: 2,
                    totalWheelchairAreaRequiredSqFt: 36,
                    totalCompanionAreaRequiredSqFt: 24,
                    totalAccessibilityAreaRequiredSqFt: 60,
                    totalAdjustedOccupancy: 128
                }
            }
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

        expect(statsEl.innerHTML).toContain('ACCESSIBILITY REPORTING');
        expect(statsEl.innerHTML).toContain('Wheelchair Spaces');
        expect(statsEl.innerHTML).toContain('Adjusted Occupancy');
        expect(statsEl.innerHTML).toContain('128');
        expect(statsEl.innerHTML).toContain('wheelchair locations still do not alter seating blocks or aisle widths');
    });
});
