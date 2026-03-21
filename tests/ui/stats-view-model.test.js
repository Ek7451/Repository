import { describe, expect, test } from 'vitest';

import { buildStatsViewModel } from '../../ui/stats-view-model.js';

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

describe('buildStatsViewModel', () => {
    test('builds a single-tier summary from explicit solver and layout inputs', () => {
        const solver = createSolver({
            rows: [
                createRow({ row_number: 1, c_value: null }),
                createRow({ row_number: 2, x: 12, z: 2, c_value: 3.25, computedLength: 42, computedSeats: 22 })
            ]
        });

        const viewModel = buildStatsDto({
            solvers: [solver],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics()]])
        });

        expect(viewModel.summary).toMatchObject({
            totalRows: 1,
            totalOccupancy: 120,
            averageCValueDisplay: '3.25'
        });
        expect(viewModel.tiers[0].rows[1]).toMatchObject({
            rowNumber: 2,
            cValueDisplay: '3.25"',
            rowLengthDisplay: "42'",
            rowSeatsDisplay: '22'
        });
        expect(viewModel.tiers[0].egress).toMatchObject({
            displaySections: 3,
            displayAisles: 3,
            seatsPerBlock: '12.0',
            maxSeatsPerSectionRow: 14
        });
    });

    test('aggregates occupancy and tier detail across multiple tiers', () => {
        const tier1 = createSolver({ tierIndex: 0, rows: [createRow({ c_value: 3.1 })] });
        const tier2 = createSolver({ tierIndex: 1, rows: [createRow({ row_number: 1, x: 18, z: 5, c_value: 4.1 })] });

        const viewModel = buildStatsDto({
            solvers: [tier1, tier2],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([
                [0, createMetrics({ capacity: 120 })],
                [1, createMetrics({ capacity: 80 })]
            ])
        });

        expect(viewModel.summary.totalOccupancy).toBe(200);
        expect(viewModel.tiers).toHaveLength(2);
        expect(viewModel.tiers[1]).toMatchObject({
            tierNumber: 2,
            occupancy: { capacity: 80 }
        });
    });

    test('preserves mirrored-sides combined and per-side displays', () => {
        const solver = createSolver({
            rows: [
                createRow({
                    computedLength: 120,
                    computedSeats: 48,
                    computedLengthPerSide: 60,
                    computedSeatsPerSide: 24
                })
            ]
        });

        const viewModel = buildStatsDto({
            solvers: [solver],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Sides' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[
                0,
                createMetrics({
                    mirroredSideRuns: 2,
                    numAisles: 2,
                    numSections: 2,
                    totalRowLength: '60',
                    totalSeatingLength: '48',
                    totalAisleLength: '12',
                    seatsPerRow: 24,
                    capacity: 96
                })
            ]])
        });

        expect(viewModel.tiers[0].rows[0]).toMatchObject({
            rowLengthDisplay: "120' (60'/side)",
            rowSeatsDisplay: '48 (24/side)'
        });
        expect(viewModel.tiers[0].egress).toMatchObject({
            headerSuffix: ' &bull; Both Sides',
            displayAisles: 4,
            displaySections: 4
        });
    });

    test('leaves base egress metrics in place when tier layout data is missing', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({ numAisles: 4, numSections: 5 })]])
        });

        expect(viewModel.tiers[0].egress).toMatchObject({
            displayAisles: 4,
            displaySections: 5
        });
    });

    test('surfaces forced-width and stability-only warning states together', () => {
        const forcedWidthViewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2, seatsBetweenAisles: 20 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                blocksAddedForEgress: 2,
                converged: false
            })]])
        });

        expect(forcedWidthViewModel.tiers[0].egress.warningText).toContain('Limit Forced');
        expect(forcedWidthViewModel.tiers[0].egress.warningText).toContain('did not fully stabilize');
    });

    test('reports seat-cap infeasibility in plain English', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2, seatsBetweenAisles: 30 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                converged: false,
                failureReason: 'seat_cap_stagnated',
                seatCapCompliant: false,
                maxSeatsPerSectionRow: 33
            })]])
        });

        expect(viewModel.tiers[0].egress.warningText).toContain('Layout is infeasible: max seats per row section is 33');
        expect(viewModel.tiers[0].egress.warningText).toContain('30-seat limit');
    });

    test('reports egress-cap infeasibility in plain English', () => {
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

        expect(viewModel.tiers[0].egress.warningText).toContain('Layout is infeasible: max aisle load is 402 occ');
        expect(viewModel.tiers[0].egress.warningText).toContain('360 occ limit');
        expect(viewModel.tiers[0].egress.warningText).toContain('72.0" max aisle width');
    });

    test('reports topology and measurement geometry diagnostics', () => {
        const topologyViewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                converged: false,
                failureReason: 'invalid_topology',
                invalidTopologyRowIndices: [0, 2],
                invalidTopologyPaths: [1]
            })]])
        });
        const measurementViewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                converged: false,
                failureReason: 'invalid_measurement'
            })]])
        });

        expect(topologyViewModel.tiers[0].egress.warningText).toContain('Layout could not be resolved against the current tier geometry.');
        expect(topologyViewModel.tiers[0].egress.warningText).toContain('Affected rows 1, 3; paths 2.');
        expect(measurementViewModel.tiers[0].egress.warningText).toContain('Layout could not be measured reliably against the current tier geometry.');
    });

    test('uses a neutral stability warning when non-convergence remains compliant', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                converged: false,
                failureReason: 'grouped_open_stagnated',
                seatCapCompliant: true,
                egressCapCompliant: true,
                renderedWidthCompliant: true
            })]])
        });

        expect(viewModel.tiers[0].egress.warningText).toContain('Layout did not fully stabilize');
        expect(viewModel.tiers[0].egress.warningText).not.toContain('Layout is infeasible');
    });

    test('keeps estimated egress values separate from final realized metrics', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver()],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([[0, createMetrics({
                numAisles: 2,
                numSections: 2,
                occupantsPerSection: 60,
                occupantsPerAisleLine: 30,
                capacityWidth: '6.0',
                aisleWidth: '48.0',
                renderedAisleWidth: '42.0',
                egressEstimate: createMetrics({
                    numAisles: 4,
                    numSections: 4,
                    occupantsPerSection: 30,
                    occupantsPerAisleLine: 15,
                    capacityWidth: '3.0'
                })
            })]])
        });

        expect(viewModel.tiers[0].egress).toMatchObject({
            displayAisles: 2,
            displaySections: 2,
            occupantsPerSection: 60,
            occupantsPerAisleLine: 30,
            renderedAisleWidth: '42.0',
            estimate: expect.objectContaining({
                displayAisles: 4,
                displaySections: 4,
                occupantsPerSection: 30,
                occupantsPerAisleLine: 15
            })
        });
    });

    test('uses reconciled tier capacity for total occupancy when provided', () => {
        const viewModel = buildStatsDto({
            solvers: [createSolver({ tierIndex: 0 }), createSolver({ tierIndex: 1 })],
            focalPointFt: { x: 0, z: 0 },
            bowlConfig: { type: 'Full' },
            egressParams: { egressFactor: 0.2 },
            tierMetricsByIndex: new Map([
                [0, createMetrics({ capacity: 265 })],
                [1, createMetrics({ capacity: 135 })]
            ])
        });

        expect(viewModel.summary.totalOccupancy).toBe(400);
    });
});
