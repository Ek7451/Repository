/**
 * 3D Scene Renderer (Three.js)
 * Creates extruded seating bowl geometry + field surface.
 */

import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import {
    buildGeometryPaths,
    sampleAisleBand,
    buildTierAisleReferenceMap,
    resolveTierAisleStationRatios,
    samplePathPointByRatio,
    getTierRenderedAisleWidthFt
} from '../core/aisle-layout.js';
import { buildStructuralProfileGeometry } from '../core/profile-solver.js';
import { intervalLengthToSeatCount } from '../core/seat-math.js';
import { resolvePlanFocalYFt } from '../core/sports-templates.js';

const SCENE_THEME_COLORS = {
    light: {
        sceneBg: 0xffffff,
        gridMajor: 0xd6d6d2,
        gridMinor: 0xeeeeea,
        field: 0x7aae1a,       // JLG Green (website tone)
        fieldRunoff: 0xde850a, // JLG Orange
        focal: 0xde850a,       // Use brand orange for focal marker
        tier: [0x505550, 0x888f87, 0xb7beb6], // Tier 1 dark, Tier 2 medium, Tier 3 light gray
        tierSeat: [0x6b706b, 0x9fa69e, 0xcfd5cd],
        tierAisle: [0xf7f7f6, 0xfbfbfa, 0xffffff],
        ambientIntensity: 0.5,
        dirIntensity: 1.3,
        hemiSky: 0xffffff,
        hemiGround: 0xe8e6de,
        hemiIntensity: 0.5,
        shadowOpacity: 0.08
    },
    dark: {
        sceneBg: 0x0f151d,
        gridMajor: 0x394757,
        gridMinor: 0x232d39,
        field: 0x8fcf33,
        fieldRunoff: 0xf19b2f,
        focal: 0xf19b2f,
        tier: [0x9ea99d, 0x859183, 0x6f7b6d],
        tierSeat: [0xc1c9be, 0xaab5a5, 0x95a08f],
        tierAisle: [0x2d3530, 0x38413b, 0x455049],
        ambientIntensity: 0.72,
        dirIntensity: 1.15,
        hemiSky: 0xcbd8e7,
        hemiGround: 0x0a0f15,
        hemiIntensity: 0.7,
        shadowOpacity: 0.16
    }
};

function normalizeThemeName(theme) {
    return theme === 'dark' ? 'dark' : 'light';
}

let BRAND_COLORS = SCENE_THEME_COLORS.light;
const MIDDLE_CLICK_DOUBLE_MS = 400;
const MIDDLE_CLICK_DRAG_PX = 6;

function syncSceneThemeColors(theme = 'light') {
    theme = normalizeThemeName(theme);
    BRAND_COLORS = SCENE_THEME_COLORS[theme] || SCENE_THEME_COLORS.light;
}

export class Scene3D {
    /**
     * @param {HTMLElement} container - DOM element to mount the 3D canvas into
     */
    constructor(container, options = {}) {
        this.container = container;
        this._theme = normalizeThemeName(options?.theme);
        /** @type {any} */
        this.THREE = THREE;
        /** @type {any} */
        this.scene = null;
        /** @type {any} */
        this.camera = null;
        /** @type {any} */
        this.renderer = null;
        /** @type {any} */
        this.controls = null;
        /** @type {any} */
        this.bowlGroup = null;
        /** @type {any} */
        this.aisleGroup = null;
        /** @type {any} */
        this.seatGroup = null;
        /** @type {any} */
        this.fieldGroup = null;
        this._animId = null;
        this._initialized = false;
        this._cameraAutoFitted = false;
        this.seatPreviewStats = null;
        /** @type {any} */
        this._ambientLight = null;
        /** @type {any} */
        this._dirLight = null;
        /** @type {any} */
        this._hemiLight = null;
        /** @type {any} */
        this._gridHelper = null;
        /** @type {any} */
        this._shadowPlane = null;
        this._lastMiddleClickTime = 0;
        this._middlePointerState = null;
        this._middlePointerDownHandler = null;
        this._middlePointerMoveHandler = null;
        this._middlePointerUpHandler = null;
        this._middlePointerCancelHandler = null;
    }

    async init() {
        syncSceneThemeColors(this._theme);
        const size = this._getViewportSize();
        const w = size.w;
        const h = size.h;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(BRAND_COLORS.sceneBg);
        this.scene.fog = new THREE.FogExp2(BRAND_COLORS.sceneBg, 0.0);

        // Camera
        this.camera = /** @type {any} */ (new THREE.PerspectiveCamera(50, w / h, 1, 5000));
        this.camera.position.set(200, 150, 300);
        this.camera.lookAt(0, 20, 0);

        // Renderer
        this.renderer = /** @type {any} */ (new THREE.WebGLRenderer({ antialias: true }));
        this.renderer.setSize(w, h, false);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.localClippingEnabled = true;
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.maxPolarAngle = Math.PI / 2.05;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 1.2;
        this.controls.target.set(0, 20, 0);

        // Lighting - Modern crisp setup
        this._ambientLight = new THREE.AmbientLight(0xffffff, BRAND_COLORS.ambientIntensity);
        this.scene.add(this._ambientLight);

        this._dirLight = /** @type {any} */ (new THREE.DirectionalLight(0xffffff, BRAND_COLORS.dirIntensity));
        this._dirLight.position.set(150, 300, 150);
        this._dirLight.castShadow = true;
        this._dirLight.shadow.mapSize.width = 2048;
        this._dirLight.shadow.mapSize.height = 2048;
        this._dirLight.shadow.camera.left = -400;
        this._dirLight.shadow.camera.right = 400;
        this._dirLight.shadow.camera.top = 400;
        this._dirLight.shadow.camera.bottom = -400;
        this._dirLight.shadow.camera.far = 1000;
        this._dirLight.shadow.bias = -0.0005;
        this.scene.add(this._dirLight);

        this._hemiLight = new THREE.HemisphereLight(BRAND_COLORS.hemiSky, BRAND_COLORS.hemiGround, BRAND_COLORS.hemiIntensity);
        this.scene.add(this._hemiLight);

        // Keep a subtle reference grid so the 3D scene is always legible.
        this._gridHelper = /** @type {any} */ (this._buildGridHelper());
        this.scene.add(this._gridHelper);

        // Invisible shadow-catching plane instead of gray ground
        const shadowGeo = new THREE.PlaneGeometry(2000, 2000);
        const shadowMat = /** @type {any} */ (new THREE.ShadowMaterial({ opacity: BRAND_COLORS.shadowOpacity }));
        this._shadowPlane = /** @type {any} */ (new THREE.Mesh(shadowGeo, shadowMat));
        this._shadowPlane.rotation.x = -Math.PI / 2;
        this._shadowPlane.position.y = -0.05;
        this._shadowPlane.receiveShadow = true;
        this.scene.add(this._shadowPlane);


        // Groups for dynamic content
        this.bowlGroup = new THREE.Group();
        this.aisleGroup = new THREE.Group();
        this.seatGroup = new THREE.Group();
        this.fieldGroup = new THREE.Group();
        this.scene.add(this.bowlGroup);
        this.scene.add(this.aisleGroup);
        this.scene.add(this.seatGroup);
        this.scene.add(this.fieldGroup);

        // Handle resize
        this._resizeHandler = () => this._onResize();
        window.addEventListener('resize', this._resizeHandler);

        // Double Middle Mouse Button to zoom extents
        this._middlePointerDownHandler = (e) => this._handleMiddlePointerDown(e);
        this._middlePointerMoveHandler = (e) => this._handleMiddlePointerMove(e);
        this._middlePointerUpHandler = (e) => {
            if (!this._handleMiddlePointerUp(e)) return;

            // Small delay ensures OrbitControls processes pointerup and clears its drag state first.
            setTimeout(() => {
                this._fitCameraToBowl();
            }, 10);
        };
        this._middlePointerCancelHandler = () => {
            this._middlePointerState = null;
            this._lastMiddleClickTime = 0;
        };
        this.renderer.domElement.addEventListener('pointerdown', this._middlePointerDownHandler);
        this.renderer.domElement.addEventListener('pointermove', this._middlePointerMoveHandler);
        this.renderer.domElement.addEventListener('pointerup', this._middlePointerUpHandler);
        this.renderer.domElement.addEventListener('pointercancel', this._middlePointerCancelHandler);

        // Resize observer for container
        this._resizeObserver = new ResizeObserver(() => this._onResize());
        this._resizeObserver.observe(this.container);

        // Start render loop
        this._animate();
        this._initialized = true;

        // Some layouts report 0 size on first paint; force follow-up resizes.
        requestAnimationFrame(() => this._onResize());
        setTimeout(() => this._onResize(), 50);
        setTimeout(() => this._onResize(), 200);
    }

    _buildGridHelper() {
        const grid = /** @type {any} */ (new this.THREE.GridHelper(1200, 24, BRAND_COLORS.gridMajor, BRAND_COLORS.gridMinor));
        grid.position.y = 0.01;
        return grid;
    }

    applyTheme(theme = this._theme) {
        this._theme = normalizeThemeName(theme);
        syncSceneThemeColors(this._theme);
        if (!this.scene || !this.THREE) return;

        this.scene.background = new this.THREE.Color(BRAND_COLORS.sceneBg);
        if (this.scene.fog && this.scene.fog.color) {
            this.scene.fog.color.setHex(BRAND_COLORS.sceneBg);
        }

        if (this._ambientLight) {
            this._ambientLight.intensity = BRAND_COLORS.ambientIntensity;
        }

        if (this._dirLight) {
            this._dirLight.intensity = BRAND_COLORS.dirIntensity;
        }

        if (this._hemiLight) {
            this._hemiLight.color.setHex(BRAND_COLORS.hemiSky);
            this._hemiLight.groundColor.setHex(BRAND_COLORS.hemiGround);
            this._hemiLight.intensity = BRAND_COLORS.hemiIntensity;
        }

        if (this._shadowPlane && this._shadowPlane.material) {
            this._shadowPlane.material.opacity = BRAND_COLORS.shadowOpacity;
            this._shadowPlane.material.needsUpdate = true;
        }

        if (this._gridHelper) {
            this.scene.remove(this._gridHelper);
            this._gridHelper.geometry?.dispose?.();
            if (Array.isArray(this._gridHelper.material)) {
                this._gridHelper.material.forEach(m => m?.dispose?.());
            } else {
                this._gridHelper.material?.dispose?.();
            }
        }
        this._gridHelper = this._buildGridHelper();
        this.scene.add(this._gridHelper);
    }

    _onResize() {
        const size = this._getViewportSize();
        const w = size.w;
        const h = size.h;
        if (w === 0 || h === 0) return;

        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h, false);
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
    }

    _animate() {
        this._animId = requestAnimationFrame(() => this._animate());
        if (this.controls) {
            this.controls.update();
            this._stabilizeCameraDistance();
        }
        if (this.renderer && this.scene && this.camera) {
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (err) {
                console.warn('3D render error:', err);
            }
        }
    }

    /**
     * Update the field surface.
     * @param {Object} template - Sport template
     * @param {number} [customRunoff]
     * @param {number} [focalZ] - Focal point elevation (ft) from the left parameter pane.
     * @param {number} [focalX] - Focal point horizontal offset (ft) from the field-edge anchor.
     */
    updateField(template, customRunoff, focalZ = 0, focalX = 0) {
        if (!this._initialized || !this.THREE) return;
        const THREE = this.THREE;

        // Clear existing field
        while (this.fieldGroup.children.length) {
            const child = this.fieldGroup.children[0];
            this.fieldGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        if (!template) return;

        const runoff = customRunoff != null ? customRunoff : template.runoff;
        const shape = template.shape;

        // Field surface (green)
        const fieldShape = this._createFieldShape(template, 0);
        if (fieldShape) {
            const fieldGeo = new THREE.ShapeGeometry(fieldShape);
            const fieldMat = new THREE.MeshStandardMaterial({
                color: BRAND_COLORS.field,
                roughness: 0.7,
                side: THREE.DoubleSide
            });
            const fieldMesh = /** @type {any} */ (new THREE.Mesh(fieldGeo, fieldMat));
            fieldMesh.rotation.x = -Math.PI / 2;
            fieldMesh.position.y = 0.05;
            fieldMesh.receiveShadow = true;
            this.fieldGroup.add(fieldMesh);
        }

        // Runoff perimeter line
        const runoffShape = this._createFieldShape(template, runoff);
        if (runoffShape) {
            const runoffPoints = runoffShape.getPoints(64);
            const runoffGeo = new THREE.BufferGeometry().setFromPoints(
                runoffPoints.map(p => new THREE.Vector3(p.x, 0.1, -p.y))
            );
            const runoffMat = new THREE.LineDashedMaterial({
                color: BRAND_COLORS.fieldRunoff,
                dashSize: 5,
                gapSize: 3,
                linewidth: 1
            });
            const runoffLine = new THREE.Line(runoffGeo, runoffMat);
            runoffLine.computeLineDistances();
            this.fieldGroup.add(runoffLine);
        }

        // Focal point marker
        const fx = template.focal_x || 0;
        const fy = resolvePlanFocalYFt(template, focalX);
        const markerGeo = new THREE.SphereGeometry(2, 16, 16);
        const markerMat = new THREE.MeshStandardMaterial({
            color: BRAND_COLORS.focal,
            emissive: 0x6a430a,
            emissiveIntensity: 0.45
        });
        const marker = /** @type {any} */ (new THREE.Mesh(markerGeo, markerMat));
        const focalElev = Number.isFinite(Number(focalZ)) ? Number(focalZ) : 0;
        marker.position.set(fx, focalElev, -fy);
        this.fieldGroup.add(marker);
    }

    _createFieldShape(template, extra) {
        const THREE = this.THREE;
        const shape = new THREE.Shape();

        if (template.shape === 'rectangle') {
            const halfL = template.field_length / 2 + extra;
            const halfW = template.field_width / 2 + extra;
            shape.moveTo(-halfL, -halfW);
            shape.lineTo(halfL, -halfW);
            shape.lineTo(halfL, halfW);
            shape.lineTo(-halfL, halfW);
            shape.closePath();

        } else if (template.shape === 'rounded_rect') {
            const halfL = template.field_length / 2 + extra;
            const halfW = template.field_width / 2 + extra;
            const r = Math.min((template.corner_radius || 0) + extra, halfL, halfW);

            shape.moveTo(-halfL + r, -halfW);
            shape.lineTo(halfL - r, -halfW);
            shape.quadraticCurveTo(halfL, -halfW, halfL, -halfW + r);
            shape.lineTo(halfL, halfW - r);
            shape.quadraticCurveTo(halfL, halfW, halfL - r, halfW);
            shape.lineTo(-halfL + r, halfW);
            shape.quadraticCurveTo(-halfL, halfW, -halfL, halfW - r);
            shape.lineTo(-halfL, -halfW + r);
            shape.quadraticCurveTo(-halfL, -halfW, -halfL + r, -halfW);

        } else if (template.shape === 'oval') {
            const halfW = template.field_width / 2 + extra;
            const halfStraight = template.straight_length / 2 - (template.corner_radius || 0) + extra;

            // Top line
            shape.moveTo(-halfStraight, halfW);
            shape.lineTo(halfStraight, halfW);
            // Right arc
            shape.absarc(halfStraight, 0, halfW, Math.PI / 2, -Math.PI / 2, true);
            // Bottom line
            shape.lineTo(-halfStraight, -halfW);
            // Left arc
            shape.absarc(-halfStraight, 0, halfW, -Math.PI / 2, Math.PI / 2, true);

        } else if (template.shape === 'arc') {
            const radius = (template.field_radius || 0) + extra;
            const halfAngle = ((template.arc_angle || 90) / 2) * Math.PI / 180;

            shape.moveTo(0, 0);
            shape.lineTo(
                radius * Math.cos(Math.PI / 2 - halfAngle),
                radius * Math.sin(Math.PI / 2 - halfAngle)
            );
            shape.absarc(0, 0, radius, Math.PI / 2 - halfAngle, Math.PI / 2 + halfAngle, false);
            shape.lineTo(0, 0);

        } else {
            return null;
        }

        return shape;
    }

    /**
     * Update the seating bowl.
     * @param {Array|Object} solvers
     * @param {Object} bowlConfig
     * @param {Object} template
     * @param {number} [offsetCorrection]
     * @param {Array} [tierAisleLayouts]
     * @param {Object|null} [seatPreviewOptions]
     */
    updateBowl(solvers, bowlConfig, template, offsetCorrection = 0, tierAisleLayouts = [], seatPreviewOptions = null) {
        if (!this._initialized || !this.THREE) return;
        const THREE = this.THREE;

        // Clear existing bowl
        while (this.bowlGroup.children.length) {
            const child = this.bowlGroup.children[0];
            this.bowlGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        // Clear existing aisle overlays
        while (this.aisleGroup && this.aisleGroup.children.length) {
            const child = this.aisleGroup.children[0];
            this.aisleGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        while (this.seatGroup && this.seatGroup.children.length) {
            const child = this.seatGroup.children[0];
            this.seatGroup.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        if (!solvers) {
            this.seatPreviewStats = { enabled: false, seatWidthIn: 0, totalSeats: 0, tiers: [] };
            return;
        }
        const solverList = Array.isArray(solvers) ? solvers : [solvers];
        const aisleLayoutMap = new Map((tierAisleLayouts || []).map(layout => [layout.tierIndex, layout]));
        const showSeatCubes = !!(seatPreviewOptions && seatPreviewOptions.showSeatCubes);
        const seatWidthIn = Math.max(0, Number(seatPreviewOptions && seatPreviewOptions.seatWidthIn) || 0);
        let totalSeatPreviewCount = 0;
        const seatPreviewByTier = [];
        let addedMeshes = 0;

        // Process each tier
        solverList.forEach((solver, index) => {
            if (!solver.rows || solver.rows.length === 0) return;
            const tIdx = solver.tierIndex !== undefined ? solver.tierIndex : index;

            // Generate Mesh for this tier
            const geometry = this._createTierGeometry(solver, bowlConfig, offsetCorrection);
            if (!geometry) return;

            // Material - tier colors (dark/medium/light neutral grayscale)
            let color = BRAND_COLORS.tier[Math.max(0, index) % BRAND_COLORS.tier.length];

            const material = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide
            });

            const mesh = /** @type {any} */ (new THREE.Mesh(geometry, material));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = mesh.userData || {};
            mesh.userData.tierIndex = tIdx;
            mesh.userData.rhinoExportCategory = 'bowl';
            this.bowlGroup.add(mesh);
            addedMeshes += 1;

            // NOTE:
            // We intentionally do not draw a global wire/edge overlay here.
            // Those lines visually mimic aisles in top views and make 3D appear
            // to have more aisles than the egress-calculated layout.

            const tierAisleLayout = aisleLayoutMap.get(tIdx);
            if (tierAisleLayout && tierAisleLayout.aisles && tierAisleLayout.aisles.length > 0) {
                const aisleGeometry = this._createTierAisleGeometry(solver, bowlConfig, tierAisleLayout, offsetCorrection);
                if (aisleGeometry) {
                    const aisleMaterial = new THREE.MeshStandardMaterial({
                        color: BRAND_COLORS.tierAisle[Math.max(0, index) % BRAND_COLORS.tierAisle.length],
                        roughness: 0.7,
                        metalness: 0.02,
                        side: THREE.DoubleSide,
                        transparent: true,
                        opacity: 0.95
                    });
                    const aisleMesh = /** @type {any} */ (new THREE.Mesh(aisleGeometry, aisleMaterial));
                    aisleMesh.renderOrder = 5;
                    aisleMesh.castShadow = false;
                    aisleMesh.receiveShadow = true;
                    aisleMesh.userData = aisleMesh.userData || {};
                    aisleMesh.userData.tierIndex = tIdx;
                    aisleMesh.userData.rhinoExportCategory = 'aisles';
                    this.aisleGroup.add(aisleMesh);
                }
            }

            if (showSeatCubes && seatWidthIn > 0) {
                const seatPreview = this._createTierSeatPreviewMesh(
                    solver,
                    bowlConfig,
                    tierAisleLayout || null,
                    seatWidthIn,
                    offsetCorrection,
                    index
                );
                if (seatPreview && seatPreview.mesh) {
                    seatPreview.mesh.userData = seatPreview.mesh.userData || {};
                    seatPreview.mesh.userData.tierIndex = tIdx;
                    seatPreview.mesh.userData.rhinoExportCategory = 'spectators';
                    if (seatPreview.mesh.userData.seatPreview) {
                        seatPreview.mesh.userData.seatPreview.tierIndex = tIdx;
                    }
                    this.seatGroup.add(seatPreview.mesh);
                    totalSeatPreviewCount += seatPreview.count || 0;
                    seatPreviewByTier.push({
                        tierIndex: tIdx,
                        count: seatPreview.count || 0
                    });
                }
            }
        });

        this.seatPreviewStats = showSeatCubes ? {
            enabled: true,
            seatWidthIn,
            totalSeats: totalSeatPreviewCount,
            tiers: seatPreviewByTier
        } : {
            enabled: false,
            seatWidthIn,
            totalSeats: 0,
            tiers: []
        };

        // Auto-fit only once; keep user camera after that.
        if (!this._cameraAutoFitted && addedMeshes > 0) {
            this._fitCameraToBowl();
            this._cameraAutoFitted = true;
        }
    }

    _resetCamera(size) {
        // Optional: adjust camera based on bowl size if needed
    }

    _createTierGeometry(solver, bowlConfig, offsetCorrection = 0) {
        const THREE = this.THREE;
        const positions = [];
        const indices = [];

        // Ensure defaults
        const config = bowlConfig || { type: 'Full', width: 200, length: 400, corner: 'Radius', radius: 20 };
        const structuralDepthFt = Math.max(0, (Number(config.structuralDepth) || 0) / 12.0);

        // Build a closed thickened section whenever structural depth is enabled.
        if (structuralDepthFt > 0) {
            const thickGeometry = this._createTierGeometryWithDepth(solver, config, structuralDepthFt, offsetCorrection);
            if (thickGeometry) return thickGeometry;
        }

        // We accumulate vertices for the whole tier to single mesh
        let baseIndex = 0;

        solver.rows.forEach(row => {
            const zBottom = row.z - row.riser_height;
            const zTop = row.z;
            // Keep zero-depth geometry aligned with the 2D profile convention:
            // tread runs from (row.x - tread_depth) to row.x.
            const xFront = (row.x - row.tread_depth) - offsetCorrection;
            const xBack = row.x - offsetCorrection;

            // Generate paths (now array of subpaths)
            const pathsFront = this._getBowlPoints(config, xFront);
            const pathsBack = this._getBowlPoints(config, xBack);

            // Check valid arrays existence
            if (!pathsFront || !pathsBack || pathsFront.length === 0) return;

            const numPaths = Math.min(pathsFront.length, pathsBack.length);
            for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
                const ptsFront = pathsFront[pathIdx];
                const ptsBack = pathsBack[pathIdx];

                if (!ptsFront || !ptsBack || ptsFront.length < 2 || ptsBack.length < 2) continue;

                const n = Math.min(ptsFront.length, ptsBack.length);

                // For each point along the contour
                for (let i = 0; i < n; i++) {
                    const pF = ptsFront[i];
                    const pB = ptsBack[i];

                    // Vertices for this profile slice:
                    // 0: Riser Bottom (Front, Low)
                    // 1: Riser Top (Front, High)
                    // 2: Tread Back (Back, High)

                    positions.push(pF.x, zBottom, pF.z); // 0
                    positions.push(pF.x, zTop, pF.z);    // 1
                    positions.push(pB.x, zTop, pB.z);    // 2

                    // If not last point, create quads connecting to next index
                    if (i < n - 1) {
                        const i0 = baseIndex + i * 3;     // Curr Low
                        const i1 = baseIndex + i * 3 + 1; // Curr High Front
                        const i2 = baseIndex + i * 3 + 2; // Curr High Back

                        const j0 = baseIndex + (i + 1) * 3;     // Next Low
                        const j1 = baseIndex + (i + 1) * 3 + 1; // Next High Front
                        const j2 = baseIndex + (i + 1) * 3 + 2; // Next High Back

                        // Riser Quad: i0 -> j0 -> j1 -> i1
                        indices.push(i0, j0, i1);
                        indices.push(j0, j1, i1);

                        // Tread Quad: i1 -> j1 -> j2 -> i2
                        indices.push(i1, j1, i2);
                        indices.push(j1, j2, i2);
                    }
                }
                baseIndex += n * 3;
            }
        });

        if (positions.length === 0 || indices.length === 0) return null;
        for (let i = 0; i < positions.length; i++) {
            if (!Number.isFinite(positions[i])) return null;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    _createTierAisleGeometry(solver, bowlConfig, tierAisleLayout, offsetCorrection = 0) {
        const THREE = this.THREE;
        if (!solver || !solver.rows || solver.rows.length === 0) return null;
        if (!tierAisleLayout || !tierAisleLayout.aisles || tierAisleLayout.aisles.length === 0) return null;

        const positions = [];
        const indices = [];
        const zOffset = 0.045; // small lift to avoid z-fighting against bowl faces

        const pushVertex = (x, y, z) => {
            positions.push(x, y, z);
            return (positions.length / 3) - 1;
        };

        const pushQuad = (a, b, c, d) => {
            const i0 = pushVertex(a.x, a.y, a.z);
            const i1 = pushVertex(b.x, b.y, b.z);
            const i2 = pushVertex(c.x, c.y, c.z);
            const i3 = pushVertex(d.x, d.y, d.z);
            indices.push(i0, i1, i2);
            indices.push(i0, i2, i3);
        };

        const pathCache = new Map();
        const chamferCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                const segments = this._getBowlGeometrySegments(bowlConfig, offset);
                pathCache.set(key, buildGeometryPaths(segments));
            }
            return pathCache.get(key);
        };
        const aisleReferenceMap = this._buildTierAisleReferenceMap(
            solver,
            tierAisleLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        );

        solver.rows.forEach(row => {
            const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
            const backOffset = row.x - offsetCorrection;
            const pathsFront = getPathsForOffset(frontOffset);
            const pathsBack = getPathsForOffset(backOffset);
            if (!pathsFront.length || !pathsBack.length) return;

            const zTop = row.z + zOffset;
            const zBottom = (row.z - row.riser_height) + zOffset;

            tierAisleLayout.aisles.forEach((aisle, aisleIndex) => {
                const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
                const pathFront = pathsFront[pathIndex];
                const pathBack = pathsBack[pathIndex];
                if (!pathFront || !pathBack) return;

                const ratios = this._resolveTierAisleStationRatios(
                    pathFront,
                    pathBack,
                    aisle,
                    aisleIndex,
                    chamferCache,
                    aisleReferenceMap
                );
                if (!ratios) return;

                const widthFt = getTierRenderedAisleWidthFt(tierAisleLayout, aisleIndex);
                if (widthFt <= 0) return;
                const bandFront = sampleAisleBand(pathFront, ratios.uFront, widthFt);
                const bandBack = sampleAisleBand(pathBack, ratios.uBack, widthFt);
                if (!bandFront || !bandBack) return;

                const fL = { x: bandFront.left.x, y: zTop, z: -bandFront.left.y };
                const fR = { x: bandFront.right.x, y: zTop, z: -bandFront.right.y };
                const bR = { x: bandBack.right.x, y: zTop, z: -bandBack.right.y };
                const bL = { x: bandBack.left.x, y: zTop, z: -bandBack.left.y };

                // Tread patch for this row.
                pushQuad(fL, fR, bR, bL);

                // Riser patch at the row front so aisles read as continuous down the steps.
                const rfL = { x: bandFront.left.x, y: zBottom, z: -bandFront.left.y };
                const rfR = { x: bandFront.right.x, y: zBottom, z: -bandFront.right.y };
                pushQuad(rfL, rfR, fR, fL);
            });
        });

        if (!positions.length || !indices.length) return null;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    _buildTierAisleReferenceMap(
        solver,
        tierAisleLayout,
        offsetCorrection,
        getPathsForOffset,
        chamferCache
    ) {
        return buildTierAisleReferenceMap({
            rows: solver?.rows || [],
            tierLayout: tierAisleLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        });
    }

    _resolveTierAisleStationRatios(pathFront, pathBack, aisle, aisleIndex, chamferCache, aisleReferenceMap = null) {
        return resolveTierAisleStationRatios(
            pathFront,
            pathBack,
            aisle,
            aisleIndex,
            chamferCache,
            aisleReferenceMap
        );
    }

    _createTierSeatPreviewMesh(
        solver,
        bowlConfig,
        tierAisleLayout,
        seatWidthIn,
        offsetCorrection = 0,
        tierColorIndex = 0
    ) {
        const THREE = this.THREE;
        if (!solver || !solver.rows || solver.rows.length === 0) return null;

        const seatSizeFt = Math.max(0.1, (Number(seatWidthIn) || 0) / 12.0);
        if (seatSizeFt <= 0) return null;

        const aisles = (tierAisleLayout && Array.isArray(tierAisleLayout.aisles)) ? tierAisleLayout.aisles : [];
        const seatPlacements = [];
        const zLift = 0.08;

        const pathCache = new Map();
        const chamferCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                const segments = this._getBowlGeometrySegments(bowlConfig, offset);
                pathCache.set(key, buildGeometryPaths(segments));
            }
            return pathCache.get(key);
        };
        const aisleReferenceMap = this._buildTierAisleReferenceMap(
            solver,
            tierAisleLayout,
            offsetCorrection,
            getPathsForOffset,
            chamferCache
        );

        solver.rows.forEach(row => {
            const centerOffset = (row.x - (row.tread_depth * 0.5)) - offsetCorrection;
            const centerPaths = getPathsForOffset(centerOffset);
            if (!centerPaths.length) return;

            const blockedByPath = centerPaths.map(() => []);

            if (aisles.length > 0) {
                for (let i = 0; i < aisles.length; i++) {
                    const aisle = aisles[i];
                    const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
                    const path = centerPaths[pathIndex];
                    if (!path || !Number.isFinite(path.length) || path.length <= 1e-6) continue;

                    const ratios = this._resolveTierAisleStationRatios(
                        path,
                        path,
                        aisle,
                        i,
                        chamferCache,
                        aisleReferenceMap
                    );
                    if (!ratios) continue;
                    const u = Number.isFinite(ratios.uFront) ? ratios.uFront : ratios.uBack;
                    if (!Number.isFinite(u)) continue;

                    const normalizedU = path.closed
                        ? ((((u % 1) + 1) % 1))
                        : Math.max(0, Math.min(1, u));
                    const centerDist = normalizedU * path.length;
                    const aisleWidthFt = getTierRenderedAisleWidthFt(tierAisleLayout, i);
                    if (aisleWidthFt <= 0) continue;
                    this._addSeatBlockedSpan(
                        blockedByPath[pathIndex],
                        path.length,
                        centerDist - (aisleWidthFt * 0.5),
                        centerDist + (aisleWidthFt * 0.5),
                        !!path.closed
                    );
                }
            }

            for (let pathIndex = 0; pathIndex < centerPaths.length; pathIndex++) {
                const path = centerPaths[pathIndex];
                if (!path || !Number.isFinite(path.length) || path.length <= 1e-6) continue;

                const freeIntervals = this._computeSeatFreeIntervals(path, blockedByPath[pathIndex] || []);
                if (!freeIntervals.length) continue;

                const centerY = row.z + (seatSizeFt * 0.5) + zLift;

                for (let j = 0; j < freeIntervals.length; j++) {
                    const interval = freeIntervals[j];
                    const startDist = interval[0];
                    const endDist = interval[1];
                    const len = endDist - startDist;
                    if (len + 1e-6 < seatSizeFt) continue;

                    const seatCount = intervalLengthToSeatCount(len + 1e-6, seatWidthIn);
                    if (seatCount <= 0) continue;

                    const remainder = Math.max(0, len - (seatCount * seatSizeFt));
                    let dist = startDist + (remainder * 0.5) + (seatSizeFt * 0.5);

                    for (let s = 0; s < seatCount; s++) {
                        const u = dist / path.length;
                        const pt = samplePathPointByRatio(path, u);
                        seatPlacements.push({
                            x: pt.x,
                            y: centerY,
                            z: -pt.y,
                            yaw: Math.atan2(-pt.ty, pt.tx)
                        });
                        dist += seatSizeFt;
                    }
                }
            }
        });

        if (!seatPlacements.length) return null;

        const material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.72,
            metalness: 0.0,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        const geometry = new THREE.BoxGeometry(seatSizeFt, seatSizeFt, seatSizeFt);
        const mesh = /** @type {any} */ (new THREE.InstancedMesh(geometry, material, seatPlacements.length));
        if (THREE.DynamicDrawUsage !== undefined) {
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        }
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.renderOrder = 4;

        const dummy = /** @type {any} */ (new THREE.Object3D());
        for (let i = 0; i < seatPlacements.length; i++) {
            const p = seatPlacements[i];
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(0, p.yaw, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
        mesh.userData.seatPreview = {
            count: seatPlacements.length,
            seatWidthIn: Number(seatWidthIn) || 0,
            tierIndex: solver.tierIndex
        };

        return {
            mesh,
            count: seatPlacements.length
        };
    }

    _addSeatBlockedSpan(spans, pathLength, startDist, endDist, isClosed) {
        if (!Array.isArray(spans)) return;
        const length = Math.max(0, Number(pathLength) || 0);
        if (length <= 1e-6) return;
        if (!Number.isFinite(startDist) || !Number.isFinite(endDist)) return;

        if (!isClosed) {
            const s = Math.max(0, Math.min(length, startDist));
            const e = Math.max(0, Math.min(length, endDist));
            if (e - s > 1e-6) spans.push([s, e]);
            return;
        }

        let s = startDist;
        let e = endDist;
        const width = e - s;
        if (width >= length - 1e-6) {
            spans.push([0, length]);
            return;
        }

        while (s < 0) { s += length; e += length; }
        while (s >= length) { s -= length; e -= length; }

        if (e <= length) {
            if (e - s > 1e-6) spans.push([s, e]);
            return;
        }

        if (length - s > 1e-6) spans.push([s, length]);
        if (e - length > 1e-6) spans.push([0, e - length]);
    }

    _computeSeatFreeIntervals(path, blockedSpans = []) {
        const length = Math.max(0, Number(path && path.length) || 0);
        if (length <= 1e-6) return [];
        if (!Array.isArray(blockedSpans) || blockedSpans.length === 0) return [[0, length]];

        const spans = blockedSpans
            .filter(span => Array.isArray(span) && span.length >= 2 && Number.isFinite(span[0]) && Number.isFinite(span[1]))
            .map(span => [Math.max(0, span[0]), Math.min(length, span[1])])
            .filter(span => (span[1] - span[0]) > 1e-6)
            .sort((a, b) => a[0] - b[0]);
        if (!spans.length) return [[0, length]];

        const merged = [];
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            const last = merged[merged.length - 1];
            if (!last || span[0] > last[1] + 1e-6) {
                merged.push([span[0], span[1]]);
            } else if (span[1] > last[1]) {
                last[1] = span[1];
            }
        }

        const free = [];
        let cursor = 0;
        for (let i = 0; i < merged.length; i++) {
            const span = merged[i];
            if (span[0] > cursor + 1e-6) free.push([cursor, span[0]]);
            cursor = Math.max(cursor, span[1]);
        }
        if (cursor < length - 1e-6) free.push([cursor, length]);
        return free;
    }

    _createTierGeometryWithDepth(solver, bowlConfig, structuralDepthFt, offsetCorrection = 0) {
        const THREE = this.THREE;
        const positions = [];
        const indices = [];
        const profile = buildStructuralProfileGeometry(solver, {
            structuralDepthFt,
            structuralProfileMode: bowlConfig?.structuralProfileMode,
            tierIndex: solver?.tierIndex ?? 0
        })?.closedProfile;
        if (!profile || profile.length < 4) return null;

        const pathCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, this._getBowlPoints(bowlConfig, offset));
            }
            return pathCache.get(key);
        };

        const pathSets = profile.map(pt => getPathsForOffset(pt.x - offsetCorrection));
        if (pathSets.some(paths => !paths || paths.length === 0)) return null;

        const profileCount = profile.length;
        let baseIndex = 0;
        let numPaths = Infinity;
        for (const paths of pathSets) {
            numPaths = Math.min(numPaths, paths.length);
        }

        if (!Number.isFinite(numPaths) || numPaths < 1) return null;

        for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
            let n = Infinity;
            for (let p = 0; p < profileCount; p++) {
                const pts = pathSets[p][pathIdx];
                if (!pts || pts.length < 2) {
                    n = 0;
                    break;
                }
                n = Math.min(n, pts.length);
            }
            if (!Number.isFinite(n) || n < 2) continue;

            const stripBase = baseIndex;

            // Vertex grid: profile index x contour index.
            for (let p = 0; p < profileCount; p++) {
                const pts = pathSets[p][pathIdx];
                const z = profile[p].z;
                for (let i = 0; i < n; i++) {
                    const planPt = pts[i];
                    positions.push(planPt.x, z, planPt.z);
                }
            }

            // Connect each adjacent profile segment along the contour.
            for (let p = 0; p < profileCount - 1; p++) {
                const rowA = stripBase + p * n;
                const rowB = stripBase + (p + 1) * n;
                for (let i = 0; i < n - 1; i++) {
                    const a = rowA + i;
                    const b = rowB + i;
                    const c = rowB + i + 1;
                    const d = rowA + i + 1;

                    indices.push(a, b, d);
                    indices.push(b, c, d);
                }
            }

            baseIndex += profileCount * n;
        }

        if (positions.length === 0 || indices.length === 0) return null;
        for (let i = 0; i < positions.length; i++) {
            if (!Number.isFinite(positions[i])) return null;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return geometry;
    }

    getExportSceneData() {
        return {
            bowlMeshes: this.bowlGroup?.children ?? [],
            aisleMeshes: this.aisleGroup?.children ?? [],
            seatMeshes: this.seatGroup?.children ?? [],
            THREE: this.THREE
        };
    }

    _handleMiddlePointerDown(event) {
        if (!event || event.button !== 1) return;

        this._middlePointerState = {
            pointerId: event.pointerId ?? null,
            clientX: Number(event.clientX) || 0,
            clientY: Number(event.clientY) || 0,
            moved: false
        };
    }

    _handleMiddlePointerMove(event) {
        const state = this._middlePointerState;
        if (!state) return;
        if (state.pointerId !== null && event?.pointerId !== undefined && state.pointerId !== event.pointerId) return;

        const dx = (Number(event?.clientX) || 0) - state.clientX;
        const dy = (Number(event?.clientY) || 0) - state.clientY;
        if ((dx * dx) + (dy * dy) > (MIDDLE_CLICK_DRAG_PX * MIDDLE_CLICK_DRAG_PX)) {
            state.moved = true;
        }
    }

    _handleMiddlePointerUp(event, now = performance.now()) {
        if (!event || event.button !== 1) return false;

        const state = this._middlePointerState;
        this._middlePointerState = null;
        if (!state) return false;

        if (state.pointerId !== null && event.pointerId !== undefined && state.pointerId !== event.pointerId) {
            this._lastMiddleClickTime = 0;
            return false;
        }

        if (state.moved) {
            this._lastMiddleClickTime = 0;
            return false;
        }

        if ((now - this._lastMiddleClickTime) < MIDDLE_CLICK_DOUBLE_MS) {
            this._lastMiddleClickTime = 0;
            return true;
        }

        this._lastMiddleClickTime = now;
        return false;
    }

    _stabilizeCameraDistance() {
        if (!this.camera || !this.controls) return;

        const minimumDistance = 8;
        const target = this.controls.target;
        const position = this.camera.position;
        const direction = new this.THREE.Vector3().subVectors(position, target);

        let distance = direction.length();
        if (!Number.isFinite(distance) || distance <= 0) {
            direction.set(1, 0.6, 1).normalize();
            distance = 0;
        } else {
            direction.normalize();
        }

        if (distance < minimumDistance) {
            position.copy(target).addScaledVector(direction, minimumDistance);
            distance = minimumDistance;
        }

        this.camera.near = Math.max(0.1, distance / 1000);
        this.camera.far = Math.max(5000, distance * 10);
        this.camera.updateProjectionMatrix();
    }

    _fitCameraToBowl() {
        if (!this.bowlGroup || this.bowlGroup.children.length === 0 || !this.camera || !this.controls) return;

        const box = new this.THREE.Box3().setFromObject(this.bowlGroup);
        if (box.isEmpty()) return;

        const size = box.getSize(new this.THREE.Vector3());
        const center = box.getCenter(new this.THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const centerFinite = Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z);
        const maxDimFinite = Number.isFinite(maxDim) && maxDim > 0;
        const boundsSuspicious = !centerFinite || !maxDimFinite || maxDim > 100000 || Math.abs(center.x) > 100000 || Math.abs(center.y) > 100000 || Math.abs(center.z) > 100000;

        if (boundsSuspicious) {
            this.controls.target.set(0, 20, 0);
            this.camera.position.set(260, 180, 340);
            this._stabilizeCameraDistance();
            this.controls.update();
            return;
        }

        const fov = this.camera.fov * (Math.PI / 180);
        const rawDistance = (maxDim / (2 * Math.tan(fov / 2))) * 0.95;
        const distance = Math.min(3000, Math.max(140, rawDistance));

        // Get current view direction relative to the target
        const direction = new this.THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        if (direction.lengthSq() < 0.0001) {
            direction.set(1, 0.6, 1); // fallback direction if camera is somehow perfectly on target
        }
        direction.normalize();

        // Update target to the bounding box center
        this.controls.target.copy(center);

        // Position camera `distance` units away along the current view direction
        this.camera.position.copy(center).addScaledVector(direction, distance);
        this._stabilizeCameraDistance();
        this.controls.update();
    }

    _getBowlPoints(bowlConfig, offset) {
        const segments = this._getBowlGeometrySegments(bowlConfig, offset);
        const subpaths = [];
        let currentPoints = null;

        const add = (x, y) => {
            if (!currentPoints) {
                currentPoints = [];
                subpaths.push(currentPoints);
            }
            currentPoints.push({ x: x, z: -y });
        };

        const resolution = 5; // Degrees per segment for arcs

        segments.forEach(s => {
            if (s.cmd === 'moveTo') {
                currentPoints = [];
                subpaths.push(currentPoints);
                add(s.x, s.y);
            } else if (s.cmd === 'lineTo') {
                add(s.x, s.y);
            } else if (s.cmd === 'arc') {
                // Approximate arc
                let start = s.sa;
                let end = s.ea;
                const r = s.r;
                const cx = s.x;
                const cy = s.y;
                const ccw = s.ccw;

                // Normalize angles
                if (ccw) {
                    while (end < start) end += Math.PI * 2;
                } else {
                    while (end > start) end -= Math.PI * 2;
                }

                const totalAngle = Math.abs(end - start);
                const steps = Math.max(1, Math.ceil(totalAngle * (180 / Math.PI) / resolution));

                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const a = start + (end - start) * t;
                    const px = cx + r * Math.cos(a);
                    const py = cy + r * Math.sin(a);
                    add(px, py);
                }
            } else if (s.cmd === 'closePath') {
                if (currentPoints && currentPoints.length > 0) {
                    currentPoints.push({ x: currentPoints[0].x, z: currentPoints[0].z });
                }
            }
        });

        return subpaths.filter(p => p.length > 0);
    }

    getBowlGeometrySegments(bowlConfig, offset) {
        return this._getBowlGeometrySegments(bowlConfig, offset);
    }

    _getBowlGeometrySegments(bowlConfig, offset) {
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

            // "Sides" -> Along foul lines
            // "U-Shape" -> Foul lines + Outfield curve
            // "Full" -> Wrap all the way around home plate

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

        const W = (bowlConfig.width || 200) / 2;
        let type = bowlConfig.type || 'Full';
        const L = (type.includes('Side') && bowlConfig.sideLength) ? (bowlConfig.sideLength / 2) : (bowlConfig.length || 300) / 2;
        let corner = bowlConfig.corner || 'Chamfer';
        let r = bowlConfig.radius || 0;

        const d = offset;

        // Base rectangle corners
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

        const segments = [];
        const addLine = (x, y) => segments.push({ cmd: 'lineTo', x, y });
        const addMove = (x, y) => segments.push({ cmd: 'moveTo', x, y });
        const addArc = (x, y, r, sa, ea, ccw) => segments.push({ cmd: 'arc', x, y, r, sa, ea, ccw });
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

    forceResize() {
        this._onResize();
    }

    _getViewportSize() {
        const rect = this.container.getBoundingClientRect();
        let w = Math.max(1, Math.floor(this.container.clientWidth || rect.width || 1));
        let h = Math.max(1, Math.floor(this.container.clientHeight || rect.height || 1));

        // Fallback: if the container collapses, use the panel dimensions.
        if ((h <= 1 || w <= 1) && this.container.parentElement) {
            const pr = this.container.parentElement.getBoundingClientRect();
            w = Math.max(w, Math.floor(pr.width || 1));
            h = Math.max(h, Math.floor(pr.height || 1));
        }

        // Last-resort floor for reliability.
        h = Math.max(120, h);
        w = Math.max(120, w);
        return { w, h };
    }

    dispose() {
        if (this._animId) cancelAnimationFrame(this._animId);
        if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this.renderer) {
            if (this._middlePointerDownHandler) {
                this.renderer.domElement.removeEventListener('pointerdown', this._middlePointerDownHandler);
            }
            if (this._middlePointerMoveHandler) {
                this.renderer.domElement.removeEventListener('pointermove', this._middlePointerMoveHandler);
            }
            if (this._middlePointerUpHandler) {
                this.renderer.domElement.removeEventListener('pointerup', this._middlePointerUpHandler);
            }
            if (this._middlePointerCancelHandler) {
                this.renderer.domElement.removeEventListener('pointercancel', this._middlePointerCancelHandler);
            }
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
    }
}
