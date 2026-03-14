/**
 * Field Plan View Renderer (2D Canvas)
 * Renders top-down field shapes, runoff perimeters, and focal point markers.
 */

import { getCValueQuality } from '../core/sightline-calc.js';
import {
    buildGeometryPaths,
    sampleAisleBand,
    samplePathPointByRatio,
    buildTierAisleLayout,
    resolveAisleStationRatios
} from '../core/aisle-layout.js';

const FIELD_THEME_COLORS = {
    light: {
        canvasBg: '#ffffff',
        grid: 'rgba(35, 35, 35, 0.06)',
        gridStrong: 'rgba(35, 35, 35, 0.10)',
        fieldEdge: '#7aae1a',   // JLG Green
        runoff: '#de850a',      // JLG Orange
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
        aislesFill: 'rgba(187, 198, 183, 0.12)',
        aislesStroke: 'rgba(187, 198, 183, 0.15)',
        focal: '#dbe2ea',
        legendText: '#b2bdca'
    }
};

const FIELD_TIER_PLAN_COLORS = {
    light: [
        {
            rowBand: 'rgba(80, 85, 80, 0.92)',
            aisleFill: 'rgba(35, 35, 35, 0.04)',
            aisleStroke: 'rgba(35, 35, 35, 0.58)',
            rowOutline: 'rgba(35, 35, 35, 0.14)',
            frontEdge: 'rgba(35, 35, 35, 0.60)',
            perimeter: 'rgba(35, 35, 35, 0.70)'
        },
        {
            rowBand: 'rgba(136, 143, 135, 0.94)',
            aisleFill: 'rgba(111, 117, 110, 0.09)',
            aisleStroke: 'rgba(111, 117, 110, 0.66)',
            rowOutline: 'rgba(111, 117, 110, 0.26)',
            frontEdge: 'rgba(111, 117, 110, 0.78)',
            perimeter: 'rgba(111, 117, 110, 0.86)'
        },
        {
            rowBand: 'rgba(183, 190, 182, 0.98)',
            aisleFill: 'rgba(158, 166, 157, 0.14)',
            aisleStroke: 'rgba(138, 145, 136, 0.76)',
            rowOutline: 'rgba(148, 156, 146, 0.34)',
            frontEdge: 'rgba(132, 139, 130, 0.80)',
            perimeter: 'rgba(122, 129, 120, 0.88)'
        }
    ],
    dark: [
        {
            rowBand: 'rgba(154, 165, 153, 0.68)',
            aisleFill: 'rgba(198, 208, 195, 0.055)',
            aisleStroke: 'rgba(198, 208, 195, 0.22)',
            rowOutline: 'rgba(198, 208, 195, 0.11)',
            frontEdge: 'rgba(198, 208, 195, 0.37)',
            perimeter: 'rgba(198, 208, 195, 0.45)'
        },
        {
            rowBand: 'rgba(122, 139, 121, 0.72)',
            aisleFill: 'rgba(157, 170, 155, 0.075)',
            aisleStroke: 'rgba(157, 170, 155, 0.26)',
            rowOutline: 'rgba(157, 170, 155, 0.125)',
            frontEdge: 'rgba(157, 170, 155, 0.42)',
            perimeter: 'rgba(157, 170, 155, 0.49)'
        },
        {
            rowBand: 'rgba(103, 116, 101, 0.76)',
            aisleFill: 'rgba(131, 145, 130, 0.09)',
            aisleStroke: 'rgba(131, 145, 130, 0.29)',
            rowOutline: 'rgba(131, 145, 130, 0.14)',
            frontEdge: 'rgba(131, 145, 130, 0.45)',
            perimeter: 'rgba(131, 145, 130, 0.52)'
        }
    ]
};

const FIELD_QUALITY_COLORS_DARK = {
    Excellent: 'rgba(121, 164, 47, 0.84)',
    Good: 'rgba(66, 146, 111, 0.84)',
    Acceptable: 'rgba(194, 126, 30, 0.86)',
    Poor: 'rgba(181, 74, 71, 0.86)'
};

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

function getActiveThemeName() {
    if (typeof document === 'undefined' || !document.documentElement) return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

let BRAND_FIELD_COLORS = FIELD_THEME_COLORS.light;
let TIER_PLAN_COLORS = FIELD_TIER_PLAN_COLORS.light;
let ACTIVE_FIELD_THEME = 'light';

function syncFieldThemeColors() {
    const theme = getActiveThemeName();
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
const ROW_SEATCOUNT_MIN_SCALE = 4.0;     // px/ft, tuned to show near close-up screenshot zoom
// Target sizing: ~40% larger than original labels (not 2x).
const ROW_SEATCOUNT_LABEL_FONT_PX = 11.2;   // original 8
const SECTION_LABEL_FONT_PX_ZOOMED_OUT = 9.5;   // ~5% smaller than the prior full-extent size
const SECTION_LABEL_FONT_PX_ZOOMED_IN = 15.4;  // enlarged close-zoom behavior
const SECTION_LABEL_STACKED_FONT_PX = 14;   // original 10
const SECTION_OCC_LABEL_FONT_PX = 11.2;     // original 8
const SECTION_LABEL_STACK_OFFSET_PX = 12.6; // original 9
// Row seat-count labels should sit at a consistent distance from the visible aisle edge
// across all tiers (not a % of section width, which varies by tier/chamfer).
// Gap beyond the visible aisle edge for the row seat-count label center.
// Combined with aisle half-width this gives a consistent cross-tier offset.
const ROW_SEATCOUNT_LABEL_EDGE_OFFSET_FT = 0.9;
const ROW_SEATCOUNT_LABEL_MIN_T = 0.08;
const ROW_SEATCOUNT_LABEL_MAX_T = 0.45;

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
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.padding = 40;

        // Zoom/pan state
        this._userZoom = 1.0;
        this._panX = 0;
        this._panY = 0;
        this._userHasZoomed = false;
        this._isPanning = false;
        this._panStartX = 0;
        this._panStartY = 0;

        this._setupInteraction();
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
            const w = this.canvas.width;
            const h = this.canvas.height;
            const template = this._lastArgs[0];
            const runoff = this._lastArgs[1] != null ? this._lastArgs[1] : template.runoff;
            const bounds = this._getBounds(template, runoff, this._lastArgs[2], this._lastArgs[3]);
            const baseScale = this._calcScale(bounds, w, h);
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            const baseTx = w / 2 - centerX * baseScale;
            const baseTy = h / 2 + centerY * baseScale;
            const cx = w / 2, cy = h / 2;

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
            this._userZoom = 1.0;
            this._panX = 0;
            this._panY = 0;
            this._userHasZoomed = false;
            if (this._lastArgs) {
                this._rerenderFromLastArgs();
            }
        });

        // Middle mouse button double-click for zoom extents
        this._middleClickTime = 0;
        this.canvas.addEventListener('auxclick', (e) => {
            if (e.button === 1) { // Middle button
                const now = Date.now();
                if (now - this._middleClickTime < 400) {
                    // Double middle-click: zoom extents
                    this._userZoom = 1.0;
                    this._panX = 0;
                    this._panY = 0;
                    this._userHasZoomed = false;
                    if (this._lastArgs) {
                        this._rerenderFromLastArgs();
                    }
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
        syncFieldThemeColors();

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
        const baseScale = this._calcScale(bounds, w, h);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        const baseTx = w / 2 - centerX * baseScale;
        const baseTy = h / 2 + centerY * baseScale; // Flip Y

        let scale, tx, ty;

        if (this._userHasZoomed) {
            scale = baseScale * this._userZoom;
            const cx = w / 2, cy = h / 2;

            // Apply zoom around center, then pan
            tx = cx + (baseTx - cx) * this._userZoom + this._panX;
            ty = cy + (baseTy - cy) * this._userZoom + this._panY;
        } else {
            scale = baseScale;
            tx = baseTx;
            ty = baseTy;
        }

        // Draw grid based on bounds
        this._drawGrid(ctx, w, h, scale, bounds, tx, ty);

        // Save context for transformations
        ctx.save();
        ctx.translate(tx, ty);
        ctx.scale(scale, -scale); // Flip Y so +Y is up

        // Draw seating BEFORE runoff/field so field lines satisfy 'on top' if overlap?
        // Actually, typically field is focus. Seating behind?
        // Let's draw seating first.
        // Let's draw seating first.
        if (solvers && visibility && visibility.showSeating) {
            this._drawSeating(ctx, solvers, template, visibility, scale, visualFocalX, bowlConfig, offsetCorrection, tierAisleLayouts);
        }

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
                    const leftX = -((template.field_length || 0) / 2 + maxDist);
                    if (leftX < bounds.minX) bounds.minX = leftX;
                    const rightX = (template.field_length || 0) / 2 + maxDist;
                    if (rightX > bounds.maxX) bounds.maxX = rightX;
                }

                // Add padding for sunlight shadows
                const shadowPad = maxDist * 0.15;
                bounds.minX -= shadowPad * 0.5;
                bounds.maxX += shadowPad;
                bounds.minY -= shadowPad;
                bounds.maxY += shadowPad * 0.5;
            }
        }

        return bounds;
    }

    _calcScale(bounds, w, h) {
        const rangeX = bounds.maxX - bounds.minX;
        const rangeY = bounds.maxY - bounds.minY;
        const pad = this.padding * 2;
        // Avoid div/0
        const rx = rangeX || 100;
        const ry = rangeY || 100;
        return Math.min((w - pad) / rx, (h - pad) / ry);
    }

    _drawGrid(ctx, w, h, scale, bounds, tx, ty) {
        ctx.save();
        ctx.strokeStyle = BRAND_FIELD_COLORS.grid;
        ctx.lineWidth = 1;

        // Grid usually needs to "stick" to world coordinates
        // Bounds determine the visible area globally

        const targetPx = 80;
        const ftPerPx = 1 / scale;
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


    /**
     * Generate the path for a specific "buffer" (offset) from the focal center.
     * @param {Object} bowlConfig - { width, length, cornerType, cornerRadius, type }
     * @param {number} offset - Distance from the focal center line (row.x)
     * @returns {BowlParams}
     */
    _getBowlParams(bowlConfig, offset) {
        // Bowl Config Defaults
        const W = (bowlConfig.width || 200) / 2;
        let type = bowlConfig.type || 'Full';
        const L = (type.includes('Side') && bowlConfig.sideLength) ? (bowlConfig.sideLength / 2) : (bowlConfig.length || 300) / 2;
        let corner = bowlConfig.corner || 'Chamfer';
        let r = bowlConfig.radius || 0;

        const d = offset;

        // 1. Define base rectangle corners (centered at 0,0)
        const w_eff = W + d;
        const l_eff = L + d;

        // Fix: Match canvas X=Length, Y=Width field orientation
        const right = l_eff;
        const left = -l_eff;
        const top = w_eff;
        const bottom = -w_eff;

        if (r < 1) {
            corner = 'Square';
            r = 0;
        }

        const r_eff = (corner === 'Radius') ? (r + d) : 0;
        const chamfer_leg = (corner === 'Chamfer') ? (r + d * 0.5858) : 0;

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

    _getBowlGeometry(bowlConfig, offset) {
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

            const dBack = offset; // behind home plate depth
            const hx = 0; const hy = -dBack;

            if (type === 'Sides') {
                addMove(dx1, dy1);
                addLine(hx, hy);
                addMove(hx, hy);
                addLine(dx2, dy2);
            } else if (type === 'U-End1' || type === 'U-Shape (End 1)') {
                // Outfield arc + foul lines
                addMove(dx1, dy1);
                addArc(0, 0, r, startAngle, endAngle, false);
                addLine(hx, hy);
                addLine(dx1, dy1);
            } else {
                // Full wrap around home plate
                addMove(dx2, dy2);
                addLine(hx, hy);
                addLine(dx1, dy1);
                addArc(0, 0, r, startAngle, endAngle, false);
                addClose();
            }

            return segments;
        }

        const { pts, type, corner, r_eff } = this._getBowlParams(bowlConfig, offset);
        const segments = [];

        const addLine = (x, y) => segments.push({ cmd: 'lineTo', x, y });
        const addMove = (x, y) => segments.push({ cmd: 'moveTo', x, y });
        const addArc = (x, y, rad, sa, ea, ccw) => segments.push({ cmd: 'arc', x, y, r: rad, sa, ea, ccw });
        const addClose = () => segments.push({ cmd: 'closePath' });

        if (type === 'Sides') {
            addMove(pts.fixed_left, pts.bottom);
            addLine(pts.fixed_right, pts.bottom);

            addMove(pts.fixed_left, pts.top);
            addLine(pts.fixed_right, pts.top);

        } else if (type === 'Side1') {
            addMove(pts.fixed_left, pts.bottom);
            addLine(pts.fixed_right, pts.bottom);

        } else if (type === 'Side2') {
            addMove(pts.fixed_left, pts.top);
            addLine(pts.fixed_right, pts.top);

        } else if (type === 'U-Shape (End 1)' || type === 'U-End1') {
            addMove(pts.fixed_right, pts.top);
            addLine(pts.tl_end.x, pts.top);

            if (corner === 'Radius') addArc(pts.tl_center.x, pts.tl_center.y, r_eff, 0.5 * Math.PI, 1.0 * Math.PI, false);
            else if (corner === 'Chamfer') addLine(pts.tl_start.x, pts.tl_start.y);
            else addLine(pts.left, pts.top);

            addLine(pts.left, pts.bl_end.y);

            if (corner === 'Radius') addArc(pts.bl_center.x, pts.bl_center.y, r_eff, 1.0 * Math.PI, 1.5 * Math.PI, false);
            else if (corner === 'Chamfer') addLine(pts.bl_start.x, pts.bl_start.y);
            else addLine(pts.left, pts.bottom);

            addLine(pts.fixed_right, pts.bottom);

        } else if (type === 'U-Shape (End 2)' || type === 'U-End2') {
            addMove(pts.right, pts.fixed_top);
            addLine(pts.right, pts.br_start.y);

            if (corner === 'Radius') addArc(pts.br_center.x, pts.br_center.y, r_eff, 0, 1.5 * Math.PI, true);
            else if (corner === 'Chamfer') addLine(pts.br_end.x, pts.br_end.y);
            else addLine(pts.right, pts.bottom);

            addLine(pts.bl_start.x, pts.bottom);

            if (corner === 'Radius') addArc(pts.bl_center.x, pts.bl_center.y, r_eff, 1.5 * Math.PI, 1.0 * Math.PI, true);
            else if (corner === 'Chamfer') addLine(pts.bl_end.x, pts.bl_end.y);
            else addLine(pts.left, pts.bottom);

            addLine(pts.left, pts.fixed_top);

        } else { // Full Bowl
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

    getBowlGeometrySegments(bowlConfig, offset) {
        return this._getBowlGeometry(bowlConfig, offset);
    }

    calculateRowLength(bowlConfig, offset) {
        const segments = this._getBowlGeometry(bowlConfig, offset);
        const clip = bowlConfig && bowlConfig.clip;
        let totalLength = 0;
        let lastX = 0, lastY = 0;
        let startX = 0, startY = 0;

        segments.forEach(s => {
            if (s.cmd === 'moveTo') {
                lastX = s.x;
                lastY = s.y;
                startX = s.x;
                startY = s.y;
            } else if (s.cmd === 'lineTo') {
                totalLength += this._clippedLineLength(lastX, lastY, s.x, s.y, clip);
                lastX = s.x;
                lastY = s.y;
            } else if (s.cmd === 'arc') {
                totalLength += this._clippedArcLength(s, clip);
                lastX = s.x + s.r * Math.cos(s.ea);
                lastY = s.y + s.r * Math.sin(s.ea);
            } else if (s.cmd === 'closePath') {
                totalLength += this._clippedLineLength(lastX, lastY, startX, startY, clip);
                lastX = startX;
                lastY = startY;
            }
        });

        return totalLength;
    }

    _generateBufferPath(bowlConfig, offset) {
        const segments = this._getBowlGeometry(bowlConfig, offset);
        const path = new Path2D();

        segments.forEach(s => {
            if (s.cmd === 'moveTo') path.moveTo(s.x, s.y);
            else if (s.cmd === 'lineTo') path.lineTo(s.x, s.y);
            else if (s.cmd === 'arc') path.arc(s.x, s.y, s.r, s.sa, s.ea, s.ccw);
            else if (s.cmd === 'closePath') path.closePath();
        });

        return path;
    }

    generateTierAisleLayout(solver, bowlConfig, tierMetrics, offsetCorrection = 0, egressParams = null) {
        if (!solver || !solver.rows || solver.rows.length === 0 || !tierMetrics) return null;

        const firstRow = solver.rows[0];
        const lastRow = solver.rows[solver.rows.length - 1];
        const frontOffset = (firstRow.x - firstRow.tread_depth) - offsetCorrection;
        const backOffset = (lastRow.x) - offsetCorrection;
        const frontSegments = this._getBowlGeometry(bowlConfig, frontOffset);
        const backSegments = this._getBowlGeometry(bowlConfig, backOffset);

        const targetAisles = Math.max(0, Math.round(Number(tierMetrics.numAisles) || 0));
        const aisleWidthFt = Math.max(0, (Number(tierMetrics.aisleWidth) || 0) / 12.0);
        const maxSeatsBetweenAisles = egressParams ? Number(egressParams.seatsBetweenAisles) : NaN;
        const seatWidthIn = egressParams ? Number(egressParams.seatWidthIn) : NaN;

        const layout = buildTierAisleLayout({
            frontSegments,
            backSegments,
            targetAisles,
            aisleWidthFt,
            bowlConfig,
            maxSeatsBetweenAisles,
            seatWidthIn
        });

        const tierSummary = this._summarizeTierLayoutSections(
            solver,
            bowlConfig,
            {
                ...layout,
                tierIndex: solver.tierIndex !== undefined ? solver.tierIndex : 0,
                seatWidthIn: Number.isFinite(seatWidthIn) ? seatWidthIn : NaN
            },
            offsetCorrection
        );

        return {
            tierIndex: solver.tierIndex !== undefined ? solver.tierIndex : 0,
            aisleWidthFt: layout.aisleWidthFt,
            seatWidthIn: Number.isFinite(seatWidthIn) ? seatWidthIn : NaN,
            aisles: layout.aisles || [],
            targetAisles: layout.targetAisles || targetAisles,
            forcedCount: layout.forcedCount || 0,
            sectionBoundaries: layout.sectionBoundaries || [],
            axisExclusionFt: layout.axisExclusionFt || 0,
            sectionSummary: tierSummary || null
        };
    }

    _summarizeTierLayoutSections(solver, bowlConfig, tierLayout, offsetCorrection = 0) {
        if (!solver || !Array.isArray(solver.rows) || solver.rows.length === 0) return null;
        if (!tierLayout || !Array.isArray(tierLayout.aisles) || !Array.isArray(tierLayout.sectionBoundaries)) return null;

        const seatWidthIn = Math.max(1, Number(tierLayout.seatWidthIn) || 0);
        const aisleWidthFt = Math.max(0, Number(tierLayout.aisleWidthFt) || 0);
        if (!(seatWidthIn > 0) || !(aisleWidthFt >= 0)) return null;

        const backRow = solver.rows[solver.rows.length - 1];
        if (!backRow) return null;
        const backCenterOffset = (backRow.x - (backRow.tread_depth * 0.5)) - offsetCorrection;
        const backPaths = buildGeometryPaths(this._getBowlGeometry(bowlConfig, backCenterOffset));
        if (!backPaths.length) return null;

        const chamferCache = new Map();
        const backAisleRatios = this._buildResolvedAisleRatioMap(backPaths, backPaths, tierLayout, chamferCache);

        let actualAisles = 0;
        let actualSections = 0;
        const backRowSectionSeatCounts = [];
        let allSectionPathsClosed = true;

        for (let p = 0; p < tierLayout.sectionBoundaries.length; p++) {
            const path = backPaths[p];
            const boundaries = tierLayout.sectionBoundaries[p];
            if (!Array.isArray(boundaries) || !boundaries.length) continue;

            const pathIsClosed = !!(path && path.closed);
            if (!pathIsClosed) allSectionPathsClosed = false;
            actualAisles += boundaries.length;
            actualSections += pathIsClosed ? boundaries.length : Math.max(0, boundaries.length - 1);

            if (!path || boundaries.length < 2) continue;
            const aisleMap = backAisleRatios.get(p);
            if (!aisleMap) continue;

            const slotCount = pathIsClosed ? boundaries.length : Math.max(0, boundaries.length - 1);
            for (let i = 0; i < slotCount; i++) {
                const a = boundaries[i];
                const b = pathIsClosed ? boundaries[(i + 1) % boundaries.length] : boundaries[i + 1];
                const uA = aisleMap.get(a.aisleIndex);
                const uB = aisleMap.get(b.aisleIndex);
                if (!Number.isFinite(uA) || !Number.isFinite(uB)) continue;

                const centerGapFt = sectionDistanceOnPath(path, uA, uB);
                const seatingGapFt = Math.max(0, centerGapFt - aisleWidthFt);
                const seatCount = Math.max(0, Math.floor((seatingGapFt * 12.0) / seatWidthIn));
                backRowSectionSeatCounts.push(seatCount);
            }
        }

        let avgBackRowSeatsPerSection = 0;
        let maxBackRowSeatsPerSection = 0;
        let minBackRowSeatsPerSection = 0;
        if (backRowSectionSeatCounts.length) {
            const sum = backRowSectionSeatCounts.reduce((a, b) => a + b, 0);
            avgBackRowSeatsPerSection = sum / backRowSectionSeatCounts.length;
            maxBackRowSeatsPerSection = Math.max(...backRowSectionSeatCounts);
            minBackRowSeatsPerSection = Math.min(...backRowSectionSeatCounts);
        }

        return {
            actualAisles,
            actualSections,
            allSectionPathsClosed,
            backRowSectionSeatCounts,
            avgBackRowSeatsPerSection,
            maxBackRowSeatsPerSection,
            minBackRowSeatsPerSection
        };
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
            offsetYPx = 0
        } = options;

        ctx.save();
        ctx.translate(x, y);
        // Cancel world scaling + Y flip so labels are upright and pixel-sized.
        ctx.scale(1 / safeScale, -1 / safeScale);
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

        ctx.fillStyle = bgColor;
        ctx.fillRect(rx, ry, width, height);
        if (borderColor) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(rx + 0.5, ry + 0.5, width - 1, height - 1);
        }

        ctx.fillStyle = textColor;
        ctx.fillText(String(text), 0, 0);
        ctx.restore();
    }

    _buildResolvedAisleRatioMap(pathA, pathB, tierLayout, chamferCache) {
        const byPath = new Map();
        if (!tierLayout || !Array.isArray(tierLayout.aisles)) return byPath;

        for (let i = 0; i < tierLayout.aisles.length; i++) {
            const aisle = tierLayout.aisles[i];
            const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
            const pA = pathA[pathIndex];
            const pB = pathB[pathIndex];
            if (!pA || !pB) continue;
            const ratios = resolveAisleStationRatios(pA, pB, aisle, chamferCache);
            if (!ratios || !Number.isFinite(ratios.uFront)) continue;
            if (!byPath.has(pathIndex)) byPath.set(pathIndex, new Map());
            byPath.get(pathIndex).set(i, normalizePathU(pA, ratios.uFront));
        }
        return byPath;
    }

    _pickBestRowLabelSampling(centerOffset, getPathsForOffset, tierLayout, chamferCache) {
        const baseOffset = Number(centerOffset) || 0;
        // Small perturbations avoid pathological centerline sampling exactly on a corner/chamfer vertex.
        const offsetsToTry = [0, 0.02, -0.02, 0.05, -0.05];

        let best = null;
        for (let i = 0; i < offsetsToTry.length; i++) {
            const testOffset = baseOffset + offsetsToTry[i];
            const paths = getPathsForOffset(testOffset);
            if (!paths || !paths.length) continue;
            const aisleRatiosByPath = this._buildResolvedAisleRatioMap(paths, paths, tierLayout, chamferCache);

            let score = 0;
            aisleRatiosByPath.forEach(m => { score += m?.size || 0; });

            if (!best || score > best.score) {
                best = { paths, aisleRatiosByPath, score, sampledOffset: testOffset };
                // Early exit if we resolved every aisle across all paths for this row.
                if (score >= (tierLayout?.aisles?.length || 0)) break;
            }
        }

        return best || { paths: [], aisleRatiosByPath: new Map(), score: 0, sampledOffset: baseOffset };
    }

    _buildTierSectionTemplates(referencePaths, tierLayout, sectionBase) {
        const out = new Map();
        if (!tierLayout || !Array.isArray(tierLayout.sectionBoundaries)) return out;

        // Resolve reference aisle stations directly from stored aisle data (front-path basis).
        const refAisleByPath = new Map();
        (tierLayout.aisles || []).forEach((aisle, aisleIndex) => {
            const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
            const u = Number.isFinite(aisle.uFront) ? aisle.uFront : aisle.u;
            if (!Number.isFinite(u)) return;
            if (!refAisleByPath.has(pathIndex)) refAisleByPath.set(pathIndex, new Map());
            refAisleByPath.get(pathIndex).set(aisleIndex, u);
        });

        let nextSectionNumber = sectionBase;
        for (let pathIndex = 0; pathIndex < tierLayout.sectionBoundaries.length; pathIndex++) {
            const path = referencePaths[pathIndex];
            const boundaries = tierLayout.sectionBoundaries[pathIndex];
            const aisleMap = refAisleByPath.get(pathIndex);
            if (!path || !Array.isArray(boundaries) || boundaries.length < 2 || !aisleMap) continue;

            const slots = [];
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
                    uA: normUA,
                    uB: normUB,
                    midU,
                    midPt,
                    sectionNumber: null
                });
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

        const aisleWidthFt = Math.max(0, Number(tierLayout.aisleWidthFt) || 0);
        const seatWidthIn = Math.max(1, Number(tierLayout.seatWidthIn) || 0);
        if (!(seatWidthIn > 0) || !(aisleWidthFt > 0)) return;

        const effectiveScale = Math.max(0, Number(scale) || 0);
        const showRowSeatCounts = effectiveScale >= ROW_SEATCOUNT_MIN_SCALE;
        // Section labels should remain visible at close zoom; only row seat counts are zoom-gated.
        const showSectionLabels = effectiveScale >= SECTION_LABEL_MIN_SCALE;
        if (!showSectionLabels && !showRowSeatCounts) return;

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(this._getBowlGeometry(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        const tierIdx = Math.max(0, Math.floor(Number(tierLayout.tierIndex) || 0));
        const sectionBase = (tierIdx + 1) * 100;
        // Build section templates on a mid-tier row for stable numbering/order
        // independent of zoom level and local chamfer flare at the back row.
        const templateRowIndex = Math.floor((Math.max(1, solver.rows.length) - 1) * 0.5);
        const templateRow = solver.rows[templateRowIndex];
        const templateOffset = (templateRow.x - (templateRow.tread_depth * 0.5)) - offsetCorrection;
        const labelPaths = getPathsForOffset(templateOffset);
        const chamferCache = new Map();

        const sectionTemplates = this._buildTierSectionTemplates(labelPaths, tierLayout, sectionBase);
        if (!sectionTemplates.size) return;

        // Draw per-row seat counts for each section at the right-hand side of each row segment.
        const sectionSeatTotals = new Map();
        if (showRowSeatCounts) {
            for (let r = 0; r < solver.rows.length; r++) {
                const row = solver.rows[r];
                const centerOffset = (row.x - (row.tread_depth * 0.5)) - offsetCorrection;
                const sampledRow = this._pickBestRowLabelSampling(centerOffset, getPathsForOffset, tierLayout, chamferCache);
                const centerPaths = sampledRow.paths;
                if (!centerPaths.length) continue;

                const aisleRatiosByPath = sampledRow.aisleRatiosByPath;
                if (!aisleRatiosByPath.size) continue;

                ctx.save();
                ctx.translate(fx, fy);

                sectionTemplates.forEach((slots, pathIndex) => {
                    const path = centerPaths[pathIndex];
                    const aisleMap = aisleRatiosByPath.get(pathIndex);
                    if (!path || !aisleMap || slots.length < 1) return;
                    if (!sectionSeatTotals.has(pathIndex)) {
                        sectionSeatTotals.set(pathIndex, new Array(slots.length).fill(0));
                    }
                    const totals = sectionSeatTotals.get(pathIndex);

                    for (let i = 0; i < slots.length; i++) {
                        const slot = slots[i];
                        const uA = aisleMap.get(slot.aisleIndexA);
                        const uB = aisleMap.get(slot.aisleIndexB);
                        if (!Number.isFinite(uA) || !Number.isFinite(uB)) continue;

                        const centerGapFt = sectionDistanceOnPath(path, uA, uB);
                        const seatingGapFt = Math.max(0, centerGapFt - aisleWidthFt);
                        const seatCount = Math.floor((seatingGapFt * 12.0) / seatWidthIn);
                        if (!(seatCount > 0)) continue;
                        totals[i] += seatCount;

                        const ptA = samplePathPointByRatio(path, uA);
                        const ptB = samplePathPointByRatio(path, uB);
                        const rightIsA = (ptA.x > ptB.x + 1e-6) || (Math.abs(ptA.x - ptB.x) <= 1e-6 && ptA.y >= ptB.y);
                        const labelCenterOffsetFt = (aisleWidthFt * 0.5) + ROW_SEATCOUNT_LABEL_EDGE_OFFSET_FT;
                        const edgeInsetT = centerGapFt > 1e-6
                            ? Math.max(
                                ROW_SEATCOUNT_LABEL_MIN_T,
                                Math.min(ROW_SEATCOUNT_LABEL_MAX_T, labelCenterOffsetFt / centerGapFt)
                            )
                            : 0.2;
                        const labelU = rightIsA
                            ? interpolatePathSectionU(path, uA, uB, edgeInsetT)
                            : interpolatePathSectionU(path, uA, uB, 1 - edgeInsetT);
                        const labelPt = samplePathPointByRatio(path, labelU);

                        this._drawWorldTextLabel(ctx, scale, labelPt.x, labelPt.y, String(seatCount), {
                            fontPx: ROW_SEATCOUNT_LABEL_FONT_PX,
                            fontWeight: 700,
                            textColor: '#1f2937',
                            bgColor: 'rgba(255,255,255,0.88)',
                            borderColor: 'rgba(148, 163, 184, 0.35)',
                            paddingX: 4,
                            paddingY: 1.5
                        });
                    }
                });

                ctx.restore();
            }
        }

        if (showSectionLabels) {
            // Place section labels in the approximate center of each section polygon
            // using the first and last row centerlines so labels track aisle geometry.
            const firstRow = solver.rows[0];
            const lastRow = solver.rows[solver.rows.length - 1];
            const firstOffset = (firstRow.x - (firstRow.tread_depth * 0.5)) - offsetCorrection;
            const lastOffset = (lastRow.x - (lastRow.tread_depth * 0.5)) - offsetCorrection;
            const firstPaths = getPathsForOffset(firstOffset);
            const lastPaths = getPathsForOffset(lastOffset);
            const firstAisleRatios = this._buildResolvedAisleRatioMap(firstPaths, firstPaths, tierLayout, chamferCache);
            const lastAisleRatios = this._buildResolvedAisleRatioMap(lastPaths, lastPaths, tierLayout, chamferCache);

            ctx.save();
            ctx.translate(fx, fy);
            sectionTemplates.forEach((slots, pathIndex) => {
                const path = labelPaths[pathIndex];
                const frontPath = firstPaths[pathIndex];
                const backPath = lastPaths[pathIndex];
                const frontAisles = firstAisleRatios.get(pathIndex);
                const backAisles = lastAisleRatios.get(pathIndex);
                const totals = sectionSeatTotals.get(pathIndex);
                if (!path) return;
                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    if (!Number.isFinite(slot.sectionNumber)) continue;
                    let labelX = NaN;
                    let labelY = NaN;

                    if (frontPath && backPath && frontAisles && backAisles) {
                        const uFA = frontAisles.get(slot.aisleIndexA);
                        const uFB = frontAisles.get(slot.aisleIndexB);
                        const uBA = backAisles.get(slot.aisleIndexA);
                        const uBB = backAisles.get(slot.aisleIndexB);
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

                    const hasOccLine = showRowSeatCounts && Array.isArray(totals) && Number.isFinite(totals[i]) && totals[i] > 0;
                    const useCloseZoomSectionLabelSize = showRowSeatCounts;

                    this._drawWorldTextLabel(ctx, scale, labelX, labelY, `#${slot.sectionNumber}`, {
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
                        this._drawWorldTextLabel(ctx, scale, labelX, labelY, `${Math.round(totals[i])}occ`, {
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
                }
            });
            ctx.restore();
        }
    }

    getTierAisleBandPolygons(solver, bowlConfig, tierLayout, offsetCorrection = 0) {
        if (!tierLayout || !tierLayout.aisles || tierLayout.aisles.length === 0) return [];
        if (!solver || !solver.rows || solver.rows.length === 0) return [];

        const widthFt = Math.max(0, Number(tierLayout.aisleWidthFt) || 0);
        if (widthFt <= 0) return [];

        const polygons = [];
        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(this._getBowlGeometry(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        const chamferCache = new Map();
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

                const ratios = resolveAisleStationRatios(pathFront, pathBack, aisle, chamferCache);
                if (!ratios) continue;

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

        const aisleWidthFt = Math.max(0, Number(tierLayout.aisleWidthFt) || 0);
        const seatWidthIn = Math.max(1, Number(tierLayout.seatWidthIn) || 0);
        if (!(seatWidthIn > 0) || !(aisleWidthFt > 0)) {
            return { sectionLabels: [], rowSeatLabels: [] };
        }

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(this._getBowlGeometry(bowlConfig, offset)));
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
        const sectionTemplates = this._buildTierSectionTemplates(labelPaths, tierLayout, sectionBase);
        if (!sectionTemplates.size) return { sectionLabels: [], rowSeatLabels: [] };

        const rowSeatLabels = [];
        const sectionSeatTotals = new Map();
        for (let r = 0; r < solver.rows.length; r++) {
            const row = solver.rows[r];
            const centerOffset = (row.x - (row.tread_depth * 0.5)) - offsetCorrection;
            const sampledRow = this._pickBestRowLabelSampling(centerOffset, getPathsForOffset, tierLayout, chamferCache);
            const centerPaths = sampledRow.paths;
            if (!centerPaths.length) continue;

            const aisleRatiosByPath = sampledRow.aisleRatiosByPath;
            if (!aisleRatiosByPath.size) continue;

            sectionTemplates.forEach((slots, pathIndex) => {
                const path = centerPaths[pathIndex];
                const aisleMap = aisleRatiosByPath.get(pathIndex);
                if (!path || !aisleMap || slots.length < 1) return;
                if (!sectionSeatTotals.has(pathIndex)) {
                    sectionSeatTotals.set(pathIndex, new Array(slots.length).fill(0));
                }
                const totals = sectionSeatTotals.get(pathIndex);

                for (let i = 0; i < slots.length; i++) {
                    const slot = slots[i];
                    const uA = aisleMap.get(slot.aisleIndexA);
                    const uB = aisleMap.get(slot.aisleIndexB);
                    if (!Number.isFinite(uA) || !Number.isFinite(uB)) continue;

                    const centerGapFt = sectionDistanceOnPath(path, uA, uB);
                    const seatingGapFt = Math.max(0, centerGapFt - aisleWidthFt);
                    const seatCount = Math.floor((seatingGapFt * 12.0) / seatWidthIn);
                    if (!(seatCount > 0)) continue;
                    totals[i] += seatCount;

                    const ptA = samplePathPointByRatio(path, uA);
                    const ptB = samplePathPointByRatio(path, uB);
                    const rightIsA = (ptA.x > ptB.x + 1e-6) || (Math.abs(ptA.x - ptB.x) <= 1e-6 && ptA.y >= ptB.y);
                    const labelCenterOffsetFt = (aisleWidthFt * 0.5) + ROW_SEATCOUNT_LABEL_EDGE_OFFSET_FT;
                    const edgeInsetT = centerGapFt > 1e-6
                        ? Math.max(
                            ROW_SEATCOUNT_LABEL_MIN_T,
                            Math.min(ROW_SEATCOUNT_LABEL_MAX_T, labelCenterOffsetFt / centerGapFt)
                        )
                        : 0.2;
                    const labelU = rightIsA
                        ? interpolatePathSectionU(path, uA, uB, edgeInsetT)
                        : interpolatePathSectionU(path, uA, uB, 1 - edgeInsetT);
                    const labelPt = samplePathPointByRatio(path, labelU);

                    rowSeatLabels.push({
                        tierIndex: tierIdx,
                        rowIndex: r,
                        sectionNumber: Number.isFinite(slot.sectionNumber) ? slot.sectionNumber : null,
                        pathIndex,
                        slotIndex: i,
                        x: labelPt.x,
                        y: labelPt.y,
                        seatCount,
                        text: String(seatCount)
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
        const firstAisleRatios = this._buildResolvedAisleRatioMap(firstPaths, firstPaths, tierLayout, chamferCache);
        const lastAisleRatios = this._buildResolvedAisleRatioMap(lastPaths, lastPaths, tierLayout, chamferCache);

        sectionTemplates.forEach((slots, pathIndex) => {
            const path = labelPaths[pathIndex];
            const frontPath = firstPaths[pathIndex];
            const backPath = lastPaths[pathIndex];
            const frontAisles = firstAisleRatios.get(pathIndex);
            const backAisles = lastAisleRatios.get(pathIndex);
            const totals = sectionSeatTotals.get(pathIndex);
            if (!path) return;

            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (!Number.isFinite(slot.sectionNumber)) continue;

                let labelX = NaN;
                let labelY = NaN;
                if (frontPath && backPath && frontAisles && backAisles) {
                    const uFA = frontAisles.get(slot.aisleIndexA);
                    const uFB = frontAisles.get(slot.aisleIndexB);
                    const uBA = backAisles.get(slot.aisleIndexA);
                    const uBB = backAisles.get(slot.aisleIndexB);
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

                const occupancy = Array.isArray(totals) && Number.isFinite(totals[i]) ? Math.round(totals[i]) : null;
                sectionLabels.push({
                    tierIndex: tierIdx,
                    pathIndex,
                    slotIndex: i,
                    sectionNumber: slot.sectionNumber,
                    x: labelX,
                    y: labelY,
                    text: `#${slot.sectionNumber}`,
                    occupancy,
                    occText: occupancy && occupancy > 0 ? `${occupancy}occ` : null
                });
            }
        });

        return { sectionLabels, rowSeatLabels };
    }

    _drawTierAisles(ctx, solver, bowlConfig, tierLayout, offsetCorrection, scale, fx, fy) {
        if (!tierLayout || !tierLayout.aisles || tierLayout.aisles.length === 0) return;
        if (!solver || !solver.rows || solver.rows.length === 0) return;

        const widthFt = Math.max(0, Number(tierLayout.aisleWidthFt) || 0);
        if (widthFt <= 0) return;

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(this._getBowlGeometry(bowlConfig, offset)));
            }
            return pathCache.get(key);
        };

        ctx.save();
        ctx.translate(fx, fy);
        ctx.fillStyle = BRAND_FIELD_COLORS.aislesFill;
        const chamferCache = new Map();

        // Match 3D aisle logic by sampling front/back paths per seating row.
        // This creates the same radiating aisle behavior in Field Plan.
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

                const ratios = resolveAisleStationRatios(pathFront, pathBack, aisle, chamferCache);
                if (!ratios) continue;

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

        // Render-time clipping (does not modify underlying geometry).
        const clipApplied = this._applyRenderClip(ctx, bowlConfig);

        // === SUNLIGHT SHADOW PASS ===
        // Simulate harsh directional sunlight — shadows offset 30° to lower-right
        // Each tier casts a shadow proportional to its height/elevation
        // 30° from vertical: cos(30°)=0.87 (down), sin(30°)=0.5 (right)
        const sunAngleX = 0.5;  // shadow offset right
        const sunAngleY = -0.87; // shadow offset down (negative = screen-down in flipped Y)

        solvers.forEach((solver, idx) => {
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : idx;
            const tierColors = getTierPlanColors(tIdx);
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

                ctx.strokeStyle = rowStrokeColor;
                ctx.lineWidth = Math.max(1 / scale, row.tread_depth * 1.05);

                const offset = (row.x - row.tread_depth) - offsetCorrection;
                const path = this._generateBufferPath(bowlConfig, offset);

                ctx.save();
                ctx.translate(fx, fy);
                ctx.stroke(path);
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
            solver.rows.forEach((row, rowIdx) => {
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

        if (clipApplied) ctx.restore();
    }

    _clipKeepPredicateFactory(clip) {
        if (!clip || !clip.enabled) return null;
        const axis = (clip.axis || 'X').toUpperCase();
        const side = clip.side || 'positive';
        const position = Number.isFinite(parseFloat(clip.position)) ? parseFloat(clip.position) : 0;
        if (axis === 'X') {
            return side === 'positive' ? ((x) => x >= position) : ((x) => x <= position);
        }
        return side === 'positive' ? ((_, y) => y >= position) : ((_, y) => y <= position);
    }

    _clippedLineLength(x1, y1, x2, y2, clip) {
        const keep = this._clipKeepPredicateFactory(clip);
        if (!keep) return Math.hypot(x2 - x1, y2 - y1);

        const p1In = keep(x1, y1);
        const p2In = keep(x2, y2);
        if (p1In && p2In) return Math.hypot(x2 - x1, y2 - y1);
        if (!p1In && !p2In) return 0;

        const axis = (clip.axis || 'X').toUpperCase();
        const pos = Number.isFinite(parseFloat(clip.position)) ? parseFloat(clip.position) : 0;
        const d = axis === 'X' ? (x2 - x1) : (y2 - y1);
        if (Math.abs(d) < 1e-9) return 0;

        const t = axis === 'X' ? (pos - x1) / d : (pos - y1) / d;
        const clampedT = Math.max(0, Math.min(1, t));
        const ix = x1 + (x2 - x1) * clampedT;
        const iy = y1 + (y2 - y1) * clampedT;

        if (p1In) return Math.hypot(ix - x1, iy - y1);
        return Math.hypot(x2 - ix, y2 - iy);
    }

    _clippedArcLength(arc, clip) {
        const keep = this._clipKeepPredicateFactory(clip);
        if (!keep) {
            let angle = arc.ea - arc.sa;
            if (arc.ccw) {
                while (angle > 0) angle -= 2 * Math.PI;
                while (angle <= -2 * Math.PI) angle += 2 * Math.PI;
            } else {
                while (angle < 0) angle += 2 * Math.PI;
                while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
            }
            return arc.r * Math.abs(angle);
        }

        // Numerical approximation is sufficient for occupancy metrics.
        const steps = 96;
        let total = 0;
        let prev = null;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = arc.sa + (arc.ea - arc.sa) * t;
            const x = arc.x + arc.r * Math.cos(a);
            const y = arc.y + arc.r * Math.sin(a);
            if (prev) total += this._clippedLineLength(prev.x, prev.y, x, y, clip);
            prev = { x, y };
        }
        return total;
    }

    _applyRenderClip(ctx, bowlConfig) {
        const clip = bowlConfig && bowlConfig.clip;
        if (!clip || !clip.enabled) return false;

        const axis = (clip.axis || 'X').toUpperCase();
        const side = clip.side || 'positive';
        const pos = Number.isFinite(parseFloat(clip.position)) ? parseFloat(clip.position) : 0;
        const inf = 100000;

        ctx.save();
        ctx.beginPath();
        if (axis === 'X') {
            if (side === 'positive') ctx.rect(pos, -inf, inf * 2, inf * 2);
            else ctx.rect(-inf, -inf, inf + pos, inf * 2);
        } else {
            if (side === 'positive') ctx.rect(-inf, pos, inf * 2, inf * 2);
            else ctx.rect(-inf, -inf, inf * 2, inf + pos);
        }
        ctx.clip();
        return true;
    }

    _drawShape(ctx, template, extraRunoff, style) {
        const shape = template.shape;
        ctx.save();
        ctx.strokeStyle = style.strokeStyle;
        ctx.lineWidth = style.lineWidth;
        ctx.setLineDash(style.lineDash);
        ctx.fillStyle = 'transparent';

        if (shape === 'rectangle') {
            const halfL = (template.field_length) / 2 + extraRunoff;
            const halfW = (template.field_width) / 2 + extraRunoff;
            ctx.beginPath();
            ctx.rect(-halfL, -halfW, halfL * 2, halfW * 2);
            ctx.stroke();

        } else if (shape === 'rounded_rect') {
            const halfL = (template.field_length) / 2 + extraRunoff;
            const halfW = (template.field_width) / 2 + extraRunoff;
            const r = (template.corner_radius || 0) + extraRunoff;
            this._roundedRect(ctx, -halfL, -halfW, halfL * 2, halfW * 2, r);
            ctx.stroke();

        } else if (shape === 'oval') {
            const halfStraight = (template.straight_length) / 2 - (template.corner_radius || 0) + extraRunoff;
            const halfW = (template.field_width) / 2 + extraRunoff;

            ctx.beginPath();
            // Top straight
            ctx.moveTo(-halfStraight, halfW);
            ctx.lineTo(halfStraight, halfW);
            // Right semicircle
            ctx.arc(halfStraight, 0, halfW, Math.PI / 2, -Math.PI / 2, true);
            // Bottom straight
            ctx.lineTo(-halfStraight, -halfW);
            // Left semicircle
            ctx.arc(-halfStraight, 0, halfW, -Math.PI / 2, Math.PI / 2, true);
            ctx.closePath();
            ctx.stroke();

        } else if (shape === 'arc') {
            const radius = (template.field_radius || 0) + extraRunoff;
            const halfAngle = ((template.arc_angle || 90) / 2) * Math.PI / 180;
            const startAngle = Math.PI / 2 - halfAngle;
            const endAngle = Math.PI / 2 + halfAngle;

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(
                radius * Math.cos(startAngle),
                radius * Math.sin(startAngle)
            );
            ctx.arc(0, 0, radius, startAngle, endAngle);
            ctx.lineTo(0, 0);
            ctx.stroke();
        }

        ctx.restore();
    }


    _roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
        ctx.lineTo(x + width, y + height - r);
        ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
        ctx.lineTo(x + r, y + height);
        ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
        ctx.lineTo(x, y + r);
        ctx.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
        ctx.closePath();
    }

    _drawFocalPoint(ctx, template, scale, visualFocalX) {
        const fx = template.focal_x || 0;
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
