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
        wheelchairSpacesAreaSqFt: 0,
        companionSpacesAreaSqFt: 0,
        totalAccessibilityAreaSqFt: 0,
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
                wheelchairSpacesAreaSqFt: 0,
                companionSpacesAreaSqFt: 0,
                totalAccessibilityAreaSqFt: 0,
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

    test('renders the new section metrics table with the shared sections icon', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                sectionDetails: [{
                    sectionNumber: 100,
                    occupancy: 44,
                    seatWidthIn: 20,
                    longestRowBySeatCount: { rowNumber: 2, seatCount: 24 },
                    shortestRowBySeatCount: { rowNumber: 1, seatCount: 20 },
                    longestRowByLength: { rowNumber: 2, seatingLengthFt: 40.5 },
                    shortestRowByLength: { rowNumber: 1, seatingLengthFt: 33.3 }
                }]
            })]])
        });
        const statsEl = { innerHTML: '' };
        const detailsEl = {
            innerHTML: '',
            querySelectorAll: vi.fn(() => [])
        };
        const sectionMetricsEl = {
            innerHTML: '',
            querySelectorAll: vi.fn(() => [])
        };
        const panel = new StatsPanel({
            statsEl: /** @type {any} */ (statsEl),
            detailsEl: /** @type {any} */ (detailsEl),
            sectionMetricsEl: /** @type {any} */ (sectionMetricsEl)
        });

        panel.update(viewModel);

        expect(detailsEl.innerHTML).not.toContain('SECTION METRICS');
        expect(sectionMetricsEl.innerHTML).toContain('SECTION METRICS');
        expect(sectionMetricsEl.innerHTML).toContain('results-data-table__title-icon');
        expect(sectionMetricsEl.innerHTML).toContain('icon-sections');
        expect(sectionMetricsEl.innerHTML).toContain('Longest Row / Seats');
        expect(sectionMetricsEl.innerHTML).toContain('<span>100</span>');
        expect(sectionMetricsEl.innerHTML).toContain('R2 / 24');
        expect(sectionMetricsEl.innerHTML).not.toContain('Nearest Row / Dist');
        expect(sectionMetricsEl.innerHTML).not.toContain('Farthest Row / Dist');
    });

    test('emits row and section hover targets for the rendered metrics tables', () => {
        const onHoverTargetChanged = vi.fn();
        const globalAny = /** @type {any} */ (globalThis);
        const OriginalHTMLElement = globalAny.HTMLElement;
        const FakeHTMLElement = /** @type {any} */ (class {});
        globalAny.HTMLElement = FakeHTMLElement;

        const createHoverRow = (dataset = {}) => {
            const row = /** @type {any} */ (new FakeHTMLElement());
            row.dataset = { ...dataset };
            row.closest = vi.fn(() => row);
            row.onmouseenter = null;
            row.onmouseleave = null;
            return row;
        };
        const createContainer = (rows = []) => {
            const container = /** @type {any} */ (new FakeHTMLElement());
            container.innerHTML = '';
            container.querySelectorAll = vi.fn((selector) => (
                selector === '[data-results-hover-type]' ? rows : []
            ));
            container.querySelector = vi.fn((selector) => rows.find((row) => {
                const matchesType = selector.includes(`[data-results-hover-type="${row.dataset.resultsHoverType}"]`);
                const matchesTier = selector.includes(`[data-results-hover-tier-index="${row.dataset.resultsHoverTierIndex}"]`);
                const matchesRow = !selector.includes('data-results-hover-row-index')
                    || selector.includes(`[data-results-hover-row-index="${row.dataset.resultsHoverRowIndex}"]`);
                const matchesSection = !selector.includes('data-results-hover-section-number')
                    || selector.includes(`[data-results-hover-section-number="${row.dataset.resultsHoverSectionNumber}"]`);
                return matchesType && matchesTier && matchesRow && matchesSection;
            }) || null);
            container.contains = vi.fn((candidate) => rows.includes(candidate));
            return container;
        };

        const detailRow = createHoverRow({
            resultsHoverType: 'row',
            resultsHoverTierIndex: '0',
            resultsHoverRowIndex: '1'
        });
        const sectionRow = createHoverRow({
            resultsHoverType: 'section',
            resultsHoverTierIndex: '0',
            resultsHoverSectionNumber: '100'
        });
        const viewModel = buildStatsDto({
            solvers: [createSolver({
                rows: [
                    createRow({ row_number: 1 }),
                    createRow({
                        row_number: 2,
                        x: 13,
                        z: 2,
                        computedLength: 42,
                        computedSeats: 22
                    })
                ]
            })],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                sectionDetails: [{
                    sectionNumber: 100,
                    occupancy: 44,
                    seatWidthIn: 20,
                    longestRowBySeatCount: { rowNumber: 2, seatCount: 24 },
                    shortestRowBySeatCount: { rowNumber: 1, seatCount: 20 },
                    longestRowByLength: { rowNumber: 2, seatingLengthFt: 40.5 },
                    shortestRowByLength: { rowNumber: 1, seatingLengthFt: 33.3 }
                }]
            })]])
        });
        const statsEl = { innerHTML: '' };
        const detailsEl = createContainer([detailRow]);
        const sectionMetricsEl = createContainer([sectionRow]);
        const panel = new StatsPanel({
            statsEl: /** @type {any} */ (statsEl),
            detailsEl: /** @type {any} */ (detailsEl),
            sectionMetricsEl: /** @type {any} */ (sectionMetricsEl),
            onHoverTargetChanged
        });

        try {
            panel.update(viewModel);

            detailRow.onmouseenter?.();
            detailRow.onmouseleave?.({ relatedTarget: null });
            sectionRow.onmouseenter?.();
            sectionRow.onmouseleave?.({ relatedTarget: null });

            expect(onHoverTargetChanged).toHaveBeenNthCalledWith(1, {
                type: 'row',
                tierIndex: 0,
                rowIndex: 1
            });
            expect(onHoverTargetChanged).toHaveBeenNthCalledWith(2, null);
            expect(onHoverTargetChanged).toHaveBeenNthCalledWith(3, {
                type: 'section',
                tierIndex: 0,
                sectionNumber: 100
            });
            expect(onHoverTargetChanged).toHaveBeenNthCalledWith(4, null);
        } finally {
            globalAny.HTMLElement = OriginalHTMLElement;
        }
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
                wheelchairSpacesAreaSqFt: 48,
                companionSpacesAreaSqFt: 36,
                totalAccessibilityAreaSqFt: 84,
                wheelchairLocationsRequired: 2
            })]]),
            configurationSummary: {
                totalOccupancyAllTiers: 120,
                reportedOccupancyAllTiers: 128,
                accessibility: {
                    baseSeatCount: 120,
                    wheelchairSpacesRequired: 4,
                    companionSeatsRequired: 4,
                    wheelchairSpacesAreaSqFt: 48,
                    companionSpacesAreaSqFt: 36,
                    totalAccessibilityAreaSqFt: 84,
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
        expect(accessibilityEl.innerHTML).toContain('Wheelchair Area');
        expect(accessibilityEl.innerHTML).toContain('Companion Area');
        expect(accessibilityEl.innerHTML).toContain('Total Area');
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
