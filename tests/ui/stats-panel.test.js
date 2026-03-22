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
    const metrics = {
        capacity: 120,
        reportedOccupancy: undefined,
        accessibilityOccupancyContribution: 0,
        wheelchairSpacesRequired: 0,
        companionSeatsRequired: 0,
        wheelchairLocationsRequired: 0,
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
        legalMaxOccupantsPerAisle: 360,
        mirroredSideRuns: 1,
        blocksAddedForEgress: 0,
        converged: true,
        failureReason: null,
        invalidTopologyPaths: [],
        invalidTopologyRowIndices: [],
        seatCapCompliant: true,
        egressCapCompliant: true,
        renderedWidthCompliant: true,
        ...overrides
    };

    if (!Object.prototype.hasOwnProperty.call(overrides, 'reportedOccupancy')) {
        metrics.reportedOccupancy = metrics.capacity;
    }
    if (!Object.prototype.hasOwnProperty.call(overrides, 'accessibilityOccupancyContribution')) {
        metrics.accessibilityOccupancyContribution = Math.max(
            0,
            Number(metrics.reportedOccupancy) - Number(metrics.capacity)
        );
    }

    return metrics;
}

function buildStatsDto(input = {}) {
    const tierMetricsByIndex = input.tierMetricsByIndex instanceof Map ? input.tierMetricsByIndex : new Map();
    const totalOccupancyAllTiers = Number.isFinite(Number(input?.configurationSummary?.totalOccupancyAllTiers))
        ? Number(input.configurationSummary.totalOccupancyAllTiers)
        : Array.from(tierMetricsByIndex.values()).reduce((sum, metrics) => (
            sum + Math.max(0, Number(metrics?.capacity) || 0)
        ), 0);
    const reportedOccupancyAllTiers = Number.isFinite(Number(input?.configurationSummary?.reportedOccupancyAllTiers))
        ? Number(input.configurationSummary.reportedOccupancyAllTiers)
        : Array.from(tierMetricsByIndex.values()).reduce((sum, metrics) => (
            sum + Math.max(
                0,
                Number(metrics?.reportedOccupancy ?? metrics?.capacity) || 0
            )
        ), 0);

    return buildStatsViewModel({
        ...input,
        configurationSummary: input.configurationSummary ?? {
            totalOccupancyAllTiers,
            reportedOccupancyAllTiers,
            accessibility: {
                baseSeatCount: totalOccupancyAllTiers,
                wheelchairSpacesRequired: 0,
                companionSeatsRequired: 0,
                wheelchairLocationsRequired: 0,
                accessibilityOccupancyContribution: Math.max(0, reportedOccupancyAllTiers - totalOccupancyAllTiers),
                reportedOccupancy: reportedOccupancyAllTiers
            }
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

    test('renders dedicated accessibility markup from the shared view model', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                capacity: 120,
                reportedOccupancy: 128,
                accessibilityOccupancyContribution: 8,
                wheelchairSpacesRequired: 4,
                companionSeatsRequired: 4,
                wheelchairLocationsRequired: 2
            })]]),
            configurationSummary: {
                totalOccupancyAllTiers: 120,
                reportedOccupancyAllTiers: 128,
                accessibility: {
                    baseSeatCount: 120,
                    wheelchairSpacesRequired: 4,
                    companionSeatsRequired: 4,
                    wheelchairLocationsRequired: 2,
                    accessibilityOccupancyContribution: 8,
                    reportedOccupancy: 128
                }
            }
        });
        const statsEl = { innerHTML: '' };
        const accessibilityEl = { innerHTML: '' };
        const detailsEl = {
            innerHTML: '',
            querySelectorAll: vi.fn(() => [])
        };
        const panel = new StatsPanel({
            statsEl: /** @type {any} */ (statsEl),
            accessibilityEl: /** @type {any} */ (accessibilityEl),
            detailsEl: /** @type {any} */ (detailsEl)
        });

        panel.update(viewModel);

        expect(accessibilityEl.innerHTML).toContain('ACCESSIBILITY');
        expect(accessibilityEl.innerHTML).toContain('Wheelchair Spaces');
        expect(accessibilityEl.innerHTML).toContain('Companion Seats');
        expect(accessibilityEl.innerHTML).toContain('Space Locations');
        expect(accessibilityEl.innerHTML).toContain('Reported Occupancy: 128 total');
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

    test('renders the detailed non-convergence warning text in the banner', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                converged: false,
                failureReason: 'egress_cap_stagnated',
                egressCapCompliant: false,
                occupantsPerAisleLine: 402,
                legalMaxOccupantsPerAisle: 360,
                maximumWidth: '72.0'
            })]])
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

        expect(statsEl.innerHTML).toContain('Layout is infeasible: max aisle load is 402 occ, above the 360 occ limit at 72.0" max aisle width.');
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
