import { resolvePlanFocalYFt } from '../core/sports-templates.js';
import { buildStructuralProfileGeometry } from '../core/profile-solver.js';

const DXF_VERSION = 'AC1009';

function slugifySportName(sportName) {
    const normalized = String(sportName ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    return normalized || 'seating';
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function formatDxfNumber(value, digits = 4) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : null;
}

function sanitizeLayerName(name) {
    const rawName = String(name ?? '0').trim();
    const collapsedWhitespace = rawName.replace(/\s+/g, '_');
    const cleanedName = collapsedWhitespace.replace(/[<>/\\":;?*|=`]/g, '_').replace(/_+/g, '_');
    return cleanedName || '0';
}

function sanitizeTextValue(text) {
    return String(text ?? '').replace(/\0/g, '').replace(/\r?\n/g, ' ').trim();
}

function buildDxfDocument(entityParts, layerNames) {
    const layers = ['0', ...Array.from(layerNames).filter((layer) => layer && layer !== '0').sort()];
    const layerTableParts = layers.map(
        (layer) => `0\nLAYER\n2\n${layer}\n70\n0\n62\n7\n6\nContinuous\n`
    );

    return [
        '0\nSECTION\n2\nHEADER\n',
        `9\n$ACADVER\n1\n${DXF_VERSION}\n`,
        '9\n$DWGCODEPAGE\n3\nANSI_1252\n',
        '9\n$INSBASE\n10\n0.0000\n20\n0.0000\n30\n0.0000\n',
        '9\n$LUNITS\n70\n2\n',
        '9\n$LUPREC\n70\n4\n',
        '9\n$TEXTSTYLE\n7\nStandard\n',
        '9\n$CLAYER\n8\n0\n',
        '0\nENDSEC\n',
        '0\nSECTION\n2\nTABLES\n',
        '0\nTABLE\n2\nLTYPE\n70\n1\n',
        '0\nLTYPE\n2\nContinuous\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0000\n',
        '0\nENDTAB\n',
        '0\nTABLE\n2\nSTYLE\n70\n1\n',
        '0\nSTYLE\n2\nStandard\n70\n0\n40\n0.0000\n41\n1.0000\n50\n0.0000\n71\n0\n42\n2.5000\n3\ntxt\n4\n\n',
        '0\nENDTAB\n',
        `0\nTABLE\n2\nLAYER\n70\n${layers.length}\n`,
        ...layerTableParts,
        '0\nENDTAB\n',
        '0\nENDSEC\n',
        '0\nSECTION\n2\nENTITIES\n',
        ...entityParts,
        '0\nENDSEC\n0\nEOF\n'
    ].join('');
}

function createDxfWriter() {
    const entityParts = [];
    const layerNames = new Set();

    const registerLayer = (layer) => {
        const safeLayer = sanitizeLayerName(layer);
        layerNames.add(safeLayer);
        return safeLayer;
    };

    const addEntity = (entity) => {
        entityParts.push(entity);
    };

    return {
        addLine(layer, x1, y1, x2, y2) {
            const values = [x1, y1, x2, y2].map((value) => formatDxfNumber(value));
            if (values.includes(null)) return;

            const safeLayer = registerLayer(layer);
            addEntity(
                `0\nLINE\n8\n${safeLayer}\n` +
                `10\n${values[0]}\n20\n${values[1]}\n30\n0.0000\n` +
                `11\n${values[2]}\n21\n${values[3]}\n31\n0.0000\n`
            );
        },

        addPoint(layer, x, y) {
            const values = [x, y].map((value) => formatDxfNumber(value));
            if (values.includes(null)) return;

            const safeLayer = registerLayer(layer);
            addEntity(`0\nPOINT\n8\n${safeLayer}\n10\n${values[0]}\n20\n${values[1]}\n30\n0.0000\n`);
        },

        addCircle(layer, x, y, radius) {
            const values = [x, y].map((value) => formatDxfNumber(value));
            const safeRadius = formatDxfNumber(radius);
            if (values.includes(null) || safeRadius === null || Number(safeRadius) <= 0) return;

            const safeLayer = registerLayer(layer);
            addEntity(
                `0\nCIRCLE\n8\n${safeLayer}\n` +
                `10\n${values[0]}\n20\n${values[1]}\n30\n0.0000\n40\n${safeRadius}\n`
            );
        },

        addArc(layer, x, y, radius, startAngleDeg, endAngleDeg) {
            const values = [x, y].map((value) => formatDxfNumber(value));
            const safeRadius = formatDxfNumber(radius);
            const safeStart = formatDxfNumber(startAngleDeg);
            const safeEnd = formatDxfNumber(endAngleDeg);
            if (
                values.includes(null) ||
                safeRadius === null ||
                safeStart === null ||
                safeEnd === null ||
                Number(safeRadius) <= 0
            ) {
                return;
            }

            const safeLayer = registerLayer(layer);
            addEntity(
                `0\nARC\n8\n${safeLayer}\n` +
                `10\n${values[0]}\n20\n${values[1]}\n30\n0.0000\n` +
                `40\n${safeRadius}\n50\n${safeStart}\n51\n${safeEnd}\n`
            );
        },

        addText(layer, x, y, text, options = {}) {
            const safeText = sanitizeTextValue(text);
            if (!safeText) return;

            const safeHeight = formatDxfNumber(options.heightIn ?? 10);
            const baseValues = [x, y].map((value) => formatDxfNumber(value));
            if (safeHeight === null || baseValues.includes(null) || Number(safeHeight) <= 0) return;

            const alignX = formatDxfNumber(options.alignX ?? x);
            const alignY = formatDxfNumber(options.alignY ?? y);
            const halign = Number.isInteger(options.halign) ? options.halign : null;
            const valign = Number.isInteger(options.valign) ? options.valign : null;
            const hasAlignment = halign !== null && valign !== null && alignX !== null && alignY !== null;

            const safeLayer = registerLayer(layer);
            let entity =
                `0\nTEXT\n8\n${safeLayer}\n` +
                `10\n${baseValues[0]}\n20\n${baseValues[1]}\n30\n0.0000\n` +
                `40\n${safeHeight}\n1\n${safeText}\n7\nStandard\n`;

            if (hasAlignment) {
                entity += `72\n${halign}\n73\n${valign}\n11\n${alignX}\n21\n${alignY}\n31\n0.0000\n`;
            }

            addEntity(entity);
        },

        build() {
            return buildDxfDocument(entityParts, layerNames);
        }
    };
}

function appendDxfLine(writer, layer, x1, y1, x2, y2) {
    writer.addLine(layer, x1, y1, x2, y2);
}

function appendDxfText(writer, layer, xFt, yFt, text, heightIn = 10) {
    if (!isFiniteNumber(xFt) || !isFiniteNumber(yFt)) return;

    writer.addText(layer, xFt * 12, yFt * 12, text, {
        heightIn,
        halign: 1,
        valign: 2,
        alignX: xFt * 12,
        alignY: yFt * 12
    });
}

function appendPlanSegments(writer, layer, segments = []) {
    let lastX = null;
    let lastY = null;
    let startX = null;
    let startY = null;

    (segments || []).forEach((segment) => {
        if (segment.cmd === 'moveTo') {
            if (!isFiniteNumber(segment.x) || !isFiniteNumber(segment.y)) return;
            lastX = segment.x;
            lastY = segment.y;
            startX = segment.x;
            startY = segment.y;
        } else if (segment.cmd === 'lineTo') {
            if (lastX === null || lastY === null) return;
            appendDxfLine(writer, layer, lastX * 12, lastY * 12, segment.x * 12, segment.y * 12);
            if (isFiniteNumber(segment.x) && isFiniteNumber(segment.y)) {
                lastX = segment.x;
                lastY = segment.y;
            }
        } else if (segment.cmd === 'arc') {
            if (
                !isFiniteNumber(segment.x) ||
                !isFiniteNumber(segment.y) ||
                !isFiniteNumber(segment.r) ||
                Number(segment.r) <= 0 ||
                !isFiniteNumber(segment.sa) ||
                !isFiniteNumber(segment.ea)
            ) {
                return;
            }

            let dxfSa = segment.ccw ? segment.ea : segment.sa;
            let dxfEa = segment.ccw ? segment.sa : segment.ea;
            let degSa = dxfSa * 180 / Math.PI;
            let degEa = dxfEa * 180 / Math.PI;
            degSa = ((degSa % 360) + 360) % 360;
            degEa = ((degEa % 360) + 360) % 360;

            writer.addArc(layer, segment.x * 12, segment.y * 12, segment.r * 12, degSa, degEa);

            lastX = segment.x + segment.r * Math.cos(segment.ea);
            lastY = segment.y + segment.r * Math.sin(segment.ea);
        } else if (segment.cmd === 'closePath') {
            if (lastX === null || lastY === null || startX === null || startY === null) return;
            appendDxfLine(writer, layer, lastX * 12, lastY * 12, startX * 12, startY * 12);
            lastX = startX;
            lastY = startY;
        }
    });
}

function addDxfShape(writer, template, runoff, layer) {
    const shape = template?.shape || 'rectangle';
    const addLine = (x1, y1, x2, y2) => appendDxfLine(writer, layer, x1 * 12, y1 * 12, x2 * 12, y2 * 12);
    const addArc = (x, y, r, sa, ea) => {
        if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(r) || Number(r) <= 0) return;

        const degSa = ((sa * 180 / Math.PI) % 360 + 360) % 360;
        const degEa = ((ea * 180 / Math.PI) % 360 + 360) % 360;
        writer.addArc(layer, x * 12, y * 12, r * 12, degSa, degEa);
    };

    if (shape === 'rectangle') {
        const halfL = ((template.field_length || 0) / 2) + runoff;
        const halfW = ((template.field_width || 0) / 2) + runoff;
        addLine(-halfL, -halfW, halfL, -halfW);
        addLine(halfL, -halfW, halfL, halfW);
        addLine(halfL, halfW, -halfL, halfW);
        addLine(-halfL, halfW, -halfL, -halfW);
    } else if (shape === 'rounded_rect') {
        const halfL = ((template.field_length || 0) / 2) + runoff;
        const halfW = ((template.field_width || 0) / 2) + runoff;
        const r = (template.corner_radius || 0) + runoff;
        const rx = halfL - r;
        const ry = halfW - r;
        addLine(-rx, -halfW, rx, -halfW);
        addArc(rx, -ry, r, -Math.PI / 2, 0);
        addLine(halfL, -ry, halfL, ry);
        addArc(rx, ry, r, 0, Math.PI / 2);
        addLine(rx, halfW, -rx, halfW);
        addArc(-rx, ry, r, Math.PI / 2, Math.PI);
        addLine(-halfL, ry, -halfL, -ry);
        addArc(-rx, -ry, r, Math.PI, 3 * Math.PI / 2);
    } else if (shape === 'oval') {
        const halfStraight = ((template.straight_length || 0) / 2) - (template.corner_radius || 0) + runoff;
        const halfW = ((template.field_width || 0) / 2) + runoff;
        addLine(-halfStraight, halfW, halfStraight, halfW);
        addArc(halfStraight, 0, halfW, -Math.PI / 2, Math.PI / 2);
        addLine(halfStraight, -halfW, -halfStraight, -halfW);
        addArc(-halfStraight, 0, halfW, Math.PI / 2, 3 * Math.PI / 2);
    } else if (shape === 'arc') {
        const radius = (template.field_radius || 0) + runoff;
        const halfAngle = ((template.arc_angle || 90) / 2) * Math.PI / 180;
        const startAngle = Math.PI / 2 - halfAngle;
        const endAngle = Math.PI / 2 + halfAngle;
        addLine(0, 0, radius * Math.cos(startAngle), radius * Math.sin(startAngle));
        addArc(0, 0, radius, startAngle, endAngle);
        addLine(radius * Math.cos(endAngle), radius * Math.sin(endAngle), 0, 0);
    }
}

export function buildProfileDxf({
    solvers,
    structuralDepthFt = 0,
    structuralProfileMode = 'stepped',
    focalPointFt = { x: 0, z: 0 }
}) {
    const writer = createDxfWriter();
    const fX = (Number(focalPointFt?.x) || 0) * 12;
    const fZ = (Number(focalPointFt?.z) || 0) * 12;

    writer.addPoint('Focal_Point', fX, fZ);

    (solvers || []).forEach((solver, tierIndex) => {
        if (!solver?.rows || solver.rows.length === 0) return;

        const rawSegments = solver.getStepGeometry?.();
        const segments = Array.isArray(rawSegments) ? rawSegments : [];
        const profLayer = `Tier_${tierIndex + 1}_Profile`;
        const sightLayer = `Tier_${tierIndex + 1}_Sightlines`;
        const headLayer = `Tier_${tierIndex + 1}_Heads`;
        const textLayer = `Tier_${tierIndex + 1}_Metrics`;

        const firstRow = solver.rows[0];
        const solverTierIndex = solver.tierIndex !== undefined ? solver.tierIndex : tierIndex;
        const baseZ = solverTierIndex === 0 ? 0 : (firstRow.z - firstRow.riser_height);
        const startX = firstRow.x - solver.treadDepthFt;

        appendDxfLine(writer, profLayer, startX * 12, baseZ * 12, startX * 12, firstRow.z * 12);

        for (const segment of segments) {
            if (!Array.isArray(segment) || segment.length < 2) continue;
            const [start, end] = segment;
            appendDxfLine(writer, profLayer, start?.x * 12, start?.z * 12, end?.x * 12, end?.z * 12);
        }

        if (structuralDepthFt > 0) {
            const structuralGeometry = buildStructuralProfileGeometry(solver, {
                structuralDepthFt,
                structuralProfileMode,
                tierIndex: tierIndex
            });
            const undersideProfile = structuralGeometry?.undersideProfile ?? [];
            const topProfile = structuralGeometry?.topProfile ?? [];
            const topEnd = topProfile[topProfile.length - 1];
            const frontBottomPoint = {
                x: topProfile[0]?.x ?? startX,
                z: undersideProfile[0]?.z ?? baseZ
            };
            if (undersideProfile.length > 0) {
                appendDxfLine(
                    writer,
                    profLayer,
                    frontBottomPoint.x * 12,
                    frontBottomPoint.z * 12,
                    undersideProfile[0].x * 12,
                    undersideProfile[0].z * 12
                );
                for (let i = 0; i < undersideProfile.length - 1; i++) {
                    appendDxfLine(
                        writer,
                        profLayer,
                        undersideProfile[i].x * 12,
                        undersideProfile[i].z * 12,
                        undersideProfile[i + 1].x * 12,
                        undersideProfile[i + 1].z * 12
                    );
                }
                const rearBottomPoint = undersideProfile[undersideProfile.length - 1];
                appendDxfLine(
                    writer,
                    profLayer,
                    topEnd.x * 12,
                    topEnd.z * 12,
                    rearBottomPoint.x * 12,
                    rearBottomPoint.z * 12
                );
            }
        }

        solver.rows.forEach((row) => {
            const eyeXIn = row.eye_x * 12;
            const eyeZIn = row.eye_z * 12;

            writer.addLine(sightLayer, eyeXIn, eyeZIn, fX, fZ);
            writer.addPoint(headLayer, eyeXIn, eyeZIn);
            writer.addCircle(headLayer, eyeXIn + (4.5 * 0.3), eyeZIn, 4.5);
            if (isFiniteNumber(row.c_value)) {
                writer.addText(
                    textLayer,
                    (row.x - solver.treadDepthFt / 2) * 12,
                    (row.z * 12) + 12,
                    `${Number(row.c_value).toFixed(2)} in C-Val`,
                    { heightIn: 4 }
                );
            }
        });
    });

    return writer.build();
}

export function buildProfileDxfExportDescriptor({
    solvers = [],
    structuralDepthFt = 0,
    structuralProfileMode = 'stepped',
    focalPointFt = { x: 0, z: 0 },
    sportName = ''
} = {}) {
    const activeSolvers = (solvers || []).filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
    if (activeSolvers.length === 0) {
        console.warn('No 2D profile data to export');
        return null;
    }

    return {
        filename: `SeatingProfile_${slugifySportName(sportName)}.dxf`,
        content: buildProfileDxf({
            solvers: activeSolvers,
            structuralDepthFt,
            structuralProfileMode,
            focalPointFt
        }),
        type: 'text/plain'
    };
}

export function buildPlanDxf({ template, runoffFt = 0, visualFocalXFt, tierPlanArtifacts = [] }) {
    const writer = createDxfWriter();

    addDxfShape(writer, template, 0, 'Field_Edge');
    addDxfShape(writer, template, runoffFt, 'Runoff');

    const fpX = (template?.focal_x || 0) * 12;
    const fpY = resolvePlanFocalYFt(template, visualFocalXFt) * 12;
    writer.addPoint('Focal_Point', fpX, fpY);
    writer.addLine('Focal_Point', fpX - 24, fpY, fpX + 24, fpY);
    writer.addLine('Focal_Point', fpX, fpY - 24, fpX, fpY + 24);
    writer.addCircle('Focal_Point', fpX, fpY, 18);

    (tierPlanArtifacts || []).forEach((artifact, index) => {
        const tierIndex = Math.max(0, Math.floor(Number(artifact?.tierIndex) || index));
        const layer = `Tier_${tierIndex + 1}_Plan`;
        const aisleLayer = `Tier_${tierIndex + 1}_Aisles`;
        const sectionLabelLayer = `Tier_${tierIndex + 1}_Section_Labels`;
        const rowLabelLayer = `Tier_${tierIndex + 1}_Row_Seat_Counts`;
        const rowGeometries = Array.isArray(artifact?.rowGeometries) ? artifact.rowGeometries : [];
        const aislePolygons = Array.isArray(artifact?.aislePolygons) ? artifact.aislePolygons : [];
        const overlay = artifact?.overlayData && typeof artifact.overlayData === 'object'
            ? artifact.overlayData
            : null;
        const rowSeatLabels = Array.isArray(overlay?.rowSeatLabels) ? overlay.rowSeatLabels : [];
        const sectionLabels = Array.isArray(overlay?.sectionLabels) ? overlay.sectionLabels : [];

        rowGeometries.forEach((segments) => appendPlanSegments(writer, layer, segments));

        aislePolygons.forEach((poly) => {
            const pts = Array.isArray(poly.points) ? poly.points : [];
            if (pts.length < 2) return;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i];
                const b = pts[(i + 1) % pts.length];
                appendDxfLine(writer, aisleLayer, a.x * 12, a.y * 12, b.x * 12, b.y * 12);
            }
        });

        rowSeatLabels.forEach((label) => appendDxfText(writer, rowLabelLayer, label.x, label.y, label.text, 8));

        const stackOffsetFt = 1.0;
        sectionLabels.forEach((label) => {
            const hasOcc = !!label.occText;
            appendDxfText(writer, sectionLabelLayer, label.x, label.y + (hasOcc ? stackOffsetFt : 0), label.text, hasOcc ? 12 : 13);
            if (hasOcc) {
                appendDxfText(writer, sectionLabelLayer, label.x, label.y - stackOffsetFt, label.occText, 9);
            }
        });
    });

    return writer.build();
}

export function buildPlanDxfExportDescriptor({
    template = null,
    runoffFt = 0,
    visualFocalXFt = undefined,
    tierPlanArtifacts = [],
    sportName = ''
} = {}) {
    if (!template || !Array.isArray(tierPlanArtifacts) || tierPlanArtifacts.length === 0) {
        console.warn('No Plan data to export');
        return null;
    }

    return {
        filename: `SeatingPlan_${slugifySportName(sportName)}.dxf`,
        content: buildPlanDxf({
            template,
            runoffFt,
            visualFocalXFt,
            tierPlanArtifacts
        }),
        type: 'text/plain'
    };
}
