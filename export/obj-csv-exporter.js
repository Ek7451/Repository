function getTierIndex(solver, fallbackIndex = 0) {
    const tierIndex = Number(solver?.tierIndex);
    return Number.isInteger(tierIndex) ? tierIndex : fallbackIndex;
}

function slugifySportName(sportName) {
    const normalized = String(sportName ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    return normalized || 'seating';
}

function createEmptyOverlay() {
    return {
        sectionLabels: [],
        rowSeatLabels: []
    };
}

function buildTierArtifactMap(tierArtifacts = []) {
    const artifactMap = new Map();
    (tierArtifacts || []).forEach((artifact) => {
        const tierIndex = Math.max(0, Math.floor(Number(artifact?.tierIndex) || 0));
        artifactMap.set(tierIndex, artifact);
    });
    return artifactMap;
}

function summarizeValues(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { min: 0, avg: 0, max: 0 };
    }

    const numericValues = values.filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) {
        return { min: 0, avg: 0, max: 0 };
    }

    const sum = numericValues.reduce((acc, value) => acc + value, 0);
    return {
        min: Math.min(...numericValues),
        avg: +(sum / numericValues.length).toFixed(2),
        max: Math.max(...numericValues)
    };
}

function buildTierExportRecord({
    solver,
    fallbackIndex,
    egressParams,
    tierArtifactMap
}) {
    const tierIndex = getTierIndex(solver, fallbackIndex);
    const tierNumber = tierIndex + 1;
    const rows = Array.isArray(solver?.rows) ? solver.rows : [];
    const tierArtifact = tierArtifactMap instanceof Map ? tierArtifactMap.get(tierIndex) : null;
    const estMetrics = tierArtifact?.tierMetrics ?? null;
    const tierLayout = tierArtifact?.tierLayout ?? null;
    const overlay = tierArtifact?.overlayData ?? createEmptyOverlay();

    const rowSeatLabels = Array.isArray(overlay.rowSeatLabels) ? overlay.rowSeatLabels.slice() : [];
    const sectionLabels = Array.isArray(overlay.sectionLabels) ? overlay.sectionLabels.slice() : [];
    rowSeatLabels.sort((a, b) =>
        (a.rowIndex - b.rowIndex) ||
        ((a.sectionNumber || 0) - (b.sectionNumber || 0)) ||
        (a.pathIndex - b.pathIndex) ||
        (a.slotIndex - b.slotIndex)
    );
    sectionLabels.sort((a, b) => (a.sectionNumber || 0) - (b.sectionNumber || 0));

    const rowsByIndex = new Map();
    rows.forEach((row, rowIndex) => {
        rowsByIndex.set(rowIndex, {
            rowIndex,
            rowNumber: Number(row.row_number ?? (rowIndex + 1)),
            xFt: Number.isFinite(row.x) ? +row.x.toFixed(3) : null,
            zFt: Number.isFinite(row.z) ? +row.z.toFixed(3) : null,
            treadDepthIn: Number.isFinite(row.tread_depth) ? +(row.tread_depth * 12).toFixed(2) : null,
            riserHeightIn: Number.isFinite(row.riser_height) ? +(row.riser_height * 12).toFixed(2) : null,
            cValueIn: Number.isFinite(row.c_value) ? +row.c_value.toFixed(2) : null,
            sightlineAngleDeg: Number.isFinite(row.sightline_angle) ? +row.sightline_angle.toFixed(3) : null,
            linearLengthFt: Number.isFinite(row.computedLength) ? +row.computedLength.toFixed(3) : null,
            estimatedLinearSeats: Number.isFinite(row.computedSeats) ? Math.round(row.computedSeats) : null,
            seatsInRowActual: 0,
            sectionsInRow: 0,
            sectionSeatCounts: []
        });
    });

    const sectionsByKey = new Map();
    const getSectionKey = (pathIndex, slotIndex) => `${pathIndex}:${slotIndex}`;

    sectionLabels.forEach((label) => {
        const key = getSectionKey(label.pathIndex, label.slotIndex);
        sectionsByKey.set(key, {
            tierIndex,
            tierNumber,
            sectionNumber: Number.isFinite(label.sectionNumber) ? label.sectionNumber : null,
            pathIndex: Number.isFinite(label.pathIndex) ? label.pathIndex : null,
            slotIndex: Number.isFinite(label.slotIndex) ? label.slotIndex : null,
            occupancy: 0,
            rowsInSection: 0,
            seatCountsByRow: [],
            minSeatsPerRow: null,
            maxSeatsPerRow: null,
            avgSeatsPerRow: null,
            frontRowSeats: null,
            backRowSeats: null,
            labelAnchorFt: (Number.isFinite(label.x) && Number.isFinite(label.y))
                ? { x: +label.x.toFixed(3), y: +label.y.toFixed(3) }
                : null
        });
    });

    rowSeatLabels.forEach((label) => {
        const sectionKey = getSectionKey(label.pathIndex, label.slotIndex);
        if (!sectionsByKey.has(sectionKey)) {
            sectionsByKey.set(sectionKey, {
                tierIndex,
                tierNumber,
                sectionNumber: Number.isFinite(label.sectionNumber) ? label.sectionNumber : null,
                pathIndex: Number.isFinite(label.pathIndex) ? label.pathIndex : null,
                slotIndex: Number.isFinite(label.slotIndex) ? label.slotIndex : null,
                occupancy: 0,
                rowsInSection: 0,
                seatCountsByRow: [],
                minSeatsPerRow: null,
                maxSeatsPerRow: null,
                avgSeatsPerRow: null,
                frontRowSeats: null,
                backRowSeats: null,
                labelAnchorFt: null
            });
        }

        const section = sectionsByKey.get(sectionKey);
        const rowRec = rowsByIndex.get(label.rowIndex);
        const seatCount = Math.max(0, Math.round(Number(label.seatCount) || 0));

        if (rowRec && seatCount > 0) {
            rowRec.sectionSeatCounts.push({
                sectionNumber: section.sectionNumber,
                pathIndex: Number.isFinite(label.pathIndex) ? label.pathIndex : null,
                slotIndex: Number.isFinite(label.slotIndex) ? label.slotIndex : null,
                seatCount
            });
            rowRec.seatsInRowActual += seatCount;
        }

        if (section && seatCount > 0) {
            const rowNumber = rowRec ? rowRec.rowNumber : (Number(label.rowIndex) + 1);
            section.seatCountsByRow.push({
                rowIndex: Number.isFinite(label.rowIndex) ? label.rowIndex : null,
                rowNumber,
                seatCount
            });
            section.occupancy += seatCount;
        }
    });

    const rowRecords = Array.from(rowsByIndex.values()).sort((a, b) => a.rowIndex - b.rowIndex);
    rowRecords.forEach((rowRec) => {
        rowRec.sectionSeatCounts.sort((a, b) =>
            ((a.sectionNumber ?? 0) - (b.sectionNumber ?? 0)) ||
            ((a.pathIndex ?? 0) - (b.pathIndex ?? 0)) ||
            ((a.slotIndex ?? 0) - (b.slotIndex ?? 0))
        );
        rowRec.sectionsInRow = rowRec.sectionSeatCounts.length;
    });

    const seatWidthIn = Math.max(0, Number(tierLayout?.seatWidthIn) || Number(egressParams?.seatWidthIn) || 0);
    const aisleWidthIn = Math.max(0, (Number(tierLayout?.aisleWidthFt) || 0) * 12.0);

    const sectionRecords = Array.from(sectionsByKey.values())
        .sort((a, b) => (a.sectionNumber ?? 0) - (b.sectionNumber ?? 0))
        .map((section) => {
            section.seatCountsByRow.sort((a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0));
            section.rowsInSection = section.seatCountsByRow.length;
            if (section.rowsInSection > 0) {
                const seatCounts = section.seatCountsByRow.map((row) => row.seatCount);
                const sum = seatCounts.reduce((acc, value) => acc + value, 0);
                section.occupancy = Math.max(section.occupancy, sum);
                section.minSeatsPerRow = Math.min(...seatCounts);
                section.maxSeatsPerRow = Math.max(...seatCounts);
                section.avgSeatsPerRow = +(sum / section.rowsInSection).toFixed(2);
                section.frontRowSeats = seatCounts[0];
                section.backRowSeats = seatCounts[seatCounts.length - 1];
                section.averageSeatBandWidthFt = seatWidthIn > 0
                    ? +((section.avgSeatsPerRow * seatWidthIn) / 12.0).toFixed(3)
                    : null;
                section.backRowSeatBandWidthFt = (seatWidthIn > 0 && Number.isFinite(section.backRowSeats))
                    ? +((section.backRowSeats * seatWidthIn) / 12.0).toFixed(3)
                    : null;
            } else {
                section.averageSeatBandWidthFt = null;
                section.backRowSeatBandWidthFt = null;
            }
            section.seatWidthIn = seatWidthIn > 0 ? +seatWidthIn.toFixed(2) : null;
            return section;
        });

    const totalOccupancy = Math.max(
        0,
        Number(estMetrics?.capacity)
            || sectionRecords.reduce((acc, section) => acc + (Number(section.occupancy) || 0), 0)
    );
    const rowTotals = rowRecords.map((row) => row.seatsInRowActual);
    const sectionTotals = sectionRecords.map((section) => section.occupancy);
    const sectionsPerRowCounts = rowRecords.map((row) => row.sectionsInRow);
    const rowsPerSectionCounts = sectionRecords.map((section) => section.rowsInSection);
    const actualSectionCount = sectionRecords.length;
    const actualAisleCenterlines = Array.isArray(tierLayout?.aisles) ? tierLayout.aisles.length : 0;
    const sectionSummary = tierLayout?.sectionSummary || null;

    return {
        tierIndex,
        tierNumber,
        name: `Tier ${tierNumber}`,
        rowCount: rowRecords.length,
        totalOccupancy,
        egressInputs: {
            seatWidthIn: seatWidthIn > 0 ? +seatWidthIn.toFixed(2) : null,
            aisleWidthIn: aisleWidthIn > 0 ? +aisleWidthIn.toFixed(2) : null,
            maxSeatsPerRow: Number.isFinite(egressParams?.seatsBetweenAisles) ? +egressParams.seatsBetweenAisles : null,
            egressFactor: Number.isFinite(egressParams?.egressFactor) ? +egressParams.egressFactor : null
        },
        actualLayout: {
            aisleCenterlineCount: actualAisleCenterlines,
            aisleCountBySectionBoundaries: Number.isFinite(sectionSummary?.actualAisles)
                ? sectionSummary.actualAisles
                : actualAisleCenterlines,
            sectionCount: Number.isFinite(sectionSummary?.actualSections)
                ? sectionSummary.actualSections
                : actualSectionCount,
            forcedAislesAdded: Number.isFinite(tierLayout?.forcedCount) ? tierLayout.forcedCount : 0,
            targetAislesRequested: Number.isFinite(tierLayout?.targetAisles) ? tierLayout.targetAisles : null
        },
        distributions: {
            seatsPerRowActual: summarizeValues(rowTotals),
            seatsPerSection: summarizeValues(sectionTotals),
            sectionsPerRow: summarizeValues(sectionsPerRowCounts),
            rowsPerSection: summarizeValues(rowsPerSectionCounts)
        },
        egressEstimate: estMetrics ? {
            requiredWidthIn: Number.isFinite(estMetrics.requiredWidth) ? +estMetrics.requiredWidth.toFixed(2) : null,
            aisleWidthIn: Number.isFinite(estMetrics.aisleWidth) ? +estMetrics.aisleWidth.toFixed(2) : null,
            estimatedNumAisles: Number.isFinite(estMetrics.numAisles) ? estMetrics.numAisles : null,
            estimatedNumSections: Number.isFinite(estMetrics.numSections) ? estMetrics.numSections : null,
            estimatedSeatsPerRowAvg: Number.isFinite(estMetrics.seatsPerRow) ? +estMetrics.seatsPerRow.toFixed(2) : null,
            estimatedSeatsPerSectionAvg: Number.isFinite(estMetrics.occupantsPerSection)
                ? +estMetrics.occupantsPerSection.toFixed(2)
                : null
        } : null,
        rows: rowRecords,
        sections: sectionRecords
    };
}

export function buildStudyResultsJsonPayload({
    solvers,
    sportName,
    profileType,
    template,
    bowlConfig,
    egressParams,
    focalPointFt,
    primaryTierParameters,
    tierArtifacts = []
}) {
    const activeSolvers = (solvers || []).filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
    if (activeSolvers.length === 0) return null;

    const tierArtifactMap = buildTierArtifactMap(tierArtifacts);
    const tierExports = activeSolvers.map((solver, index) => buildTierExportRecord({
        solver,
        fallbackIndex: index,
        egressParams,
        tierArtifactMap
    }));
    const totalOccupancyAllTiers = tierExports.reduce((acc, tier) => acc + (Number(tier.totalOccupancy) || 0), 0);
    const totalAislesAllTiers = tierExports.reduce((acc, tier) => acc + (Number(tier.actualLayout?.aisleCenterlineCount) || 0), 0);
    const totalSectionsAllTiers = tierExports.reduce((acc, tier) => acc + (Number(tier.actualLayout?.sectionCount) || 0), 0);
    const tier1Solver = activeSolvers[0];

    return {
        exportVersion: 'phase6-multitier-metrics',
        exportedAt: new Date().toISOString(),
        sport: sportName,
        profileType: profileType || 'Parabolic',
        template: template ? {
            name: template.name || null,
            shape: template.shape || null,
            fieldLengthFt: Number.isFinite(template.field_length) ? template.field_length : null,
            fieldWidthFt: Number.isFinite(template.field_width) ? template.field_width : null,
            runoffDefaultFt: Number.isFinite(template.runoff) ? template.runoff : null
        } : null,
        bowlConfig,
        egressInputs: {
            seatWidthIn: egressParams?.seatWidthIn ?? null,
            minAisleWidthIn: egressParams?.minAisleWidthIn ?? null,
            maxAisleWidthIn: egressParams?.maxAisleWidthIn ?? null,
            maxSeatsPerRow: egressParams?.seatsBetweenAisles ?? null,
            egressFactor: egressParams?.egressFactor ?? null
        },
        totals: {
            enabledTierCount: tierExports.length,
            totalOccupancy: totalOccupancyAllTiers,
            totalAisleCenterlines: totalAislesAllTiers,
            totalSections: totalSectionsAllTiers
        },
        parameters: {
            targetCValue: primaryTierParameters?.targetCValue ?? 0,
            firstRowDistance: primaryTierParameters?.firstRowDistance ?? 0,
            firstRowElevation: primaryTierParameters?.firstRowElevation ?? 0,
            treadDepth: primaryTierParameters?.treadDepth ?? 0,
            riserHeight: primaryTierParameters?.riserHeight ?? 0,
            numRows: Math.round(primaryTierParameters?.numRows ?? 0),
            eyeHeight: primaryTierParameters?.eyeHeight ?? 0,
            eyeSetback: primaryTierParameters?.eyeSetback ?? 0,
            focalX: Number(focalPointFt?.x) || 0,
            focalZ: Number(focalPointFt?.z) || 0
        },
        rows: (tier1Solver?.rows || []).map((row) => ({
            row: row.row_number,
            x: Number.isFinite(row?.x) ? +row.x.toFixed(3) : null,
            z: Number.isFinite(row?.z) ? +row.z.toFixed(3) : null,
            riser_in: Number.isFinite(row?.riser_height) ? +(row.riser_height * 12).toFixed(2) : null,
            c_value_in: Number.isFinite(row?.c_value) ? +row.c_value.toFixed(2) : null,
            eye_x: Number.isFinite(row?.eye_x) ? +row.eye_x.toFixed(3) : null,
            eye_z: Number.isFinite(row?.eye_z) ? +row.eye_z.toFixed(3) : null
        })),
        tiers: tierExports
    };
}

export function buildStudyResultsJsonExportDescriptor({
    solvers = [],
    sportName = '',
    profileType = 'Parabolic',
    template = null,
    bowlConfig = null,
    egressParams = null,
    focalPointFt = { x: 0, z: 0 },
    primaryTierParameters = null,
    tierArtifacts = []
} = {}) {
    const payload = buildStudyResultsJsonPayload({
        solvers,
        sportName,
        profileType,
        template,
        bowlConfig,
        egressParams,
        focalPointFt,
        primaryTierParameters,
        tierArtifacts
    });
    if (!payload) {
        console.warn('No solver data to export');
        return null;
    }

    return {
        filename: `seating - study - ${slugifySportName(payload.sport)}.json`,
        content: JSON.stringify(payload, null, 2),
        type: 'application/json'
    };
}

export function buildObjText({ bowlMeshes = [], objectName = 'SeatingBowl' } = {}) {
    let output = '# Seating Bowl Study - OBJ Export\n';
    output += `o ${objectName}\n`;
    let indexOffset = 1;

    (bowlMeshes || []).forEach((mesh) => {
        if (!mesh || mesh.type !== 'Mesh') return;

        const positions = mesh.geometry?.attributes?.position?.array;
        const indices = mesh.geometry?.index?.array;
        if (!positions || !indices) return;

        const vertexCount = Math.floor(positions.length / 3);
        if (vertexCount <= 0) return;

        const vertexLines = [];
        for (let index = 0; index < vertexCount; index += 1) {
            const x = Number(positions[index * 3]);
            const y = Number(positions[(index * 3) + 1]);
            const z = Number(positions[(index * 3) + 2]);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                return;
            }
            vertexLines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} \n`);
        }

        const faceLines = [];
        for (let index = 0; index + 2 < indices.length; index += 3) {
            const a = Number(indices[index]);
            const b = Number(indices[index + 1]);
            const c = Number(indices[index + 2]);
            if (
                !Number.isInteger(a) ||
                !Number.isInteger(b) ||
                !Number.isInteger(c) ||
                a < 0 ||
                b < 0 ||
                c < 0 ||
                a >= vertexCount ||
                b >= vertexCount ||
                c >= vertexCount
            ) {
                continue;
            }
            faceLines.push(`f ${a + indexOffset} ${b + indexOffset} ${c + indexOffset} \n`);
        }

        output += vertexLines.join('');
        output += faceLines.join('');
        indexOffset += vertexCount;
    });

    return output;
}

export function buildObjExportDescriptor({ bowlMeshes = [], sportName = '', objectName = 'SeatingBowl' } = {}) {
    if (!Array.isArray(bowlMeshes) || bowlMeshes.length === 0) {
        console.warn('No 3D data to export');
        return null;
    }

    return {
        filename: `seating - study - ${slugifySportName(sportName)}.obj`,
        content: buildObjText({
            bowlMeshes,
            objectName
        }),
        type: 'text/plain'
    };
}

export function buildTierMetricsCsv({ solvers = [], focalPointFt = { x: 0 } } = {}) {
    let csv = 'Tier,Row,Riser (in),Elevation (ft),C-Value (in),Tread (in),Dist to Focal (ft),Sightline Angle (deg),Linear Length (ft),Seats\n';
    const focalXForDetails = Number(focalPointFt?.x) || 0;

    (solvers || []).forEach((solver, tierIndex) => {
        if (!Array.isArray(solver?.rows)) return;

        solver.rows.forEach((row, rowIndex) => {
            const isFirstRow = rowIndex === 0;
            const isTier1FirstRow = tierIndex === 0 && isFirstRow;
            const rowZ = Number(row?.z) || 0;
            const treadDepth = Number(row?.tread_depth) || 0;
            const rowX = Number(row?.x) || 0;
            const riserHeight = Number(row?.riser_height) || 0;
            const riserInches = isTier1FirstRow ? (rowZ * 12) : (riserHeight * 12);
            const cValDisplay = isFirstRow ? 'N/A' : (Number(row?.c_value) || 0).toFixed(2);
            const treadInches = (treadDepth * 12).toFixed(2);
            const distToFocalFt = ((rowX - treadDepth) - focalXForDetails).toFixed(2);
            const sightlineDeg = (Number(row?.sightline_angle) || 0).toFixed(2);
            csv += `${tierIndex + 1},${row?.row_number},${riserInches.toFixed(2)},${rowZ.toFixed(2)},${cValDisplay},${treadInches},${distToFocalFt},${sightlineDeg},${(Number(row?.computedLength) || 0).toFixed(0)},${Number(row?.computedSeats) || 0}\n`;
        });
    });

    return csv;
}

export function buildTierMetricsCsvExportDescriptor({ solvers = [], focalPointFt = { x: 0 }, sportName = '' } = {}) {
    const activeSolvers = (solvers || []).filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
    if (activeSolvers.length === 0) {
        console.warn('No data for CSV');
        return null;
    }

    return {
        filename: `tier-metrics-${slugifySportName(sportName)}.csv`,
        content: buildTierMetricsCsv({
            solvers: activeSolvers,
            focalPointFt
        }),
        type: 'text/csv'
    };
}

export function buildConfigExportDescriptor({ config = null } = {}) {
    const sportName = config && typeof config === 'object' ? config.sport : '';
    return {
        filename: `bowl-config-${slugifySportName(sportName)}.json`,
        content: JSON.stringify(config ?? {}, null, 2),
        type: 'application/json'
    };
}
