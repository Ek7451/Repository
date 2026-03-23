import { SightlineAnalyzer, getCValueQuality } from '../core/sightline-calc.js';

function getStatsTierIndex(solver, fallbackIndex = 0) {
    const tierIndex = Number(solver?.tierIndex);
    return Number.isInteger(tierIndex) ? tierIndex : fallbackIndex;
}

function buildEgressDisplayData({
    metrics,
    tierNumber,
    egressFactor,
    isMirroredSidesMode
}) {
    if (!metrics) return null;

    const totalLen = parseFloat(metrics.totalRowLength) || 0;
    const seatLen = parseFloat(metrics.totalSeatingLength) || 0;
    const aisleLen = parseFloat(metrics.totalAisleLength) || 0;
    const mirrorRuns = Math.max(1, Math.floor(Number(metrics.mirroredSideRuns) || 1));
    const isMirroredSides = isMirroredSidesMode || mirrorRuns > 1;
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

    return {
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
        maxSeatsPerSectionRow: Math.max(0, Math.round(Number(metrics.maxSeatsPerSectionRow) || 0)),
        occupantsPerAisleLine: metrics.occupantsPerAisleLine,
        aisleWidth: metrics.aisleWidth,
        minimumWidth: metrics.minimumWidth,
        maximumWidth: metrics.maximumWidth,
        governingWidth: metrics.governingWidth,
        blocksAddedForEgress: Math.max(0, Number(metrics.blocksAddedForEgress) || 0),
        egressFactor
    };
}

function formatDiagnosticIndexSuffix({ invalidTopologyRowIndices, invalidTopologyPaths }) {
    const detailParts = [];
    const rowIndexes = Array.isArray(invalidTopologyRowIndices)
        ? invalidTopologyRowIndices
            .filter((value) => Number.isInteger(value) && value >= 0)
            .slice(0, 3)
            .map((value) => value + 1)
        : [];
    const pathIndexes = Array.isArray(invalidTopologyPaths)
        ? invalidTopologyPaths
            .filter((value) => Number.isInteger(value) && value >= 0)
            .slice(0, 3)
            .map((value) => value + 1)
        : [];

    if (rowIndexes.length > 0) {
        detailParts.push(`rows ${rowIndexes.join(', ')}`);
    }
    if (pathIndexes.length > 0) {
        detailParts.push(`paths ${pathIndexes.join(', ')}`);
    }

    return detailParts.length > 0 ? ` Affected ${detailParts.join('; ')}.` : '';
}

function buildSeatCapInfeasibilityWarning(metrics, egressParams = {}) {
    const actualSeats = Math.max(0, Number(metrics?.maxSeatsPerSectionRow) || 0);
    const seatLimit = Number(egressParams?.seatsBetweenAisles);

    if (Number.isFinite(seatLimit) && seatLimit > 0) {
        return `Layout is infeasible: max seats per row section is ${actualSeats}, above the ${Math.round(seatLimit)}-seat limit.`;
    }

    return 'Layout is infeasible: section seat count still exceeds the configured seat limit.';
}

function buildEgressCapInfeasibilityWarning(metrics) {
    const actualLoad = Math.max(0, Number(metrics?.occupantsPerAisleLine) || 0);
    const legalMaxLoad = Math.max(0, Number(metrics?.legalMaxOccupantsPerAisle) || 0);
    const maxAisleWidth = metrics?.maximumWidth ?? metrics?.governingWidth ?? metrics?.renderedAisleWidth;

    if (legalMaxLoad > 0 && maxAisleWidth) {
        return `Layout is infeasible: max aisle load is ${actualLoad} occ, above the ${legalMaxLoad} occ limit at ${maxAisleWidth}" max aisle width.`;
    }

    return 'Layout is infeasible: aisle load still exceeds the legal capacity.';
}

function buildRenderedWidthWarning(metrics) {
    const renderedWidth = metrics?.renderedAisleWidth ?? metrics?.aisleWidth ?? '0.0';
    const requiredWidth = metrics?.governingWidth ?? metrics?.capacityWidth ?? '0.0';
    return `Layout is infeasible: rendered aisle width is ${renderedWidth}", below the ${requiredWidth}" requirement.`;
}

function buildStabilityWarning() {
    return 'Layout did not fully stabilize, but the final aisle widths were widened conservatively.';
}

function formatSectionRowMetric(entry, valueKey, formatter = (value) => String(value)) {
    const rowNumber = Math.max(1, Math.round(Number(entry?.rowNumber) || 0));
    const value = Number(entry?.[valueKey]);
    if (!(rowNumber > 0) || !Number.isFinite(value)) return '--';
    return `R${rowNumber} / ${formatter(value)}`;
}

function formatSectionNumberDisplay(sectionNumber) {
    const numericValue = Math.round(Number(sectionNumber) || 0);
    return numericValue > 0 ? String(numericValue) : '--';
}

function buildSectionDisplayData(metrics) {
    if (!Array.isArray(metrics?.sectionDetails)) return [];

    return metrics.sectionDetails
        .slice()
        .sort((a, b) => (Math.round(Number(a?.sectionNumber) || 0) - Math.round(Number(b?.sectionNumber) || 0)))
        .map((section) => ({
            sectionNumber: Math.max(0, Math.round(Number(section?.sectionNumber) || 0)),
            sectionNumberDisplay: formatSectionNumberDisplay(section?.sectionNumber),
            totalSeatsDisplay: Math.max(0, Math.round(Number(section?.occupancy) || 0)).toLocaleString(),
            seatSizeDisplay: `${Math.max(0, Number(section?.seatWidthIn) || 0).toFixed(1)}"`,
            longestRowSeatsDisplay: formatSectionRowMetric(section?.longestRowBySeatCount, 'seatCount', (value) => Math.round(value).toLocaleString()),
            shortestRowSeatsDisplay: formatSectionRowMetric(section?.shortestRowBySeatCount, 'seatCount', (value) => Math.round(value).toLocaleString()),
            longestRowLengthDisplay: formatSectionRowMetric(section?.longestRowByLength, 'seatingLengthFt', (value) => `${value.toFixed(1)}'`),
            shortestRowLengthDisplay: formatSectionRowMetric(section?.shortestRowByLength, 'seatingLengthFt', (value) => `${value.toFixed(1)}'`)
        }));
}

function buildNonConvergenceWarning(metrics, egressParams = {}) {
    if (!metrics || metrics.converged !== false) return '';

    const failureReason = typeof metrics.failureReason === 'string' ? metrics.failureReason : '';
    const seatCapFailed = metrics.seatCapCompliant === false;
    const egressCapFailed = metrics.egressCapCompliant === false;
    const renderedWidthFailed = metrics.renderedWidthCompliant === false;

    switch (failureReason) {
    case 'seat_cap_stagnated':
        return buildSeatCapInfeasibilityWarning(metrics, egressParams);
    case 'egress_cap_stagnated':
        return buildEgressCapInfeasibilityWarning(metrics);
    case 'invalid_topology':
        return `Layout could not be resolved against the current tier geometry.${formatDiagnosticIndexSuffix(metrics)}`;
    case 'invalid_measurement':
        return 'Layout could not be measured reliably against the current tier geometry.';
    case 'grouped_open_stagnated':
        if (seatCapFailed) return buildSeatCapInfeasibilityWarning(metrics, egressParams);
        if (egressCapFailed) return buildEgressCapInfeasibilityWarning(metrics);
        if (renderedWidthFailed) return buildRenderedWidthWarning(metrics);
        return buildStabilityWarning();
    default:
        if (seatCapFailed) return buildSeatCapInfeasibilityWarning(metrics, egressParams);
        if (egressCapFailed) return buildEgressCapInfeasibilityWarning(metrics);
        if (renderedWidthFailed) return buildRenderedWidthWarning(metrics);
        return buildStabilityWarning();
    }
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
    const finalMetrics = tierMetricsByIndex instanceof Map
        ? (tierMetricsByIndex.get(tierIndex) || null)
        : null;
    const metrics = finalMetrics;
    const estimateMetrics = finalMetrics?.egressEstimate && finalMetrics.egressEstimate !== finalMetrics
        ? finalMetrics.egressEstimate
        : null;
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
            rowIndex,
            rowNumber: Number.isFinite(Number(row?.row_number)) ? Number(row.row_number) : (rowIndex + 1),
            riserDisplay: `${riserInches.toFixed(2)}"`,
            riserWarning: !tierOneFirstRow && riserInches >= 22,
            elevationDisplay: `${rowZ.toFixed(2)}'`,
            cValueDisplay: !isFirstRow && cValue !== null ? `${cValue.toFixed(2)}"` : 'N/A',
            cValueColor: isFirstRow ? 'var(--text-muted)' : (cValueQuality?.color || 'var(--text-primary)'),
            treadDisplay: `${(treadDepth * 12).toFixed(2)}"`,
            distToFocalDisplay: `${((rowX - treadDepth) - (Number(focalPointFt?.x) || 0)).toFixed(2)}'`,
            angleDisplay: `${sightlineAngle.toFixed(2)}\u00B0`,
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
        const finalEgress = buildEgressDisplayData({
            metrics,
            tierNumber,
            egressFactor: egressParams.egressFactor,
            isMirroredSidesMode
        });
        const estimateEgress = estimateMetrics
            ? buildEgressDisplayData({
                metrics: estimateMetrics,
                tierNumber,
                egressFactor: egressParams.egressFactor,
                isMirroredSidesMode
            })
            : null;
        const warningMessages = [];
        if (finalEgress.blocksAddedForEgress > 0) {
            warningMessages.push(`Limit Forced: Clamped to Max Aisle (${metrics.maximumWidth}")`);
        }
        const nonConvergenceWarning = buildNonConvergenceWarning(metrics, egressParams);
        if (nonConvergenceWarning) {
            warningMessages.push(nonConvergenceWarning);
        }
        if (metrics.renderedWidthCompliant === false && nonConvergenceWarning !== buildRenderedWidthWarning(metrics)) {
            warningMessages.push(buildRenderedWidthWarning(metrics));
        }

        egress = {
            ...finalEgress,
            estimate: estimateEgress,
            renderedAisleWidth: metrics.renderedAisleWidth ?? metrics.aisleWidth,
            seatCapCompliant: metrics.seatCapCompliant,
            egressCapCompliant: metrics.egressCapCompliant,
            renderedWidthCompliant: metrics.renderedWidthCompliant,
            warningText: warningMessages.join(' ')
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
            capacity: Math.max(0, Number(metrics?.capacity) || 0),
            standardSeats: Math.max(0, Number(metrics?.capacity) || 0),
            accessibilityContribution: Math.max(0, Number(metrics?.accessibilityOccupancyContribution) || 0),
            reportedOccupancy: Math.max(
                0,
                Number(metrics?.reportedOccupancy) || Math.max(0, Number(metrics?.capacity) || 0)
            )
        },
        accessibility: {
            tierLabel: `TIER ${tierNumber}`,
            wheelchairSpacesRequired: Math.max(0, Number(metrics?.wheelchairSpacesRequired) || 0),
            companionSeatsRequired: Math.max(0, Number(metrics?.companionSeatsRequired) || 0),
            wheelchairSpacesAreaSqFt: Math.max(0, Number(metrics?.wheelchairSpacesAreaSqFt) || 0),
            companionSpacesAreaSqFt: Math.max(0, Number(metrics?.companionSpacesAreaSqFt) || 0),
            totalAccessibilityAreaSqFt: Math.max(0, Number(metrics?.totalAccessibilityAreaSqFt) || 0),
            wheelchairLocationsRequired: Math.max(0, Number(metrics?.wheelchairLocationsRequired) || 0),
            accessibilityOccupancyContribution: Math.max(
                0,
                Number(metrics?.accessibilityOccupancyContribution) || 0
            ),
            reportedOccupancy: Math.max(
                0,
                Number(metrics?.reportedOccupancy) || Math.max(0, Number(metrics?.capacity) || 0)
            ),
            baseSeatCount: Math.max(0, Number(metrics?.capacity) || 0)
        },
        egress,
        sections: buildSectionDisplayData(metrics),
        rows
    };
}

export function buildStatsViewModel({
    solvers = [],
    focalPointFt = { x: 0, z: 0 },
    bowlConfig = {},
    egressParams = {},
    tierMetricsByIndex = new Map(),
    configurationSummary = null
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
    const accessibilitySummary = configurationSummary?.accessibility && typeof configurationSummary.accessibility === 'object'
        ? configurationSummary.accessibility
        : {};
    const totalOccupancy = Math.max(
        0,
        Number(
            configurationSummary?.reportedOccupancyAllTiers
            ?? configurationSummary?.totalOccupancyAllTiers
        ) || 0
    );

    return {
        summary: {
            totalRows,
            totalOccupancy,
            accessibility: {
                baseSeatCount: Math.max(
                    0,
                    Number(
                        accessibilitySummary?.baseSeatCount
                        ?? configurationSummary?.totalOccupancyAllTiers
                    ) || 0
                ),
                wheelchairSpacesRequired: Math.max(
                    0,
                    Number(accessibilitySummary?.wheelchairSpacesRequired) || 0
                ),
                companionSeatsRequired: Math.max(
                    0,
                    Number(accessibilitySummary?.companionSeatsRequired) || 0
                ),
                wheelchairSpacesAreaSqFt: Math.max(
                    0,
                    Number(accessibilitySummary?.wheelchairSpacesAreaSqFt) || 0
                ),
                companionSpacesAreaSqFt: Math.max(
                    0,
                    Number(accessibilitySummary?.companionSpacesAreaSqFt) || 0
                ),
                totalAccessibilityAreaSqFt: Math.max(
                    0,
                    Number(accessibilitySummary?.totalAccessibilityAreaSqFt) || 0
                ),
                wheelchairLocationsRequired: Math.max(
                    0,
                    Number(accessibilitySummary?.wheelchairLocationsRequired) || 0
                ),
                accessibilityOccupancyContribution: Math.max(
                    0,
                    Number(accessibilitySummary?.accessibilityOccupancyContribution) || 0
                ),
                reportedOccupancy: totalOccupancy
            },
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
