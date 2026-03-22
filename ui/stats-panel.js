function getDefaultElement(id) {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') {
        return null;
    }
    return document.getElementById(id);
}

function getTemplateElement(id) {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') {
        return null;
    }
    const template = document.getElementById(id);
    if (typeof HTMLTemplateElement === 'undefined') {
        return null;
    }
    return template instanceof HTMLTemplateElement ? template : null;
}

function cloneTemplateElement(id) {
    const element = getTemplateElement(id)?.content.firstElementChild?.cloneNode(true);
    if (typeof HTMLElement === 'undefined') {
        return null;
    }
    return element instanceof HTMLElement ? element : null;
}

function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => {
        element.setAttribute(key, String(value));
    });
    return element;
}

function applyStyleVars(element, styleVars = {}) {
    if (!element) return;
    Object.entries(styleVars).forEach(([name, value]) => {
        if (value === undefined || value === null || value === '') return;
        element.style.setProperty(`--${name}`, String(value));
    });
}

function canRenderWithDom(element = null) {
    return Boolean(
        element
        && typeof element.replaceChildren === 'function'
        && typeof document !== 'undefined'
        && document
        && typeof document.createElement === 'function'
        && typeof document.createElementNS === 'function'
        && typeof HTMLTemplateElement !== 'undefined'
        && typeof HTMLElement !== 'undefined'
    );
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function setAccordionState(sectionEl, triggerEl, panelEl, isCollapsed, panelId) {
    if (!(sectionEl instanceof HTMLElement) || !(triggerEl instanceof HTMLElement) || !(panelEl instanceof HTMLElement)) {
        return;
    }

    sectionEl.classList.toggle('collapsed', isCollapsed);
    panelEl.hidden = isCollapsed;
    if (panelId) {
        panelEl.id = panelId;
        triggerEl.setAttribute('aria-controls', panelId);
    }
    triggerEl.setAttribute('aria-expanded', String(!isCollapsed));
}

const QUALITY_LEGEND = [
    { label: 'Excellent', color: '#7aae1a', rangeLabel: '>= 4.75"' },
    { label: 'Good', color: '#37996e', rangeLabel: '3.5 - 4.71"' },
    { label: 'Acceptable', color: '#de850a', rangeLabel: '2.4 - 3.5"' },
    { label: 'Poor', color: '#d1433d', rangeLabel: '< 2.4"' }
];
const ACCESSIBILITY_OVERVIEW_METRIC_DEFS = [
    ['Wheelchair Spaces', 'wheelchair', (summary) => Math.max(0, Number(summary?.wheelchairSpacesRequired) || 0), ''],
    ['Companion Seats', 'companion', (summary) => Math.max(0, Number(summary?.companionSeatsRequired) || 0), ''],
    ['Space Locations', 'locations', (summary) => Math.max(0, Number(summary?.wheelchairLocationsRequired) || 0), ''],
    ['Wheelchair Area', 'area', (summary) => Math.max(0, Number(summary?.wheelchairSpacesAreaSqFt) || 0), 'sf'],
    ['Companion Area', 'area', (summary) => Math.max(0, Number(summary?.companionSpacesAreaSqFt) || 0), 'sf'],
    ['Total Area', 'area', (summary) => Math.max(0, Number(summary?.totalAccessibilityAreaSqFt) || 0), 'sf'],
    ['Occupancy Add', 'occupancy', (summary) => Math.max(0, Number(summary?.accessibilityOccupancyContribution) || 0), 'occ']
];
const ACCESSIBILITY_TIER_METRIC_DEFS = [
    ...ACCESSIBILITY_OVERVIEW_METRIC_DEFS,
    ['Standard Seats', 'seats', (accessibility) => Math.max(0, Number(accessibility?.baseSeatCount) || 0), '']
];

function resolveAccessibilityMetrics(source, definitions) {
    return definitions.map(([label, kind, valueResolver, suffix]) => [
        label,
        kind,
        String(valueResolver(source)),
        suffix
    ]);
}

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

function createMetricIcon(kind) {
    const svg = createSvgElement('svg', {
        class: `tier-metric-icon icon-${kind}`,
        viewBox: '0 0 24 24',
        fill: 'currentColor',
        'aria-hidden': 'true'
    });

    if (kind === 'aisles') {
        svg.appendChild(createSvgElement('polygon', { points: '6,4 10,2 10,20 6,22' }));
        svg.appendChild(createSvgElement('polygon', { points: '14,2 18,4 18,22 14,20' }));
        return svg;
    }

    if (kind === 'width') {
        svg.appendChild(createSvgElement('path', { d: 'M8 8l-4 4 4 4v-3h8v3l4-4-4-4v3H8V8z M4 4v16h2V4H4z M18 4v16h2V4h-2z' }));
        return svg;
    }

    if (kind === 'area') {
        svg.appendChild(createSvgElement('rect', {
            x: '5',
            y: '5',
            width: '14',
            height: '14',
            rx: '2',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.8'
        }));
        svg.appendChild(createSvgElement('path', {
            d: 'M9 15 15 9',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.8',
            'stroke-linecap': 'round'
        }));
        return svg;
    }

    if (kind === 'sections') {
        svg.appendChild(createSvgElement('path', { d: 'M4 4h6v16H4z M12 4h8v7h-8z M12 13h8v7h-8z' }));
        return svg;
    }

    if (kind === 'seats') {
        svg.appendChild(createSvgElement('path', { d: 'M7 4a2 2 0 012-2h6a2 2 0 012 2v10H7V4z' }));
        svg.appendChild(createSvgElement('rect', { x: '3', y: '14', width: '18', height: '5', rx: '2.5' }));
        return svg;
    }

    if (kind === 'avg') {
        svg.appendChild(createSvgElement('path', { d: 'M2.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M1 12h8v2H1z M9.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M8 12h8v2H8z M16.5 8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4h-5V8z M15 12h8v2h-8z' }));
        return svg;
    }

    if (kind === 'wheelchair') {
        svg.appendChild(createSvgElement('path', {
            d: 'M22.73 18.34 20.48 19.1a.75.75 0 0 1-.91-.38l-2.8-5.6H8.99a.75.75 0 0 1-.75-.75v-2.4a5.25 5.25 0 1 0 6.74 5.36.75.75 0 1 1 1.5.09A6.75 6.75 0 1 1 8.24 8.42V5.87a2.25 2.25 0 1 1 1.5 0v2.38h5.25a.75.75 0 0 1 0 1.5H9.74v1.88h7.5a.75.75 0 0 1 .67.41l2.71 5.42 1.63-.54a.75.75 0 1 1 .48 1.42Z'
        }));
        return svg;
    }

    if (kind === 'locations') {
        svg.appendChild(createSvgElement('path', { d: 'M12 21s5-4.6 5-9a5 5 0 1 0-10 0c0 4.4 5 9 5 9z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        svg.appendChild(createSvgElement('circle', { cx: '12', cy: '12', r: '1.9', fill: 'currentColor' }));
        return svg;
    }

    if (kind === 'occupancy') {
        svg.appendChild(createSvgElement('path', { d: 'M6 4h12v5H6z M4 11h16v7H4z M7 18h2v2H7z M15 18h2v2h-2z' }));
        return svg;
    }

    svg.appendChild(createSvgElement('path', { d: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z' }));
    return svg;
}

function createMetricValue(mainText, suffixText = '') {
    const valueEl = createElement('div', 'tier-metric-value');
    valueEl.append(document.createTextNode(mainText));
    if (suffixText) {
        valueEl.appendChild(createElement('span', 'small-text', suffixText));
    }
    return valueEl;
}

function createLegendItem(segment) {
    const item = createElement('div', 'legend-item');
    const colorEl = createElement('div', 'legend-color');
    applyStyleVars(colorEl, { 'legend-color': segment.color });

    const textEl = createElement('div', 'legend-text');
    textEl.appendChild(createElement('span', 'legend-label', segment.label));
    textEl.appendChild(createElement('span', 'legend-range', segment.rangeLabel));

    item.append(colorEl, textEl);
    return item;
}

function createPieChartVisual(summary = {}) {
    const chartData = normalizeQualityDistribution(summary);
    const totalPoints = chartData.reduce((sum, segment) => sum + segment.count, 0);
    let cumulativePercent = 0;

    const wrapper = createElement('div', 'visuals-col-chart');
    const chartContainer = createElement('div', 'pie-chart-container');
    const svg = createSvgElement('svg', { viewBox: '0 0 100 100', class: 'pie-chart-svg' });

    const fullSegment = chartData.find((segment) => totalPoints > 0 && (segment.count / totalPoints) > 0.999);
    if (fullSegment) {
        const circle = createSvgElement('circle', {
            cx: '50',
            cy: '50',
            r: '41',
            fill: 'none',
            stroke: fullSegment.color,
            'stroke-width': '18',
            class: 'chart-segment'
        });
        circle.appendChild(createSvgElement('title'));
        circle.querySelector('title')?.append(document.createTextNode(`${fullSegment.label}: ${fullSegment.count} (100.0%)`));
        svg.appendChild(circle);
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
            const radius = 50;
            const center = 50;
            const innerRadius = 32;

            const d = [
                `M ${center + (radius * x1)} ${center + (radius * y1)}`,
                `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${center + (radius * x2)} ${center + (radius * y2)}`,
                `L ${center + (innerRadius * x2)} ${center + (innerRadius * y2)}`,
                `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${center + (innerRadius * x1)} ${center + (innerRadius * y1)}`,
                'Z'
            ].join(' ');

            const path = createSvgElement('path', {
                d,
                fill: segment.color,
                class: 'chart-segment',
                stroke: segment.color,
                'stroke-width': '1'
            });
            const title = createSvgElement('title');
            title.append(document.createTextNode(`${segment.label}: ${segment.count} (${(percent * 100).toFixed(1)}%)`));
            path.appendChild(title);
            svg.appendChild(path);
        });
    } else {
        svg.appendChild(createSvgElement('circle', {
            cx: '50',
            cy: '50',
            r: '41',
            stroke: '#e2e8f0',
            'stroke-width': '18',
            fill: 'none'
        }));
    }

    const centerText = createElement('div', 'chart-center-text');
    centerText.appendChild(createElement('div', 'chart-center-value', summary.averageCValueDisplay || '0.00'));
    centerText.appendChild(createElement('div', 'chart-center-label', 'Avg C'));
    chartContainer.append(svg, centerText);

    const legend = createElement('div', 'chart-legend');
    chartData.forEach((segment) => {
        legend.appendChild(createLegendItem(segment));
    });

    wrapper.append(chartContainer, legend);
    return wrapper;
}

function createOccupancyBreakdown(tiers = [], totalOccupancy = 0) {
    const container = createElement('div', 'occupancy-breakdown-content');
    const barContainer = createElement('div', 'occupancy-bar-container');
    const bar = createElement('div', 'occupancy-stacked-bar');
    const tierBreakdownGrid = createOccupancyTierSummaryGrid(tiers);

    if (totalOccupancy > 0) {
        tiers.forEach((tier) => {
            const reportedOccupancy = Math.max(0, Number(tier?.occupancy?.reportedOccupancy) || 0);
            if (reportedOccupancy === 0) return;

            const color = tier?.occupancy?.color || 'var(--accent-blue)';
            const percent = `${(reportedOccupancy / totalOccupancy) * 100}%`;

            const segment = createElement('div', 'occupancy-bar-segment');
            applyStyleVars(segment, {
                'segment-width': percent,
                'segment-color': color
            });
            bar.appendChild(segment);
        });
    }

    barContainer.appendChild(bar);
    container.append(barContainer, tierBreakdownGrid);
    return container;
}

function createOccupancyTierSummaryGrid(tiers = []) {
    const grid = createElement('div', 'occupancy-tier-breakdown-grid');

    tiers.forEach((tier) => {
        const reportedOccupancy = Math.max(0, Number(tier?.occupancy?.reportedOccupancy) || 0);
        if (reportedOccupancy === 0) return;

        const color = tier?.occupancy?.color || 'var(--accent-blue)';
        const label = tier?.occupancy?.label || 'Tier';
        const standardSeats = Math.max(0, Number(tier?.occupancy?.standardSeats) || 0);
        const accessibilityContribution = Math.max(0, Number(tier?.occupancy?.accessibilityContribution) || 0);

        const tierCard = createElement('div', 'occupancy-tier-breakdown-card');
        applyStyleVars(tierCard, { 'tier-color': color });
        tierCard.appendChild(createElement('div', 'occupancy-tier-breakdown-header', label));
        tierCard.appendChild(createElement(
            'div',
            'occupancy-tier-breakdown-line',
            `Standard: ${standardSeats.toLocaleString()}`
        ));
        tierCard.appendChild(createElement(
            'div',
            'occupancy-tier-breakdown-line occupancy-tier-breakdown-line--muted',
            `Accessible: ${accessibilityContribution.toLocaleString()}`
        ));
        grid.appendChild(tierCard);
    });

    return grid;
}

function createMetricItem(label, iconKind, mainValue, suffixText = '') {
    const item = createElement('div', 'tier-metric-item');
    item.appendChild(createElement('div', 'tier-metric-label', label));

    const content = createElement('div', 'tier-metric-content');
    content.appendChild(createMetricIcon(iconKind));
    content.appendChild(createMetricValue(mainValue, suffixText));
    item.appendChild(content);
    return item;
}

function createAccessibilityOverview(summary = {}) {
    const section = createElement('section', 'accessibility-overview');
    section.appendChild(createElement('div', 'total-occupancy-label results-section-title--center results-section-title--spaced', 'ACCESSIBILITY'));

    const totalBlock = createElement('div', 'accessibility-total-block');
    totalBlock.appendChild(createElement('div', 'total-occupancy-label', 'REPORTED OCCUPANCY'));
    totalBlock.appendChild(createElement(
        'div',
        'total-occupancy',
        Math.max(0, Number(summary?.reportedOccupancy) || 0).toLocaleString()
    ));
    section.appendChild(totalBlock);

    const grid = createElement('div', 'tier-metrics-grid accessibility-overview-grid');
    resolveAccessibilityMetrics(summary, ACCESSIBILITY_OVERVIEW_METRIC_DEFS).forEach(([label, kind, value, suffix]) => {
        grid.appendChild(createMetricItem(label, kind, value, suffix || ''));
    });
    section.appendChild(grid);
    return section;
}

function buildMetricItemMarkup(label, value, suffix = '') {
    return `
        <div class="tier-metric-item">
            <div class="tier-metric-label">${escapeHtml(label)}</div>
            <div class="tier-metric-value">${escapeHtml(String(value))}${suffix ? `<span class="small-text">${escapeHtml(suffix)}</span>` : ''}</div>
        </div>
    `;
}

function buildOccupancyBreakdownMarkup(tiers = [], totalOccupancy = 0) {
    const barSegments = [];

    if (totalOccupancy > 0) {
        tiers.forEach((tier) => {
            const reportedOccupancy = Math.max(0, Number(tier?.occupancy?.reportedOccupancy) || 0);
            if (!(reportedOccupancy > 0)) return;

            const color = tier?.occupancy?.color || 'var(--accent-blue)';
            barSegments.push(`
                <div class="occupancy-bar-segment" style="--segment-width:${(reportedOccupancy / totalOccupancy) * 100}%; --segment-color:${escapeHtml(color)}"></div>
            `);
        });
    }

    return `
        <div class="occupancy-breakdown-content">
            <div class="occupancy-bar-container">
                <div class="occupancy-stacked-bar">${barSegments.join('')}</div>
            </div>
            ${buildOccupancyTierSummaryGridMarkup(tiers)}
        </div>
    `;
}

function buildOccupancyTierSummaryGridMarkup(tiers = []) {
    const tierCards = tiers.map((tier) => {
        const reportedOccupancy = Math.max(0, Number(tier?.occupancy?.reportedOccupancy) || 0);
        if (!(reportedOccupancy > 0)) return '';

        const color = tier?.occupancy?.color || 'var(--accent-blue)';
        const label = tier?.occupancy?.label || 'Tier';
        const standardSeats = Math.max(0, Number(tier?.occupancy?.standardSeats) || 0);
        const accessibilityContribution = Math.max(0, Number(tier?.occupancy?.accessibilityContribution) || 0);

        return `
            <div class="occupancy-tier-breakdown-card" style="--tier-color:${escapeHtml(color)}">
                <div class="occupancy-tier-breakdown-header">${escapeHtml(label)}</div>
                <div class="occupancy-tier-breakdown-line">Standard: ${escapeHtml(standardSeats.toLocaleString())}</div>
                <div class="occupancy-tier-breakdown-line occupancy-tier-breakdown-line--muted">Accessible: ${escapeHtml(accessibilityContribution.toLocaleString())}</div>
            </div>
        `;
    }).join('');

    return `<div class="occupancy-tier-breakdown-grid">${tierCards}</div>`;
}

function buildAccessibilityOverviewMarkup(summary = {}) {
    const metricsMarkup = resolveAccessibilityMetrics(summary, ACCESSIBILITY_OVERVIEW_METRIC_DEFS)
        .map(([label, _kind, value, suffix]) => buildMetricItemMarkup(label, value, suffix))
        .join('');

    return `
        <section class="accessibility-overview">
            <div class="total-occupancy-label results-section-title--center results-section-title--spaced">ACCESSIBILITY</div>
            <div class="accessibility-total-block">
                <div class="total-occupancy-label">REPORTED OCCUPANCY</div>
                <div class="total-occupancy">${Math.max(0, Number(summary?.reportedOccupancy) || 0).toLocaleString()}</div>
            </div>
            <div class="tier-metrics-grid accessibility-overview-grid">
                ${metricsMarkup}
            </div>
        </section>
    `;
}

function buildAccessibilityCardMarkup(tier) {
    const accessibility = tier?.accessibility;
    if (!accessibility) return '';

    const metricsMarkup = resolveAccessibilityMetrics(accessibility, ACCESSIBILITY_TIER_METRIC_DEFS)
        .map(([label, _kind, value, suffix]) => buildMetricItemMarkup(label, value, suffix))
        .join('');

    return `
        <section class="tier-metrics-card tier-${escapeHtml(String(tier.tierNumber))}">
            <div class="tier-metrics-card-header">
                <div class="tier-metrics-header tier-${escapeHtml(String(tier.tierNumber))}">${escapeHtml(accessibility.tierLabel)}</div>
            </div>
            <div class="tier-metrics-card-body">
                <div class="tier-metrics-grid">${metricsMarkup}</div>
                <div class="tier-metrics-check">${escapeHtml(`Reported Occupancy: ${accessibility.reportedOccupancy.toLocaleString()} total (${accessibility.baseSeatCount.toLocaleString()} standard + ${accessibility.accessibilityOccupancyContribution.toLocaleString()} accessibility).`)}</div>
            </div>
        </section>
    `;
}

function createResultsDetailsSection({ title, classes = [], isCollapsed = true, sectionId = '', contentBuilder = null }) {
    const section = cloneTemplateElement('resultsDetailsSectionTemplate');
    if (!section) return null;

    classes.forEach((className) => section.classList.add(className));
    const trigger = section.querySelector('[data-accordion-trigger]');
    const titleEl = section.querySelector('[data-results-details-title]');
    const panel = /** @type {HTMLElement | null} */ (section.querySelector('[data-results-details-panel]'));
    if (titleEl) titleEl.textContent = title;
    if (panel && typeof contentBuilder === 'function') {
        contentBuilder(panel);
    }
    setAccordionState(section, trigger, panel, isCollapsed, sectionId);
    return section;
}

function appendLineBreak(container) {
    container.appendChild(document.createElement('br'));
}

function createEgressEstimateSection(estimate, index) {
    return createResultsDetailsSection({
        title: `Estimated Egress Seed (${estimate.tierLabel}${estimate.originalHeaderSuffix})`,
        classes: ['results-details--supporting'],
        isCollapsed: true,
        sectionId: `resultsEgressEstimatePanel-${index}`,
        contentBuilder: (panel) => {
            const row = createElement('div', 'egress-tier-row compact');
            const rowTop = createElement('div', 'egress-row-top');
            const tierLabelGroup = createElement('div', 'tier-label-group');
            tierLabelGroup.appendChild(createElement('span', 'tier-label', estimate.tierLabel));
            tierLabelGroup.appendChild(createElement('span', 'tier-pct tier-pct--seating', `${estimate.totalSeatingPercentage}% Seating`));
            tierLabelGroup.appendChild(createElement('span', 'tier-pct-sep', '/'));
            tierLabelGroup.appendChild(createElement('span', 'tier-pct tier-pct--egress', `${estimate.totalAislePercentage}% Egress`));
            rowTop.appendChild(tierLabelGroup);

            const bar = createElement('div', 'egress-bar-compact');
            const seating = createElement('div', 'bar-segment-seat');
            applyStyleVars(seating, { 'segment-width': `${estimate.totalSeatingPercentage}%` });
            const aisle = createElement('div', 'bar-segment-aisle');
            applyStyleVars(aisle, { 'segment-width': `${estimate.totalAislePercentage}%` });
            bar.append(seating, aisle);

            const details = createElement('div', 'egress-row-details');
            const headline = createElement('strong', '', `${estimate.displayAisles} Aisles${estimate.countsTag}`);
            details.append(headline);
            details.append(document.createTextNode(` (Width: ${estimate.aisleWidth}") - ${estimate.displaySeatLen.toLocaleString()}' Linear Seating vs ${estimate.displayAisleLen.toLocaleString()}' Linear Aisles${estimate.linearQuantitiesTag}`));

            const notes = createElement('div', 'egress-row-notes');
            notes.append(document.createTextNode(`-> Total Linear Seating${estimate.countsTag}: ${estimate.displayTotalLen.toLocaleString()}' (averaging ${estimate.displaySeatsPerRow} seats/row)`));
            appendLineBreak(notes);
            notes.append(document.createTextNode(`-> Sections${estimate.countsTag}: ${estimate.displaySections} (max ${estimate.maxSeatsPerSectionRow} seats in a section row, largest section ${estimate.occupantsPerSection} seats)`));
            appendLineBreak(notes);
            notes.append(document.createTextNode(`-> Max Load/Aisle (per aisle): ${estimate.occupantsPerAisleLine} occ (50/50 section split)`));
            appendLineBreak(notes);
            notes.append(document.createTextNode(`-> Aisle Egress Capacity Check (per aisle): ${estimate.occupantsPerAisleLine} occ x ${estimate.egressFactor}"/occ = ${estimate.capacityWidth}" required`));
            appendLineBreak(notes);
            notes.append(document.createTextNode(`-> Aisle Sizing: Max of Min Allowed (${estimate.minimumWidth}") vs Required (${estimate.capacityWidth}") -> `));
            const highlight = createElement('strong', 'egress-row-details-highlight', `Governing Width = ${estimate.governingWidth}"`);
            notes.appendChild(highlight);
            if (estimate.blocksAddedForEgress > 0) {
                appendLineBreak(notes);
                const limitNote = createElement(
                    'span',
                    'tier-metrics-limit-note',
                    `-> Max Width Limit Forced: Clamped to Max Aisle Width (${estimate.maximumWidth}"). Automatically added ${estimate.blocksAddedForEgress} section(s) to maintain code compliance!`
                );
                notes.appendChild(limitNote);
            }

            details.appendChild(notes);
            row.append(rowTop, bar, details);
            panel.appendChild(row);
        }
    });
}

function createEgressMetricCard(tier) {
    const card = cloneTemplateElement('resultsMetricCardTemplate');
    if (!card) return null;

    const egress = tier?.egress;
    if (!egress) return null;

    card.classList.add(`tier-${tier.tierNumber}`);
    const header = card.querySelector('[data-results-card-header]');
    if (header instanceof HTMLElement) {
        header.classList.add(`tier-${tier.tierNumber}`);
        header.textContent = `${egress.tierLabel}${egress.headerSuffix}`;
    }

    const grid = card.querySelector('[data-results-card-grid]');
    if (grid instanceof HTMLElement) {
        [
            ['Aisles' + egress.countsTag, 'aisles', String(egress.displayAisles)],
            ['Required Width', 'width', String(egress.capacityWidth), '"'],
            ['Sections' + egress.countsTag, 'sections', String(egress.displaySections)],
            ['Largest Section', 'seats', String(egress.occupantsPerSection)],
            ['Max Seats/Row/Section', 'avg', String(egress.maxSeatsPerSectionRow)],
            ['Max Load/Aisle', 'load', String(egress.occupantsPerAisleLine), 'occ']
        ].forEach(([label, kind, value, suffix]) => {
            grid.appendChild(createMetricItem(label, kind, value, suffix || ''));
        });
    }

    const check = card.querySelector('[data-results-card-check]');
    if (check) {
        check.textContent = `Aisle Egress Capacity (largest aisle): ${egress.occupantsPerAisleLine} occ x ${egress.egressFactor}"/occ = ${egress.capacityWidth}" Req.${egress.perSideMirrorNote}`;
    }

    const warning = /** @type {HTMLElement | null} */ (card.querySelector('[data-results-card-warning]'));
    const warningText = card.querySelector('[data-results-card-warning-text]');
    if (warning && warningText) {
        warning.hidden = !egress.warningText;
        warningText.textContent = egress.warningText || '';
    }

    return card;
}

function createAccessibilityMetricCard(tier) {
    const card = cloneTemplateElement('resultsMetricCardTemplate');
    if (!card) return null;

    const accessibility = tier?.accessibility;
    if (!accessibility) return null;

    card.classList.add(`tier-${tier.tierNumber}`);
    const header = card.querySelector('[data-results-card-header]');
    if (header instanceof HTMLElement) {
        header.classList.add(`tier-${tier.tierNumber}`);
        header.textContent = accessibility.tierLabel;
    }

    const grid = card.querySelector('[data-results-card-grid]');
    if (grid instanceof HTMLElement) {
        resolveAccessibilityMetrics(accessibility, ACCESSIBILITY_TIER_METRIC_DEFS).forEach(([label, kind, value, suffix]) => {
            grid.appendChild(createMetricItem(label, kind, value, suffix || ''));
        });
    }

    const check = card.querySelector('[data-results-card-check]');
    if (check) {
        check.textContent = `Reported Occupancy: ${accessibility.reportedOccupancy.toLocaleString()} total (${accessibility.baseSeatCount.toLocaleString()} standard + ${accessibility.accessibilityOccupancyContribution.toLocaleString()} accessibility).`;
    }

    const warning = /** @type {HTMLElement | null} */ (card.querySelector('[data-results-card-warning]'));
    if (warning) {
        warning.hidden = true;
    }

    return card;
}

export class StatsPanel {
    constructor({ statsEl = null, accessibilityEl = null, detailsEl = null } = {}) {
        this.statsEl = statsEl ?? getDefaultElement('statsContent');
        this.accessibilityEl = accessibilityEl ?? getDefaultElement('accessibilityContent');
        this.detailsEl = detailsEl ?? getDefaultElement('detailsContent');
        this.openDetailSections = new Set();
    }

    update(viewModel = null) {
        if (!this.statsEl) return;
        if (!viewModel || !Array.isArray(viewModel.tiers) || viewModel.tiers.length === 0) return;

        this._captureOpenDetailSections();

        if (canRenderWithDom(this.statsEl)) {
            this.statsEl.replaceChildren(this._buildStatsContent(viewModel));
        } else {
            this.statsEl.innerHTML = this._buildStatsMarkup(viewModel);
        }
        if (this.accessibilityEl) {
            if (canRenderWithDom(this.accessibilityEl)) {
                this.accessibilityEl.replaceChildren(this._buildAccessibilityContent(viewModel));
            } else {
                this.accessibilityEl.innerHTML = this._buildAccessibilityMarkup(viewModel);
            }
        }
        if (this.detailsEl) {
            if (canRenderWithDom(this.detailsEl)) {
                this.detailsEl.replaceChildren(this._buildDetailsContent(viewModel));
            } else {
                this.detailsEl.innerHTML = this._buildDetailsMarkup(viewModel);
            }
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

    _buildStatsContent(viewModel) {
        const summary = viewModel.summary || {};
        const totalOccupancy = Math.max(0, Number(summary.totalOccupancy) || 0);
        const root = createElement('div', 'results-summary-container');
        root.appendChild(createElement('div', 'total-occupancy-label results-section-title--center results-section-title--chart', 'C-VALUE ANALYSIS'));
        root.appendChild(createPieChartVisual(summary));

        const occupancySection = createElement('div', 'occupancy-section');
        occupancySection.appendChild(createElement('div', 'total-occupancy-label', 'TOTAL OCCUPANCY'));
        occupancySection.appendChild(createElement('div', 'total-occupancy', totalOccupancy.toLocaleString()));

        const breakdown = createElement('div', 'occupancy-breakdown');
        breakdown.appendChild(createOccupancyBreakdown(viewModel.tiers, totalOccupancy));
        occupancySection.appendChild(breakdown);

        occupancySection.appendChild(createElement('div', 'results-divider results-divider--spacious'));
        occupancySection.appendChild(createElement('div', 'total-occupancy-label results-section-title--spaced', 'EGRESS ANALYSIS'));

        const egressContainer = createElement('div', 'egress-metrics-container');
        viewModel.tiers.forEach((tier) => {
            const card = createEgressMetricCard(tier);
            if (card) egressContainer.appendChild(card);
        });
        viewModel.tiers.forEach((tier, index) => {
            const estimate = tier?.egress?.estimate;
            if (!estimate) return;
            const section = createEgressEstimateSection(estimate, index);
            if (section) egressContainer.appendChild(section);
        });
        occupancySection.appendChild(egressContainer);

        root.appendChild(occupancySection);
        return root;
    }

    _buildAccessibilityContent(viewModel) {
        const root = createElement('div', 'results-summary-container');
        root.appendChild(createAccessibilityOverview(viewModel.summary?.accessibility || {}));

        const accessibilityContainer = createElement('div', 'egress-metrics-container accessibility-metrics-container');
        viewModel.tiers.forEach((tier) => {
            const card = createAccessibilityMetricCard(tier);
            if (card) accessibilityContainer.appendChild(card);
        });
        root.appendChild(accessibilityContainer);
        return root;
    }

    _buildDetailsContent(viewModel) {
        const root = createElement('div', 'results-summary-container');
        root.appendChild(createElement('div', 'total-occupancy-label results-section-title--center results-section-title--spaced', 'TIER ROW DETAILS'));

        viewModel.tiers.forEach((tier, index) => {
            const section = createResultsDetailsSection({
                title: tier.title,
                classes: [tier.sectionClass],
                isCollapsed: !this.openDetailSections.has(tier.sectionClass),
                sectionId: `resultsTierPanel-${index + 1}`,
                contentBuilder: (panel) => {
                    const header = createElement('div', 'row-table-header');
                    ['Row', 'Riser', 'Elev', 'C-Value', 'Tread', 'Dist->Focal', 'Angle', 'Length', 'Seats']
                        .forEach((label) => header.appendChild(createElement('span', '', label)));
                    panel.appendChild(header);

                    (tier.rows || []).forEach((row) => {
                        const rowEl = cloneTemplateElement('resultsDetailRowTemplate');
                        if (!rowEl) return;

                        rowEl.querySelector('[data-results-row-number]')?.replaceChildren(document.createTextNode(String(row.rowNumber)));

                        const riserEl = /** @type {HTMLElement | null} */ (rowEl.querySelector('[data-results-row-riser]'));
                        if (riserEl) {
                            riserEl.textContent = row.riserDisplay;
                            riserEl.classList.toggle('row-table-cell--warning', !!row.riserWarning);
                            if (row.riserWarning) {
                                riserEl.title = 'Riser is 22 inches or greater!';
                            } else {
                                riserEl.removeAttribute('title');
                            }
                        }

                        rowEl.querySelector('[data-results-row-elevation]')?.replaceChildren(document.createTextNode(row.elevationDisplay));

                        const cValueEl = /** @type {HTMLElement | null} */ (rowEl.querySelector('[data-results-row-cvalue]'));
                        if (cValueEl) {
                            cValueEl.textContent = row.cValueDisplay;
                            applyStyleVars(cValueEl, { 'row-cell-color': row.cValueColor });
                        }

                        rowEl.querySelector('[data-results-row-tread]')?.replaceChildren(document.createTextNode(row.treadDisplay));
                        rowEl.querySelector('[data-results-row-distance]')?.replaceChildren(document.createTextNode(row.distToFocalDisplay));
                        rowEl.querySelector('[data-results-row-angle]')?.replaceChildren(document.createTextNode(row.angleDisplay));
                        rowEl.querySelector('[data-results-row-length]')?.replaceChildren(document.createTextNode(row.rowLengthDisplay));
                        rowEl.querySelector('[data-results-row-seats]')?.replaceChildren(document.createTextNode(row.rowSeatsDisplay));

                        panel.appendChild(rowEl);
                    });
                }
            });

            if (section) {
                root.appendChild(section);
            }
        });

        return root;
    }

    _buildStatsMarkup(viewModel) {
        const summary = viewModel.summary || {};
        const totalOccupancy = Math.max(0, Number(summary.totalOccupancy) || 0);
        const cardsMarkup = viewModel.tiers.map((tier) => {
            const egress = tier?.egress;
            if (!egress) return '';

            const metricsMarkup = [
                ['Aisles' + egress.countsTag, egress.displayAisles, ''],
                ['Required Width', egress.capacityWidth, '"'],
                ['Sections' + egress.countsTag, egress.displaySections, ''],
                ['Largest Section', egress.occupantsPerSection, ''],
                ['Max Seats/Row', egress.maxSeatsPerSectionRow, ''],
                ['Max Load/Aisle', egress.occupantsPerAisleLine, 'occ']
            ].map(([label, value, suffix]) => `
                <div class="tier-metric-item">
                    <div class="tier-metric-label">${escapeHtml(label)}</div>
                    <div class="tier-metric-value">${escapeHtml(String(value))}${suffix ? `<span class="small-text">${escapeHtml(suffix)}</span>` : ''}</div>
                </div>
            `).join('');

            const warningMarkup = egress.warningText
                ? `<div class="tier-metrics-warning"><span data-results-card-warning-text>${escapeHtml(egress.warningText)}</span></div>`
                : '';

            return `
                <section class="tier-metrics-card tier-${escapeHtml(String(tier.tierNumber))}">
                    <div class="tier-metrics-card-header">
                        <div class="tier-metrics-header tier-${escapeHtml(String(tier.tierNumber))}">${escapeHtml(`${egress.tierLabel}${egress.headerSuffix}`)}</div>
                    </div>
                    <div class="tier-metrics-card-body">
                        <div class="tier-metrics-grid">${metricsMarkup}</div>
                        <div class="tier-metrics-check">${escapeHtml(`Aisle Egress Capacity (per aisle): ${egress.occupantsPerAisleLine} occ x ${egress.egressFactor}"/occ = ${egress.capacityWidth}" Req.${egress.perSideMirrorNote}`)}</div>
                        ${warningMarkup}
                    </div>
                </section>
            `;
        }).join('');

        const estimateMarkup = viewModel.tiers.map((tier, index) => {
            const estimate = tier?.egress?.estimate;
            if (!estimate) return '';

            const limitMarkup = estimate.blocksAddedForEgress > 0
                ? `<br><span class="tier-metrics-limit-note">-> Max Width Limit Forced: Clamped to Max Aisle Width (${escapeHtml(String(estimate.maximumWidth))}"). Automatically added ${escapeHtml(String(estimate.blocksAddedForEgress))} section(s) to maintain code compliance!</span>`
                : '';

            return `
                <section class="results-details collapsed results-details--supporting" id="resultsEgressEstimatePanel-${index}">
                    <button type="button" class="accordion__trigger results-details__trigger" aria-expanded="false">Estimated Egress Seed (${escapeHtml(`${estimate.tierLabel}${estimate.originalHeaderSuffix}`)})</button>
                    <div class="section-body results-details__panel" hidden>
                        <div class="egress-tier-row compact">
                            <div class="egress-row-details">
                                <strong>${escapeHtml(`${estimate.displayAisles} Aisles${estimate.countsTag}`)}</strong>
                                ${escapeHtml(` (Width: ${estimate.aisleWidth}") - ${estimate.displaySeatLen.toLocaleString()}' Linear Seating vs ${estimate.displayAisleLen.toLocaleString()}' Linear Aisles${estimate.linearQuantitiesTag}`)}
                                <div class="egress-row-notes">
                                    ${escapeHtml(`-> Total Linear Seating${estimate.countsTag}: ${estimate.displayTotalLen.toLocaleString()}' (averaging ${estimate.displaySeatsPerRow} seats/row)`)}<br>
                                    ${escapeHtml(`-> Sections${estimate.countsTag}: ${estimate.displaySections} (max ${estimate.maxSeatsPerSectionRow} seats in a section row, largest section ${estimate.occupantsPerSection} seats)`)}<br>
                                    ${escapeHtml(`-> Max Load/Aisle (per aisle): ${estimate.occupantsPerAisleLine} occ (50/50 section split)`)}<br>
                                    ${escapeHtml(`-> Aisle Egress Capacity Check (per aisle): ${estimate.occupantsPerAisleLine} occ x ${estimate.egressFactor}"/occ = ${estimate.capacityWidth}" required`)}<br>
                                    ${escapeHtml(`-> Aisle Sizing: Max of Min Allowed (${estimate.minimumWidth}") vs Required (${estimate.capacityWidth}") -> `)}<strong class="egress-row-details-highlight">${escapeHtml(`Governing Width = ${estimate.governingWidth}"`)}</strong>${limitMarkup}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            `;
        }).join('');

        return `
            <div class="results-summary-container">
                <div class="total-occupancy-label results-section-title--center results-section-title--chart">C-VALUE ANALYSIS</div>
                <div class="occupancy-section">
                    <div class="total-occupancy-label">TOTAL OCCUPANCY</div>
                    <div class="total-occupancy">${totalOccupancy.toLocaleString()}</div>
                    <div class="occupancy-breakdown">${buildOccupancyBreakdownMarkup(viewModel.tiers, totalOccupancy)}</div>
                    <div class="results-divider results-divider--spacious"></div>
                    <div class="total-occupancy-label results-section-title--spaced">EGRESS ANALYSIS</div>
                    <div class="egress-metrics-container">${cardsMarkup}${estimateMarkup}</div>
                </div>
            </div>
        `;
    }

    _buildAccessibilityMarkup(viewModel) {
        return `
            <div class="results-summary-container">
                ${buildAccessibilityOverviewMarkup(viewModel.summary?.accessibility || {})}
                <div class="egress-metrics-container accessibility-metrics-container">
                    ${viewModel.tiers.map((tier) => buildAccessibilityCardMarkup(tier)).join('')}
                </div>
            </div>
        `;
    }

    _buildDetailsMarkup(viewModel) {
        const sectionsMarkup = viewModel.tiers.map((tier) => {
            const isCollapsed = !this.openDetailSections.has(tier.sectionClass);
            const rowsMarkup = (tier.rows || []).map((row) => `
                <div class="row-table-row">
                    <span>${escapeHtml(String(row.rowNumber))}</span>
                    <span${row.riserWarning ? ' class="row-table-cell--warning" title="Riser is 22 inches or greater!"' : ''}>${escapeHtml(row.riserDisplay)}</span>
                    <span>${escapeHtml(row.elevationDisplay)}</span>
                    <span class="row-table-cell--accent">${escapeHtml(row.cValueDisplay)}</span>
                    <span>${escapeHtml(row.treadDisplay)}</span>
                    <span>${escapeHtml(row.distToFocalDisplay)}</span>
                    <span>${escapeHtml(row.angleDisplay)}</span>
                    <span class="row-table-cell--muted">${escapeHtml(row.rowLengthDisplay)}</span>
                    <span class="row-table-cell--muted">${escapeHtml(row.rowSeatsDisplay)}</span>
                </div>
            `).join('');

            return `
                <section class="results-details ${escapeHtml(tier.sectionClass)}${isCollapsed ? ' collapsed' : ''}">
                    <button type="button" class="accordion__trigger results-details__trigger" aria-expanded="${isCollapsed ? 'false' : 'true'}">${escapeHtml(tier.title)}</button>
                    <div class="section-body results-details__panel"${isCollapsed ? ' hidden' : ''}>
                        <div class="row-table-header">
                            <span>Row</span><span>Riser</span><span>Elev</span><span>C-Value</span><span>Tread</span><span>Dist-&gt;Focal</span><span>Angle</span><span>Length</span><span>Seats</span>
                        </div>
                        ${rowsMarkup}
                    </div>
                </section>
            `;
        }).join('');

        return `
            <div class="results-summary-container">
                <div class="total-occupancy-label results-section-title--center results-section-title--spaced">TIER ROW DETAILS</div>
                ${sectionsMarkup}
            </div>
        `;
    }
}
