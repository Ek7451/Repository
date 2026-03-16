/**
 * Section Profile View Renderer (2D Canvas)
 * Renders the stepped seating profile, sightlines, head circles, and focal point.
 */

import {
    buildTierRowCountHandleCandidates,
    buildStructuralProfileGeometry,
    getSolverTierIndex
} from '../core/profile-solver.js';
import { getCValueQuality, generateHeadCirclePoints, SightlineAnalyzer } from '../core/sightline-calc.js';

const PROFILE_THEME_COLORS = {
    light: {
        canvasBg: '#ffffff',
        groundLine: 'rgba(35, 35, 35, 0.14)',
        grid: 'rgba(35, 35, 35, 0.05)',
        gridLabel: 'rgba(35, 35, 35, 0.38)',
        hoverInk: '#232323',
        focal: '#232323',
        tooltipBg: 'rgba(255, 255, 255, 0.97)',
        tooltipTitle: '#232323',
        tooltipText: '#4d535a',
        tier: [
            {
                stroke: '#232323',
                fill: 'rgba(35, 35, 35, 0.06)',
                fillStroke: 'rgba(35, 35, 35, 0.22)',
                head: '#3f3f3f',
                eye: '#232323'
            },
            {
                stroke: '#6f756e',
                fill: 'rgba(111, 117, 110, 0.08)',
                fillStroke: 'rgba(111, 117, 110, 0.26)',
                head: '#7d847c',
                eye: '#5f655f'
            },
            {
                stroke: '#9ea69d',
                fill: 'rgba(158, 166, 157, 0.12)',
                fillStroke: 'rgba(158, 166, 157, 0.36)',
                head: '#adb4ab',
                eye: '#868c85'
            }
        ]
    },
    dark: {
        canvasBg: '#0f151d',
        groundLine: 'rgba(232, 237, 242, 0.14)',
        grid: 'rgba(232, 237, 242, 0.06)',
        gridLabel: 'rgba(232, 237, 242, 0.46)',
        hoverInk: '#eef3f8',
        focal: '#eef3f8',
        tooltipBg: 'rgba(14, 20, 27, 0.96)',
        tooltipTitle: '#edf2f7',
        tooltipText: '#c2ceda',
        tier: [
            {
                stroke: '#c7cfc5',
                fill: 'rgba(199, 207, 197, 0.07)',
                fillStroke: 'rgba(199, 207, 197, 0.28)',
                head: '#d9e0d6',
                eye: '#eef3ea'
            },
            {
                stroke: '#95a294',
                fill: 'rgba(149, 162, 148, 0.08)',
                fillStroke: 'rgba(149, 162, 148, 0.26)',
                head: '#aab7a7',
                eye: '#c0ccbd'
            },
            {
                stroke: '#7f8b7e',
                fill: 'rgba(127, 139, 126, 0.09)',
                fillStroke: 'rgba(127, 139, 126, 0.25)',
                head: '#97a294',
                eye: '#adb8aa'
            }
        ]
    }
};

function normalizeThemeName(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

let BRAND_PROFILE_COLORS = PROFILE_THEME_COLORS.light;

function syncProfileThemeColors(theme = 'light') {
    theme = normalizeThemeName(theme);
    BRAND_PROFILE_COLORS = PROFILE_THEME_COLORS[theme] || PROFILE_THEME_COLORS.light;
}

const PROFILE_X_AXIS_LABEL_Y_OFFSET_PX = 96; // keep bottom scale clear of profile overlay toggle
const PROFILE_ZERO_LINE_WORLD_Z_OFFSET_FT = 0;
const TIER_DRAG_PICK_DISTANCE_PX = 18;
const TIER_DRAG_PICK_PADDING_PX = 10;
const TIER_DRAG_SNAP_TOLERANCE_PX = 12;
const TIER_DRAG_GUIDE_POINT_RADIUS_PX = 4;
const TIER_ROW_COUNT_HANDLE_RADIUS_PX = 6;
const TIER_ROW_COUNT_HANDLE_PICK_DISTANCE_PX = 12;

function getTierBaseZ(solver, tierIndex = 0) {
    if (!solver?.rows?.length) return 0;
    return tierIndex === 0 ? 0 : (solver.rows[0].z - solver.rows[0].riser_height);
}

function getDistanceToSegmentPx(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) {
        return Math.hypot(px - ax, py - ay);
    }

    const projection = ((px - ax) * dx + (py - ay) * dy) / ((dx * dx) + (dy * dy));
    const t = Math.max(0, Math.min(1, projection));
    const nearestX = ax + dx * t;
    const nearestY = ay + dy * t;
    return Math.hypot(px - nearestX, py - nearestY);
}

export class ProfileRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas, options = {}) {
        const settings = /** @type {{
            theme?: string,
            onTierPositionChanged?: ((payload: {
                tierIndex: number,
                firstRowDist: number,
                firstRowElev: number
            }) => boolean | void),
            onTierRowCountChanged?: ((payload: {
                tierIndex: number,
                numRows: number
            }) => boolean | void)
        }} */ (options && typeof options === 'object' ? options : {});
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.padding = 60;
        this.hoveredRow = -1;
        this._theme = normalizeThemeName(settings.theme);
        this._onTierPositionChanged = typeof settings.onTierPositionChanged === 'function'
            ? settings.onTierPositionChanged
            : () => {};
        this._onTierRowCountChanged = typeof settings.onTierRowCountChanged === 'function'
            ? settings.onTierRowCountChanged
            : () => {};

        // --- Camera State (World Coordinates) ---
        // exact world coordinates of the center of the canvas
        this._cameraX = 0;
        this._cameraZ = 0;
        // Zoom level: pixels per foot
        this._pxPerFoot = 10;

        // Interaction Flags
        this._manualControl = false; // (Legacy flag, less relevant now that we only auto-fit once)
        this._isFirstRender = true;  // NEW: Only auto-fit on first load
        this._isPanning = false;
        this._panStartX = 0;
        this._panStartY = 0;

        // Cache for rerender
        this._lastSolvers = null;
        this._lastFocalX = 0;
        this._lastFocalZ = 0;
        this._lastOptions = {};
        this._lastAllRows = null;
        this._lastTierRenderState = [];
        this._lastMx = 0;
        this._lastMy = 0;
        this._dragState = null;
        this._hoveredTierIndex = null;
        this._hoveredTierHandleIndex = null;

        this._setupInteraction();
        syncProfileThemeColors(this._theme);
    }

    setTheme(theme) {
        this._theme = normalizeThemeName(theme);
        syncProfileThemeColors(this._theme);
    }

    _setupInteraction() {
        // --- Helper: Screen <-> World Transforms ---
        // (These use the CURRENT instance state)
        const toWorld = (sx, sy) => {
            const w = this.canvas.width;
            const h = this.canvas.height;
            // sx = (worldX - camX) * scale + w/2
            // => worldX = (sx - w/2) / scale + camX
            const worldX = (sx - w / 2) / this._pxPerFoot + this._cameraX;
            // sy = (camZ - worldZ) * scale + h/2  (Y-up in world, Y-down in screen)
            // => worldZ = camZ - (sy - h/2) / scale
            const worldZ = this._cameraZ - (sy - h / 2) / this._pxPerFoot;
            return { x: worldX, z: worldZ };
        };

        // Hover tracking
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            this._lastMx = mx;
            this._lastMy = my;

            if (this._isPanning) {
                const dx = e.clientX - this._panStartX;
                const dy = e.clientY - this._panStartY;

                // Pan in world units
                // Moving mouse RIGHT (positive dx) means dragging world RIGHT, so camera moves LEFT (negative)
                // Actually, standard pan: drag left moves camera right.
                // dx > 0 (drag right) -> Should see content to the left -> Camera moves LEFT (x decreases)

                this._cameraX -= dx / this._pxPerFoot;
                this._cameraZ += dy / this._pxPerFoot; // dy > 0 (down) -> Camera moves UP (z increases)

                this._panStartX = e.clientX;
                this._panStartY = e.clientY;
                this._manualControl = true;
                this._rerender();
                return;
            }

            if (this._dragState) {
                return;
            }

            if (this._lastSolvers) {
                this._handleHover(mx, my);
                this._updateInteractionTargets(mx, my);
                this._updateInteractionCursor(mx, my);
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredRow = -1;
            this._isPanning = false;
            this._hoveredTierIndex = null;
            this._hoveredTierHandleIndex = null;
            if (!this._dragState) {
                this.canvas.style.cursor = 'default';
            }
            this._rerender();
        });

        // Mouse wheel: Zoom towards cursor
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            // Use Client coordinates relative to rect for stability
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // 1. Get world point under mouse BEFORE zoom
            const worldBefore = toWorld(mx, my);

            // 2. Apply zoom
            const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            this._pxPerFoot *= zoomFactor;
            this._pxPerFoot = Math.max(0.5, Math.min(200, this._pxPerFoot)); // Clamp

            // 3. Adjust camera so worldBefore is STILL under mx, my
            const w = this.canvas.width;
            const h = this.canvas.height;

            // worldX = (sx - w/2) / scale + camX
            // => camX = worldX - (sx - w/2) / scale
            this._cameraX = worldBefore.x - (mx - w / 2) / this._pxPerFoot;

            // worldZ = camZ - (sy - h/2) / scale
            // => camZ = worldZ + (sy - h/2) / scale
            this._cameraZ = worldBefore.z + (my - h / 2) / this._pxPerFoot;

            this._manualControl = true;
            this._rerender();
        }, { passive: false });

        // Middle mouse interaction (Pan & Double-click reset)
        let lastMiddleClickTime = 0;

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // Middle mouse
                e.preventDefault();
                const now = Date.now();
                if (now - lastMiddleClickTime < 300) {
                    // DOUBLE CLICK DETECTED -> RESET
                    this._manualControl = false;
                    this._isFirstRender = true; // Force re-calculation
                    this._rerender();
                    lastMiddleClickTime = 0; // Prevent triple-click triggering
                    return;
                }
                lastMiddleClickTime = now;

                // Start Pan
                this._isPanning = true;
                this._panStartX = e.clientX;
                this._panStartY = e.clientY;
            }
        });

        this.canvas.addEventListener('mouseup', (e) => {
            if (e.button === 1) {
                this._isPanning = false;
                this._updateInteractionCursor(this._lastMx, this._lastMy);
            }
        });

        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || this._isPanning) return;

            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const rowCountHandleTarget = this._findTierRowCountHandleTarget(mx, my);
            if (rowCountHandleTarget) {
                this._dragState = {
                    mode: 'rowCount',
                    pointerId: e.pointerId,
                    tierIndex: rowCountHandleTarget.tierIndex,
                    currentNumRows: rowCountHandleTarget.numRows,
                    activeHandlePoint: rowCountHandleTarget.handlePoint,
                    candidates: rowCountHandleTarget.candidates
                };
                this.hoveredRow = -1;
                this._hoveredTierIndex = rowCountHandleTarget.tierIndex;
                this._hoveredTierHandleIndex = rowCountHandleTarget.tierIndex;
                this.canvas.style.cursor = 'row-resize';
                this.canvas.setPointerCapture?.(e.pointerId);
                e.preventDefault();
                this._rerender();
                return;
            }

            const tierTarget = this._findTierDragTarget(mx, my);
            if (!tierTarget) return;

            this._dragState = {
                mode: 'position',
                pointerId: e.pointerId,
                tierIndex: tierTarget.tierIndex,
                startWorld: toWorld(mx, my),
                startFirstRowDist: tierTarget.firstRowDist,
                startFirstRowElev: tierTarget.firstRowElev,
                lastResolvedPosition: {
                    firstRowDist: tierTarget.firstRowDist,
                    firstRowElev: tierTarget.firstRowElev
                },
                guides: {
                    x: null,
                    z: null
                }
            };
            this.hoveredRow = -1;
            this.canvas.style.cursor = 'grabbing';
            this.canvas.setPointerCapture?.(e.pointerId);
            e.preventDefault();
            this._rerender();
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (!this._dragState || this._dragState.pointerId !== e.pointerId) return;

            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            this._lastMx = mx;
            this._lastMy = my;
            this._updateTierDrag({
                worldPoint: toWorld(mx, my),
                mx,
                my
            });
            e.preventDefault();
        });

        this.canvas.addEventListener('pointerup', (e) => {
            if (!this._dragState || this._dragState.pointerId !== e.pointerId) return;
            this.canvas.releasePointerCapture?.(e.pointerId);
            this._finishTierDrag();
        });

        this.canvas.addEventListener('pointercancel', (e) => {
            if (!this._dragState || this._dragState.pointerId !== e.pointerId) return;
            this.canvas.releasePointerCapture?.(e.pointerId);
            this._finishTierDrag();
        });

        this.canvas.addEventListener('contextmenu', (e) => {
            if (e.button === 1) e.preventDefault();
        });
    }

    _rerender() {
        if (this._lastSolvers !== null && this._lastFocalX !== undefined) {
            this.renderMulti(this._lastSolvers, this._lastFocalX, this._lastFocalZ, this._lastOptions);
        }
    }

    _handleHover(mx, my) {
        if (!this._lastAllRows) return;

        // Re-calculate local transform vars for hit testing
        // We need to match the transform logic in render()
        const w = this.canvas.width;
        const h = this.canvas.height;
        const scale = this._pxPerFoot;
        const camX = this._cameraX;
        const camZ = this._cameraZ;
        const offsetX = w / 2 - camX * scale;
        const offsetY = h / 2 + camZ * scale;

        let closest = -1;
        let closestDist = Infinity;
        const thresholdPx = 20;

        for (let i = 0; i < this._lastAllRows.length; i++) {
            const row = this._lastAllRows[i];
            const heelSx = offsetX + row.x * scale;
            const heelSy = offsetY - row.z * scale;
            const dHeel = Math.hypot(heelSx - mx, heelSy - my);

            const headSx = offsetX + row.eye_x * scale;
            const headSy = offsetY - row.eye_z * scale;
            const dHead = Math.hypot(headSx - mx, headSy - my);

            const dist = Math.min(dHeel, dHead);

            if (dist < closestDist && dist < thresholdPx) {
                closestDist = dist;
                closest = i;
            }
        }

        if (closest !== this.hoveredRow) {
            this.hoveredRow = closest;
            this._rerender(); // Determines colors based on hover
        }
    }

    _toScreenPoint(x, z) {
        return {
            sx: this._offsetX + x * this._pxPerFoot,
            sy: this._offsetY - z * this._pxPerFoot
        };
    }

    _updateInteractionTargets(mx, my) {
        const handleTarget = this._findTierRowCountHandleTarget(mx, my);
        const tierTarget = handleTarget ? null : this._findTierDragTarget(mx, my);
        const nextHoveredTierIndex = handleTarget?.tierIndex ?? tierTarget?.tierIndex ?? null;
        const nextHoveredTierHandleIndex = handleTarget?.tierIndex ?? null;

        if (
            nextHoveredTierIndex === this._hoveredTierIndex &&
            nextHoveredTierHandleIndex === this._hoveredTierHandleIndex
        ) {
            return;
        }

        this._hoveredTierIndex = nextHoveredTierIndex;
        this._hoveredTierHandleIndex = nextHoveredTierHandleIndex;
        this._rerender();
    }

    _updateInteractionCursor(mx, my) {
        if (this._dragState?.mode === 'rowCount') {
            this.canvas.style.cursor = 'row-resize';
            return;
        }

        if (this._dragState || this._isPanning) {
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        const nextCursor = this._findTierRowCountHandleTarget(mx, my)
            ? 'row-resize'
            : (this._findTierDragTarget(mx, my) ? 'grab' : 'default');
        if (this.canvas.style.cursor !== nextCursor) {
            this.canvas.style.cursor = nextCursor;
        }
    }

    _buildTierRenderState(solver, fallbackTierIndex = 0, rowCountControlConfig = null) {
        if (!solver?.rows?.length) return null;

        const tierIndex = getSolverTierIndex(solver, fallbackTierIndex);
        const rows = solver.rows;
        const baseZ = getTierBaseZ(solver, tierIndex);
        const segments = solver.getStepGeometry().map(([start, end]) => ([start, end]));
        const firstRow = rows[0];
        const lastRow = rows[rows.length - 1];
        const riserX = firstRow.x - solver.treadDepthFt;
        const rowCountHandlePoint = {
            x: lastRow.x,
            z: lastRow.z,
            numRows: rows.length
        };

        segments.unshift([
            { x: riserX, z: baseZ },
            { x: riserX, z: firstRow.z }
        ]);

        return {
            tierIndex,
            solver,
            firstRowDist: firstRow.x - solver.treadDepthFt,
            firstRowElev: firstRow.z,
            bounds: {
                minX: riserX,
                maxX: lastRow.x,
                minZ: Math.min(baseZ, firstRow.z),
                maxZ: Math.max(...rows.map((row) => row.z))
            },
            segments,
            rowCountControlConfig,
            rowCountCandidates: buildTierRowCountHandleCandidates(solver, rowCountControlConfig),
            rowCountHandlePoint,
            referencePoints: rows.flatMap((row) => ([
                {
                    tierIndex,
                    rowNumber: row.row_number,
                    edge: 'front',
                    x: row.x - solver.treadDepthFt,
                    z: row.z
                },
                {
                    tierIndex,
                    rowNumber: row.row_number,
                    edge: 'back',
                    x: row.x,
                    z: row.z
                }
            ]))
        };
    }

    _findTierRowCountHandleTarget(mx, my) {
        if (!this._lastTierRenderState.length) return null;

        let closestTarget = null;
        let closestDistance = Infinity;

        for (let index = this._lastTierRenderState.length - 1; index >= 0; index -= 1) {
            const tier = this._lastTierRenderState[index];
            if (!Array.isArray(tier?.rowCountCandidates) || tier.rowCountCandidates.length === 0) continue;

            const handlePoint = tier.rowCountHandlePoint;
            if (!handlePoint) continue;

            const screenPoint = this._toScreenPoint(handlePoint.x, handlePoint.z);
            const distance = Math.hypot(screenPoint.sx - mx, screenPoint.sy - my);
            if (distance > TIER_ROW_COUNT_HANDLE_PICK_DISTANCE_PX || distance >= closestDistance) continue;

            closestDistance = distance;
            closestTarget = {
                tierIndex: tier.tierIndex,
                numRows: handlePoint.numRows,
                handlePoint,
                candidates: tier.rowCountCandidates
            };
        }

        return closestTarget;
    }

    _resolveNearestRowCountCandidate(candidates, mx, my) {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;

        let closestCandidate = null;
        let closestDistance = Infinity;

        for (const candidate of candidates) {
            const screenPoint = this._toScreenPoint(candidate.x, candidate.z);
            const distance = Math.hypot(screenPoint.sx - mx, screenPoint.sy - my);
            if (distance >= closestDistance) continue;
            closestDistance = distance;
            closestCandidate = candidate;
        }

        return closestCandidate;
    }

    _findTierDragTarget(mx, my) {
        if (!this._lastTierRenderState.length) return null;

        let closestTier = null;
        let closestDistance = Infinity;
        let boundsMatch = null;

        for (let index = this._lastTierRenderState.length - 1; index >= 0; index -= 1) {
            const tier = this._lastTierRenderState[index];
            const withinBounds = this._isPointInsideTierBounds(tier, mx, my);
            if (!boundsMatch && withinBounds) {
                boundsMatch = tier;
            }

            for (const [start, end] of tier.segments) {
                const startScreen = this._toScreenPoint(start.x, start.z);
                const endScreen = this._toScreenPoint(end.x, end.z);
                const distance = getDistanceToSegmentPx(
                    mx,
                    my,
                    startScreen.sx,
                    startScreen.sy,
                    endScreen.sx,
                    endScreen.sy
                );
                if (distance <= TIER_DRAG_PICK_DISTANCE_PX && distance < closestDistance) {
                    closestDistance = distance;
                    closestTier = tier;
                }
            }
        }

        const target = closestTier || boundsMatch;
        if (!target) return null;

        return {
            tierIndex: target.tierIndex,
            firstRowDist: target.firstRowDist,
            firstRowElev: target.firstRowElev
        };
    }

    _isPointInsideTierBounds(tier, mx, my) {
        if (!tier?.bounds) return false;

        const topLeft = this._toScreenPoint(tier.bounds.minX, tier.bounds.maxZ);
        const bottomRight = this._toScreenPoint(tier.bounds.maxX, tier.bounds.minZ);
        const minX = Math.min(topLeft.sx, bottomRight.sx) - TIER_DRAG_PICK_PADDING_PX;
        const maxX = Math.max(topLeft.sx, bottomRight.sx) + TIER_DRAG_PICK_PADDING_PX;
        const minY = Math.min(topLeft.sy, bottomRight.sy) - TIER_DRAG_PICK_PADDING_PX;
        const maxY = Math.max(topLeft.sy, bottomRight.sy) + TIER_DRAG_PICK_PADDING_PX;
        return mx >= minX && mx <= maxX && my >= minY && my <= maxY;
    }

    _resolveDragTargetPosition(tierIndex, firstRowDist, firstRowElev) {
        const activeTier = this._lastTierRenderState.find((tier) => tier.tierIndex === tierIndex);
        if (!activeTier) {
            return {
                firstRowDist,
                firstRowElev,
                guides: { x: null, z: null }
            };
        }

        const referencePoints = this._lastTierRenderState
            .filter((tier) => tier.tierIndex < tierIndex)
            .flatMap((tier) => tier.referencePoints);
        if (!referencePoints.length) {
            return {
                firstRowDist,
                firstRowElev,
                guides: { x: null, z: null }
            };
        }

        const xSnap = this._findAxisSnap({
            axis: 'x',
            activePoints: activeTier.referencePoints,
            referencePoints,
            currentValue: activeTier.firstRowDist,
            targetValue: firstRowDist
        });
        const zSnap = this._findAxisSnap({
            axis: 'z',
            activePoints: activeTier.referencePoints,
            referencePoints,
            currentValue: activeTier.firstRowElev,
            targetValue: firstRowElev
        });

        const resolvedPosition = {
            firstRowDist: xSnap?.adjustedValue ?? firstRowDist,
            firstRowElev: zSnap?.adjustedValue ?? firstRowElev
        };
        const xShift = resolvedPosition.firstRowDist - activeTier.firstRowDist;
        const zShift = resolvedPosition.firstRowElev - activeTier.firstRowElev;

        return {
            ...resolvedPosition,
            guides: {
                x: xSnap
                    ? {
                        lineValue: xSnap.referencePoint.x,
                        activePoint: {
                            x: xSnap.activePoint.x + xShift,
                            z: xSnap.activePoint.z + zShift
                        },
                        referencePoint: xSnap.referencePoint
                    }
                    : null,
                z: zSnap
                    ? {
                        lineValue: zSnap.referencePoint.z,
                        activePoint: {
                            x: zSnap.activePoint.x + xShift,
                            z: zSnap.activePoint.z + zShift
                        },
                        referencePoint: zSnap.referencePoint
                    }
                    : null
            }
        };
    }

    _findAxisSnap({ axis, activePoints, referencePoints, currentValue, targetValue }) {
        const activeOffset = targetValue - currentValue;
        let bestMatch = null;

        for (const activePoint of activePoints || []) {
            const shiftedValue = activePoint[axis] + activeOffset;

            for (const referencePoint of referencePoints || []) {
                const delta = referencePoint[axis] - shiftedValue;
                const distancePx = Math.abs(delta) * this._pxPerFoot;
                if (distancePx > TIER_DRAG_SNAP_TOLERANCE_PX) continue;
                if (bestMatch && distancePx >= bestMatch.distancePx) continue;

                bestMatch = {
                    adjustedValue: targetValue + delta,
                    activePoint,
                    referencePoint,
                    distancePx
                };
            }
        }

        return bestMatch;
    }

    _updateTierDrag({ worldPoint, mx, my }) {
        if (!this._dragState) return;

        if (this._dragState.mode === 'rowCount') {
            const nextCandidate = this._resolveNearestRowCountCandidate(this._dragState.candidates, mx, my);
            if (!nextCandidate) return;

            this._dragState.activeHandlePoint = {
                x: nextCandidate.x,
                z: nextCandidate.z,
                numRows: nextCandidate.numRows
            };

            if (this._dragState.currentNumRows !== nextCandidate.numRows) {
                this._dragState.currentNumRows = nextCandidate.numRows;
                this._onTierRowCountChanged({
                    tierIndex: this._dragState.tierIndex,
                    numRows: nextCandidate.numRows
                });
            }
            this._rerender();
            return;
        }

        const nextFirstRowDist = this._dragState.startFirstRowDist + (worldPoint.x - this._dragState.startWorld.x);
        const nextFirstRowElev = this._dragState.startFirstRowElev + (worldPoint.z - this._dragState.startWorld.z);
        const resolvedPosition = this._resolveDragTargetPosition(
            this._dragState.tierIndex,
            nextFirstRowDist,
            nextFirstRowElev
        );

        this._dragState.lastResolvedPosition = {
            firstRowDist: resolvedPosition.firstRowDist,
            firstRowElev: resolvedPosition.firstRowElev
        };
        this._dragState.guides = resolvedPosition.guides;
        this._onTierPositionChanged({
            tierIndex: this._dragState.tierIndex,
            firstRowDist: resolvedPosition.firstRowDist,
            firstRowElev: resolvedPosition.firstRowElev
        });
        this._rerender();
    }

    _finishTierDrag() {
        if (!this._dragState) return;

        if (this._dragState.mode === 'rowCount') {
            this._dragState = null;
            this._updateInteractionTargets(this._lastMx, this._lastMy);
            this._updateInteractionCursor(this._lastMx, this._lastMy);
            this._rerender();
            return;
        }

        const { tierIndex, lastResolvedPosition } = this._dragState;
        this._dragState = null;
        if (lastResolvedPosition) {
            this._onTierPositionChanged({
                tierIndex,
                ...lastResolvedPosition
            });
        }
        this._updateInteractionCursor(this._lastMx, this._lastMy);
        this._rerender();
    }

    _drawDragGuides(ctx, toScreen, viewBounds) {
        if (this._dragState?.mode !== 'position') return;

        const guides = this._dragState?.guides;
        if (!guides) return;

        ctx.save();
        ctx.strokeStyle = BRAND_PROFILE_COLORS.hoverInk;
        ctx.fillStyle = BRAND_PROFILE_COLORS.hoverInk;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([6, 4]);

        if (guides.x) {
            const top = toScreen(guides.x.lineValue, viewBounds.maxZ);
            const bottom = toScreen(guides.x.lineValue, viewBounds.minZ);
            ctx.beginPath();
            ctx.moveTo(top.sx, top.sy);
            ctx.lineTo(bottom.sx, bottom.sy);
            ctx.stroke();
            this._drawGuidePoint(ctx, toScreen(guides.x.referencePoint.x, guides.x.referencePoint.z));
            this._drawGuidePoint(ctx, toScreen(guides.x.activePoint.x, guides.x.activePoint.z), true);
        }

        if (guides.z) {
            const left = toScreen(viewBounds.minX, guides.z.lineValue);
            const right = toScreen(viewBounds.maxX, guides.z.lineValue);
            ctx.beginPath();
            ctx.moveTo(left.sx, left.sy);
            ctx.lineTo(right.sx, right.sy);
            ctx.stroke();
            this._drawGuidePoint(ctx, toScreen(guides.z.referencePoint.x, guides.z.referencePoint.z));
            this._drawGuidePoint(ctx, toScreen(guides.z.activePoint.x, guides.z.activePoint.z), true);
        }

        ctx.restore();
    }

    _drawGuidePoint(ctx, point, isActivePoint = false) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = isActivePoint ? BRAND_PROFILE_COLORS.hoverInk : BRAND_PROFILE_COLORS.canvasBg;
        ctx.strokeStyle = BRAND_PROFILE_COLORS.hoverInk;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(point.sx, point.sy, TIER_DRAG_GUIDE_POINT_RADIUS_PX, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    _drawTierRowCountHandles(ctx, toScreen) {
        this._lastTierRenderState.forEach((tier) => {
            if (!Array.isArray(tier?.rowCountCandidates) || tier.rowCountCandidates.length === 0) return;

            const isActive = this._dragState?.mode === 'rowCount' && this._dragState.tierIndex === tier.tierIndex;
            const isHovered = this._hoveredTierIndex === tier.tierIndex;
            if (!isActive && !isHovered) return;

            const handlePoint = isActive
                ? this._dragState?.activeHandlePoint
                : tier.rowCountHandlePoint;
            if (!handlePoint) return;

            this._drawTierRowCountHandle(
                ctx,
                toScreen(handlePoint.x, handlePoint.z),
                tier.tierIndex,
                {
                    isActive,
                    isHandleHovered: this._hoveredTierHandleIndex === tier.tierIndex
                }
            );
        });
    }

    _drawTierRowCountHandle(ctx, point, tierIndex, {
        isActive = false,
        isHandleHovered = false
    } = {}) {
        const colors = this._getTierColors(tierIndex);
        const radius = isActive ? TIER_ROW_COUNT_HANDLE_RADIUS_PX + 1 : TIER_ROW_COUNT_HANDLE_RADIUS_PX;

        ctx.save();
        ctx.globalAlpha = isActive || isHandleHovered ? 1 : 0.78;
        ctx.fillStyle = isActive ? colors.stroke : BRAND_PROFILE_COLORS.canvasBg;
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = isActive ? 2.5 : 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(point.sx, point.sy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (isHandleHovered || isActive) {
            ctx.strokeStyle = BRAND_PROFILE_COLORS.hoverInk;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(point.sx, point.sy, radius + 3, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Render the section profile (Single Solver wrapper)
     */
    /**
     * Render the section profile (Single Solver wrapper)
     */
    render(solver, focalX, focalZ, options = {}) {
        this.renderMulti([solver], focalX, focalZ, options);
    }

    /**
     * Render multiple independent solver sections.
     * Uses Camera State (_cameraX, _cameraZ, _pxPerFoot).
     */
    renderMulti(solvers, focalX, focalZ, options = {}) {
        syncProfileThemeColors(this._theme);
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        const showSightlines = options.showSightlines !== false;
        const showHeads = options.showHeads !== false;
        const showCLabels = options.showCLabels !== false;
        const rowLabelFontPx = options.rowLabelFontPx ?? 11;
        const structuralDepth = (options.structuralDepth || 0) / 12.0;
        const structuralProfileMode = options.structuralProfileMode === 'sloped' ? 'sloped' : 'stepped';
        const tierRowCountControls = Array.isArray(options.tierRowCountControls)
            ? options.tierRowCountControls
            : [];

        // Cache for hover and rerender
        this._lastSolvers = solvers;
        this._lastFocalX = focalX;
        this._lastFocalZ = focalZ;
        this._lastOptions = options;

        // Build flat list of all rows across solvers for hover detection
        this._lastAllRows = [];
        this._lastTierRenderState = [];
        solvers.forEach((solver, index) => {
            if (solver?.rows) {
                this._lastAllRows.push(...solver.rows);
            }
            const tierControlIndex = getSolverTierIndex(solver, index);
            const tierState = this._buildTierRenderState(
                solver,
                index,
                tierRowCountControls[tierControlIndex] || null
            );
            if (tierState) {
                this._lastTierRenderState.push(tierState);
            }
        });
        if (
            this._dragState &&
            !this._lastTierRenderState.some((tier) => tier.tierIndex === this._dragState?.tierIndex)
        ) {
            this._dragState = null;
            this.canvas.style.cursor = 'default';
        }
        if (
            this._hoveredTierIndex !== null &&
            !this._lastTierRenderState.some((tier) => tier.tierIndex === this._hoveredTierIndex)
        ) {
            this._hoveredTierIndex = null;
            this._hoveredTierHandleIndex = null;
        }

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = BRAND_PROFILE_COLORS.canvasBg;
        ctx.fillRect(0, 0, w, h);

        // --- Auto-Fit Logic (One-Time Execution using _isFirstRender) ---
        // Bounds are ALWAYS calculated to know the extents of geometry
        const bounds = this._calcBoundsMulti(solvers, focalX, focalZ, {
            structuralDepth,
            structuralProfileMode
        });
        this._worldBounds = bounds;

        if (this._isFirstRender) {
            // Apply Auto-Fit logic: Calculate scale to fit bounds, center camera on bounds center.
            const rangeX = bounds.maxX - bounds.minX;
            const rangeZ = bounds.maxZ - bounds.minZ;
            const pad = this.padding * 2;

            const safeRangeX = Math.max(rangeX, 1);
            const safeRangeZ = Math.max(rangeZ, 1);

            const scaleX = (w - pad) / safeRangeX;
            const scaleZ = (h - pad) / safeRangeZ;
            this._pxPerFoot = Math.min(scaleX, scaleZ);

            // Center camera on bounds center
            this._cameraX = (bounds.minX + bounds.maxX) / 2;
            this._cameraZ = (bounds.minZ + bounds.maxZ) / 2;

            // Mark first render as done. Future updates will inherit these camera settings.
            this._isFirstRender = false;
        }

        this._scale = this._pxPerFoot;

        // Transform Function: World -> Screen
        // ScreenX = (WorldX - CamX) * Scale + ScreenCenterW
        // ScreenY = (CamZ - WorldZ) * Scale + ScreenCenterH  (Flip Z for screen Y)
        const scale = this._pxPerFoot;
        const offsetX = w / 2 - this._cameraX * scale;
        const offsetY = h / 2 + this._cameraZ * scale;

        this._offsetX = offsetX;
        this._offsetY = offsetY;

        const toScreen = (x, z) => ({
            sx: offsetX + x * scale,
            sy: offsetY - z * scale
        });

        // Draw grid (using viewport bounds, effectively infinite)
        // We calculate visible world bounds based on camera
        const visibleMinX = this._cameraX - (w / 2) / scale;
        const visibleMaxX = this._cameraX + (w / 2) / scale;
        const visibleMinZ = this._cameraZ - (h / 2) / scale;
        const visibleMaxZ = this._cameraZ + (h / 2) / scale;

        const viewBounds = {
            minX: visibleMinX, maxX: visibleMaxX,
            minZ: visibleMinZ, maxZ: visibleMaxZ
        };

        this._drawGrid(ctx, w, h, scale, viewBounds, offsetX, offsetY);

        // Draw ground line
        ctx.save();
        ctx.strokeStyle = BRAND_PROFILE_COLORS.groundLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        const gLeft = toScreen(bounds.minX - 100, PROFILE_ZERO_LINE_WORLD_Z_OFFSET_FT); // Extend a bit relative to geometry
        const gRight = toScreen(bounds.maxX + 100, PROFILE_ZERO_LINE_WORLD_Z_OFFSET_FT);
        ctx.beginPath();
        ctx.moveTo(gLeft.sx, gLeft.sy);
        ctx.lineTo(gRight.sx, gRight.sy);
        ctx.stroke();
        ctx.restore();

        // Global row index for hover tracking
        let globalRowIdx = 0;

        // Render each solver independently
        for (let tierIdx = 0; tierIdx < solvers.length; tierIdx++) {
            const solver = solvers[tierIdx];
            if (!solver.rows || solver.rows.length === 0) continue;

            const colors = this._getTierColors(getSolverTierIndex(solver, tierIdx));

            // Analyze sightlines for this solver (visuals only)
            // Note: Stats are calculated in App.js using filtered rows. Visuals show ALL rays.
            const analyzer = new SightlineAnalyzer(solver.rows, focalX, focalZ);
            analyzer.analyze();

            // Draw sightlines
            if (showSightlines) {
                for (let i = 0; i < solver.rows.length; i++) {
                    const row = solver.rows[i];
                    const quality = getCValueQuality(row.c_value);
                    const globalI = globalRowIdx + i;

                    ctx.save();
                    ctx.strokeStyle = quality.color;
                    ctx.globalAlpha = (this.hoveredRow >= 0 && this.hoveredRow !== globalI) ? 0.15 : 0.5;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([]);

                    const eyeS = toScreen(row.eye_x, row.eye_z);
                    const focalS = toScreen(focalX, focalZ);
                    ctx.beginPath();
                    ctx.moveTo(eyeS.sx, eyeS.sy);
                    ctx.lineTo(focalS.sx, focalS.sy);
                    ctx.stroke();
                    ctx.restore();
                }
            }

            this._drawProfile(ctx, solver, toScreen, scale, {
                structuralDepth,
                structuralProfileMode,
                tierIdx
            });

            // Draw heads and eye points
            if (showHeads) {
                for (let i = 0; i < solver.rows.length; i++) {
                    const row = solver.rows[i];
                    const globalI = globalRowIdx + i;
                    const isHovered = this.hoveredRow === globalI;

                    const headRadius = 0.375;
                    const headCenter = {
                        x: row.eye_x + headRadius * 0.3,
                        z: row.eye_z
                    };
                    const headPoints = generateHeadCirclePoints(headCenter.x, headCenter.z, headRadius, 16);

                    // Head
                    ctx.save();
                    ctx.strokeStyle = isHovered ? BRAND_PROFILE_COLORS.hoverInk : colors.head;
                    ctx.lineWidth = isHovered ? 2 : 1;
                    ctx.globalAlpha = (this.hoveredRow >= 0 && !isHovered) ? 0.25 : 0.8;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    for (let j = 0; j < headPoints.length; j++) {
                        const s = toScreen(headPoints[j].x, headPoints[j].z);
                        if (j === 0) ctx.moveTo(s.sx, s.sy);
                        else ctx.lineTo(s.sx, s.sy);
                    }
                    ctx.stroke();

                    // Eye
                    const eyeS = toScreen(row.eye_x, row.eye_z);
                    const markerSize = 3;
                    ctx.strokeStyle = isHovered ? BRAND_PROFILE_COLORS.hoverInk : colors.eye;
                    ctx.lineWidth = isHovered ? 2 : 1;
                    ctx.beginPath();
                    ctx.moveTo(eyeS.sx - markerSize, eyeS.sy);
                    ctx.lineTo(eyeS.sx + markerSize, eyeS.sy);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(eyeS.sx, eyeS.sy - markerSize);
                    ctx.lineTo(eyeS.sx, eyeS.sy + markerSize);
                    ctx.stroke();
                    ctx.restore();
                }
            }

            // Draw C-value labels
            if (showCLabels) {
                ctx.save();
                ctx.font = `bold ${rowLabelFontPx}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'center';
                // Keep row labels anchored to the original tread line even when structural depth is displayed.
                const labelOffsetPx = 12;
                const cValueOffsetPx = 23;

                for (let i = 0; i < solver.rows.length; i++) {
                    const row = solver.rows[i];
                    const quality = getCValueQuality(row.c_value);
                    const globalI = globalRowIdx + i;
                    const isHovered = this.hoveredRow === globalI;

                    if (this.hoveredRow >= 0 && !isHovered) continue;

                    const treadMid = toScreen(row.x - solver.treadDepthFt / 2, row.z);
                    ctx.fillStyle = quality.color;
                    ctx.globalAlpha = isHovered ? 1 : 0.7;
                    ctx.fillText(`R${row.row_number}`, treadMid.sx, treadMid.sy + labelOffsetPx);
                    if (row.row_number > 1) {
                        ctx.fillText(`${row.c_value.toFixed(1)}"`, treadMid.sx, treadMid.sy + cValueOffsetPx);
                    }
                }
                ctx.restore();
            }

            globalRowIdx += solver.rows.length;
        }

        // Draw focal point marker
        this._drawFocalPoint(ctx, focalX, focalZ, toScreen, scale);
        this._drawTierRowCountHandles(ctx, toScreen);

        if (this._dragState) {
            this._drawDragGuides(ctx, toScreen, viewBounds);
        }

        // Hover tooltip
        if (!this._dragState && this.hoveredRow >= 0 && this.hoveredRow < this._lastAllRows.length) {
            this._drawTooltip(ctx, this._lastAllRows[this.hoveredRow], w, h, this._lastMx, this._lastMy);
        }

        // Axis labels and legend
        // Use viewBounds for labels to ensure they span screen
        this._drawAxisLabels(ctx, w, h, scale, viewBounds, offsetX, offsetY);
        // this._drawLegend(ctx, w, h); // User removed legend from canvas in favor of HTML legend
    }

    _calcBounds(solver, focalX, focalZ, options = {}) {
        return this._calcBoundsMulti([solver], focalX, focalZ, options);
    }

    _calcBoundsMulti(solvers, focalX, focalZ, {
        structuralDepth = 0,
        structuralProfileMode = 'stepped'
    } = {}) {
        let minX = focalX;
        let maxX = focalX;
        let minZ = focalZ;
        let maxZ = focalZ;

        for (let tierIdx = 0; tierIdx < solvers.length; tierIdx += 1) {
            const solver = solvers[tierIdx];
            for (const row of solver.rows) {
                minX = Math.min(minX, row.x - solver.treadDepthFt);
                maxX = Math.max(maxX, row.x);
                minZ = Math.min(minZ, row.z - row.riser_height, 0);
                maxZ = Math.max(maxZ, row.eye_z + 1);
            }

            if (structuralDepth > 0) {
                const structuralGeometry = buildStructuralProfileGeometry(solver, {
                    structuralDepthFt: structuralDepth,
                    structuralProfileMode,
                    tierIndex: tierIdx
                });
                if (structuralGeometry?.bounds) {
                    minX = Math.min(minX, structuralGeometry.bounds.minX);
                    maxX = Math.max(maxX, structuralGeometry.bounds.maxX);
                    minZ = Math.min(minZ, structuralGeometry.bounds.minZ);
                    maxZ = Math.max(maxZ, structuralGeometry.bounds.maxZ);
                }
            }
        }

        const padX = (maxX - minX) * 0.08;
        const padZ = (maxZ - minZ) * 0.12;
        return {
            minX: minX - padX,
            maxX: maxX + padX,
            minZ: minZ - padZ,
            maxZ: maxZ + padZ
        };
    }

    _calcScale(bounds, w, h) {
        const pad = this.padding * 2;
        const rangeX = bounds.maxX - bounds.minX;
        const rangeZ = bounds.maxZ - bounds.minZ;
        return Math.min((w - pad) / rangeX, (h - pad) / rangeZ);
    }

    _drawGrid(ctx, w, h, scale, bounds, offsetX, offsetY) {
        ctx.save();

        const gridFt = this._getGridSpacingFt(scale, 70, 0.5);

        ctx.strokeStyle = BRAND_PROFILE_COLORS.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);

        // Vertical grid lines
        const startX = Math.floor(bounds.minX / gridFt) * gridFt;
        for (let x = startX; x <= bounds.maxX; x += gridFt) {
            const px = offsetX + x * scale;
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, h);
            ctx.stroke();
        }

        // Horizontal grid lines
        const startZ = Math.floor(bounds.minZ / gridFt) * gridFt;
        for (let z = startZ; z <= bounds.maxZ; z += gridFt) {
            const py = offsetY - z * scale;
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(w, py);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Get color scheme for a tier index.
     * Tier colors follow JLG brand accents:
     * Tier 1 = Green, Tier 2 = Teal, Tier 3 = Orange
     */
    _getTierColors(tierIdx) {
        return BRAND_PROFILE_COLORS.tier[tierIdx] || BRAND_PROFILE_COLORS.tier[0];
    }

    _drawProfile(ctx, solver, toScreen, scale, {
        structuralDepth = 0,
        structuralProfileMode = 'stepped',
        tierIdx = 0
    } = {}) {
        const segments = solver.getStepGeometry();
        const colors = this._getTierColors(getSolverTierIndex(solver, tierIdx));
        let structuralGeometry = null;

        // Draw structural depth fill first (behind the outline)
        // Structural depth creates a proper offset stepped profile:
        //   - Each TREAD (horizontal) is offset DOWN by depth
        //   - Each RISER (vertical) is offset RIGHT by depth
        // This forms a closed structural cross-section loop.
        if (structuralDepth > 0 && segments.length > 0) {
            structuralGeometry = buildStructuralProfileGeometry(solver, {
                structuralDepthFt: structuralDepth,
                structuralProfileMode,
                tierIndex: tierIdx
            });
            ctx.save();
            ctx.fillStyle = colors.fill;
            ctx.strokeStyle = colors.fillStroke;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);

            const firstRow = solver.rows[0];
            const tIdx = getSolverTierIndex(solver, tierIdx);
            const startX = structuralGeometry?.topProfile?.[0]?.x ?? (firstRow.x - solver.treadDepthFt);
            const baseZ = structuralGeometry?.topProfile?.[0]?.z
                ?? (tIdx === 0 ? 0 : (firstRow.z - firstRow.riser_height));
            const topProfile = [{ x: startX, z: baseZ }];
            topProfile.push({ x: startX, z: firstRow.z }); // Top of first riser → start of first tread

            // Add each segment from getStepGeometry
            for (const [start, end] of segments) {
                topProfile.push({ x: start.x, z: start.z });
                topProfile.push({ x: end.x, z: end.z });
            }

            // === Build the BOTTOM profile (offset stepped) ===
            // For each row: bottom tread runs at z-d, riser at x+d
            // The bottom profile stays within the original profile bounds:
            //   - Starts at same Z as original base (just shifted right)
            //   - Ends at same X as original last tread (just shifted down)
            const bottomProfile = [...(structuralGeometry?.undersideProfile ?? [])];
            const frontBottomPoint = { x: startX, z: bottomProfile[0]?.z ?? baseZ };
            const fillBottomProfile = [frontBottomPoint, ...bottomProfile];
            const rearBottomZ = bottomProfile.length > 0
                ? bottomProfile[bottomProfile.length - 1].z
                : (topProfile[topProfile.length - 1]?.z ?? baseZ);

            // === Draw the closed polygon ===
            ctx.beginPath();

            // Draw TOP profile forward
            let s = toScreen(topProfile[0].x, topProfile[0].z);
            ctx.moveTo(s.sx, s.sy);
            for (let i = 1; i < topProfile.length; i++) {
                s = toScreen(topProfile[i].x, topProfile[i].z);
                ctx.lineTo(s.sx, s.sy);
            }

            // Connect top end → bottom end (straight down, no rightward extension)
            const topEnd = topProfile[topProfile.length - 1];
            s = toScreen(topEnd.x, rearBottomZ);
            ctx.lineTo(s.sx, s.sy);

            // Draw BOTTOM profile in reverse
            for (let i = fillBottomProfile.length - 1; i >= 0; i--) {
                s = toScreen(fillBottomProfile[i].x, fillBottomProfile[i].z);
                ctx.lineTo(s.sx, s.sy);
            }

            // closePath connects bottom start (startX+d, baseZ) back to
            // top start (startX, baseZ) — a clean horizontal line

            ctx.closePath();
            ctx.fill();

            // Draw the outline of the structural section
            ctx.strokeStyle = colors.stroke;
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();

            // Draw the bottom offset profile as a distinct dashed line
            ctx.save();
            ctx.strokeStyle = colors.stroke;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([6, 4]);
            ctx.globalAlpha = 0.6;
            ctx.beginPath();

            // Bottom profile from start to end
            s = toScreen(frontBottomPoint.x, frontBottomPoint.z);
            ctx.moveTo(s.sx, s.sy);
            for (const pt of bottomProfile) {
                s = toScreen(pt.x, pt.z);
                ctx.lineTo(s.sx, s.sy);
            }
            // Connect to last top point (straight up at same X)
            s = toScreen(topEnd.x, topEnd.z);
            ctx.lineTo(s.sx, s.sy);
            ctx.stroke();

            // Draw connecting line at start (horizontal from top start to bottom start)
            ctx.beginPath();
            s = toScreen(startX, frontBottomPoint.z);
            ctx.moveTo(s.sx, s.sy);
            s = toScreen(bottomProfile[0]?.x ?? startX, bottomProfile[0]?.z ?? frontBottomPoint.z);
            ctx.lineTo(s.sx, s.sy);
            ctx.stroke();

            ctx.restore();
        }

        // Draw step outline
        ctx.save();
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw as a connected path
        ctx.beginPath();
        let first = true;

        for (const [start, end] of segments) {
            const s = toScreen(start.x, start.z);
            const e = toScreen(end.x, end.z);

            if (first) {
                ctx.moveTo(s.sx, s.sy);
                first = false;
            }
            ctx.lineTo(s.sx, s.sy);
            ctx.lineTo(e.sx, e.sy);
        }
        ctx.stroke();

        // Draw first vertical riser
        if (solver.rows.length > 0) {
            const firstRow = solver.rows[0];
            const riserTopX = firstRow.x - solver.treadDepthFt;
            const treadPt = toScreen(riserTopX, firstRow.z);

            let bottomZ;
            const tIdx = getSolverTierIndex(solver, tierIdx);
            if (tIdx === 0) {
                // Tier 1: Draw ALL the way to ground (z=0) to show base wall
                bottomZ = 0;
            } else if (structuralDepth > 0) {
                bottomZ = structuralGeometry?.topProfile?.[0]?.z
                    ?? Math.max(0, firstRow.z - structuralDepth);
            } else {
                // Upper tiers: Draw only standard riser height
                bottomZ = firstRow.z - firstRow.riser_height;
            }

            const bottomPt = toScreen(riserTopX, bottomZ);

            ctx.beginPath();
            ctx.moveTo(bottomPt.sx, bottomPt.sy);
            ctx.lineTo(treadPt.sx, treadPt.sy);
            ctx.stroke();
        }

        ctx.restore();
    }

    _drawFocalPoint(ctx, fx, fz, toScreen, scale) {
        const s = toScreen(fx, fz);
        const size = 8;

        ctx.save();
        ctx.strokeStyle = BRAND_PROFILE_COLORS.focal;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(s.sx - size, s.sy);
        ctx.lineTo(s.sx + size, s.sy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy - size);
        ctx.lineTo(s.sx, s.sy + size);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.sx, s.sy, size * 0.6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = BRAND_PROFILE_COLORS.focal;
        ctx.textAlign = 'center';
        ctx.fillText('Focal Point', s.sx, s.sy + size + 14);

        ctx.restore();
    }

    _drawAxisLabels(ctx, w, h, scale, bounds, offsetX, offsetY) {
        ctx.save();
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillStyle = BRAND_PROFILE_COLORS.gridLabel;

        const gridFt = this._getGridSpacingFt(scale, 35);

        // X axis labels
        ctx.textAlign = 'center';
        const startX = Math.floor(bounds.minX / gridFt) * gridFt;
        const xAxisLabelY = Math.max(16, h - PROFILE_X_AXIS_LABEL_Y_OFFSET_PX);
        for (let x = startX; x <= bounds.maxX; x += gridFt) {
            if (x < 0) continue;
            const px = offsetX + x * scale;
            ctx.fillText(`${x}'`, px, xAxisLabelY);
        }

        // Z axis labels
        ctx.textAlign = 'right';
        const startZ = Math.floor(bounds.minZ / gridFt) * gridFt;
        for (let z = startZ; z <= bounds.maxZ; z += gridFt) {
            if (z < 0) continue;
            const py = offsetY - z * scale;
            ctx.fillText(`${z}'`, this.padding - 8, py + 3);
        }

        ctx.restore();
    }

    _getGridSpacingFt(scale, targetPx, thresholdRatio = 1) {
        const candidates = [1, 2, 5, 10, 20, 50, 100, 200];
        let gridFt = 10;
        for (const c of candidates) {
            if (c * scale >= targetPx * thresholdRatio) {
                gridFt = c;
                break;
            }
        }
        return gridFt;
    }

    _drawTooltip(ctx, row, w, h, mx, my) {
        const quality = getCValueQuality(row.c_value);

        const lines = [
            `Row ${row.row_number}`,
            `C-Value: ${row.c_value.toFixed(2)}" (${quality.quality})`,
            `Riser: ${(row.riser_height * 12).toFixed(1)}"`,
            `Tread: ${(row.tread_depth * 12).toFixed(1)}"`,
            `Elevation: ${row.z.toFixed(2)}'`,
            `Distance: ${row.x.toFixed(2)}'`,
            `Sightline Angle: ${row.sightline_angle.toFixed(1)}°`
        ];

        const lineHeight = 18;
        const pad = 12;
        const boxWidth = 220;
        const boxHeight = lines.length * lineHeight + pad * 2;

        const boxX = w - boxWidth - 15;
        const boxY = 15;

        ctx.save();

        // Background
        ctx.fillStyle = BRAND_PROFILE_COLORS.tooltipBg;
        ctx.strokeStyle = quality.color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0,0,0,0.12)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        this._roundedRectPath(ctx, boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.stroke();

        // Text
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';

        lines.forEach((line, i) => {
            ctx.fillStyle = i === 0 ? BRAND_PROFILE_COLORS.tooltipTitle : BRAND_PROFILE_COLORS.tooltipText;
            if (i === 0) ctx.font = 'bold 13px Inter, system-ui, sans-serif';
            else ctx.font = '12px Inter, system-ui, sans-serif';
            ctx.fillText(line, boxX + pad, boxY + pad + (i + 1) * lineHeight - 4);
        });

        ctx.restore();
    }

    _roundedRectPath(ctx, x, y, w, h, r) {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
    }

    _drawLegend(ctx, w, h) {
        ctx.save();
        ctx.font = '11px Inter, system-ui, sans-serif';

        const items = [
            { color: '#7aae1a', label: 'Excellent (≥4.75")' },
            { color: '#37996e', label: 'Good (3.5-4.75")' },
            { color: '#de850a', label: 'Acceptable (2.4-3.5")' },
            { color: '#d1433d', label: 'Poor (<2.4")' }
        ];

        const startX = this.padding;
        const startY = 16;

        items.forEach((item, i) => {
            const x = startX + i * 155;

            // Color dot
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.arc(x + 5, startY, 4, 0, Math.PI * 2);
            ctx.fill();

            // Label
            ctx.fillStyle = BRAND_PROFILE_COLORS.tooltipText;
            ctx.textAlign = 'left';
            ctx.fillText(item.label, x + 14, startY + 4);
        });

        ctx.restore();
    }
}
