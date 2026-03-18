import { SightlineAnalyzer, getCValueQuality } from '../core/sightline-calc.js';

function getStatsTierIndex(solver, fallbackIndex = 0) {
    const tierIndex = Number(solver?.tierIndex);
    return Number.isInteger(tierIndex) ? tierIndex : fallbackIndex;
}

function buildTierStatsViewModel({
    solver,
    loopIndex,
    focalPointFt,
    egressParams,
    tierMetricsByIndex,
    isMirroredSidesMode
}) {
    const tierIndex = getStatsTierIndex(solver, loopIndex);
    const tierNumber = tierIndex + 1;
    const baseMetrics = tierMetricsByIndex instanceof Map
        ? (tierMetricsByIndex.get(tierIndex) || null)
        : null;
    const metrics = baseMetrics;
    const accentColor = tierIndex === 0
        ? 'var(--accent-blue)'
        : (tierIndex === 1 ? 'var(--accent-cyan)' : 'var(--accent-purple)');

    const rows = (solver?.rows || []).map((row, rowIndex) => {
        const isFirstRow = rowIndex === 0;
        const tierOneFirstRow = tierIndex === 0 && isFirstRow;
        const rowZ = Number.isFinite(Number(row?.z)) ? Number(row.z) : 0;
        const riserHeight = Number.isFinite(Number(row?.riser_height)) ? Number(row.riser_height) : 0;
        const treadDepth = Number.isFinite(Number(row?.tread_depth)) ? Number(row.tread_depth) : 0;
        const rowX = Number.isFinite(Number(row?.x)) ? Number(row.x) : 0;
        const cValue = Number.isFinite(Number(row?.c_value)) ? Number(row.c_value) : null;
        const sightlineAngle = Number.isFinite(Number(row?.sightline_angle)) ? Number(row.sightline_angle) : 0;
        const totalLength = Number.isFinite(Number(row?.computedLength)) ? Number(row.computedLength) : 0;
        const totalSeats = Number.isFinite(Number(row?.computedSeats)) ? Number(row.computedSeats) : 0;
        const lengthPerSide = Number.isFinite(Number(row?.computedLengthPerSide))
            ? Number(row.computedLengthPerSide)
            : null;
        const seatsPerSide = Number.isFinite(Number(row?.computedSeatsPerSide))
            ? Number(row.computedSeatsPerSide)
            : null;
        const cValueQuality = !isFirstRow && cValue !== null ? getCValueQuality(cValue) : null;
        const riserInches = tierOneFirstRow ? (rowZ * 12) : (riserHeight * 12);

        return {
            rowNumber: Number.isFinite(Number(row?.row_number)) ? Number(row.row_number) : (rowIndex + 1),
            riserDisplay: `${riserInches.toFixed(2)}"`,
            riserWarning: !tierOneFirstRow && riserInches >= 22,
            elevationDisplay: `${rowZ.toFixed(2)}'`,
            cValueDisplay: !isFirstRow && cValue !== null ? `${cValue.toFixed(2)}"` : 'N/A',
            cValueColor: isFirstRow ? 'var(--text-muted)' : (cValueQuality?.color || 'var(--text-primary)'),
            treadDisplay: `${(treadDepth * 12).toFixed(2)}"`,
            distToFocalDisplay: `${((rowX - treadDepth) - (Number(focalPointFt?.x) || 0)).toFixed(2)}'`,
            angleDisplay: `${sightlineAngle.toFixed(2)}&deg;`,
            rowLengthDisplay: isMirroredSidesMode && lengthPerSide !== null
                ? `${totalLength.toFixed(0)}' (${lengthPerSide.toFixed(0)}'/side)`
                : `${totalLength.toFixed(0)}'`,
            rowSeatsDisplay: isMirroredSidesMode && seatsPerSide !== null
                ? `${totalSeats.toLocaleString()} (${seatsPerSide.toLocaleString()}/side)`
                : `${totalSeats.toLocaleString()}`
        };
    });

    let egress = null;
    if (metrics) {
        const totalLen = parseFloat(metrics.totalRowLength) || 0;
        const seatLen = parseFloat(metrics.totalSeatingLength) || 0;
        const aisleLen = parseFloat(metrics.totalAisleLength) || 0;
        const mirrorRuns = Math.max(1, Math.floor(Number(metrics.mirroredSideRuns) || 1));
        const isMirroredSides = mirrorRuns > 1;
        const displayAisles = isMirroredSides
            ? (Math.max(0, Number(metrics.numAisles) || 0) * mirrorRuns)
            : Math.max(0, Number(metrics.numAisles) || 0);
        const displaySections = isMirroredSides
            ? (Math.max(0, Number(metrics.numSections) || 0) * mirrorRuns)
            : Math.max(0, Number(metrics.numSections) || 0);
        const displayTotalLen = isMirroredSides ? (totalLen * mirrorRuns) : totalLen;
        const displaySeatLen = isMirroredSides ? (seatLen * mirrorRuns) : seatLen;
        const displayAisleLen = isMirroredSides ? (aisleLen * mirrorRuns) : aisleLen;
        const displaySeatsPerRow = isMirroredSides
            ? Math.round((Number(metrics.seatsPerRow) || 0) * mirrorRuns)
            : Math.round(Number(metrics.seatsPerRow) || 0);
        const blocksAddedForEgress = Math.max(0, Number(metrics.blocksAddedForEgress) || 0);

        egress = {
            tierLabel: `TIER ${tierNumber}`,
            headerSuffix: isMirroredSides ? ' &bull; Both Sides' : '',
            originalHeaderSuffix: isMirroredSides ? ' &bull; Both Sides (Combined Counts)' : '',
            countsTag: isMirroredSides ? ' (both sides)' : '',
            linearQuantitiesTag: isMirroredSides ? ' (combined both sides)' : '',
            perSideMirrorNote: isMirroredSides
                ? ' Counts and linear quantities shown combined for both sides. Width/load checks remain per aisle.'
                : '',
            displayAisles,
            displaySections,
            displayTotalLen,
            displaySeatLen,
            displayAisleLen,
            displaySeatsPerRow,
            totalSeatingPercentage: totalLen > 0 ? ((seatLen / totalLen) * 100).toFixed(0) : '0',
            totalAislePercentage: totalLen > 0 ? ((aisleLen / totalLen) * 100).toFixed(0) : '0',
            capacityWidth: metrics.capacityWidth,
            occupantsPerSection: metrics.occupantsPerSection,
            seatsPerBlock: metrics.seatsPerBlock,
            occupantsPerAisleLine: metrics.occupantsPerAisleLine,
            aisleWidth: metrics.aisleWidth,
            minimumWidth: metrics.minimumWidth,
            maximumWidth: metrics.maximumWidth,
            governingWidth: metrics.governingWidth,
            blocksAddedForEgress,
            egressFactor: egressParams.egressFactor,
            warningText: blocksAddedForEgress > 0
                ? `Limit Forced: Clamped to Max Aisle (${metrics.maximumWidth}")`
                : (metrics.converged === false ? 'Warning: Layout did not converge.' : '')
        };
    }

    return {
        tierIndex,
        tierNumber,
        title: `Tier ${tierNumber} Details`,
        sectionClass: `tier-section-${tierNumber}`,
        occupancy: {
            label: `Tier ${tierNumber}`,
            color: accentColor,
            capacity: Math.max(0, Number(metrics?.capacity) || 0)
        },
        egress,
        rows
    };
}

export function buildStatsViewModel({
    solvers = [],
    focalPointFt = { x: 0, z: 0 },
    bowlConfig = {},
    egressParams = {},
    tierMetricsByIndex = new Map()
} = {}) {
    const activeSolvers = (solvers || []).filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
    if (!activeSolvers.length) return null;

    const rowsForStats = [];
    activeSolvers.forEach((solver) => {
        if (!solver.rows || solver.rows.length === 0) return;
        if (solver.rows.length > 1) {
            rowsForStats.push(...solver.rows.slice(1));
            return;
        }
        rowsForStats.push(solver.rows[0]);
    });

    let qualityDistribution = { Excellent: 0, Good: 0, Acceptable: 0, Poor: 0 };
    let totalRows = 0;
    let averageCValueDisplay = '0.00';

    if (rowsForStats.length > 0) {
        const analyzer = new SightlineAnalyzer(
            rowsForStats,
            Number(focalPointFt?.x) || 0,
            Number(focalPointFt?.z) || 0
        );
        analyzer.analyze();
        const stats = analyzer.getStatistics();

        if (stats) {
            qualityDistribution = stats.qualityDistribution || qualityDistribution;
            totalRows = Math.max(0, Number(stats.totalRows) || 0);
            averageCValueDisplay = Number.isFinite(stats.avgC) ? stats.avgC.toFixed(2) : '0.00';
        }
    }

    const safeBowlConfig = /** @type {any} */ (bowlConfig);
    const isMirroredSidesMode = String(safeBowlConfig?.type || '').toLowerCase() === 'sides';

    const tiers = activeSolvers.map((solver, loopIndex) => buildTierStatsViewModel({
        solver,
        loopIndex,
        focalPointFt,
        egressParams,
        tierMetricsByIndex,
        isMirroredSidesMode
    }));
    const totalOccupancy = tiers.reduce((sum, tier) => sum + Math.max(0, Number(tier?.occupancy?.capacity) || 0), 0);

    return {
        summary: {
            totalRows,
            totalOccupancy,
            averageCValueDisplay,
            qualityDistribution: [
                { label: 'Excellent', count: Math.max(0, Number(qualityDistribution.Excellent) || 0) },
                { label: 'Good', count: Math.max(0, Number(qualityDistribution.Good) || 0) },
                { label: 'Acceptable', count: Math.max(0, Number(qualityDistribution.Acceptable) || 0) },
                { label: 'Poor', count: Math.max(0, Number(qualityDistribution.Poor) || 0) }
            ]
        },
        tiers
    };
}
