import { ProfileSolver } from '../profile-solver.js?v=4';
import { SightlineAnalyzer, getCValueQuality } from '../sightline-calc.js';

export function renderStatsPanel({
    solvers = [],
    statsEl = null,
    detailsEl = null,
    focalPointFt = { x: 0, z: 0 },
    egressParams = {},
    bowlConfig = {},
    tierAisleLayouts = [],
    fieldRenderer = null,
    sportName = ''
} = {}) {
    if (!solvers.length || !solvers[0].rows || solvers[0].rows.length === 0) return;
    if (!statsEl) return;

    // Aggregate rows for STATISTICS (excluding first row of each tier)
    const rowsForStats = [];
    // Only include rows from Tiers that actually have rows
    for (const s of solvers) {
        if (s.rows && s.rows.length > 0) {
            // For statistics, we might want to include the first row?
            // Original logic excluded index 0. Let's keep that for now.
            if (s.rows.length > 1) rowsForStats.push(...s.rows.slice(1));
            else rowsForStats.push(s.rows[0]); // If only 1 row, use it?
        }
    }

    let stats = null;
    let dist = { Excellent: 0, Good: 0, Acceptable: 0, Poor: 0 };
    let totalRows = 0;
    let minC_Display = '0.00';
    let maxC_Display = '0.00';
    let avgC_Display = '0.00';

    // Only analyze if we have valid rows
    if (rowsForStats.length > 0) {
        const analyzer = new SightlineAnalyzer(
            rowsForStats,
            Number(focalPointFt?.x) || 0,
            Number(focalPointFt?.z) || 0
        );
        analyzer.analyze();
        stats = analyzer.getStatistics();

        if (stats) {
            dist = stats.qualityDistribution;
            totalRows = stats.totalRows;
            minC_Display = stats.minC.toFixed(2);
            maxC_Display = stats.maxC.toFixed(2);
            avgC_Display = stats.avgC.toFixed(2);
        }
    }

    let openTiers = [];
    if (detailsEl) {
        detailsEl.querySelectorAll('.results-details:not(.collapsed)').forEach(el => {
            const tc = Array.from(el.classList).find(c => c.startsWith('tier-section-'));
            if (tc) openTiers.push(tc);
        });
    }

    // Calculate percentages
    const pExc = totalRows > 0 ? (dist.Excellent / totalRows) * 100 : 0;
    const pGood = totalRows > 0 ? (dist.Good / totalRows) * 100 : 0;
    const pAcc = totalRows > 0 ? (dist.Acceptable / totalRows) * 100 : 0;
    const pPoor = totalRows > 0 ? (dist.Poor / totalRows) * 100 : 0;

    // Cumulative for gradient
    const c1 = pExc;
    const c2 = c1 + pGood;
    const c3 = c2 + pAcc;

    const gradient = `conic-gradient(
        #7aae1a 0% ${c1}%,
        #37996e ${c1}% ${c2}%,
        #de850a ${c2}% ${c3}%,
        #d1433d ${c3}% 100%
    )`;
    // Compute total rise/depth across all solvers
    let maxZ = 0;
    let minX = Infinity;
    let maxX = -Infinity;

    for (const s of solvers) {
        if (!s.rows || s.rows.length === 0) continue;
        const last = s.rows[s.rows.length - 1];
        const first = s.rows[0];
        maxZ = Math.max(maxZ, last.z);
        minX = Math.min(minX, first.x - s.treadDepthFt);
        maxX = Math.max(maxX, last.x);
    }
    const totalHeight = maxZ.toFixed(1);
    const totalDistVal = maxX > -Infinity ? maxX.toFixed(1) : '0.0';

    // --- Occupancy Logic ---
    // Base Offset Logic removed in favor of offsetCorrection
    const edgeSports = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];
    const isEdgeSport = edgeSports.includes(sportName);
    const safeWidth = Number.isFinite(bowlConfig.width) ? bowlConfig.width : 0;
    const offsetCorrection = isEdgeSport ? 0 : (safeWidth / 2);
    const tierLayoutByIndex = new Map((tierAisleLayouts || []).map(layout => [
        Math.max(0, Math.floor(Number(layout && layout.tierIndex) || 0)),
        layout
    ]));

    const reconcileTierMetricsForDisplay = (solver, loopIndex, metrics) => {
        if (!metrics) return metrics;
        const tierIdx = solver && solver.tierIndex !== undefined ? solver.tierIndex : loopIndex;
        const layout = tierLayoutByIndex.get(Math.max(0, Math.floor(Number(tierIdx) || 0)));
        const summary = layout && layout.sectionSummary;
        if (!summary) return metrics;

        const out = { ...metrics };
        const actualSections = Math.max(0, Math.floor(Number(summary.actualSections) || 0));
        const actualAisles = Math.max(0, Math.floor(Number(summary.actualAisles) || 0));
        const avgBackRowSeats = Number(summary.avgBackRowSeatsPerSection);
        const egressFactorVal = Number(egressParams && egressParams.egressFactor);
        const totalCapacity = Math.max(0, Number(metrics.capacity) || 0);
        const useClosedLoopReconcile = summary.allSectionPathsClosed === true;

        if (useClosedLoopReconcile && actualSections > 0) {
            out.numSections = actualSections;
            // Closed bowl paths produce one section per aisle strip in the plan layout.
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
    };

    let totalOcc = 0;
    let tierData = [];

    solvers.forEach((s, i) => {
        try {
            const baseMetrics = ProfileSolver.calculateTierMetrics(s, bowlConfig, fieldRenderer, egressParams, offsetCorrection);
            const metrics = reconcileTierMetricsForDisplay(s, i, baseMetrics);

            if (metrics) {
                totalOcc += metrics.capacity;
                const label = `Tier ${i + 1}`;
                const color = i === 0 ? 'var(--accent-blue)' : (i === 1 ? 'var(--accent-cyan)' : 'var(--accent-purple)');

                tierData.push({ label, capacity: metrics.capacity, color });
            }
        } catch (e) {
            console.error('Error in occupancy calc:', e);
        }
    });

    let occSegments = '';
    let occLegends = '';

    if (totalOcc > 0) {
        tierData.forEach(tier => {
            const pct = (tier.capacity / totalOcc) * 100;
            occSegments += `<div style="width:${pct}%; background:${tier.color}; height:100%;"></div>`;
            occLegends += `<div class="occ-legend-item"><span style="color:${tier.color}; font-size: 14px; margin-right: 4px;">&#9679;</span>${tier.label}: <strong>${tier.capacity.toLocaleString()}</strong></div>`;
        });
    }

    const occBreakdownHTML = `
        <div class="occupancy-bar-container">
            <div class="occupancy-stacked-bar">
                ${occSegments}
            </div>
            <div class="occupancy-legend-row">
                ${occLegends}
            </div>
        </div>
    `;

    // --- SVG Pie Chart Generation ---
    const chartData = [
        { label: 'Excellent', count: dist.Excellent, color: '#7aae1a' },
        { label: 'Good', count: dist.Good, color: '#37996e' },
        { label: 'Acceptable', count: dist.Acceptable, color: '#de850a' },
        { label: 'Poor', count: dist.Poor, color: '#d1433d' }
    ];

    let totalPoints = (dist.Excellent || 0) + (dist.Good || 0) + (dist.Acceptable || 0) + (dist.Poor || 0);
    let cumulativePercent = 0;
    let svgPaths = '';

    const fullSegment = chartData.find(s => totalPoints > 0 && (s.count / totalPoints) > 0.999);

    if (fullSegment) {
        svgPaths = `<circle cx="50" cy="50" r="41" fill="none" stroke="${fullSegment.color}" stroke-width="18" class="chart-segment">
                        <title>${fullSegment.label}: ${fullSegment.count} (100.0%)</title>
                     </circle>`;

    } else if (totalPoints > 0) {
        chartData.forEach(segment => {
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

    const pieChartSVG = `
        <div class="pie-chart-container">
            <svg viewBox="0 0 100 100" class="pie-chart-svg">
                ${svgPaths}
            </svg>
            <div class="chart-center-text">
                <div class="chart-center-value">${avgC_Display}</div>
                <div class="chart-center-label">Avg C</div>
            </div>
        </div>
        
        <div class="chart-legend">
            <div class="legend-item">
                <div class="legend-color" style="background:#7aae1a"></div>
                <div class="legend-text">
                    <span class="legend-label">Excellent</span>
                    <span class="legend-range">≥ 4.75"</span>
                </div>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background:#37996e"></div>
                <div class="legend-text">
                    <span class="legend-label">Good</span>
                    <span class="legend-range">3.5 - 4.71"</span>
                </div>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background:#de850a"></div>
                <div class="legend-text">
                    <span class="legend-label">Acceptable</span>
                    <span class="legend-range">2.4 - 3.5"</span>
                </div>
            </div>
            <div class="legend-item">
                <div class="legend-color" style="background:#d1433d"></div>
                <div class="legend-text">
                    <span class="legend-label">Poor</span>
                    <span class="legend-range">< 2.4"</span>
                </div>
            </div>
        </div>
    `;

    // Build per-tier row tables
    let rowTableHTML = '';
    const focalXForDetails = Number(focalPointFt?.x) || 0;
    const isMirroredSidesMode = String(bowlConfig && bowlConfig.type ? bowlConfig.type : '').toLowerCase() === 'sides';
    for (let t = 0; t < solvers.length; t++) {
        const s = solvers[t];
        if (!s.rows) continue;

        const tierIdx = s.tierIndex !== undefined ? s.tierIndex : t;
        const title = `Tier ${tierIdx + 1} Details`;
        // tier-section class for color consistency
        const tierClass = `tier-section-${tierIdx + 1}`;

        // Add 'results-details' class
        const isColl = openTiers.includes(tierClass) ? '' : 'collapsed';
        rowTableHTML += `<div class="collapsible ${isColl} ${tierClass} results-details">
            <div class="section-header">
                ${title}
            </div>
            <div class="section-body">
                <div class="row-table-header">
                    <span>Row</span><span>Riser</span><span>Elev</span><span>C-Value</span><span>Tread</span><span>Dist→Focal</span><span>Angle</span><span>Length</span><span>Seats</span>
                </div>`;

        rowTableHTML += s.rows.map((row, idx) => {
            const isFirst = idx === 0;
            let cValDisplay = 'N/A';
            let colorStyle = '';

            if (!isFirst) {
                const q = getCValueQuality(row.c_value);
                cValDisplay = `${row.c_value.toFixed(2)}"`;
                colorStyle = `style="color:${q.color}"`;
            } else {
                colorStyle = 'style="color:var(--text-muted)"';
            }

            const isTier1FirstRow = tierIdx === 0 && isFirst;
            const riserInches = isTier1FirstRow ? (row.z * 12) : (row.riser_height * 12);
            let riserStyle = '';
            if (!isTier1FirstRow && riserInches >= 22) {
                riserStyle = 'style="color: #ef4444; font-weight: bold;" title="Riser is 22 inches or greater!"';
            }
            const treadInches = (row.tread_depth || 0) * 12;
            const distToFocalFt = (row.x - row.tread_depth) - focalXForDetails;
            const sightlineDeg = row.sightline_angle || 0;
            const rowLengthDisplay = isMirroredSidesMode && Number.isFinite(row.computedLengthPerSide)
                ? `${(row.computedLength || 0).toFixed(0)}' (${(row.computedLengthPerSide || 0).toFixed(0)}'/side)`
                : `${(row.computedLength || 0).toFixed(0)}'`;
            const rowSeatsDisplay = isMirroredSidesMode && Number.isFinite(row.computedSeatsPerSide)
                ? `${(row.computedSeats || 0).toLocaleString()} (${(row.computedSeatsPerSide || 0).toLocaleString()}/side)`
                : `${(row.computedSeats || 0).toLocaleString()}`;

            return `<div class="row-table-row">
                <span>${row.row_number}</span>
                <span ${riserStyle}>${riserInches.toFixed(2)}"</span>
                <span>${row.z.toFixed(2)}'</span>
                <span ${colorStyle}>${cValDisplay}</span>
                <span>${treadInches.toFixed(2)}"</span>
                <span>${distToFocalFt.toFixed(2)}'</span>
                <span>${sightlineDeg.toFixed(2)}°</span>
                <span style="color:var(--text-secondary)">${rowLengthDisplay}</span>
                <span style="color:var(--text-secondary)">${rowSeatsDisplay}</span>
            </div>`;
        }).join('');

        rowTableHTML += '</div></div>';
    }

    statsEl.innerHTML = `
        <div class="results-summary-container">
        
            <div class="total-occupancy-label" style="text-align: center; margin-bottom: 4px; margin-top: 0;">C-VALUE ANALYSIS</div>
            <!-- 1. SVG Pie Chart -->
            <div class="visuals-col-chart">
                ${pieChartSVG}
            </div>
            
            <!-- 2. Occupancy -->
            <div class="occupancy-section">
                <div class="total-occupancy-label">TOTAL OCCUPANCY</div>
                <div class="total-occupancy">${totalOcc.toLocaleString()}</div>
                <div class="occupancy-breakdown">
                    ${occBreakdownHTML}
                </div>

                <div class="results-divider" style="margin: 24px 0;"></div>

                <!-- Egress / Linear Stats (New) -->
                <div class="total-occupancy-label" style="margin-bottom: 16px;">EGRESS ANALYSIS</div>
                <div class="egress-metrics-container">
                    ${(() => {
            let html = '';
            let originalEgressHtml = '';
            solvers.forEach((s, i) => {
                const baseMetrics = ProfileSolver.calculateTierMetrics(s, bowlConfig, fieldRenderer, egressParams, offsetCorrection);
                const metrics = reconcileTierMetricsForDisplay(s, i, baseMetrics);
                if (!metrics) return;

                const tierLabel = `TIER ${i + 1}`;

                const aislesIcon = '<svg class="tier-metric-icon icon-aisles" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 10,2 10,20 6,22"/><polygon points="14,2 18,4 18,22 14,20"/></svg>';
                const widthIcon = '<svg class="tier-metric-icon icon-width" viewBox="0 0 24 24" fill="currentColor"><path d="M8 8l-4 4 4 4v-3h8v3l4-4-4-4v3H8V8z M4 4v16h2V4H4z M18 4v16h2V4h-2z"/></svg>';
                const sectionsIcon = '<svg class="tier-metric-icon icon-sections" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6v16H4z M12 4h8v7h-8z M12 13h8v7h-8z" /></svg>';
                const seatsIcon = '<svg class="tier-metric-icon icon-seats" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4a2 2 0 012-2h6a2 2 0 012 2v10H7V4z"/><rect x="3" y="14" width="18" height="5" rx="2.5"/></svg>';
                const avgSeatsIcon = '<svg class="tier-metric-icon icon-avg" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M1 12h8v2H1z M9.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M8 12h8v2H8z M16.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M15 12h8v2h-8z"/></svg>';
                const loadIcon = '<svg class="tier-metric-icon icon-load" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg>';
                const totalLen = parseFloat(metrics.totalRowLength) || 0;
                const seatLen = parseFloat(metrics.totalSeatingLength) || 0;
                const aisleLen = parseFloat(metrics.totalAisleLength) || 0;
                const isMirroredSides = Math.max(1, Math.floor(Number(metrics.mirroredSideRuns) || 1)) > 1;
                const mirrorRuns = Math.max(1, Math.floor(Number(metrics.mirroredSideRuns) || 1));
                const displayAisles = isMirroredSides ? ((Math.max(0, Number(metrics.numAisles) || 0)) * mirrorRuns) : metrics.numAisles;
                const displaySections = isMirroredSides ? ((Math.max(0, Number(metrics.numSections) || 0)) * mirrorRuns) : metrics.numSections;
                const displayTotalLen = isMirroredSides ? (totalLen * mirrorRuns) : totalLen;
                const displaySeatLen = isMirroredSides ? (seatLen * mirrorRuns) : seatLen;
                const displayAisleLen = isMirroredSides ? (aisleLen * mirrorRuns) : aisleLen;
                const displaySeatsPerRow = isMirroredSides
                    ? Math.round((Number(metrics.seatsPerRow) || 0) * mirrorRuns)
                    : Math.round(Number(metrics.seatsPerRow) || 0);
                const perSideTag = '';
                const countsTag = isMirroredSides ? ' (both sides)' : '';
                const perSideMirrorNote = isMirroredSides ? ' Counts and linear quantities shown combined for both sides. Width/load checks remain per aisle.' : '';

                let warningHTML = '';
                if (metrics.blocksAddedForEgress > 0) {
                    const warnText = `Limit Forced: Clamped to Max Aisle (${metrics.maximumWidth}")`;
                    warningHTML = `<div class="tier-metrics-warning">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                        ${warnText}
                    </div>`;
                } else if (!metrics.converged) {
                    warningHTML = `<div class="tier-metrics-warning">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                         Warning: Layout did not converge.
                     </div>`;
                }

                html += `
                    <div class="tier-metrics-card tier-${i + 1}">
                        <div class="tier-metrics-header tier-${i + 1}">${tierLabel}${isMirroredSides ? ' • Both Sides' : ''}</div>
                        
                        <div class="tier-metrics-grid">
                            <div class="tier-metric-item">
                                <div class="tier-metric-label">Aisles${countsTag}</div>
                                <div class="tier-metric-content">
                                    ${aislesIcon}
                                    <div class="tier-metric-value">${displayAisles}</div>
                                </div>
                            </div>
                            <div class="tier-metric-item">
                                <div class="tier-metric-label">Required Width</div>
                                <div class="tier-metric-content">
                                    ${widthIcon}
                                    <div class="tier-metric-value">${metrics.capacityWidth}<span class="small-text">"</span></div>
                                </div>
                            </div>
                            <div class="tier-metric-item">
                                <div class="tier-metric-label">Sections${countsTag}</div>
                                <div class="tier-metric-content">
                                    ${sectionsIcon}
                                    <div class="tier-metric-value">${displaySections}</div>
                                </div>
                            </div>
                            <div class="tier-metric-item">
                                <div class="tier-metric-label">Seats/Section${perSideTag}</div>
                                <div class="tier-metric-content">
                                    ${seatsIcon}
                                    <div class="tier-metric-value">${metrics.occupantsPerSection}</div>
                                </div>
                            </div>
                            <div class="tier-metric-item">
                                <div class="tier-metric-label">Avg. Seats/Row${perSideTag}</div>
                                <div class="tier-metric-content">
                                    ${avgSeatsIcon}
                                    <div class="tier-metric-value">${metrics.seatsPerBlock}</div>
                                </div>
                            </div>
                            <div class="tier-metric-item">
                                <div class="tier-metric-label">Max Load/Aisle${perSideTag}</div>
                                <div class="tier-metric-content">
                                    ${loadIcon}
                                    <div class="tier-metric-value">${metrics.occupantsPerAisleLine} <span class="small-text">occ</span></div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="tier-capacity-check">
                            Aisle Egress Capacity (per aisle): ${metrics.occupantsPerAisleLine} occ &times; ${egressParams.egressFactor}"/occ = ${metrics.capacityWidth}" Req.${perSideMirrorNote}
                        </div>
                        ${warningHTML}
                    </div>`;

                originalEgressHtml += `
                    <div class="collapsible collapsed results-details" style="margin-top: 6px; margin-bottom: 12px;">
                        <div class="section-header" style="font-size: 10px; padding: 6px 8px; font-weight: 500;">
                            Original Egress Calc (${tierLabel}${isMirroredSides ? ' • Both Sides (Combined Counts)' : ''})
                        </div>
                        <div class="section-body" style="padding: 8px;">
                            <div class="egress-tier-row compact">
                                <div class="egress-row-top">
                                    <div class="tier-label-group">
                                        <span class="tier-label">${tierLabel}</span>
                                        <span class="tier-pct" style="color:var(--accent-green)">${totalLen > 0 ? ((seatLen / totalLen) * 100).toFixed(0) : 0}% Seating</span>
                                        <span class="tier-pct-sep">/</span>
                                        <span class="tier-pct" style="color:var(--accent-red)">${totalLen > 0 ? ((aisleLen / totalLen) * 100).toFixed(0) : 0}% Egress</span>
                                    </div>
                                </div>
                                <div class="egress-bar-compact">
                                    <div class="bar-segment-seat" style="width:${totalLen > 0 ? (seatLen / totalLen) * 100 : 0}%"></div>
                                    <div class="bar-segment-aisle" style="width:${totalLen > 0 ? (aisleLen / totalLen) * 100 : 0}%"></div>
                                </div>
                                <div class="egress-row-details">
                                    <strong>${displayAisles} Aisles${countsTag}</strong> (Width: ${metrics.aisleWidth}") &bull; ${displaySeatLen.toLocaleString()}' Linear Seating vs ${displayAisleLen.toLocaleString()}' Linear Aisles${isMirroredSides ? ' (combined both sides)' : ''}
                                    <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 4px; line-height: 1.4;">
                                        &#8627; Total Linear Seating${countsTag}: ${displayTotalLen.toLocaleString()}' (averaging ${displaySeatsPerRow} seats/row)<br/>
                                        &#8627; Sections${countsTag}: ${displaySections} (avg ${metrics.seatsPerBlock} seats/row, ${metrics.occupantsPerSection} seats/section)<br/>
                                        &#8627; Max Load/Aisle (per aisle): ${metrics.occupantsPerAisleLine} occ (50/50 section split)<br/>
                                        &#8627; Aisle Egress Capacity Check (per aisle): ${metrics.occupantsPerAisleLine} occ &times; ${egressParams.egressFactor}"/occ = ${metrics.capacityWidth}" required<br/>
                                        ${`&#8627; Aisle Sizing: Max of Min Allowed (${metrics.minimumWidth}") vs Required (${metrics.capacityWidth}") &rarr; <strong style="color:var(--text-primary)">Governing Width = ${metrics.governingWidth}"</strong>` +
                        (metrics.blocksAddedForEgress > 0 ? `<br/><span style="color:var(--accent-orange); display:inline-block; max-width:100%; word-wrap:break-word; padding-top:2px;">&#8627; <strong>Max Width Limit Forced:</strong> Clamped to Max Aisle Width (${metrics.maximumWidth}"). Automatically added ${metrics.blocksAddedForEgress} section(s) to maintain code compliance!</span>` : '')
                    }
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>`;
            });

            return html + `
                </div >
                
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
            ` + originalEgressHtml + `
            </div >`;
        })()}
        </div >
    `;

    if (detailsEl) {
        detailsEl.innerHTML = `
            <div class="results-summary-container">
                <div class="total-occupancy-label" style="text-align: center; margin-bottom: 16px; margin-top: 0;">TIER ROW DETAILS</div>
                ${rowTableHTML}
            </div>
        `;
    }

    void gradient;
    void minC_Display;
    void maxC_Display;
    void pPoor;
    void maxZ;
    void minX;
    void totalHeight;
    void totalDistVal;
    void stats;
}
