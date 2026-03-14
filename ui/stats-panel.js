import { SightlineAnalyzer, getCValueQuality } from '../core/sightline-calc.js';

const QUALITY_LEGEND = [
    { label: 'Excellent', color: '#7aae1a', rangeLabel: '>= 4.75"' },
    { label: 'Good', color: '#37996e', rangeLabel: '3.5 - 4.71"' },
    { label: 'Acceptable', color: '#de850a', rangeLabel: '2.4 - 3.5"' },
    { label: 'Poor', color: '#d1433d', rangeLabel: '< 2.4"' }
];

const TIER_METRIC_ICONS = {
    aisles: '<svg class="tier-metric-icon icon-aisles" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 10,2 10,20 6,22"/><polygon points="14,2 18,4 18,22 14,20"/></svg>',
    width: '<svg class="tier-metric-icon icon-width" viewBox="0 0 24 24" fill="currentColor"><path d="M8 8l-4 4 4 4v-3h8v3l4-4-4-4v3H8V8z M4 4v16h2V4H4z M18 4v16h2V4h-2z"/></svg>',
    sections: '<svg class="tier-metric-icon icon-sections" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v16H4z M12 4h8v7h-8z M12 13h8v7h-8z" /></svg>',
    seats: '<svg class="tier-metric-icon icon-seats" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 012-2h6a2 2 0 012 2v10H7V4z"/><rect x="3" y="14" width="18" height="5" rx="2.5"/></svg>',
    avg: '<svg class="tier-metric-icon icon-avg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M1 12h8v2H1z M9.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M8 12h8v2H8z M16.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M15 12h8v2h-8z"/></svg>',
    load: '<svg class="tier-metric-icon icon-load" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>'
};

function normalizeQualityDistribution(summary = {}) {
    const distributionByLabel = new Map(
        Array.isArray(summary.qualityDistribution)
            ? summary.qualityDistribution.map((segment) => [segment.label, segment])
            : []
    );

    return QUALITY_LEGEND.map((legendItem) => {
        const segment = distributionByLabel.get(legendItem.label) || {};
        return {
            label: legendItem.label,
            color: legendItem.color,
            rangeLabel: legendItem.rangeLabel,
            count: Math.max(0, Math.round(Number(segment.count) || 0))
        };
    });
}

function buildPieChartMarkup(summary = {}) {
    const chartData = normalizeQualityDistribution(summary);
    const totalPoints = chartData.reduce((sum, segment) => sum + segment.count, 0);
    let cumulativePercent = 0;
    let svgPaths = '';

    const fullSegment = chartData.find((segment) => totalPoints > 0 && (segment.count / totalPoints) > 0.999);

    if (fullSegment) {
        svgPaths = `<circle cx="50" cy="50" r="41" fill="none" stroke="${fullSegment.color}" stroke-width="18" class="chart-segment">
                        <title>${fullSegment.label}: ${fullSegment.count} (100.0%)</title>
                     </circle>`;
    } else if (totalPoints > 0) {
        chartData.forEach((segment) => {
            if (segment.count === 0) return;
            const percent = segment.count / totalPoints;
            if (percent >= 0.999) return;

            const startPercent = cumulativePercent;
            const endPercent = cumulativePercent + percent;
            cumulativePercent += percent;

            const x1 = Math.cos(2 * Math.PI * startPercent);
            const y1 = Math.sin(2 * Math.PI * startPercent);
            const x2 = Math.cos(2 * Math.PI * endPercent);
            const y2 = Math.sin(2 * Math.PI * endPercent);

            const largeArcFlag = percent > 0.5 ? 1 : 0;
            const r = 50;
            const cx = 50;
            const cy = 50;
            const rIn = 32;

            const sx = cx + r * x1;
            const sy = cy + r * y1;
            const ex = cx + r * x2;
            const ey = cy + r * y2;
            const sxIn = cx + rIn * x1;
            const syIn = cy + rIn * y1;
            const exIn = cx + rIn * x2;
            const eyIn = cy + rIn * y2;

            const d = [
                `M ${sx} ${sy}`,
                `A ${r} ${r} 0 ${largeArcFlag} 1 ${ex} ${ey}`,
                `L ${exIn} ${eyIn}`,
                `A ${rIn} ${rIn} 0 ${largeArcFlag} 0 ${sxIn} ${syIn}`,
                'Z'
            ].join(' ');

            svgPaths += `<path d="${d}" fill="${segment.color}" class="chart-segment" stroke="white" stroke-width="1">
                            <title>${segment.label}: ${segment.count} (${(percent * 100).toFixed(1)}%)</title>
                         </path>`;
        });
    } else {
        svgPaths = '<circle cx="50" cy="50" r="41" stroke="#e2e8f0" stroke-width="18" fill="none" />';
    }

    const legendHtml = chartData.map((segment) => `
        <div class="legend-item">
            <div class="legend-color" style="background:${segment.color}"></div>
            <div class="legend-text">
                <span class="legend-label">${segment.label}</span>
                <span class="legend-range">${segment.rangeLabel}</span>
            </div>
        </div>
    `).join('');

    return `
        <div class="pie-chart-container">
            <svg viewBox="0 0 100 100" class="pie-chart-svg">
                ${svgPaths}
            </svg>
            <div class="chart-center-text">
                <div class="chart-center-value">${summary.averageCValueDisplay || '0.00'}</div>
                <div class="chart-center-label">Avg C</div>
            </div>
        </div>

        <div class="chart-legend">
            ${legendHtml}
        </div>
    `;
}

function buildOccupancyBreakdownMarkup(tiers = [], totalOccupancy = 0) {
    let occSegments = '';
    let occLegends = '';

    if (totalOccupancy > 0) {
        tiers.forEach((tier) => {
            const capacity = Math.max(0, Number(tier?.occupancy?.capacity) || 0);
            if (capacity === 0) return;
            const pct = (capacity / totalOccupancy) * 100;
            const color = tier?.occupancy?.color || 'var(--accent-blue)';
            const label = tier?.occupancy?.label || 'Tier';
            occSegments += `<div style="width:${pct}%; background:${color}; height:100%;"></div>`;
            occLegends += `<div class="occ-legend-item"><span style="color:${color}; font-size: 14px; margin-right: 4px;">&#9679;</span>${label}: <strong>${capacity.toLocaleString()}</strong></div>`;
        });
    }

    return `
        <div class="occupancy-bar-container">
            <div class="occupancy-stacked-bar">
                ${occSegments}
            </div>
            <div class="occupancy-legend-row">
                ${occLegends}
            </div>
        </div>
    `;
}

function buildEgressMarkup(tiers = []) {
    let cardsHtml = '';
    let originalEgressHtml = '';

    tiers.forEach((tier) => {
        const egress = tier?.egress;
        if (!egress) return;

        let warningHtml = '';
        if (egress.warningText) {
            warningHtml = `<div class="tier-metrics-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                ${egress.warningText}
            </div>`;
        }

        cardsHtml += `
            <div class="tier-metrics-card tier-${tier.tierNumber}">
                <div class="tier-metrics-header tier-${tier.tierNumber}">${egress.tierLabel}${egress.headerSuffix}</div>

                <div class="tier-metrics-grid">
                    <div class="tier-metric-item">
                        <div class="tier-metric-label">Aisles${egress.countsTag}</div>
                        <div class="tier-metric-content">
                            ${TIER_METRIC_ICONS.aisles}
                            <div class="tier-metric-value">${egress.displayAisles}</div>
                        </div>
                    </div>
                    <div class="tier-metric-item">
                        <div class="tier-metric-label">Required Width</div>
                        <div class="tier-metric-content">
                            ${TIER_METRIC_ICONS.width}
                            <div class="tier-metric-value">${egress.capacityWidth}<span class="small-text">"</span></div>
                        </div>
                    </div>
                    <div class="tier-metric-item">
                        <div class="tier-metric-label">Sections${egress.countsTag}</div>
                        <div class="tier-metric-content">
                            ${TIER_METRIC_ICONS.sections}
                            <div class="tier-metric-value">${egress.displaySections}</div>
                        </div>
                    </div>
                    <div class="tier-metric-item">
                        <div class="tier-metric-label">Seats/Section</div>
                        <div class="tier-metric-content">
                            ${TIER_METRIC_ICONS.seats}
                            <div class="tier-metric-value">${egress.occupantsPerSection}</div>
                        </div>
                    </div>
                    <div class="tier-metric-item">
                        <div class="tier-metric-label">Avg. Seats/Row</div>
                        <div class="tier-metric-content">
                            ${TIER_METRIC_ICONS.avg}
                            <div class="tier-metric-value">${egress.seatsPerBlock}</div>
                        </div>
                    </div>
                    <div class="tier-metric-item">
                        <div class="tier-metric-label">Max Load/Aisle</div>
                        <div class="tier-metric-content">
                            ${TIER_METRIC_ICONS.load}
                            <div class="tier-metric-value">${egress.occupantsPerAisleLine} <span class="small-text">occ</span></div>
                        </div>
                    </div>
                </div>

                <div class="tier-capacity-check">
                    Aisle Egress Capacity (per aisle): ${egress.occupantsPerAisleLine} occ &times; ${egress.egressFactor}"/occ = ${egress.capacityWidth}" Req.${egress.perSideMirrorNote}
                </div>
                ${warningHtml}
            </div>
        `;

        const limitForcedHtml = egress.blocksAddedForEgress > 0
            ? `<br/><span style="color:var(--accent-orange); display:inline-block; max-width:100%; word-wrap:break-word; padding-top:2px;">&#8627; <strong>Max Width Limit Forced:</strong> Clamped to Max Aisle Width (${egress.maximumWidth}"). Automatically added ${egress.blocksAddedForEgress} section(s) to maintain code compliance!</span>`
            : '';

        originalEgressHtml += `
            <div class="collapsible collapsed results-details" style="margin-top: 6px; margin-bottom: 12px;">
                <div class="section-header" style="font-size: 10px; padding: 6px 8px; font-weight: 500;">
                    Original Egress Calc (${egress.tierLabel}${egress.originalHeaderSuffix})
                </div>
                <div class="section-body" style="padding: 8px;">
                    <div class="egress-tier-row compact">
                        <div class="egress-row-top">
                            <div class="tier-label-group">
                                <span class="tier-label">${egress.tierLabel}</span>
                                <span class="tier-pct" style="color:var(--accent-green)">${egress.totalSeatingPercentage}% Seating</span>
                                <span class="tier-pct-sep">/</span>
                                <span class="tier-pct" style="color:var(--accent-red)">${egress.totalAislePercentage}% Egress</span>
                            </div>
                        </div>
                        <div class="egress-bar-compact">
                            <div class="bar-segment-seat" style="width:${egress.totalSeatingPercentage}%"></div>
                            <div class="bar-segment-aisle" style="width:${egress.totalAislePercentage}%"></div>
                        </div>
                        <div class="egress-row-details">
                            <strong>${egress.displayAisles} Aisles${egress.countsTag}</strong> (Width: ${egress.aisleWidth}") &bull; ${egress.displaySeatLen.toLocaleString()}' Linear Seating vs ${egress.displayAisleLen.toLocaleString()}' Linear Aisles${egress.linearQuantitiesTag}
                            <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 4px; line-height: 1.4;">
                                &#8627; Total Linear Seating${egress.countsTag}: ${egress.displayTotalLen.toLocaleString()}' (averaging ${egress.displaySeatsPerRow} seats/row)<br/>
                                &#8627; Sections${egress.countsTag}: ${egress.displaySections} (avg ${egress.seatsPerBlock} seats/row, ${egress.occupantsPerSection} seats/section)<br/>
                                &#8627; Max Load/Aisle (per aisle): ${egress.occupantsPerAisleLine} occ (50/50 section split)<br/>
                                &#8627; Aisle Egress Capacity Check (per aisle): ${egress.occupantsPerAisleLine} occ &times; ${egress.egressFactor}"/occ = ${egress.capacityWidth}" required<br/>
                                &#8627; Aisle Sizing: Max of Min Allowed (${egress.minimumWidth}") vs Required (${egress.capacityWidth}") &rarr; <strong style="color:var(--text-primary)">Governing Width = ${egress.governingWidth}"</strong>${limitForcedHtml}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    return `
        ${cardsHtml}
        <div class="collapsible collapsed results-details" style="margin-top: 12px; margin-bottom: 8px;">
            <div class="section-header" style="font-size: 10px; padding: 6px 8px; font-weight: 500; color: var(--text-muted);">
                * Code Scope Disclaimer
            </div>
            <div class="section-body" style="font-size: 0.75rem; color: var(--text-muted); padding: 8px; line-height: 1.3;">
                Early stage geometric simplification only. The following code egress requirements are EXCLUDED from current results and must be evaluated in later phases:<br />
                &bull; 30 ft rules and dead end row access conditions<br />
                &bull; Vomitory, concourse, door bank, exit stair, discharge capacity and merging flows<br />
                &bull; Exit loss checks and exit separation<br />
                &bull; Accessibility and wheelchair locations affecting seating blocks and aisle widths<br />
                &bull; Handrail and guard encroachment rules
            </div>
        </div>
        ${originalEgressHtml}
    `;
}

function reconcileTierMetricsForDisplay(solver, loopIndex, metrics, tierLayoutByIndex, egressParams) {
    if (!metrics) return metrics;
    const tierIdx = solver && solver.tierIndex !== undefined ? solver.tierIndex : loopIndex;
    const layout = tierLayoutByIndex instanceof Map
        ? tierLayoutByIndex.get(Math.max(0, Math.floor(Number(tierIdx) || 0)))
        : null;
    const summary = layout?.sectionSummary;
    if (!summary) return metrics;

    const out = { ...metrics };
    const actualSections = Math.max(0, Math.floor(Number(summary.actualSections) || 0));
    const actualAisles = Math.max(0, Math.floor(Number(summary.actualAisles) || 0));
    const avgBackRowSeats = Number(summary.avgBackRowSeatsPerSection);
    const egressFactorVal = Number(egressParams?.egressFactor);
    const totalCapacity = Math.max(0, Number(metrics.capacity) || 0);

    if (summary.allSectionPathsClosed === true && actualSections > 0) {
        out.numSections = actualSections;
        out.numAisles = actualAisles > 0 ? actualAisles : actualSections;

        if (Number.isFinite(avgBackRowSeats)) {
            out.seatsPerBlock = avgBackRowSeats.toFixed(1);
        }

        const avgOccupantsPerSection = totalCapacity / actualSections;
        out.occupantsPerSection = Math.round(avgOccupantsPerSection);
        const aisleLoad = actualSections <= 1 ? (avgOccupantsPerSection * 0.5) : avgOccupantsPerSection;
        out.occupantsPerAisleLine = Math.round(aisleLoad);

        if (Number.isFinite(egressFactorVal)) {
            out.capacityWidth = (aisleLoad * egressFactorVal).toFixed(1);
        }
    }

    return out;
}

function buildTierStatsViewModel({
    solver,
    loopIndex,
    focalPointFt,
    egressParams,
    tierMetricsByIndex,
    tierLayoutByIndex,
    isMirroredSidesMode
}) {
    const tierIndex = Number.isInteger(Number(solver?.tierIndex)) ? Number(solver.tierIndex) : loopIndex;
    const tierNumber = tierIndex + 1;
    const baseMetrics = tierMetricsByIndex instanceof Map
        ? (tierMetricsByIndex.get(tierIndex) || null)
        : null;
    const metrics = reconcileTierMetricsForDisplay(
        solver,
        loopIndex,
        baseMetrics,
        tierLayoutByIndex,
        egressParams
    );
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
    tierMetricsByIndex = new Map(),
    tierAisleLayouts = []
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

    const tierLayoutByIndex = new Map((tierAisleLayouts || []).map((layout) => [
        Math.max(0, Math.floor(Number(layout?.tierIndex) || 0)),
        layout
    ]));
    const safeBowlConfig = /** @type {any} */ (bowlConfig);
    const isMirroredSidesMode = String(safeBowlConfig?.type || '').toLowerCase() === 'sides';

    const tiers = activeSolvers.map((solver, loopIndex) => buildTierStatsViewModel({
        solver,
        loopIndex,
        focalPointFt,
        egressParams,
        tierMetricsByIndex,
        tierLayoutByIndex,
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

export class StatsPanel {
    constructor({ statsEl = null, detailsEl = null } = {}) {
        this.statsEl = statsEl;
        this.detailsEl = detailsEl;
        this.openDetailSections = new Set();
    }

    update(viewModel = null) {
        if (!this.statsEl) return;
        if (!viewModel || !Array.isArray(viewModel.tiers) || viewModel.tiers.length === 0) return;

        this._captureOpenDetailSections();

        this.statsEl.innerHTML = this._buildStatsMarkup(viewModel);

        if (this.detailsEl) {
            this.detailsEl.innerHTML = this._buildDetailsMarkup(viewModel);
        }
    }

    _captureOpenDetailSections() {
        this.openDetailSections.clear();
        if (!this.detailsEl) return;

        this.detailsEl.querySelectorAll('.results-details:not(.collapsed)').forEach((el) => {
            const tierClass = Array.from(el.classList).find((className) => className.startsWith('tier-section-'));
            if (tierClass) {
                this.openDetailSections.add(tierClass);
            }
        });
    }

    _buildStatsMarkup(viewModel) {
        const summary = viewModel.summary || {};
        const totalOccupancy = Math.max(0, Number(summary.totalOccupancy) || 0);

        return `
            <div class="results-summary-container">
                <div class="total-occupancy-label" style="text-align: center; margin-bottom: 4px; margin-top: 0;">C-VALUE ANALYSIS</div>
                <div class="visuals-col-chart">
                    ${buildPieChartMarkup(summary)}
                </div>

                <div class="occupancy-section">
                    <div class="total-occupancy-label">TOTAL OCCUPANCY</div>
                    <div class="total-occupancy">${totalOccupancy.toLocaleString()}</div>
                    <div class="occupancy-breakdown">
                        ${buildOccupancyBreakdownMarkup(viewModel.tiers, totalOccupancy)}
                    </div>

                    <div class="results-divider" style="margin: 24px 0;"></div>

                    <div class="total-occupancy-label" style="margin-bottom: 16px;">EGRESS ANALYSIS</div>
                    <div class="egress-metrics-container">
                        ${buildEgressMarkup(viewModel.tiers)}
                    </div>
                </div>
            </div>
        `;
    }

    _buildDetailsMarkup(viewModel) {
        const rowTableHtml = viewModel.tiers.map((tier) => {
            const isCollapsed = this.openDetailSections.has(tier.sectionClass) ? '' : 'collapsed';
            const rowsHtml = (tier.rows || []).map((row) => {
                const riserAttrs = row.riserWarning
                    ? 'style="color: #ef4444; font-weight: bold;" title="Riser is 22 inches or greater!"'
                    : '';

                return `
                    <div class="row-table-row">
                        <span>${row.rowNumber}</span>
                        <span ${riserAttrs}>${row.riserDisplay}</span>
                        <span>${row.elevationDisplay}</span>
                        <span style="color:${row.cValueColor}">${row.cValueDisplay}</span>
                        <span>${row.treadDisplay}</span>
                        <span>${row.distToFocalDisplay}</span>
                        <span>${row.angleDisplay}</span>
                        <span style="color:var(--text-secondary)">${row.rowLengthDisplay}</span>
                        <span style="color:var(--text-secondary)">${row.rowSeatsDisplay}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="collapsible ${isCollapsed} ${tier.sectionClass} results-details">
                    <div class="section-header">
                        ${tier.title}
                    </div>
                    <div class="section-body">
                        <div class="row-table-header">
                            <span>Row</span><span>Riser</span><span>Elev</span><span>C-Value</span><span>Tread</span><span>Dist-&gt;Focal</span><span>Angle</span><span>Length</span><span>Seats</span>
                        </div>
                        ${rowsHtml}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="results-summary-container">
                <div class="total-occupancy-label" style="text-align: center; margin-bottom: 16px; margin-top: 0;">TIER ROW DETAILS</div>
                ${rowTableHtml}
            </div>
        `;
    }
}
