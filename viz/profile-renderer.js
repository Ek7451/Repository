/**
 * Section Profile View Renderer (2D Canvas)
 * Renders the stepped seating profile, sightlines, head circles, and focal point.
 */

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

const PROFILE_X_AXIS_LABEL_Y_OFFSET_PX = 72; // keep bottom scale clear of profile overlay toggle

export class ProfileRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.padding = 60;
        this.hoveredRow = -1;
        this._theme = normalizeThemeName(options?.theme);

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
        this._lastMx = 0;
        this._lastMy = 0;

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

            if (this._lastSolvers) {
                this._handleHover(mx, my);
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredRow = -1;
            this._isPanning = false;
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
            if (e.button === 1) this._isPanning = false;
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

        // Cache for hover and rerender
        this._lastSolvers = solvers;
        this._lastFocalX = focalX;
        this._lastFocalZ = focalZ;
        this._lastOptions = options;

        // Build flat list of all rows across solvers for hover detection
        this._lastAllRows = [];
        for (const s of solvers) {
            if (s.rows) this._lastAllRows.push(...s.rows);
        }

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = BRAND_PROFILE_COLORS.canvasBg;
        ctx.fillRect(0, 0, w, h);

        // --- Auto-Fit Logic (One-Time Execution using _isFirstRender) ---
        // Bounds are ALWAYS calculated to know the extents of geometry
        const bounds = this._calcBoundsMulti(solvers, focalX, focalZ, structuralDepth);
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
        const gLeft = toScreen(bounds.minX - 100, 0); // Extend a bit relative to geometry
        const gRight = toScreen(bounds.maxX + 100, 0);
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

            const colors = this._getTierColors(solver.tierIndex !== undefined ? solver.tierIndex : tierIdx);

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

            // Draw stepped profile
            this._drawProfile(ctx, solver, toScreen, scale, structuralDepth, tierIdx);

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

        // Hover tooltip
        if (this.hoveredRow >= 0 && this.hoveredRow < this._lastAllRows.length) {
            this._drawTooltip(ctx, this._lastAllRows[this.hoveredRow], w, h, this._lastMx, this._lastMy);
        }

        // Axis labels and legend
        // Use viewBounds for labels to ensure they span screen
        this._drawAxisLabels(ctx, w, h, scale, viewBounds, offsetX, offsetY);
        // this._drawLegend(ctx, w, h); // User removed legend from canvas in favor of HTML legend
    }

    _calcBounds(solver, focalX, focalZ, structuralDepth = 0) {
        return this._calcBoundsMulti([solver], focalX, focalZ, structuralDepth);
    }

    _calcBoundsMulti(solvers, focalX, focalZ, structuralDepth = 0) {
        let minX = focalX;
        let maxX = focalX;
        let minZ = focalZ;
        let maxZ = focalZ;
        const depthPad = Math.max(0, structuralDepth || 0);

        for (const solver of solvers) {
            for (const row of solver.rows) {
                minX = Math.min(minX, row.x - solver.treadDepthFt);
                maxX = Math.max(maxX, row.x);
                minZ = Math.min(minZ, -depthPad);
                maxZ = Math.max(maxZ, row.eye_z + 1);
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

        // Determine grid spacing
        const targetPx = 70;
        const candidates = [1, 2, 5, 10, 20, 50, 100, 200];
        let gridFt = 10;
        for (const c of candidates) {
            if (c * scale >= targetPx * 0.5) {
                gridFt = c;
                break;
            }
        }

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

    _drawProfile(ctx, solver, toScreen, scale, structuralDepth = 0, tierIdx = 0) {
        const segments = solver.getStepGeometry();
        const colors = this._getTierColors(solver.tierIndex !== undefined ? solver.tierIndex : tierIdx);

        // Draw structural depth fill first (behind the outline)
        // Structural depth creates a proper offset stepped profile:
        //   - Each TREAD (horizontal) is offset DOWN by depth
        //   - Each RISER (vertical) is offset RIGHT by depth
        // This forms a closed structural cross-section loop.
        if (structuralDepth > 0 && segments.length > 0) {
            const d = structuralDepth;
            ctx.save();
            ctx.fillStyle = colors.fill;
            ctx.strokeStyle = colors.fillStroke;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);

            // === Build the TOP profile (original step geometry) ===
            const topProfile = [];
            const firstRow = solver.rows[0];
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : tierIdx;

            // Start from the base of the first riser
            let baseZ;
            if (tIdx === 0) {
                baseZ = 0; // Tier 1 starts from ground
            } else {
                baseZ = firstRow.z - firstRow.riser_height;
            }
            const startX = firstRow.x - solver.treadDepthFt;
            topProfile.push({ x: startX, z: baseZ }); // Base of first riser
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
            const bottomProfile = [];
            const isLastRow = (i) => i === solver.rows.length - 1;

            // Start: offset the base point RIGHT only (same Z as original base)
            bottomProfile.push({ x: startX + d, z: baseZ });

            for (let i = 0; i < solver.rows.length; i++) {
                const row = solver.rows[i];
                const treadStartX = row.x - solver.treadDepthFt;
                const treadEndX = row.x;

                // Bottom tread for this row: at z-d
                // Internal risers offset right by +d, but last tread ends at original X
                bottomProfile.push({ x: treadStartX + d, z: row.z - d });
                if (i < solver.rows.length - 1) {
                    // Not the last row: extend tread end to x+d (riser will be at x+d)
                    bottomProfile.push({ x: treadEndX + d, z: row.z - d });
                    // Bottom riser to next row
                    const nextRow = solver.rows[i + 1];
                    bottomProfile.push({ x: treadEndX + d, z: nextRow.z - d });
                } else {
                    // Last row: tread ends at original X (no extension)
                    bottomProfile.push({ x: treadEndX, z: row.z - d });
                }
            }

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
            // Go straight down to offset Z at same X
            s = toScreen(topEnd.x, topEnd.z - d);
            ctx.lineTo(s.sx, s.sy);

            // Draw BOTTOM profile in reverse
            for (let i = bottomProfile.length - 1; i >= 0; i--) {
                s = toScreen(bottomProfile[i].x, bottomProfile[i].z);
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
            s = toScreen(startX + d, baseZ);
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
            s = toScreen(startX, baseZ);
            ctx.moveTo(s.sx, s.sy);
            s = toScreen(startX + d, baseZ);
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
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : tierIdx;
            if (tIdx === 0) {
                // Tier 1: Draw ALL the way to ground (z=0) to show base wall
                bottomZ = 0;
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

        const candidates = [1, 2, 5, 10, 20, 50, 100, 200];
        let gridFt = 10;
        for (const c of candidates) {
            if (c * scale >= 35) {
                gridFt = c;
                break;
            }
        }

        // X axis labels
        ctx.textAlign = 'center';
        const startX = Math.floor(bounds.minX / gridFt) * gridFt;
        const xAxisLabelY = Math.max(16, h - PROFILE_X_AXIS_LABEL_Y_OFFSET_PX);
        for (let x = startX; x <= bounds.maxX; x += gridFt) {
            const px = offsetX + x * scale;
            ctx.fillText(`${x}'`, px, xAxisLabelY);
        }

        // Z axis labels
        ctx.textAlign = 'right';
        const startZ = Math.floor(bounds.minZ / gridFt) * gridFt;
        for (let z = startZ; z <= bounds.maxZ; z += gridFt) {
            const py = offsetY - z * scale;
            ctx.fillText(`${z}'`, this.padding - 8, py + 3);
        }

        ctx.restore();
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
