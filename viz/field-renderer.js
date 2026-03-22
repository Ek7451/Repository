/**
 * Field Plan View Renderer (2D Canvas)
 * Renders top-down field shapes, runoff perimeters, and focal point markers.
 */

import { getSolverTierIndex } from '../core/profile-solver.js';
import { getCValueQuality } from '../core/sightline-calc.js';
import { resolvePlanFocalYFt } from '../core/sports-templates.js';
import {
    buildGeometryPaths,
    sampleAisleBand,
    samplePathPointByRatio,
    buildTierAisleAnalysis,
    buildTierAisleReferenceMap,
    buildResolvedTierAisleRatioMap,
    pickBestRowAisleSampling,
    resolveTierAisleStationRatios,
    getTierGoverningAisleWidthIn,
    getTierRenderedAisleWidthFt,
    getTierRenderedAisleWidthIn
} from '../core/aisle-layout.js';

const FIELD_THEME_COLORS = {
    light: {
        canvasBg: '#ffffff',
        grid: 'rgba(35, 35, 35, 0.06)',
        gridStrong: 'rgba(35, 35, 35, 0.10)',
        fieldEdge: '#7aae1a',   // JLG Green
        runoff: '#de850a',      // JLG Orange
        sectionCut: 'rgba(48, 48, 48, 0.6)',
        // Solid light-gray aisle fill; row step linework is drawn afterward so steps remain visible.
        aislesFill: 'rgba(231, 236, 228, 0.96)',
        aislesStroke: 'rgba(231, 236, 228, 0.00)',
        focal: '#232323',       // Rich black / charcoal
        legendText: '#4d535a'
    },
    dark: {
        canvasBg: '#0f151d',
        grid: 'rgba(232, 237, 242, 0.06)',
        gridStrong: 'rgba(232, 237, 242, 0.11)',
        fieldEdge: '#7fae3c',
        runoff: '#c88732',
        sectionCut: 'rgba(255, 255, 255, 0.6)',
        aislesFill: 'rgba(187, 198, 183, 0.3)',
        aislesStroke: 'rgba(187, 198, 183, 0.15)',
        focal: '#dbe2ea',
        legendText: '#b2bdca'
    }
};

function resolveSectionTemplateBoundaryU(path, aisleMap, boundaryKind, aisleIndex, fallbackU) {
    if (!path) return Number(fallbackU) || 0;
    if (boundaryKind === 'edge' || !Number.isFinite(Number(aisleIndex))) {
        return normalizePathU(path, fallbackU);
    }

    const aisleU = aisleMap instanceof Map ? aisleMap.get(aisleIndex) : NaN;
    return Number.isFinite(aisleU) ? normalizePathU(path, aisleU) : normalizePathU(path, fallbackU);
}

const FIELD_TIER_PLAN_COLORS = {
    light: [
        {
            rowBand: 'rgba(80, 85, 80, 0.92)',
            aisleFill: 'rgba(35, 35, 35, 0.8)',
            aisleStroke: 'rgba(35, 35, 35, 0.58)',
            rowOutline: 'rgba(32, 32, 32, 0.5)',
            frontEdge: 'rgba(80, 80, 80, 0.9)',
            perimeter: 'rgba(94, 94, 94, 0.7)'
        },
        {
            rowBand: 'rgba(136, 143, 135, 0.94)',
            aisleFill: 'rgba(111, 117, 110, 0.8)',
            aisleStroke: 'rgba(111, 117, 110, 0.66)',
            rowOutline: 'rgba(32, 32, 32, 0.5)',
            frontEdge: 'rgba(80, 80, 80, 0.9)',
            perimeter: 'rgba(94, 94, 94, 0.7)'
        },
        {
            rowBand: 'rgba(183, 190, 182, 0.98)',
            aisleFill: 'rgba(158, 166, 157, 0.8)',
            aisleStroke: 'rgba(138, 145, 136, 0.76)',
            rowOutline: 'rgba(32, 32, 32, 0.5)',
            frontEdge: 'rgba(80, 80, 80, 0.9)',
            perimeter: 'rgba(94, 94, 94, 0.7)'
        }
    ],
    dark: [
        {
            rowBand: 'rgba(154, 165, 153, 0.68)',
            aisleFill: 'rgba(35, 35, 35, 0.8)',
            aisleStroke: 'rgba(198, 208, 195, 0.22)',
            rowOutline: 'rgba(32, 32, 32, 0.3)',
            frontEdge: 'rgba(80, 80, 80, 0.9)',
            perimeter: 'rgba(94, 94, 94, 0.7)'
        },
        {
            rowBand: 'rgba(122, 139, 121, 0.72)',
            aisleFill: 'rgba(111, 117, 110, 0.8)',
            aisleStroke: 'rgba(157, 170, 155, 0.26)',
            rowOutline: 'rgba(32, 32, 32, 0.3)',
            frontEdge: 'rgba(80, 80, 80, 0.9)',
            perimeter: 'rgba(94, 94, 94, 0.7)'
        },
        {
            rowBand: 'rgba(103, 116, 101, 0.76)',
            aisleFill: 'rgba(158, 166, 157, 0.8)',
            aisleStroke: 'rgba(131, 145, 130, 0.29)',
            rowOutline: 'rgba(32, 32, 32, 0.3)',
            frontEdge: 'rgba(80, 80, 80, 0.9)',
            perimeter: 'rgba(94, 94, 94, 0.7)'
        }
    ]
};

const FIELD_QUALITY_COLORS_DARK = {
    Excellent: 'rgba(121, 164, 47, 0.84)',
    Good: 'rgba(66, 146, 111, 0.84)',
    Acceptable: 'rgba(194, 126, 30, 0.86)',
    Poor: 'rgba(181, 74, 71, 0.86)'
};

const EDGE_SPORTS = ['Ice Hockey', 'Football', 'Soccer', 'Basketball', 'Track'];

/**
 * @typedef {Object} BowlCornerPoints
 * @property {{ x: number, y: number }} tr_start
 * @property {{ x: number, y: number }} tr_end
 * @property {{ x: number, y: number }} tr_center
 * @property {{ x: number, y: number }} br_start
 * @property {{ x: number, y: number }} br_end
 * @property {{ x: number, y: number }} br_center
 * @property {{ x: number, y: number }} bl_start
 * @property {{ x: number, y: number }} bl_end
 * @property {{ x: number, y: number }} bl_center
 * @property {{ x: number, y: number }} tl_start
 * @property {{ x: number, y: number }} tl_end
 * @property {{ x: number, y: number }} tl_center
 * @property {number} fixed_right
 * @property {number} fixed_left
 * @property {number} fixed_top
 * @property {number} fixed_bottom
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 */

/**
 * @typedef {Object} BowlParams
 * @property {BowlCornerPoints} pts
 * @property {string} type
 * @property {string} corner
 * @property {number} r_eff
 */

function normalizeThemeName(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

let BRAND_FIELD_COLORS = FIELD_THEME_COLORS.light;
let TIER_PLAN_COLORS = FIELD_TIER_PLAN_COLORS.light;
let ACTIVE_FIELD_THEME = 'light';

function syncFieldThemeColors(theme = 'light') {
    theme = normalizeThemeName(theme);
    ACTIVE_FIELD_THEME = theme;
    BRAND_FIELD_COLORS = FIELD_THEME_COLORS[theme] || FIELD_THEME_COLORS.light;
    TIER_PLAN_COLORS = FIELD_TIER_PLAN_COLORS[theme] || FIELD_TIER_PLAN_COLORS.light;
}

function getRowStrokeColorForTheme(row, tierColors, colorByCValue) {
    if (!colorByCValue) return tierColors.rowBand;

    const q = getCValueQuality(row.c_value);
    if (ACTIVE_FIELD_THEME === 'dark') {
        return FIELD_QUALITY_COLORS_DARK[q.quality] || q.color;
    }
    return q.color;
}

function getTierPlanColors(tierIdx) {
    return TIER_PLAN_COLORS[Math.max(0, Math.min(2, Number(tierIdx) || 0))] || TIER_PLAN_COLORS[0];
}

const LABEL_FONT_FAMILY = 'Manrope, Inter, system-ui, sans-serif';
const SECTION_LABEL_MIN_SCALE = 0.5;     // px/ft, effectively always visible at normal extents
const ROW_SEATCOUNT_MIN_SCALE = 6.0;     // px/ft, tuned to show near close-up screenshot zoom
const SECTION_OCC_MIN_SCALE = 3.0;       // px/ft, kept aligned with row seat counts by default
const AISLE_OCC_MIN_SCALE = 6.0;         // px/ft, kept aligned with row seat counts by default
const AISLE_WIDTH_MIN_SCALE = 6.0;       // px/ft, kept aligned with row seat counts by default
// Target sizing: ~40% larger than original labels (not 2x).
const ROW_SEATCOUNT_LABEL_FONT_PX = 11.2;   // original 8
const SECTION_LABEL_FONT_PX_ZOOMED_OUT = 9.5;   // ~5% smaller than the prior full-extent size
const SECTION_LABEL_FONT_PX_ZOOMED_IN = 15.4;  // enlarged close-zoom behavior
const SECTION_LABEL_STACKED_FONT_PX = 14;   // original 10
const SECTION_OCC_LABEL_FONT_PX = 11.2;     // original 8
const AISLE_OCC_LABEL_FONT_PX = 10.8;
const AISLE_WIDTH_LABEL_FONT_PX = 10.2;
const SECTION_LABEL_STACK_OFFSET_PX = 12.6; // original 9
// Row seat-count labels should sit at a consistent distance from the visible aisle edge
// across all tiers (not a % of section width, which varies by tier/chamfer).
// Gap beyond the visible aisle edge for the row seat-count label center.
// Combined with aisle half-width this gives a consistent cross-tier offset.
const ROW_SEATCOUNT_LABEL_EDGE_OFFSET_FT = 2.0;
const ROW_SEATCOUNT_LABEL_MIN_T = 0.08;
const ROW_SEATCOUNT_LABEL_MAX_T = 0.45;
const SECTION_CUT_LINE_EXTENSION_FT = 10;
const SECTION_CUT_LINE_INTERSECTION_EPSILON = 1e-6;

function normalizeLoopU(u) {
    let out = Number(u) || 0;
    out %= 1;
    if (out < 0) out += 1;
    return out;
}

function wrappedSpan01(startU, endU) {
    const s = normalizeLoopU(startU);
    let e = normalizeLoopU(endU);
    if (e <= s) e += 1;
    return { start: s, end: e, span: e - s };
}

function interpolateLoopU(startU, endU, t) {
    const w = wrappedSpan01(startU, endU);
    return normalizeLoopU(w.start + w.span * Math.max(0, Math.min(1, Number(t) || 0)));
}

function wrappedDistanceOnPath(path, startU, endU) {
    if (!path || !(path.length > 0)) return 0;
    const w = wrappedSpan01(startU, endU);
    return w.span * path.length;
}

function clampUnit01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
}

function normalizePathU(path, u) {
    if (!path) return Number(u) || 0;
    return path.closed ? normalizeLoopU(u) : clampUnit01(u);
}

function interpolatePathSectionU(path, startU, endU, t) {
    const tt = Math.max(0, Math.min(1, Number(t) || 0));
    if (path && path.closed) return interpolateLoopU(startU, endU, tt);
    const a = clampUnit01(startU);
    const b = clampUnit01(endU);
    return clampUnit01(a + (b - a) * tt);
}

function sectionDistanceOnPath(path, startU, endU) {
    if (!path || !(path.length > 0)) return 0;
    if (path.closed) return wrappedDistanceOnPath(path, startU, endU);
    return Math.abs(clampUnit01(endU) - clampUnit01(startU)) * path.length;
}

function normalizeAnglePi(angleRad) {
    let angle = Number(angleRad) || 0;
    while (angle <= -Math.PI) angle += Math.PI * 2;
    while (angle > Math.PI) angle -= Math.PI * 2;
    return angle;
}

function compareReadableLabelAngles(aRad, bRad) {
    const candidates = [aRad, bRad].map((angle) => {
        const normalized = normalizeAnglePi(angle);
        const baselineX = Math.cos(normalized);
        const bottomX = Math.sin(normalized);
        const bottomY = Math.cos(normalized);
        return {
            angle: normalized,
            score: [
                baselineX < -1e-6 ? 1 : 0,
                (bottomY < -1e-6 || (Math.abs(bottomY) <= 1e-6 && bottomX < -1e-6)) ? 1 : 0,
                bottomX < -1e-6 ? 1 : 0
            ]
        };
    });

    for (let i = 0; i < candidates[0].score.length; i += 1) {
        if (candidates[0].score[i] !== candidates[1].score[i]) {
            return candidates[0].score[i] - candidates[1].score[i];
        }
    }
    return 0;
}

function normalizeReadableLabelAngle(angleRad) {
    const primary = normalizeAnglePi(angleRad);
    const flipped = normalizeAnglePi(primary + Math.PI);
    return compareReadableLabelAngles(primary, flipped) <= 0 ? primary : flipped;
}

function computeScreenAngleFromWorldVector(dx, dy) {
    return Math.atan2(-(Number(dy) || 0), Number(dx) || 0);
}

function isAngleForward(normalizedAngleRad, forwardAngleRad) {
    return Math.abs(normalizeAnglePi(normalizedAngleRad - forwardAngleRad)) < (Math.PI * 0.5);
}

function getFiniteAisleIndex(value) {
    return Number.isFinite(Number(value)) ? value : null;
}

function formatAisleWidthLabel(widthIn) {
    return `${formatComputedLabelNumber(widthIn)}"`;
}

function formatComputedLabelNumber(value, maxDecimals = 12) {
    const numericValue = Math.max(0, Number(value) || 0);
    for (let decimals = 0; decimals <= maxDecimals; decimals++) {
        const normalizedValue = Number(numericValue.toFixed(decimals));
        if (Math.abs(numericValue - normalizedValue) <= 1e-9) {
            return `${normalizedValue}`;
        }
    }
    return `${numericValue}`;
}

const PLAN_SEGMENT_ARC_RESOLUTION_DEG = 5;

export function buildFieldGeometrySegments(template, extraRunoff = 0) {
    if (!template || typeof template !== 'object') return [];

    const shape = template.shape;
    const segments = [];
    const addLine = (x, y) => segments.push({ cmd: 'lineTo', x, y });
    const addMove = (x, y) => segments.push({ cmd: 'moveTo', x, y });
    const addArc = (x, y, r, sa, ea, ccw) => segments.push({ cmd: 'arc', x, y, r, sa, ea, ccw });
    const addClose = () => segments.push({ cmd: 'closePath' });

    if (shape === 'rectangle') {
        const halfL = (template.field_length || 0) / 2 + extraRunoff;
        const halfW = (template.field_width || 0) / 2 + extraRunoff;
        addMove(-halfL, -halfW);
        addLine(halfL, -halfW);
        addLine(halfL, halfW);
        addLine(-halfL, halfW);
        addClose();
        return segments;
    }

    if (shape === 'rounded_rect') {
        const halfL = (template.field_length || 0) / 2 + extraRunoff;
        const halfW = (template.field_width || 0) / 2 + extraRunoff;
        const r = Math.min((template.corner_radius || 0) + extraRunoff, halfL, halfW);
        const rx = halfL - r;
        const ry = halfW - r;

        addMove(-rx, -halfW);
        addLine(rx, -halfW);
        addArc(rx, -ry, r, -Math.PI / 2, 0, false);
        addLine(halfL, ry);
        addArc(rx, ry, r, 0, Math.PI / 2, false);
        addLine(-rx, halfW);
        addArc(-rx, ry, r, Math.PI / 2, Math.PI, false);
        addLine(-halfL, -ry);
        addArc(-rx, -ry, r, Math.PI, 1.5 * Math.PI, false);
        addClose();
        return segments;
    }

    if (shape === 'oval') {
        const baseHalfWidth = (template.field_width || 0) / 2;
        const halfW = baseHalfWidth + extraRunoff;
        // Track templates store the overall apex-to-apex length. The semicircle centers
        // stay fixed while runoff grows the arc radius uniformly outward.
        const halfStraight = Math.max(0, ((template.straight_length || 0) / 2) - baseHalfWidth);

        addMove(-halfStraight, halfW);
        addLine(halfStraight, halfW);
        addArc(halfStraight, 0, halfW, Math.PI / 2, -Math.PI / 2, true);
        addLine(-halfStraight, -halfW);
        addArc(-halfStraight, 0, halfW, -Math.PI / 2, Math.PI / 2, true);
        addClose();
        return segments;
    }

    if (shape === 'arc') {
        const radius = (template.field_radius || 0) + extraRunoff;
        const halfAngle = ((template.arc_angle || 90) / 2) * Math.PI / 180;
        const startAngle = Math.PI / 2 - halfAngle;
        const endAngle = Math.PI / 2 + halfAngle;

        addMove(0, 0);
        addLine(
            radius * Math.cos(startAngle),
            radius * Math.sin(startAngle)
        );
        addArc(0, 0, radius, startAngle, endAngle, false);
        addLine(0, 0);
        return segments;
    }

    return [];
}

function buildBowlParams(bowlConfig, offset) {
    const W = (bowlConfig.width || 200) / 2;
    let type = bowlConfig.type || 'Full';
    const L = (type.includes('Side') && bowlConfig.sideLength) ? (bowlConfig.sideLength / 2) : (bowlConfig.length || 300) / 2;
    let corner = bowlConfig.corner || 'Chamfer';
    let r = bowlConfig.radius || 0;
    const chamferReferenceOffset = Math.max(0, Number(bowlConfig.chamferReferenceOffset) || 0);

    const d = offset;
    const w_eff = W + d;
    const l_eff = L + d;

    const right = l_eff;
    const left = -l_eff;
    const top = w_eff;
    const bottom = -w_eff;

    if (r < 1) {
        corner = 'Square';
        r = 0;
    }

    const r_eff = (corner === 'Radius') ? (r + d) : 0;
    const chamfer_growth_offset = Math.max(0, d - chamferReferenceOffset);
    const chamfer_leg = (corner === 'Chamfer') ? (r + chamfer_growth_offset * 0.5858) : 0;
    const c_size = Math.max(r_eff, chamfer_leg);

    const pts = {
        tr_start: { x: right - c_size, y: top },
        tr_end: { x: right, y: top - c_size },
        tr_center: { x: right - r_eff, y: top - r_eff },

        br_start: { x: right, y: bottom + c_size },
        br_end: { x: right - c_size, y: bottom },
        br_center: { x: right - r_eff, y: bottom + r_eff },

        bl_start: { x: left + c_size, y: bottom },
        bl_end: { x: left, y: bottom + c_size },
        bl_center: { x: left + r_eff, y: bottom + r_eff },

        tl_start: { x: left, y: top - c_size },
        tl_end: { x: left + c_size, y: top },
        tl_center: { x: left + r_eff, y: top - r_eff },

        fixed_right: L,
        fixed_left: -L,
        fixed_top: W,
        fixed_bottom: -W,

        left, right, top, bottom
    };

    return { pts, type, corner, r_eff };
}

function normalizeBowlType(type) {
    if (type === 'U-Shape (End 1)' || type === 'C-Shape') return 'U-End1';
    if (type === 'U-Shape (End 2)' || type === 'U-Shape') return 'U-End2';
    return String(type || 'Full');
}

function resolveExplicitBowlBaseDimensions(bowlConfig) {
    const baseLength = Math.max(
        0,
        Number(
            bowlConfig?.length
            ?? bowlConfig?.sideLength
            ?? 300
        ) || 0
    );
    const baseWidth = Math.max(
        0,
        Number(
            bowlConfig?.width
            ?? bowlConfig?.endLength
            ?? 200
        ) || 0
    );

    return {
        halfLength: baseLength / 2,
        halfWidth: baseWidth / 2,
        sideLength: Math.max(0, Number(bowlConfig?.sideLength ?? baseLength) || 0),
        endLength: Math.max(0, Number(bowlConfig?.endLength ?? baseWidth) || 0)
    };
}

function pushPolylineSegments(segments, points = [], { close = false } = {}) {
    const safePoints = (points || []).filter((point) => (
        point &&
        Number.isFinite(Number(point.x)) &&
        Number.isFinite(Number(point.y))
    ));
    if (safePoints.length < 2) return;

    segments.push({ cmd: 'moveTo', x: safePoints[0].x, y: safePoints[0].y });
    for (let index = 1; index < safePoints.length; index += 1) {
        segments.push({ cmd: 'lineTo', x: safePoints[index].x, y: safePoints[index].y });
    }
    if (close) {
        segments.push({ cmd: 'closePath' });
    }
}

function buildExplicitBowlSegments(bowlConfig, offset) {
    const type = normalizeBowlType(bowlConfig?.type);
    if (!['Sides3', 'Sides4'].includes(type)) {
        return null;
    }

    const {
        halfLength,
        halfWidth,
        sideLength,
        endLength
    } = resolveExplicitBowlBaseDimensions(bowlConfig);
    const offsetFt = Math.max(0, Number(offset) || 0);
    const leftX = -(halfLength + offsetFt);
    const rightX = halfLength + offsetFt;
    const topY = halfWidth + offsetFt;
    const bottomY = -(halfWidth + offsetFt);
    const centeredSideHalf = sideLength / 2;
    const centeredTopLeftX = -centeredSideHalf;
    const centeredTopRightX = centeredSideHalf;
    const centeredEndHalf = endLength / 2;
    const centeredLeftBottomY = -centeredEndHalf;
    const centeredLeftTopY = centeredEndHalf;
    const segments = [];

    if (type === 'Sides3') {
        pushPolylineSegments(segments, [
            { x: centeredTopLeftX, y: topY },
            { x: centeredTopRightX, y: topY }
        ]);
        pushPolylineSegments(segments, [
            { x: centeredTopLeftX, y: bottomY },
            { x: centeredTopRightX, y: bottomY }
        ]);
        pushPolylineSegments(segments, [
            { x: leftX, y: centeredLeftBottomY },
            { x: leftX, y: centeredLeftTopY }
        ]);
        return segments;
    }

    pushPolylineSegments(segments, [
        { x: centeredTopLeftX, y: topY },
        { x: centeredTopRightX, y: topY }
    ]);
    pushPolylineSegments(segments, [
        { x: centeredTopLeftX, y: bottomY },
        { x: centeredTopRightX, y: bottomY }
    ]);
    pushPolylineSegments(segments, [
        { x: leftX, y: centeredLeftBottomY },
        { x: leftX, y: centeredLeftTopY }
    ]);
    pushPolylineSegments(segments, [
        { x: rightX, y: centeredLeftBottomY },
        { x: rightX, y: centeredLeftTopY }
    ]);
    return segments;
}

function resolveUOpenTerminal(bowlConfig, normalizedType, pts) {
    const numericEndLength = Number(bowlConfig?.endLength);
    if (!Number.isFinite(numericEndLength)) {
        return normalizedType === 'U-End1' ? pts.fixed_right : pts.fixed_top;
    }

    const safeEndLength = Math.max(0, numericEndLength);
    const { pts: basePts } = buildBowlParams(
        { ...bowlConfig, type: normalizedType },
        0
    );

    if (normalizedType === 'U-End1') {
        return basePts.tl_end.x + safeEndLength;
    }

    return basePts.br_start.y + safeEndLength;
}

export function buildBowlGeometrySegments(bowlConfig, offset) {
    if (bowlConfig.shape === 'arc') {
        const r = (bowlConfig.radius_arc || 325) + offset;
        const halfAngle = ((bowlConfig.arc_angle || 90) / 2) * Math.PI / 180;
        const startAngle = Math.PI / 2 - halfAngle;
        const endAngle = Math.PI / 2 + halfAngle;

        const segments = [];
        const addLine = (x, y) => segments.push({ cmd: 'lineTo', x, y });
        const addMove = (x, y) => segments.push({ cmd: 'moveTo', x, y });
        const addArc = (x, y, rad, sa, ea, ccw) => segments.push({ cmd: 'arc', x, y, r: rad, sa, ea, ccw });
        const addClose = () => segments.push({ cmd: 'closePath' });

        let type = bowlConfig.type || 'Full';
        const dx1 = r * Math.cos(startAngle);
        const dy1 = r * Math.sin(startAngle);
        const dx2 = r * Math.cos(endAngle);
        const dy2 = r * Math.sin(endAngle);

        const dBack = offset;
        const hx = 0;
        const hy = -dBack;

        if (type === 'Sides') {
            addMove(dx1, dy1);
            addLine(hx, hy);
            addMove(hx, hy);
            addLine(dx2, dy2);
        } else if (type === 'U-End1' || type === 'U-Shape (End 1)' || type === 'C-Shape') {
            addMove(dx1, dy1);
            addArc(0, 0, r, startAngle, endAngle, false);
            addLine(hx, hy);
            addLine(dx1, dy1);
        } else {
            addMove(dx2, dy2);
            addLine(hx, hy);
            addLine(dx1, dy1);
            addArc(0, 0, r, startAngle, endAngle, false);
            addClose();
        }

        return segments;
    }

    const explicitSegments = buildExplicitBowlSegments(bowlConfig, offset);
    if (Array.isArray(explicitSegments) && explicitSegments.length > 0) {
        return explicitSegments;
    }

    const { pts, type, corner, r_eff } = buildBowlParams(bowlConfig, offset);
    const normalizedType = normalizeBowlType(type);
    const segments = [];

    const addLine = (x, y) => segments.push({ cmd: 'lineTo', x, y });
    const addMove = (x, y) => segments.push({ cmd: 'moveTo', x, y });
    const addArc = (x, y, r, sa, ea, ccw) => segments.push({ cmd: 'arc', x, y, r, sa, ea, ccw });
    const addClose = () => segments.push({ cmd: 'closePath' });

    if (normalizedType === 'Sides') {
        addMove(pts.fixed_left, pts.bottom);
        addLine(pts.fixed_right, pts.bottom);
        addMove(pts.fixed_left, pts.top);
        addLine(pts.fixed_right, pts.top);
    } else if (normalizedType === 'Side1') {
        addMove(pts.fixed_left, pts.bottom);
        addLine(pts.fixed_right, pts.bottom);
    } else if (normalizedType === 'Side2') {
        addMove(pts.fixed_left, pts.top);
        addLine(pts.fixed_right, pts.top);
    } else if (normalizedType === 'U-End1') {
        const fixedRight = resolveUOpenTerminal(bowlConfig, normalizedType, pts);
        addMove(fixedRight, pts.top);
        addLine(pts.tl_end.x, pts.top);

        if (corner === 'Radius') addArc(pts.tl_center.x, pts.tl_center.y, r_eff, 0.5 * Math.PI, 1.0 * Math.PI, false);
        else if (corner === 'Chamfer') addLine(pts.tl_start.x, pts.tl_start.y);
        else addLine(pts.left, pts.top);

        addLine(pts.left, pts.bl_end.y);

        if (corner === 'Radius') addArc(pts.bl_center.x, pts.bl_center.y, r_eff, 1.0 * Math.PI, 1.5 * Math.PI, false);
        else if (corner === 'Chamfer') addLine(pts.bl_start.x, pts.bl_start.y);
        else addLine(pts.left, pts.bottom);

        addLine(fixedRight, pts.bottom);
    } else if (normalizedType === 'U-End2') {
        const fixedTop = resolveUOpenTerminal(bowlConfig, normalizedType, pts);
        addMove(pts.right, fixedTop);
        addLine(pts.right, pts.br_start.y);

        if (corner === 'Radius') addArc(pts.br_center.x, pts.br_center.y, r_eff, 0, 1.5 * Math.PI, true);
        else if (corner === 'Chamfer') addLine(pts.br_end.x, pts.br_end.y);
        else addLine(pts.right, pts.bottom);

        addLine(pts.bl_start.x, pts.bottom);

        if (corner === 'Radius') addArc(pts.bl_center.x, pts.bl_center.y, r_eff, 1.5 * Math.PI, 1.0 * Math.PI, true);
        else if (corner === 'Chamfer') addLine(pts.bl_end.x, pts.bl_end.y);
        else addLine(pts.left, pts.bottom);

        addLine(pts.left, fixedTop);
    } else {
        addMove(pts.tr_start.x, pts.top);

        if (corner === 'Radius') addArc(pts.tr_center.x, pts.tr_center.y, r_eff, 0.5 * Math.PI, 0, true);
        else if (corner === 'Chamfer') addLine(pts.tr_end.x, pts.tr_end.y);
        else addLine(pts.right, pts.top);

        addLine(pts.right, pts.br_start.y);

        if (corner === 'Radius') addArc(pts.br_center.x, pts.br_center.y, r_eff, 0, 1.5 * Math.PI, true);
        else if (corner === 'Chamfer') addLine(pts.br_end.x, pts.br_end.y);
        else addLine(pts.right, pts.bottom);

        addLine(pts.bl_start.x, pts.bottom);

        if (corner === 'Radius') addArc(pts.bl_center.x, pts.bl_center.y, r_eff, 1.5 * Math.PI, 1.0 * Math.PI, true);
        else if (corner === 'Chamfer') addLine(pts.bl_end.x, pts.bl_end.y);
        else addLine(pts.left, pts.bottom);

        addLine(pts.left, pts.tl_start.y);

        if (corner === 'Radius') addArc(pts.tl_center.x, pts.tl_center.y, r_eff, 1.0 * Math.PI, 0.5 * Math.PI, true);
        else if (corner === 'Chamfer') addLine(pts.tl_end.x, pts.tl_end.y);
        else addLine(pts.left, pts.top);

        addClose();
    }

    return segments;
}

function calculateSegmentLength(segments) {
    let totalLength = 0;
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;

    (segments || []).forEach((segment) => {
        if (segment.cmd === 'moveTo') {
            lastX = segment.x;
            lastY = segment.y;
            startX = segment.x;
            startY = segment.y;
        } else if (segment.cmd === 'lineTo') {
            totalLength += Math.hypot(segment.x - lastX, segment.y - lastY);
            lastX = segment.x;
            lastY = segment.y;
        } else if (segment.cmd === 'arc') {
            let angle = segment.ea - segment.sa;
            if (segment.ccw) {
                while (angle > 0) angle -= 2 * Math.PI;
                while (angle <= -2 * Math.PI) angle += 2 * Math.PI;
            } else {
                while (angle < 0) angle += 2 * Math.PI;
                while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
            }
            totalLength += segment.r * Math.abs(angle);
            lastX = segment.x + segment.r * Math.cos(segment.ea);
            lastY = segment.y + segment.r * Math.sin(segment.ea);
        } else if (segment.cmd === 'closePath') {
            totalLength += Math.hypot(startX - lastX, startY - lastY);
            lastX = startX;
            lastY = startY;
        }
    });

    return totalLength;
}

function computeSegmentBounds(segments) {
    if (!segments.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const addPoint = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    segments.forEach((segment) => {
        if (segment.cmd === 'moveTo' || segment.cmd === 'lineTo') {
            addPoint(segment.x, segment.y);
            return;
        }

        if (segment.cmd === 'arc') {
            const steps = 96;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const angle = segment.sa + ((segment.ea - segment.sa) * t);
                addPoint(
                    segment.x + (segment.r * Math.cos(angle)),
                    segment.y + (segment.r * Math.sin(angle))
                );
            }
        }
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return null;
    }

    return { minX, minY, maxX, maxY };
}

function buildPath2DFromSegments(segments) {
    const path = new Path2D();

    (segments || []).forEach((segment) => {
        if (segment.cmd === 'moveTo') path.moveTo(segment.x, segment.y);
        else if (segment.cmd === 'lineTo') path.lineTo(segment.x, segment.y);
        else if (segment.cmd === 'arc') path.arc(segment.x, segment.y, segment.r, segment.sa, segment.ea, segment.ccw);
        else if (segment.cmd === 'closePath') path.closePath();
    });

    return path;
}

export function buildPlanSubpathsFromSegments(segments, arcResolutionDeg = PLAN_SEGMENT_ARC_RESOLUTION_DEG) {
    const subpaths = [];
    let currentPoints = null;

    const addPoint = (x, y) => {
        if (!currentPoints) {
            currentPoints = [];
            subpaths.push(currentPoints);
        }
        currentPoints.push({ x, y });
    };

    (segments || []).forEach((segment) => {
        if (segment.cmd === 'moveTo') {
            currentPoints = [];
            subpaths.push(currentPoints);
            addPoint(segment.x, segment.y);
            return;
        }

        if (segment.cmd === 'lineTo') {
            addPoint(segment.x, segment.y);
            return;
        }

        if (segment.cmd === 'arc') {
            let start = segment.sa;
            let end = segment.ea;
            if (segment.ccw) {
                while (end < start) end += Math.PI * 2;
            } else {
                while (end > start) end -= Math.PI * 2;
            }

            const totalAngle = Math.abs(end - start);
            const steps = Math.max(1, Math.ceil(totalAngle * (180 / Math.PI) / Math.max(0.1, arcResolutionDeg)));

            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const angle = start + (end - start) * t;
                addPoint(
                    segment.x + segment.r * Math.cos(angle),
                    segment.y + segment.r * Math.sin(angle)
                );
            }
            return;
        }

        if (segment.cmd === 'closePath' && currentPoints && currentPoints.length > 0) {
            currentPoints.push({ x: currentPoints[0].x, y: currentPoints[0].y });
        }
    });

    return subpaths.filter((subpath) => subpath.length > 0);
}

export function buildBowlGeometrySubpaths(bowlConfig, offset, arcResolutionDeg = PLAN_SEGMENT_ARC_RESOLUTION_DEG) {
    return buildPlanSubpathsFromSegments(
        buildBowlGeometrySegments(bowlConfig, offset),
        arcResolutionDeg
    );
}

export function buildBowlBandPolygons(bowlConfig, frontOffset, backOffset, arcResolutionDeg = PLAN_SEGMENT_ARC_RESOLUTION_DEG) {
    const frontSubpaths = buildBowlGeometrySubpaths(bowlConfig, frontOffset, arcResolutionDeg);
    const backSubpaths = buildBowlGeometrySubpaths(bowlConfig, backOffset, arcResolutionDeg);
    const polygons = [];
    const pathCount = Math.min(frontSubpaths.length, backSubpaths.length);

    for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
        const frontPoints = Array.isArray(frontSubpaths[pathIndex]) ? frontSubpaths[pathIndex].slice() : [];
        const backPoints = Array.isArray(backSubpaths[pathIndex]) ? backSubpaths[pathIndex].slice() : [];
        if (frontPoints.length < 2 || backPoints.length < 2) continue;

        // Preserve the explicit closure edge for closed contours. In a full bowl,
        // that closing segment is the top run, so trimming the repeated endpoint
        // drops the visible band across that edge.
        const polygon = frontPoints.concat(backPoints.slice().reverse());
        if (polygon.length < 4) continue;
        polygons.push({
            pathIndex,
            points: polygon
        });
    }

    return polygons;
}

function pushUniqueIntersectionY(intersections, nextY) {
    if (!Number.isFinite(nextY)) return;
    if (intersections.some((value) => Math.abs(value - nextY) <= SECTION_CUT_LINE_INTERSECTION_EPSILON)) {
        return;
    }
    intersections.push(nextY);
}

function collectVerticalRayIntersectionYs(subpaths, rayX = 0) {
    const intersections = [];
    const safeRayX = Number(rayX) || 0;

    (subpaths || []).forEach((points) => {
        if (!Array.isArray(points) || points.length < 2) return;

        for (let index = 1; index < points.length; index += 1) {
            const prev = points[index - 1];
            const next = points[index];
            const x1 = Number(prev?.x);
            const y1 = Number(prev?.y);
            const x2 = Number(next?.x);
            const y2 = Number(next?.y);
            if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

            const dx = x2 - x1;
            if (Math.abs(dx) <= SECTION_CUT_LINE_INTERSECTION_EPSILON) {
                if (Math.abs(x1 - safeRayX) > SECTION_CUT_LINE_INTERSECTION_EPSILON) continue;
                pushUniqueIntersectionY(intersections, y1);
                pushUniqueIntersectionY(intersections, y2);
                continue;
            }

            const minX = Math.min(x1, x2) - SECTION_CUT_LINE_INTERSECTION_EPSILON;
            const maxX = Math.max(x1, x2) + SECTION_CUT_LINE_INTERSECTION_EPSILON;
            if (safeRayX < minX || safeRayX > maxX) continue;

            const t = (safeRayX - x1) / dx;
            if (t < -SECTION_CUT_LINE_INTERSECTION_EPSILON || t > 1 + SECTION_CUT_LINE_INTERSECTION_EPSILON) continue;

            const clampedT = Math.max(0, Math.min(1, t));
            pushUniqueIntersectionY(intersections, y1 + ((y2 - y1) * clampedT));
        }
    });

    return intersections;
}

function findNearestVerticalRayIntersectionY(intersections, originY, direction = -1) {
    const safeOriginY = Number(originY) || 0;
    const safeDirection = direction >= 0 ? 1 : -1;
    const candidates = (intersections || []).filter((value) => (
        safeDirection < 0
            ? value < (safeOriginY - SECTION_CUT_LINE_INTERSECTION_EPSILON)
            : value > (safeOriginY + SECTION_CUT_LINE_INTERSECTION_EPSILON)
    ));
    if (!candidates.length) return null;
    return safeDirection < 0 ? Math.max(...candidates) : Math.min(...candidates);
}

function approximatePathSignedArea(path, samples = 160) {
    if (!path || !(path.length > 0) || !path.closed) return 0;
    const pts = [];
    const n = Math.max(24, Math.floor(samples));
    for (let i = 0; i < n; i++) {
        pts.push(samplePathPointByRatio(path, i / n));
    }
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area2 += (a.x * b.y) - (b.x * a.y);
    }
    return area2 * 0.5;
}

export class FieldRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.padding = 160;
        this._theme = normalizeThemeName(options?.theme);

        // Zoom/pan state
        this._userZoom = 1.0;
        this._panX = 0;
        this._panY = 0;
        this._userHasZoomed = false;
        this._isPanning = false;
        this._panStartX = 0;
        this._panStartY = 0;

        this._setupInteraction();
        syncFieldThemeColors(this._theme);
    }

    setTheme(theme) {
        this._theme = normalizeThemeName(theme);
        syncFieldThemeColors(this._theme);
    }

    getGeometryPort() {
        return {
            calculateRowLength: this.calculateRowLength.bind(this),
            generateTierAisleLayout: this.generateTierAisleLayout.bind(this),
            getTierSectionMetricsOverlayData: this.getTierSectionMetricsOverlayData.bind(this),
            getTierAisleBandPolygons: this.getTierAisleBandPolygons.bind(this),
            getBowlGeometrySegments: this.getBowlGeometrySegments.bind(this),
            getFieldGeometrySegments: this.getFieldGeometrySegments.bind(this),
            getOffsetCorrection: this.getOffsetCorrection.bind(this),
            getVisualFocalY: this.getVisualFocalY.bind(this),
            buildTierAisleLayouts: this.buildTierAisleLayouts.bind(this)
        };
    }

    _rerenderFromLastArgs() {
        if (!this._lastArgs) return;
        this.render(
            this._lastArgs[0],
            this._lastArgs[1],
            this._lastArgs[2],
            this._lastArgs[3],
            this._lastArgs[4],
            this._lastArgs[5],
            this._lastArgs[6],
            this._lastArgs[7]
        );
    }

    _resetToZoomExtents() {
        this._userZoom = 1.0;
        this._panX = 0;
        this._panY = 0;
        this._userHasZoomed = false;
        if (this._lastArgs) {
            this._rerenderFromLastArgs();
        }
    }

    _getFitPaddingPx() {
        return {
            horizontal: 0,
            vertical: this.padding
        };
    }

    _getFitViewport() {
        const viewport = {
            offsetX: 0,
            offsetY: 0,
            width: this.canvas.width,
            height: this.canvas.height
        };
        const parent = this.canvas?.parentElement;
        if (!parent || typeof getComputedStyle !== 'function') {
            return viewport;
        }

        const style = getComputedStyle(parent);
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const paddingRight = parseFloat(style.paddingRight) || 0;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;

        viewport.offsetX = paddingLeft;
        viewport.offsetY = paddingTop;
        viewport.width = Math.max(1, this.canvas.width - paddingLeft - paddingRight);
        viewport.height = Math.max(1, this.canvas.height - paddingTop - paddingBottom);
        return viewport;
    }

    _getBaseFitState(bounds, viewport = this._getFitViewport()) {
        const scale = this._calcScale(bounds, viewport.width, viewport.height);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        return {
            scale,
            centerX,
            centerY,
            viewport,
            tx: viewport.offsetX + (viewport.width / 2) - (centerX * scale),
            ty: viewport.offsetY + (viewport.height / 2) + (centerY * scale)
        };
    }

    _setupInteraction() {
        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1 || e.button === 0) { // Middle or Left
                e.preventDefault();
                this._isPanning = true;
                this._panStartX = e.clientX;
                this._panStartY = e.clientY;
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (this._isPanning) {
                const dx = e.clientX - this._panStartX;
                const dy = e.clientY - this._panStartY;
                this._panX += dx;
                this._panY += dy;
                this._panStartX = e.clientX;
                this._panStartY = e.clientY;
                this._userHasZoomed = true;

                if (this._lastArgs) {
                    this._rerenderFromLastArgs();
                }
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            this._isPanning = false;
        });

        this.canvas.addEventListener('mouseleave', () => {
            this._isPanning = false;
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!this._lastArgs) return;

            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const oldZoom = this._userZoom;
            this._userZoom *= zoomFactor;
            this._userZoom = Math.max(0.1, Math.min(20, this._userZoom));

            const ratio = this._userZoom / oldZoom;

            // Need base auto-fit variables to convert back to panX/Y
            const template = this._lastArgs[0];
            const runoff = this._lastArgs[1] != null ? this._lastArgs[1] : template.runoff;
            const bounds = this._getBounds(template, runoff, this._lastArgs[2], this._lastArgs[3]);
            const fitViewport = this._getFitViewport();
            const baseFit = this._getBaseFitState(bounds, fitViewport);
            const baseTx = baseFit.tx;
            const baseTy = baseFit.ty;
            const cx = fitViewport.offsetX + (fitViewport.width / 2);
            const cy = fitViewport.offsetY + (fitViewport.height / 2);

            // Calculate current translation
            let currentTx = baseTx, currentTy = baseTy;
            if (this._userHasZoomed) {
                currentTx = cx + (baseTx - cx) * oldZoom + this._panX;
                currentTy = cy + (baseTy - cy) * oldZoom + this._panY;
            }

            // Calculate new translation to keep mx/my stationary
            const newTx = mx - (mx - currentTx) * ratio;
            const newTy = my - (my - currentTy) * ratio;

            // Extract new _panX and _panY
            this._panX = newTx - cx - (baseTx - cx) * this._userZoom;
            this._panY = newTy - cy - (baseTy - cy) * this._userZoom;

            this._userHasZoomed = true;
            this._rerenderFromLastArgs();
        }, { passive: false });

        this.canvas.addEventListener('dblclick', () => {
            this._resetToZoomExtents();
        });

        // Middle mouse button double-click for zoom extents
        this._middleClickTime = 0;
        this.canvas.addEventListener('auxclick', (e) => {
            if (e.button === 1) { // Middle button
                const now = Date.now();
                if (now - this._middleClickTime < 400) {
                    this._resetToZoomExtents();
                }
                this._middleClickTime = now;
            }
        });
    }

    /**
     * Render the field for a given template.
     * @param {Object} template - Sport template from sports-templates.js
     * @param {number} [customRunoff] - Optional override for runoff distance
     * @param {Array} [solvers] - Array of ProfileSolver instances
     * @param {Object} [visibility] - Visibility toggles { showSeating, t1, t2, t3, colorByCValue, showSectionMetrics }
     */
    render(template, customRunoff, solvers, visibility, visualFocalX = 0, bowlConfig = null, offsetCorrection = 0, tierAisleLayouts = []) {
        // Cache args for re-render during interaction
        this._lastArgs = [template, customRunoff, solvers, visibility, visualFocalX, bowlConfig, offsetCorrection, tierAisleLayouts];
        syncFieldThemeColors(this._theme);

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = BRAND_FIELD_COLORS.canvasBg;
        ctx.fillRect(0, 0, w, h);

        if (!template) return;

        const runoff = customRunoff != null ? customRunoff : template.runoff;

        // Calculate bounds for auto-fit, including seating if visible
        const bounds = this._getBounds(template, runoff, solvers, visibility);
        // Base auto-fit calculations
        const fitViewport = this._getFitViewport();
        const baseFit = this._getBaseFitState(bounds, fitViewport);
        const baseScale = baseFit.scale;
        const baseTx = baseFit.tx;
        const baseTy = baseFit.ty; // Flip Y

        let scale, tx, ty;

        if (this._userHasZoomed) {
            scale = baseScale * this._userZoom;
            const cx = fitViewport.offsetX + (fitViewport.width / 2);
            const cy = fitViewport.offsetY + (fitViewport.height / 2);

            // Apply zoom around center, then pan
            tx = cx + (baseTx - cx) * this._userZoom + this._panX;
            ty = cy + (baseTy - cy) * this._userZoom + this._panY;
        } else {
            scale = baseScale;
            tx = baseTx;
            ty = baseTy;
        }

        // Draw the grid across the visible canvas, not just the fitted geometry bounds.
        const visibleBounds = this._getVisibleWorldBounds(scale, tx, ty, w, h);
        this._drawGrid(ctx, w, h, scale, visibleBounds, tx, ty);

        // Save context for transformations
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, -scale); // Flip Y so +Y is up

        // Draw field markings beneath seating geometry so tier outlines stay visually on top.
        // Draw runoff perimeter
        this._drawShape(ctx, template, runoff, {
            strokeStyle: BRAND_FIELD_COLORS.runoff,
            lineWidth: 2 / scale,
            lineDash: [8 / scale, 6 / scale]
        });

        // Draw field edge
        this._drawShape(ctx, template, 0, {
            strokeStyle: BRAND_FIELD_COLORS.fieldEdge,
            lineWidth: 2.5 / scale,
            lineDash: []
        });

        if (solvers && visibility && visibility.showSeating) {
            this._drawSeating(ctx, solvers, template, visibility, scale, visualFocalX, bowlConfig, offsetCorrection, tierAisleLayouts);
        }

        this._drawSectionCutLine(ctx, solvers, visibility, scale, visualFocalX, bowlConfig, offsetCorrection);

        // Draw focal point
        this._drawFocalPoint(ctx, template, scale, visualFocalX);

        ctx.restore();

        // Draw legend
        this._drawLegend(ctx, w, h);
    }



    _getBounds(template, runoff, solvers, visibility) {
        // Start with field bounds
        const shape = template.shape;
        let maxX, maxY;
        if (shape === 'arc') {
            const r = (template.field_radius || 0) + runoff;
            maxX = r; maxY = r;
        } else if (shape === 'oval') {
            maxX = (template.straight_length || 0) / 2 + runoff;
            maxY = (template.field_width || 0) / 2 + runoff;
        } else {
            maxX = (template.field_length || 0) / 2 + runoff;
            maxY = (template.field_width || 0) / 2 + runoff;
        }

        let bounds = { minX: -maxX, maxX, minY: -maxY, maxY };

        // Expand for seating — include full bowl perimeter in all directions
        if (solvers && visibility && visibility.showSeating) {
            let maxDist = 0;
            let minDist = 0;
            let hasSeating = false;

            solvers.forEach((s, i) => {
                if (i === 0 && !visibility.t1) return;
                if (i === 1 && !visibility.t2) return;
                if (i === 2 && !visibility.t3) return;
                if (s.rows && s.rows.length) {
                    hasSeating = true;
                    const last = s.rows[s.rows.length - 1];
                    const first = s.rows[0];
                    if (last.x > maxDist) maxDist = last.x;
                    if (first.x < minDist) minDist = first.x;
                }
            });

            if (hasSeating) {
                const fy = 0;
                if (shape === 'arc') {
                    if (maxDist > bounds.maxY) bounds.maxY = maxDist;
                    if (maxDist > bounds.maxX) bounds.maxX = maxDist;
                } else {
                    // Bowl wraps around all sides — expand in all 4 directions
                    const bottomY = fy - maxDist;
                    if (bottomY < bounds.minY) bounds.minY = bottomY;
                    const topY = fy + maxDist;
                    if (topY > bounds.maxY) bounds.maxY = topY;
                    const baseFieldLength = Number(template.field_length || template.straight_length || 0);
                    const leftX = -((baseFieldLength / 2) + maxDist);
                    if (leftX < bounds.minX) bounds.minX = leftX;
                    const rightX = (baseFieldLength / 2) + maxDist;
                    if (rightX > bounds.maxX) bounds.maxX = rightX;
                }

                // Keep extents breathing room symmetric so zoom extents centers
                // the visible bowl consistently regardless of available width,
                // while leaving room for the section cut indicator extension.
                const shadowPad = Math.max(maxDist * 0.15, SECTION_CUT_LINE_EXTENSION_FT);
                bounds.minX -= shadowPad;
                bounds.maxX += shadowPad;
                bounds.minY -= shadowPad;
                bounds.maxY += shadowPad;
            }
        }

        return bounds;
    }

    _calcScale(bounds, w, h) {
        const rangeX = bounds.maxX - bounds.minX;
        const rangeY = bounds.maxY - bounds.minY;
        const { horizontal, vertical } = this._getFitPaddingPx();
        // Avoid div/0
        const rx = rangeX || 100;
        const ry = rangeY || 100;

        // Keep vertical framing stable across layout width changes and only clamp
        // downward when the current viewport would otherwise clip horizontally.
        const usableWidth = Math.max(1, w - (horizontal * 2));
        const usableHeight = Math.max(1, h - (vertical * 2));
        const scaleY = usableHeight / ry;
        const scaleX = usableWidth / rx;
        return Math.min(scaleY, scaleX);
    }

    _getVisibleWorldBounds(scale, tx, ty, width, height) {
        return {
            minX: (0 - tx) / scale,
            maxX: (width - tx) / scale,
            minY: (ty - height) / scale,
            maxY: ty / scale
        };
    }

    _drawGrid(ctx, w, h, scale, bounds, tx, ty) {
        ctx.save();
        ctx.strokeStyle = BRAND_FIELD_COLORS.grid;
        ctx.lineWidth = 1;

        // Grid usually needs to "stick" to world coordinates
        // Bounds determine the visible area globally

        const targetPx = 80;
        let gridFt = 50;
        const candidates = [10, 25, 50, 100, 200, 500];
        for (const c of candidates) {
            if (c * scale >= targetPx * 0.5) {
                gridFt = c;
                break;
            }
        }

        // Draw vertical lines in world space
        // Start from bounds.minX aligned to grid
        const startX = Math.floor(bounds.minX / gridFt) * gridFt;
        for (let x = startX; x <= bounds.maxX; x += gridFt) {
            // Transform world X to screen X
            const px = tx + x * scale;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, h);
            ctx.stroke();
        }

        // Horizontal
        const startY = Math.floor(bounds.minY / gridFt) * gridFt;
        for (let y = startY; y <= bounds.maxY; y += gridFt) {
            // Transform world Y to screen Y (px = ty - y*scale)
            const py = ty - y * scale;
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(w, py);
            ctx.stroke();
        }

        ctx.restore();
    }


    _getBowlGeometry(bowlConfig, offset) {
        return buildBowlGeometrySegments(bowlConfig, offset);
    }

    getBowlGeometrySegments(bowlConfig, offset) {
        return buildBowlGeometrySegments(bowlConfig, offset);
    }

    getFieldGeometrySegments(template, extraRunoff = 0) {
        return buildFieldGeometrySegments(template, extraRunoff);
    }

    calculateRowLength(bowlConfig, offset) {
        return calculateSegmentLength(this._getBowlGeometry(bowlConfig, offset));
    }

    getOffsetCorrection(bowlConfig, sportName) {
        const safeWidth = Number.isFinite(bowlConfig?.width) ? bowlConfig.width : 0;
        return EDGE_SPORTS.includes(sportName) ? 0 : (safeWidth / 2);
    }

    getVisualFocalY(template, focalPointFt, _sportName) {
        void _sportName;
        return resolvePlanFocalYFt(template, Number(focalPointFt?.x) || 0);
    }

    buildTierAisleLayouts(solvers, bowlConfig, tierMetricsByIndex, offsetCorrection = 0, egressParams = null) {
        const tierAisleLayouts = [];
        void tierMetricsByIndex;

        (solvers || []).forEach((solver, index) => {
            if (!solver?.rows?.length) return;

            const tierLayout = this.generateTierAisleLayout(
                solver,
                bowlConfig,
                null,
                offsetCorrection,
                egressParams
            );
            if (!tierLayout) return;

            tierLayout.tierIndex = getSolverTierIndex(solver, index);
            tierAisleLayouts.push(tierLayout);
        });

        return tierAisleLayouts;
    }

    _computeBowlBounds(bowlConfig, offset) {
        return computeSegmentBounds(buildBowlGeometrySegments(bowlConfig, offset) || []);
    }

    _computeSegmentBounds(segments) {
        return computeSegmentBounds(segments);
    }

    _generateBufferPath(bowlConfig, offset) {
        const segments = this._getBowlGeometry(bowlConfig, offset);
        return buildPath2DFromSegments(segments);
    }

    _fillPolygon(ctx, points) {
        if (!Array.isArray(points) || points.length < 3) return;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();
    }

    generateTierAisleLayout(solver, bowlConfig, tierMetrics, offsetCorrection = 0, egressParams = null) {
        void tierMetrics;
        if (!solver || !solver.rows || solver.rows.length === 0) return null;

        return buildTierAisleAnalysis({
            tierIndex: solver.tierIndex !== undefined ? solver.tierIndex : 0,
            rows: solver.rows,
            bowlConfig,
            offsetCorrection,
            egressParams,
            getPathsForOffset: (offset) => buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)),
            getRowLengthFt: (offset) => this.calculateRowLength(bowlConfig, offset)
        });
    }

    _drawWorldTextLabel(ctx, scale, x, y, text, options = {}) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || !text) return;
        const safeScale = Math.max(1e-6, Number(scale) || 1);
        const {
            fontPx = 10,
            fontWeight = 700,
            textColor = '#111827',
            bgColor = 'rgba(255, 255, 255, 0.92)',
            borderColor = 'rgba(17, 24, 39, 0.14)',
            paddingX = 4,
            paddingY = 2,
            offsetXPx = 0,
            offsetYPx = 0,
            rotationRad = 0,
            arrow = null
        } = options;

        ctx.save();
        ctx.translate(x, y);
        // Cancel world scaling + Y flip so labels are upright and pixel-sized.
        ctx.scale(1 / safeScale, -1 / safeScale);
        if (rotationRad) {
            ctx.rotate(Number(rotationRad) || 0);
        }
        if (offsetXPx || offsetYPx) {
            ctx.translate(Number(offsetXPx) || 0, Number(offsetYPx) || 0);
        }

        ctx.font = `${fontWeight} ${fontPx}px ${LABEL_FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(String(text));
        const width = Math.ceil((metrics.width || 0) + paddingX * 2);
        const height = Math.ceil(fontPx + paddingY * 2);
        const rx = -width / 2;
        const ry = -height / 2;

        if (bgColor) {
            ctx.fillStyle = bgColor;
            ctx.fillRect(rx, ry, width, height);
        }
        if (borderColor) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(rx + 0.5, ry + 0.5, width - 1, height - 1);
        }

        ctx.fillStyle = textColor;
        ctx.fillText(String(text), 0, 0);
        const arrowDirection = Math.sign(Number(arrow?.direction) || 0);
        if (arrowDirection) {
            const gapPx = Math.max(0, Number(arrow?.gapPx) || 5);
            const lengthPx = Math.max(0, Number(arrow?.lengthPx) || 11);
            const headPx = Math.max(0, Number(arrow?.headPx) || 4);
            const startX = arrowDirection * ((width * 0.5) + gapPx);
            const endX = startX + (arrowDirection * lengthPx);
            ctx.beginPath();
            ctx.moveTo(startX, 0);
            ctx.lineTo(endX, 0);
            ctx.moveTo(endX, 0);
            ctx.lineTo(endX - (arrowDirection * headPx), -headPx * 0.7);
            ctx.moveTo(endX, 0);
            ctx.lineTo(endX - (arrowDirection * headPx), headPx * 0.7);
            ctx.strokeStyle = arrow?.color || textColor;
            ctx.lineWidth = Math.max(1, Number(arrow?.strokeWidth) || 1.25);
            ctx.stroke();
        }
        ctx.restore();
    }

    _buildTierAisleReferenceMap(
        solver,
        _bowlConfig,
        tierLayout,
        offsetCorrection,
        getPathsForOffset,
        chamferCache
    ) {
        void _bowlConfig;
        return buildTierAisleReferenceMap({
            rows: solver?.rows || [],
            tierLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        });
    }

    _resolveTierAisleStationRatios(pathFront, pathBack, aisle, aisleIndex, tierLayout, chamferCache, aisleReferenceMap = null) {
        return resolveTierAisleStationRatios(
            pathFront,
            pathBack,
            aisle,
            aisleIndex,
            chamferCache,
            aisleReferenceMap,
            tierLayout
        );
    }

    _buildResolvedAisleRatioMap(pathA, pathB, tierLayout, chamferCache, aisleReferenceMap = null) {
        return buildResolvedTierAisleRatioMap(pathA, pathB, tierLayout, chamferCache, aisleReferenceMap);
    }

    _pickBestRowLabelSampling(centerOffset, getPathsForOffset, tierLayout, chamferCache, aisleReferenceMap = null) {
        return pickBestRowAisleSampling(centerOffset, getPathsForOffset, tierLayout, chamferCache, aisleReferenceMap);
    }

    _buildTierSectionTemplates(referencePaths, tierLayout, sectionBase) {
        const out = new Map();
        if (!tierLayout) return out;

        // Resolve reference aisle stations directly from stored aisle data (front-path basis).
        const refAisleByPath = new Map();
        (tierLayout.aisles || []).forEach((aisle, aisleIndex) => {
            const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
            const u = Number.isFinite(aisle.uFront) ? aisle.uFront : aisle.u;
            if (!Number.isFinite(u)) return;
            if (!refAisleByPath.has(pathIndex)) refAisleByPath.set(pathIndex, new Map());
            refAisleByPath.get(pathIndex).set(aisleIndex, u);
        });

        const summarySections = Array.isArray(tierLayout?.sectionSummary?.sections)
            ? tierLayout.sectionSummary.sections
            : [];
        let nextSectionNumber = sectionBase;
        const pathCount = Math.max(
            Array.isArray(referencePaths) ? referencePaths.length : 0,
            Array.isArray(tierLayout.sectionBoundaries) ? tierLayout.sectionBoundaries.length : 0
        );
        for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
            const path = referencePaths[pathIndex];
            const aisleMap = refAisleByPath.get(pathIndex);
            if (!path) continue;

            const slots = [];
            const pathSections = summarySections.filter((section) => (
                Math.max(0, Math.floor(Number(section?.pathIndex) || 0)) === pathIndex
            ));

            if (pathSections.length > 0) {
                pathSections.forEach((section) => {
                    const normUA = resolveSectionTemplateBoundaryU(
                        path,
                        aisleMap,
                        section?.startBoundaryKind,
                        section?.aisleIndexA,
                        section?.startU
                    );
                    const normUB = resolveSectionTemplateBoundaryU(
                        path,
                        aisleMap,
                        section?.endBoundaryKind,
                        section?.aisleIndexB,
                        section?.endU
                    );
                    const midU = interpolatePathSectionU(path, normUA, normUB, 0.5);
                    const midPt = samplePathPointByRatio(path, midU);
                    slots.push({
                        slotIndex: Math.max(0, Math.floor(Number(section?.slotIndex) || 0)),
                        aisleIndexA: Number.isFinite(Number(section?.aisleIndexA)) ? section.aisleIndexA : null,
                        aisleIndexB: Number.isFinite(Number(section?.aisleIndexB)) ? section.aisleIndexB : null,
                        startBoundaryKind: section?.startBoundaryKind || 'aisle',
                        endBoundaryKind: section?.endBoundaryKind || 'aisle',
                        uA: normUA,
                        uB: normUB,
                        midU,
                        midPt,
                        sectionNumber: null
                    });
                });
            } else {
                const boundaries = Array.isArray(tierLayout.sectionBoundaries?.[pathIndex])
                    ? tierLayout.sectionBoundaries[pathIndex]
                    : [];
                if (boundaries.length >= 2 && aisleMap) {
                    const slotCount = path.closed ? boundaries.length : Math.max(0, boundaries.length - 1);
                    for (let i = 0; i < slotCount; i++) {
                        const a = boundaries[i];
                        const b = path.closed ? boundaries[(i + 1) % boundaries.length] : boundaries[i + 1];
                        const uA = aisleMap.get(a.aisleIndex);
                        const uB = aisleMap.get(b.aisleIndex);
                        if (!Number.isFinite(uA) || !Number.isFinite(uB)) continue;
                        const normUA = normalizePathU(path, uA);
                        const normUB = normalizePathU(path, uB);
                        const midU = interpolatePathSectionU(path, normUA, normUB, 0.5);
                        const midPt = samplePathPointByRatio(path, midU);
                        slots.push({
                            slotIndex: i,
                            aisleIndexA: a.aisleIndex,
                            aisleIndexB: b.aisleIndex,
                            startBoundaryKind: 'aisle',
                            endBoundaryKind: 'aisle',
                            uA: normUA,
                            uB: normUB,
                            midU,
                            midPt,
                            sectionNumber: null
                        });
                    }
                }
            }
            if (slots.length < 1) continue;

            let order = slots.map((_, idx) => idx);
            if (path.closed) {
                const isPathClockwise = approximatePathSignedArea(path) < 0;
                if (!isPathClockwise) order = order.reverse();

                let startPos = 0;
                let bestX = -Infinity;
                let bestY = -Infinity;
                for (let i = 0; i < order.length; i++) {
                    const p = slots[order[i]].midPt || { x: -Infinity, y: -Infinity };
                    if (
                        p.x > bestX + 1e-6 ||
                        (Math.abs(p.x - bestX) <= 1e-6 && p.y > bestY + 1e-6)
                    ) {
                        bestX = p.x;
                        bestY = p.y;
                        startPos = i;
                    }
                }
                order = order.slice(startPos).concat(order.slice(0, startPos));
            } else {
                order.sort((aIdx, bIdx) => {
                    const a = slots[aIdx].midPt || { x: -Infinity, y: -Infinity };
                    const b = slots[bIdx].midPt || { x: -Infinity, y: -Infinity };
                    if (Math.abs(b.x - a.x) > 1e-6) return b.x - a.x;
                    return b.y - a.y;
                });
            }
            for (let i = 0; i < order.length; i++) {
                slots[order[i]].sectionNumber = nextSectionNumber++;
            }

            out.set(pathIndex, slots);
        }

        return out;
    }

    _drawTierSectionMetrics(ctx, solver, bowlConfig, tierLayout, offsetCorrection, scale, fx, fy) {
        if (!tierLayout || !Array.isArray(tierLayout.aisles) || tierLayout.aisles.length < 2) return;
        if (!solver || !Array.isArray(solver.rows) || solver.rows.length === 0) return;

        const seatWidthIn = Math.max(1, Number(tierLayout.seatWidthIn) || 0);
        if (!(seatWidthIn > 0)) return;

        const effectiveScale = Math.max(0, Number(scale) || 0);
        const showRowSeatCounts = effectiveScale >= ROW_SEATCOUNT_MIN_SCALE;
        const showSectionOccupancy = effectiveScale >= SECTION_OCC_MIN_SCALE;
        const showAisleOccupancy = effectiveScale >= AISLE_OCC_MIN_SCALE;
        const showAisleWidth = effectiveScale >= AISLE_WIDTH_MIN_SCALE;
        // Section labels should remain visible at close zoom; only row seat counts are zoom-gated.
        const showSectionLabels = effectiveScale >= SECTION_LABEL_MIN_SCALE;
        if (!showSectionLabels && !showRowSeatCounts && !showSectionOccupancy && !showAisleOccupancy && !showAisleWidth) return;

        const overlayData = this.getTierSectionMetricsOverlayData(
            solver,
            bowlConfig,
            tierLayout,
            offsetCorrection
        );
        const rowSeatLabels = Array.isArray(overlayData?.rowSeatLabels) ? overlayData.rowSeatLabels : [];
        const sectionLabels = Array.isArray(overlayData?.sectionLabels) ? overlayData.sectionLabels : [];

        ctx.save();
        ctx.translate(fx, fy);

        if (showRowSeatCounts) {
            rowSeatLabels.forEach((label) => {
                if (!Number.isFinite(label?.x) || !Number.isFinite(label?.y) || !label?.text) return;
                this._drawWorldTextLabel(ctx, scale, label.x, label.y, label.text, {
                    fontPx: ROW_SEATCOUNT_LABEL_FONT_PX,
                    fontWeight: 700,
                    textColor: '#1f2937',
                    bgColor: null,
                    borderColor: null,
                    paddingX: 4,
                    paddingY: 1.5,
                    rotationRad: label.rotationRad
                });
            });
        }

        if (showSectionLabels) {
            sectionLabels.forEach((label) => {
                if (!Number.isFinite(label?.x) || !Number.isFinite(label?.y) || !label?.text) return;

                const hasOccLine = showSectionOccupancy && !!label.occText;
                const useCloseZoomSectionLabelSize = showRowSeatCounts || showSectionOccupancy;
                this._drawWorldTextLabel(ctx, scale, label.x, label.y, label.text, {
                    fontPx: hasOccLine
                        ? SECTION_LABEL_STACKED_FONT_PX
                        : (useCloseZoomSectionLabelSize ? SECTION_LABEL_FONT_PX_ZOOMED_IN : SECTION_LABEL_FONT_PX_ZOOMED_OUT),
                    fontWeight: 800,
                    textColor: '#111827',
                    bgColor: 'rgba(255,255,255,0.94)',
                    borderColor: 'rgba(17,24,39,0.16)',
                    paddingX: hasOccLine ? 6 : (useCloseZoomSectionLabelSize ? 7 : 4),
                    paddingY: hasOccLine ? 3 : (useCloseZoomSectionLabelSize ? 3 : 1.5),
                    offsetYPx: hasOccLine ? -SECTION_LABEL_STACK_OFFSET_PX : 0
                });

                if (hasOccLine) {
                    this._drawWorldTextLabel(ctx, scale, label.x, label.y, label.occText, {
                        fontPx: SECTION_OCC_LABEL_FONT_PX,
                        fontWeight: 700,
                        textColor: '#374151',
                        bgColor: 'rgba(255,255,255,0.92)',
                        borderColor: 'rgba(148, 163, 184, 0.30)',
                        paddingX: 4,
                        paddingY: 1.5,
                        offsetYPx: SECTION_LABEL_STACK_OFFSET_PX
                    });
                }
            });
        }

        if (showAisleOccupancy || showAisleWidth) {
            const aisleMetricLabels = this._getTierAisleMetricLabelData(
                solver,
                bowlConfig,
                tierLayout,
                offsetCorrection
            );

            ctx.save();
            ctx.translate(fx, fy);
            if (showAisleOccupancy) {
                aisleMetricLabels.occupancyLabels.forEach((label) => {
                    this._drawWorldTextLabel(ctx, scale, label.x, label.y, label.text, {
                        fontPx: AISLE_OCC_LABEL_FONT_PX,
                        fontWeight: 700,
                        textColor: '#0f172a',
                        bgColor: null,
                        borderColor: null,
                        paddingX: 4.5,
                        paddingY: 1.8,
                        rotationRad: label.rotationRad,
                        arrow: label.arrow
                    });
                });
            }
            if (showAisleWidth) {
                aisleMetricLabels.widthLabels.forEach((label) => {
                    this._drawWorldTextLabel(ctx, scale, label.x, label.y, label.text, {
                        fontPx: AISLE_WIDTH_LABEL_FONT_PX,
                        fontWeight: 700,
                        textColor: '#334155',
                        bgColor: null,
                        borderColor: null,
                        paddingX: 4,
                        paddingY: 1.6,
                        rotationRad: label.rotationRad
                    });
                });
            }
            ctx.restore();
        }

        ctx.restore();
    }

    getTierAisleBandPolygons(solver, bowlConfig, tierLayout, offsetCorrection = 0) {
        if (!tierLayout || !tierLayout.aisles || tierLayout.aisles.length === 0) return [];
        if (!solver || !solver.rows || solver.rows.length === 0) return [];

        const polygons = [];
        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        const chamferCache = new Map();
        const aisleReferenceMap = this._buildTierAisleReferenceMap(
            solver,
            bowlConfig,
            tierLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        );
        for (let r = 0; r < solver.rows.length; r++) {
            const row = solver.rows[r];
            const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
            const backOffset = row.x - offsetCorrection;
            const frontPaths = getPathsForOffset(frontOffset);
            const backPaths = getPathsForOffset(backOffset);
            if (!frontPaths.length || !backPaths.length) continue;

            for (let i = 0; i < tierLayout.aisles.length; i++) {
                const aisle = tierLayout.aisles[i];
                const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));

                const pathFront = frontPaths[pathIndex];
                const pathBack = backPaths[pathIndex];
                if (!pathFront || !pathBack) continue;

                const ratios = this._resolveTierAisleStationRatios(
                    pathFront,
                    pathBack,
                    aisle,
                    i,
                    tierLayout,
                    chamferCache,
                    aisleReferenceMap
                );
                if (!ratios) continue;

                const widthFt = getTierRenderedAisleWidthFt(tierLayout, i);
                if (widthFt <= 0) continue;
                const bandFront = sampleAisleBand(pathFront, ratios.uFront, widthFt);
                const bandBack = sampleAisleBand(pathBack, ratios.uBack, widthFt);
                if (!bandFront || !bandBack) continue;

                polygons.push({
                    tierIndex: solver.tierIndex !== undefined ? solver.tierIndex : 0,
                    rowIndex: r,
                    aisleIndex: i,
                    pathIndex,
                    points: [
                        { x: bandFront.left.x, y: bandFront.left.y },
                        { x: bandFront.right.x, y: bandFront.right.y },
                        { x: bandBack.right.x, y: bandBack.right.y },
                        { x: bandBack.left.x, y: bandBack.left.y }
                    ]
                });
            }
        }

        return polygons;
    }

    getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, offsetCorrection = 0) {
        if (!tierLayout || !Array.isArray(tierLayout.aisles) || tierLayout.aisles.length < 2) {
            return { sectionLabels: [], rowSeatLabels: [] };
        }
        if (!solver || !Array.isArray(solver.rows) || solver.rows.length === 0) {
            return { sectionLabels: [], rowSeatLabels: [] };
        }
        const sectionSummary = tierLayout?.sectionSummary;
        const sections = Array.isArray(sectionSummary?.sections) ? sectionSummary.sections : [];
        if (sections.length < 1) {
            return { sectionLabels: [], rowSeatLabels: [] };
        }

        const seatWidthIn = Math.max(1, Number(tierLayout.seatWidthIn) || 0);
        if (!(seatWidthIn > 0)) {
            return { sectionLabels: [], rowSeatLabels: [] };
        }

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        const tierIdx = Math.max(0, Math.floor(Number(tierLayout.tierIndex) || 0));
        const sectionBase = (tierIdx + 1) * 100;
        const templateRowIndex = Math.floor((Math.max(1, solver.rows.length) - 1) * 0.5);
        const templateRow = solver.rows[templateRowIndex];
        const templateOffset = (templateRow.x - (templateRow.tread_depth * 0.5)) - offsetCorrection;
        const labelPaths = getPathsForOffset(templateOffset);
        const chamferCache = new Map();
        const aisleReferenceMap = this._buildTierAisleReferenceMap(
            solver,
            bowlConfig,
            tierLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        );
        const sectionTemplates = this._buildTierSectionTemplates(labelPaths, tierLayout, sectionBase);
        if (!sectionTemplates.size) return { sectionLabels: [], rowSeatLabels: [] };
        const sectionByKey = new Map(
            sections.map((section) => [`${section.pathIndex}:${section.slotIndex}`, section])
        );

        const rowSeatLabels = [];
        for (let r = 0; r < solver.rows.length; r++) {
            const row = solver.rows[r];
            const centerOffset = (row.x - (row.tread_depth * 0.5)) - offsetCorrection;
            const sampledRow = this._pickBestRowLabelSampling(
                centerOffset,
                getPathsForOffset,
                tierLayout,
                chamferCache,
                aisleReferenceMap
            );
            const centerPaths = sampledRow.paths;
            if (!centerPaths.length) continue;

            const aisleRatiosByPath = sampledRow.aisleRatiosByPath;
            if (!aisleRatiosByPath.size) continue;

            sectionTemplates.forEach((slots, pathIndex) => {
                const path = centerPaths[pathIndex];
                const aisleMap = aisleRatiosByPath.get(pathIndex);
                if (!path || slots.length < 1) return;

                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    const sectionRecord = sectionByKey.get(`${pathIndex}:${slot.slotIndex}`);
                    const seatCount = Math.max(0, Math.round(Number(sectionRecord?.rowSeatCounts?.[r]) || 0));
                    if (!(seatCount > 0)) continue;

                    const uA = resolveSectionTemplateBoundaryU(
                        path,
                        aisleMap,
                        slot.startBoundaryKind,
                        slot.aisleIndexA,
                        slot.uA
                    );
                    const uB = resolveSectionTemplateBoundaryU(
                        path,
                        aisleMap,
                        slot.endBoundaryKind,
                        slot.aisleIndexB,
                        slot.uB
                    );
                    if (!Number.isFinite(uA) || !Number.isFinite(uB)) continue;

                    const startAisleIndex = slot.startBoundaryKind === 'aisle'
                        ? getFiniteAisleIndex(slot.aisleIndexA)
                        : null;
                    const endAisleIndex = slot.endBoundaryKind === 'aisle'
                        ? getFiniteAisleIndex(slot.aisleIndexB)
                        : null;
                    const preferredAisleIndex = startAisleIndex
                        ?? endAisleIndex
                        ?? getFiniteAisleIndex(slot.aisleIndexA)
                        ?? getFiniteAisleIndex(slot.aisleIndexB);
                    const centerGapFt = sectionDistanceOnPath(path, uA, uB);
                    if (!Number.isFinite(Number(preferredAisleIndex))) continue;
                    const adjacentAisleWidthFt = Number.isFinite(Number(preferredAisleIndex))
                        ? getTierRenderedAisleWidthFt(tierLayout, preferredAisleIndex)
                        : 0;
                    const labelCenterOffsetFt = (adjacentAisleWidthFt * 0.5) + ROW_SEATCOUNT_LABEL_EDGE_OFFSET_FT;
                    const edgeInsetT = centerGapFt > 1e-6
                        ? Math.max(
                            ROW_SEATCOUNT_LABEL_MIN_T,
                            Math.min(ROW_SEATCOUNT_LABEL_MAX_T, labelCenterOffsetFt / centerGapFt)
                        )
                        : 0.2;
                    const labelU = preferredAisleIndex === slot.aisleIndexA
                        ? interpolatePathSectionU(path, uA, uB, edgeInsetT)
                        : interpolatePathSectionU(path, uA, uB, 1 - edgeInsetT);
                    const labelPt = samplePathPointByRatio(path, labelU);
                    const rotationRad = normalizeReadableLabelAngle(
                        computeScreenAngleFromWorldVector(labelPt.tx, labelPt.ty)
                    );

                    rowSeatLabels.push({
                        tierIndex: tierIdx,
                        rowIndex: r,
                        sectionNumber: Number.isFinite(slot.sectionNumber) ? slot.sectionNumber : null,
                        pathIndex,
                        slotIndex: slot.slotIndex,
                        x: labelPt.x,
                        y: labelPt.y,
                        seatCount,
                        text: String(seatCount),
                        rotationRad
                    });
                }
            });
        }

        const sectionLabels = [];
        const firstRow = solver.rows[0];
        const lastRow = solver.rows[solver.rows.length - 1];
        const firstOffset = (firstRow.x - (firstRow.tread_depth * 0.5)) - offsetCorrection;
        const lastOffset = (lastRow.x - (lastRow.tread_depth * 0.5)) - offsetCorrection;
        const firstPaths = getPathsForOffset(firstOffset);
        const lastPaths = getPathsForOffset(lastOffset);
        const firstAisleRatios = this._buildResolvedAisleRatioMap(
            firstPaths,
            firstPaths,
            tierLayout,
            chamferCache,
            aisleReferenceMap
        );
        const lastAisleRatios = this._buildResolvedAisleRatioMap(
            lastPaths,
            lastPaths,
            tierLayout,
            chamferCache,
            aisleReferenceMap
        );

        sectionTemplates.forEach((slots, pathIndex) => {
            const path = labelPaths[pathIndex];
            const frontPath = firstPaths[pathIndex];
            const backPath = lastPaths[pathIndex];
            const frontAisles = firstAisleRatios.get(pathIndex);
            const backAisles = lastAisleRatios.get(pathIndex);
            if (!path) return;

            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (!Number.isFinite(slot.sectionNumber)) continue;

                let labelX = NaN;
                let labelY = NaN;
                if (frontPath && backPath) {
                    const uFA = resolveSectionTemplateBoundaryU(
                        frontPath,
                        frontAisles,
                        slot.startBoundaryKind,
                        slot.aisleIndexA,
                        slot.uA
                    );
                    const uFB = resolveSectionTemplateBoundaryU(
                        frontPath,
                        frontAisles,
                        slot.endBoundaryKind,
                        slot.aisleIndexB,
                        slot.uB
                    );
                    const uBA = resolveSectionTemplateBoundaryU(
                        backPath,
                        backAisles,
                        slot.startBoundaryKind,
                        slot.aisleIndexA,
                        slot.uA
                    );
                    const uBB = resolveSectionTemplateBoundaryU(
                        backPath,
                        backAisles,
                        slot.endBoundaryKind,
                        slot.aisleIndexB,
                        slot.uB
                    );
                    if ([uFA, uFB, uBA, uBB].every(Number.isFinite)) {
                        const midFront = samplePathPointByRatio(frontPath, interpolatePathSectionU(frontPath, uFA, uFB, 0.5));
                        const midBack = samplePathPointByRatio(backPath, interpolatePathSectionU(backPath, uBA, uBB, 0.5));
                        labelX = (midFront.x + midBack.x) * 0.5;
                        labelY = (midFront.y + midBack.y) * 0.5;
                    }
                }

                if (!Number.isFinite(labelX) || !Number.isFinite(labelY)) {
                    const fallbackPt = samplePathPointByRatio(path, slot.midU);
                    labelX = fallbackPt.x;
                    labelY = fallbackPt.y;
                }

                const sectionRecord = sectionByKey.get(`${pathIndex}:${slot.slotIndex}`);
                const occupancy = Number.isFinite(sectionRecord?.occupancy)
                    ? Math.round(sectionRecord.occupancy)
                    : null;
                sectionLabels.push({
                    tierIndex: tierIdx,
                    pathIndex,
                    slotIndex: slot.slotIndex,
                    sectionNumber: slot.sectionNumber,
                    x: labelX,
                    y: labelY,
                    text: `#${slot.sectionNumber}`,
                    occupancy,
                    occText: occupancy && occupancy > 0 ? `${occupancy}occ` : null
                });
            }
        });

        return {
            sectionLabels,
            rowSeatLabels,
            aisleOccupancyTotals: Array.isArray(sectionSummary?.aisleOccupancyTotals)
                ? sectionSummary.aisleOccupancyTotals
                : [],
            sectionOccupancyTotals: Array.isArray(sectionSummary?.sectionOccupancyTotals)
                ? sectionSummary.sectionOccupancyTotals
                : []
        };
    }

    _getTierAisleMetricLabelData(solver, bowlConfig, tierLayout, offsetCorrection = 0) {
        const empty = { occupancyLabels: [], widthLabels: [] };
        if (!tierLayout || !Array.isArray(tierLayout.aisles) || tierLayout.aisles.length === 0) {
            return empty;
        }
        if (!solver || !Array.isArray(solver.rows) || solver.rows.length === 0) {
            return empty;
        }

        const firstRow = solver.rows[0];
        const lastRow = solver.rows[solver.rows.length - 1];
        if (!firstRow || !lastRow) return empty;

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        const chamferCache = new Map();
        const aisleReferenceMap = this._buildTierAisleReferenceMap(
            solver,
            bowlConfig,
            tierLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        );
        const occupancyFrontPaths = getPathsForOffset((firstRow.x - (firstRow.tread_depth * 0.5)) - offsetCorrection);
        const occupancyBackPaths = getPathsForOffset((lastRow.x - (lastRow.tread_depth * 0.5)) - offsetCorrection);
        const widthFrontPaths = getPathsForOffset((firstRow.x - firstRow.tread_depth) - offsetCorrection);
        const widthBackPaths = getPathsForOffset(firstRow.x - offsetCorrection);

        const occupancyLabels = [];
        const widthLabels = [];
        const aisleSummaries = Array.isArray(tierLayout?.sectionSummary?.aisles)
            ? tierLayout.sectionSummary.aisles
            : [];

        for (let aisleIndex = 0; aisleIndex < tierLayout.aisles.length; aisleIndex++) {
            const aisle = tierLayout.aisles[aisleIndex];
            const aisleSummary = aisleSummaries[aisleIndex] || null;
            if (!aisle) continue;

            const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
            const occupancyFrontPath = occupancyFrontPaths[pathIndex];
            const occupancyBackPath = occupancyBackPaths[pathIndex];
            const widthFrontPath = widthFrontPaths[pathIndex];
            const widthBackPath = widthBackPaths[pathIndex];

            if (Number.isFinite(aisleSummary?.tributaryOccupancy) && occupancyFrontPath && occupancyBackPath) {
                const occupancyRatios = this._resolveTierAisleStationRatios(
                    occupancyFrontPath,
                    occupancyBackPath,
                    aisle,
                    aisleIndex,
                    tierLayout,
                    chamferCache,
                    aisleReferenceMap
                );
                if (occupancyRatios) {
                    const frontPoint = samplePathPointByRatio(occupancyFrontPath, occupancyRatios.uFront);
                    const backPoint = samplePathPointByRatio(occupancyBackPath, occupancyRatios.uBack);
                    const rawRotationRad = computeScreenAngleFromWorldVector(
                        backPoint.x - frontPoint.x,
                        backPoint.y - frontPoint.y
                    );
                    const rotationRad = normalizeReadableLabelAngle(rawRotationRad);
                    occupancyLabels.push({
                        aisleIndex,
                        pathIndex,
                        x: (frontPoint.x + backPoint.x) * 0.5,
                        y: (frontPoint.y + backPoint.y) * 0.5,
                        text: `${formatComputedLabelNumber(aisleSummary.tributaryOccupancy)}occ`,
                        rotationRad,
                        arrow: {
                            direction: isAngleForward(rotationRad, rawRotationRad) ? 1 : -1
                        }
                    });
                }
            }

            const displayWidthIn = getTierGoverningAisleWidthIn(tierLayout, aisleIndex)
                || getTierRenderedAisleWidthIn(tierLayout, aisleIndex);
            if (displayWidthIn > 0 && widthFrontPath && widthBackPath) {
                const widthRatios = this._resolveTierAisleStationRatios(
                    widthFrontPath,
                    widthBackPath,
                    aisle,
                    aisleIndex,
                    tierLayout,
                    chamferCache,
                    aisleReferenceMap
                );
                if (widthRatios) {
                    const frontPoint = samplePathPointByRatio(widthFrontPath, widthRatios.uFront);
                    const backPoint = samplePathPointByRatio(widthBackPath, widthRatios.uBack);
                    const aisleRotationRad = computeScreenAngleFromWorldVector(
                        backPoint.x - frontPoint.x,
                        backPoint.y - frontPoint.y
                    );
                    widthLabels.push({
                        aisleIndex,
                        pathIndex,
                        x: (frontPoint.x + backPoint.x) * 0.5,
                        y: (frontPoint.y + backPoint.y) * 0.5,
                        text: formatAisleWidthLabel(displayWidthIn),
                        rotationRad: normalizeReadableLabelAngle(aisleRotationRad + (Math.PI * 0.5))
                    });
                }
            }
        }

        return {
            occupancyLabels,
            widthLabels
        };
    }

    _drawTierAisles(ctx, solver, bowlConfig, tierLayout, offsetCorrection, scale, fx, fy) {
        if (!tierLayout || !tierLayout.aisles || tierLayout.aisles.length === 0) return;
        if (!solver || !solver.rows || solver.rows.length === 0) return;

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        ctx.save();
        ctx.translate(fx, fy);
        ctx.fillStyle = BRAND_FIELD_COLORS.aislesFill;
        const chamferCache = new Map();
        const aisleReferenceMap = this._buildTierAisleReferenceMap(
            solver,
            bowlConfig,
            tierLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        );

        // Resolve row quads from tier-stable perpendicular references while
        // keeping radial and forced-corner sampling on the existing per-row path pair.
        for (let r = 0; r < solver.rows.length; r++) {
            const row = solver.rows[r];
            const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
            const backOffset = row.x - offsetCorrection;
            const frontPaths = getPathsForOffset(frontOffset);
            const backPaths = getPathsForOffset(backOffset);
            if (!frontPaths.length || !backPaths.length) continue;

            for (let i = 0; i < tierLayout.aisles.length; i++) {
                const aisle = tierLayout.aisles[i];
                const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));

                const pathFront = frontPaths[pathIndex];
                const pathBack = backPaths[pathIndex];
                if (!pathFront || !pathBack) continue;

                const ratios = this._resolveTierAisleStationRatios(
                    pathFront,
                    pathBack,
                    aisle,
                    i,
                    tierLayout,
                    chamferCache,
                    aisleReferenceMap
                );
                if (!ratios) continue;

                const widthFt = getTierRenderedAisleWidthFt(tierLayout, i);
                if (widthFt <= 0) continue;
                const bandFront = sampleAisleBand(pathFront, ratios.uFront, widthFt);
                const bandBack = sampleAisleBand(pathBack, ratios.uBack, widthFt);
                if (!bandFront || !bandBack) continue;

                ctx.beginPath();
                ctx.moveTo(bandFront.left.x, bandFront.left.y);
                ctx.lineTo(bandFront.right.x, bandFront.right.y);
                ctx.lineTo(bandBack.right.x, bandBack.right.y);
                ctx.lineTo(bandBack.left.x, bandBack.left.y);
                ctx.closePath();
                ctx.fill();
            }
        }

        ctx.restore();
    }

    _drawSeating(ctx, solvers, template, visibility, scale, visualFocalX, bowlConfig, offsetCorrection = 0, tierAisleLayouts = []) {
        // ... (bowl config fallback omitted as it's handled upstream)
        if (!bowlConfig) {
            bowlConfig = {
                width: template.field_width || 100,
                length: template.field_length || 200,
                type: 'Full',
                corner: 'Radius',
                radius: template.corner_radius || 20
            };
            if (template.shape === 'rectangle') {
                bowlConfig.corner = 'Square';
                bowlConfig.radius = 0;
            }
        }

        const fx = 0; // Always 0
        const fy = 0; // Always 0
        const aisleLayoutMap = new Map((tierAisleLayouts || []).map(layout => [layout.tierIndex, layout]));
        const colorByCValue = visibility?.colorByCValue !== false;

        // === SUNLIGHT SHADOW PASS ===
        // Simulate harsh directional sunlight — shadows offset 30° to lower-right
        // Each tier casts a shadow proportional to its height/elevation
        // 30° from vertical: cos(30°)=0.87 (down), sin(30°)=0.5 (right)
        const sunAngleX = 0.5;  // shadow offset right
        const sunAngleY = -0.87; // shadow offset down (negative = screen-down in flipped Y)

        solvers.forEach((solver, idx) => {
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : idx;
            if (tIdx === 0 && !visibility.t1) return;
            if (tIdx === 1 && !visibility.t2) return;
            if (tIdx === 2 && !visibility.t3) return;
            if (!solver.rows || solver.rows.length === 0) return;

            // Use the last row's elevation as the tier height for shadow length
            const lastRow = solver.rows[solver.rows.length - 1];
            const tierHeight = lastRow.z || 10; // elevation in feet
            const shadowLen = tierHeight * 0.5; // shadow projection length

            // Draw outer shadow silhouette for the entire tier
            const outerOffset = lastRow.x - offsetCorrection;
            const shadowPath = this._generateBufferPath(bowlConfig, outerOffset);

            ctx.save();
            ctx.translate(fx, fy);

            // Shadow offset based on tier height and sun angle (30° lower-right)
            const shadowDx = tierHeight * sunAngleX;
            const shadowDy = tierHeight * sunAngleY;

            ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.55 + tIdx * 0.12, 0.80)})`;
            ctx.shadowBlur = (20 + tIdx * 14) / scale;
            ctx.shadowOffsetX = shadowDx;
            ctx.shadowOffsetY = shadowDy;

            ctx.strokeStyle = 'rgba(0,0,0,0)';
            ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + tIdx * 0.05})`;
            ctx.lineWidth = (shadowLen) / scale;
            ctx.stroke(shadowPath);
            ctx.restore();

            // Clear shadow state
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        });

        // === MAIN SEATING ROWS PASS ===
        solvers.forEach((solver, idx) => {
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : idx;
            const tierColors = getTierPlanColors(tIdx);
            if (tIdx === 0 && !visibility.t1) return;
            if (tIdx === 1 && !visibility.t2) return;
            if (tIdx === 2 && !visibility.t3) return;

            if (!solver.rows) return;

            solver.rows.forEach((row, rowIdx) => {
                const rowStrokeColor = getRowStrokeColorForTheme(row, tierColors, colorByCValue);
                const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
                const backOffset = row.x - offsetCorrection;
                const rowBandPolygons = buildBowlBandPolygons(bowlConfig, frontOffset, backOffset);

                // Per-row shadow: larger on first row of tier
                if (rowIdx === 0) {
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.50)';
                    ctx.shadowBlur = 14 / scale;
                    ctx.shadowOffsetY = 6 / scale;
                } else {
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
                    ctx.shadowBlur = 3 / scale;
                    ctx.shadowOffsetY = 1.5 / scale;
                }

                ctx.save();
                ctx.translate(fx, fy);
                ctx.fillStyle = rowStrokeColor;
                rowBandPolygons.forEach((polygon) => {
                    if (!Array.isArray(polygon?.points) || polygon.points.length < 3) return;
                    const points = polygon.points;
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        ctx.lineTo(points[i].x, points[i].y);
                    }
                    ctx.closePath();
                    ctx.fill();
                });
                ctx.restore();

                // Clear shadow
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetY = 0;
                ctx.shadowOffsetX = 0;
            });

            // Second pass: aisle strips (egress geometry) for this tier.
            // Draw before row outlines so step lines remain visible across the aisle fills.
            const tierAisleLayout = aisleLayoutMap.get(tIdx);
            if (tierAisleLayout && tierAisleLayout.aisles && tierAisleLayout.aisles.length > 0) {
                this._drawTierAisles(ctx, solver, bowlConfig, tierAisleLayout, offsetCorrection, scale, fx, fy);
            }

            // Third pass: draw row outlines (thin) for each row
            solver.rows.forEach((row) => {
                const offset = (row.x - row.tread_depth) - offsetCorrection;
                const path = this._generateBufferPath(bowlConfig, offset);

                ctx.save();
                ctx.translate(fx, fy);
                ctx.strokeStyle = tierColors.rowOutline;
                ctx.lineWidth = 0.5 / scale;
                ctx.stroke(path);
                ctx.restore();
            });

            // Fourth pass: thick front edge outline at the FIRST row of each tier
            if (solver.rows.length > 0) {
                const firstRow = solver.rows[0];
                const frontOffset = (firstRow.x - firstRow.tread_depth) - offsetCorrection;
                const frontPath = this._generateBufferPath(bowlConfig, frontOffset);

                ctx.save();
                ctx.translate(fx, fy);
                ctx.strokeStyle = tierColors.frontEdge;
                ctx.lineWidth = 2.5 / scale;
                ctx.stroke(frontPath);
                ctx.restore();
            }

            // Fifth pass: thick PERIMETER outline on the LAST row of each visible tier
            if (solver.rows.length > 0) {
                const lastRow = solver.rows[solver.rows.length - 1];
                const perimeterOffset = (lastRow.x) - offsetCorrection;
                const perimeterPath = this._generateBufferPath(bowlConfig, perimeterOffset);

                ctx.save();
                ctx.translate(fx, fy);
                ctx.strokeStyle = tierColors.perimeter;
                ctx.lineWidth = 3.0 / scale;
                ctx.stroke(perimeterPath);
                ctx.restore();
            }

            // Sixth pass: optional section IDs + row seat counts (field plan only)
            if (visibility?.showSectionMetrics) {
                const tierAisleLayout = aisleLayoutMap.get(tIdx);
                if (tierAisleLayout && tierAisleLayout.aisles && tierAisleLayout.aisles.length > 1) {
                    this._drawTierSectionMetrics(ctx, solver, bowlConfig, tierAisleLayout, offsetCorrection, scale, fx, fy);
                }
            }

            // Aisles are drawn earlier so row step lines/front/perimeter outlines remain visible on top.
        });

    }

    _drawShape(ctx, template, extraRunoff, style) {
        ctx.save();
        ctx.strokeStyle = style.strokeStyle;
        ctx.lineWidth = style.lineWidth;
        ctx.setLineDash(style.lineDash);
        ctx.fillStyle = 'transparent';
        const segments = buildFieldGeometrySegments(template, extraRunoff);
        if (segments.length > 0) {
            ctx.stroke(buildPath2DFromSegments(segments));
        }

        ctx.restore();
    }

    _getSectionCutLineData(solvers, visibility, visualFocalY, bowlConfig, offsetCorrection = 0) {
        if (!Array.isArray(solvers) || !visibility?.showSeating || !bowlConfig) return null;

        let outerOffset = null;
        solvers.forEach((solver, tierIndex) => {
            if (tierIndex === 0 && !visibility.t1) return;
            if (tierIndex === 1 && !visibility.t2) return;
            if (tierIndex === 2 && !visibility.t3) return;
            if (!Array.isArray(solver?.rows) || solver.rows.length < 1) return;

            const lastRow = solver.rows[solver.rows.length - 1];
            const nextOffset = Number(lastRow?.x) - (Number(offsetCorrection) || 0);
            if (!Number.isFinite(nextOffset)) return;
            outerOffset = outerOffset === null ? nextOffset : Math.max(outerOffset, nextOffset);
        });

        if (!Number.isFinite(outerOffset)) return null;

        const startY = Number(visualFocalY) || 0;
        const perimeterSubpaths = buildBowlGeometrySubpaths(bowlConfig, outerOffset);
        const intersections = collectVerticalRayIntersectionYs(perimeterSubpaths, 0);
        if (!intersections.length) return null;

        let direction = -1;
        let edgeY = findNearestVerticalRayIntersectionY(intersections, startY, direction);
        if (!Number.isFinite(edgeY)) {
            direction = 1;
            edgeY = findNearestVerticalRayIntersectionY(intersections, startY, direction);
        }
        if (!Number.isFinite(edgeY)) return null;

        return {
            startX: 0,
            startY,
            edgeX: 0,
            edgeY,
            endX: 0,
            endY: edgeY + (direction * SECTION_CUT_LINE_EXTENSION_FT)
        };
    }

    _drawSectionCutLine(ctx, solvers, visibility, scale, visualFocalY, bowlConfig, offsetCorrection = 0) {
        const cutLine = this._getSectionCutLineData(
            solvers,
            visibility,
            visualFocalY,
            bowlConfig,
            offsetCorrection
        );
        if (!cutLine) return;

        ctx.save();
        ctx.strokeStyle = BRAND_FIELD_COLORS.sectionCut;
        ctx.lineWidth = 2 / Math.max(1e-6, Number(scale) || 1);
        ctx.lineCap = 'round';
        ctx.setLineDash([1,2,]);
        ctx.beginPath();
        ctx.moveTo(cutLine.startX, cutLine.startY);
        ctx.lineTo(cutLine.endX, cutLine.endY);
        ctx.stroke();
        ctx.restore();
    }

    _drawFocalPoint(ctx, template, scale, visualFocalX) {
        const fx = 0;
        const fy = visualFocalX !== undefined ? visualFocalX : (template.focal_y || 0);
        const size = 8 / scale;

        ctx.save();
        ctx.strokeStyle = BRAND_FIELD_COLORS.focal;
        ctx.lineWidth = 2.5 / scale;
        ctx.setLineDash([]);

        // Cross
        ctx.beginPath();
        ctx.moveTo(fx - size, fy);
        ctx.lineTo(fx + size, fy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(fx, fy - size);
        ctx.lineTo(fx, fy + size);
        ctx.stroke();

        // Circle
        ctx.beginPath();
        ctx.arc(fx, fy, size * 0.6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }

    _drawLegend(ctx, w, h) {
        ctx.save();
        ctx.font = '12px Inter, system-ui, sans-serif';

        const items = [
            { color: BRAND_FIELD_COLORS.fieldEdge, label: 'Field Edge', dash: false },
            { color: BRAND_FIELD_COLORS.runoff, label: 'Runoff', dash: true },
            { color: '#e7ece4', label: 'Aisles', dash: false },
            { color: BRAND_FIELD_COLORS.sectionCut, label: 'Section Cut', dash: false },
            { color: BRAND_FIELD_COLORS.focal, label: 'Focal Point', dash: false }
        ];

        const startX = 12;
        const startY = h - 14;

        items.forEach((item, i) => {
            const x = startX + i * 110;
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 2;
            if (item.dash) {
                ctx.setLineDash([6, 4]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.beginPath();
            ctx.moveTo(x, startY);
            ctx.lineTo(x + 20, startY);
            ctx.stroke();

            ctx.fillStyle = BRAND_FIELD_COLORS.legendText;
            ctx.setLineDash([]);
            ctx.fillText(item.label, x + 25, startY + 4);
        });

        ctx.restore();
    }
}
