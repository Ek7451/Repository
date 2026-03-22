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
import {
    buildBowlGeometrySegments,
    buildBowlGeometrySubpaths,
    buildFieldGeometrySegments,
    isPlanSubpathClosed
} from './field-renderer.js';

const SCENE_THEME_COLORS = {
    light: {
        sceneBg: 0xffffff,
        gridMajor: '#d6d6d2',
        gridMinor: '#eeeeea',
        field: 0x7aae1a,       // JLG Green (website tone)
        fieldRunoff: 0xde850a, // JLG Orange
        focal: 0xde850a,       // Use brand orange for focal marker
        tier: ['#606460', '#999e99', '#ccd1cb'], // Tier 1 dark, Tier 2 medium, Tier 3 light gray
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
        tier: ['#646864', '#979c96', '#b7beb6'],
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
const SCENE_EXTENTS_VERTICAL_PADDING_PX = 40;
const GRID_HELPER_Y = -0.01;
const GRID_HELPER_SIZE = 1200;
const GRID_HELPER_DIVISIONS = 48;
const GRID_FADE_START_RATIO = 0.02;
const GRID_FADE_POWER = 1.9;
const FIELD_SURFACE_Y = 0.18;
const RUNOFF_LINE_Y = 0.2;
const AISLE_POLYGON_OFFSET_FACTOR = -2;
const AISLE_POLYGON_OFFSET_UNITS = -2;
const SEAT_DEFAULT_COLOR = '#ffffff';
const SEAT_HIGHLIGHT_COLOR = '#de850a';
const SPECTATOR_LOOK_DISTANCE_FT = 120;
const SPECTATOR_ALT_LOOK_YAW_SPEED = 0.006;
const SPECTATOR_ALT_LOOK_PITCH_SPEED = 0.004;
const SPECTATOR_MAX_PITCH_RAD = Math.PI * 0.48;

function syncSceneThemeColors(theme = 'light') {
    theme = normalizeThemeName(theme);
    BRAND_COLORS = SCENE_THEME_COLORS[theme] || SCENE_THEME_COLORS.light;
}

function buildThreeShapeFromSegments(THREERef, segments = []) {
    if (!THREERef || !Array.isArray(segments) || segments.length === 0) return null;
    const shape = new THREERef.Shape();
    segments.forEach((segment) => {
        if (!segment || typeof segment !== 'object') return;
        if (segment.cmd === 'moveTo') shape.moveTo(segment.x, segment.y);
        else if (segment.cmd === 'lineTo') shape.lineTo(segment.x, segment.y);
        else if (segment.cmd === 'arc') shape.absarc(segment.x, segment.y, segment.r, segment.sa, segment.ea, segment.ccw);
        else if (segment.cmd === 'closePath') shape.closePath();
    });
    return shape;
}

export class Scene3D {
    /**
     * @param {HTMLElement} container - DOM element to mount the 3D canvas into
     */
    constructor(container, options = {}) {
        this.container = container;
        this._theme = normalizeThemeName(options?.theme);
        this._onSpectatorViewChange = typeof options?.onSpectatorViewChange === 'function'
            ? options.onSpectatorViewChange
            : null;
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
        /** @type {any} */
        this._raycaster = null;
        /** @type {any} */
        this._hoveredSeatRef = null;
        /** @type {any} */
        this._selectedSeatRef = null;
        this._spectatorView = null;
        this._seatPointerMoveHandler = null;
        this._seatPointerLeaveHandler = null;
        this._seatClickHandler = null;
        this._spectatorPointerDownHandler = null;
        this._spectatorPointerMoveHandler = null;
        this._spectatorPointerUpHandler = null;
        this._spectatorPointerCancelHandler = null;
        this._spectatorKeyDownHandler = null;
        this._spectatorKeyUpHandler = null;
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
        this.renderer.domElement.style.cursor = 'default';
        this.container.appendChild(this.renderer.domElement);
        this._raycaster = new THREE.Raycaster();

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
                this._clearSeatHover();
                this._clearSeatSelection();
                this._clearSpectatorView();
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

        this._seatPointerMoveHandler = (event) => this._handleSeatPointerMove(event);
        this._seatPointerLeaveHandler = () => this._clearSeatHover();
        this._seatClickHandler = (event) => this._handleSeatClick(event);
        this._spectatorPointerDownHandler = (event) => this._handleSpectatorPointerDown(event);
        this._spectatorPointerMoveHandler = (event) => this._handleSpectatorPointerMove(event);
        this._spectatorPointerUpHandler = (event) => this._handleSpectatorPointerUp(event);
        this._spectatorPointerCancelHandler = () => this._cancelSpectatorPointerDrag();
        this._spectatorKeyDownHandler = (event) => this._handleSpectatorKeyDown(event);
        this._spectatorKeyUpHandler = (event) => this._handleSpectatorKeyUp(event);
        this.renderer.domElement.addEventListener('pointermove', this._seatPointerMoveHandler);
        this.renderer.domElement.addEventListener('pointerleave', this._seatPointerLeaveHandler);
        this.renderer.domElement.addEventListener('click', this._seatClickHandler);
        this.renderer.domElement.addEventListener('pointerdown', this._spectatorPointerDownHandler);
        this.renderer.domElement.addEventListener('pointermove', this._spectatorPointerMoveHandler);
        this.renderer.domElement.addEventListener('pointerup', this._spectatorPointerUpHandler);
        this.renderer.domElement.addEventListener('pointercancel', this._spectatorPointerCancelHandler);
        window.addEventListener('keydown', this._spectatorKeyDownHandler);
        window.addEventListener('keyup', this._spectatorKeyUpHandler);

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
        const halfSize = GRID_HELPER_SIZE * 0.5;
        const divisions = Math.max(1, GRID_HELPER_DIVISIONS);
        const step = GRID_HELPER_SIZE / divisions;
        const positions = [];
        const colors = [];
        const backgroundColor = new this.THREE.Color(BRAND_COLORS.sceneBg);
        const majorColor = new this.THREE.Color(BRAND_COLORS.gridMajor);
        const minorColor = new this.THREE.Color(BRAND_COLORS.gridMinor);

        const pushSegment = (x1, z1, x2, z2, baseColor) => {
            positions.push(x1, 0, z1, x2, 0, z2);
            this._pushGridVertexColor(colors, baseColor, backgroundColor, halfSize, x1, z1);
            this._pushGridVertexColor(colors, baseColor, backgroundColor, halfSize, x2, z2);
        };

        for (let row = 0; row <= divisions; row++) {
            const axis = -halfSize + (row * step);
            const lineColor = row === (divisions / 2) ? majorColor : minorColor;

            for (let segment = 0; segment < divisions; segment++) {
                const start = -halfSize + (segment * step);
                const end = start + step;
                pushSegment(start, axis, end, axis, lineColor);
                pushSegment(axis, start, axis, end, lineColor);
            }
        }

        const geometry = new this.THREE.BufferGeometry();
        geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new this.THREE.Float32BufferAttribute(colors, 3));
        const material = new this.THREE.LineBasicMaterial({
            vertexColors: true,
            toneMapped: false,
            depthWrite: false
        });
        const grid = /** @type {any} */ (new this.THREE.LineSegments(geometry, material));
        grid.position.y = GRID_HELPER_Y;
        grid.renderOrder = -10;
        grid.userData = { isGridHelper: true };
        return grid;
    }

    _pushGridVertexColor(target, baseColor, backgroundColor, halfSize, x, z) {
        const fadeStart = Math.max(0, halfSize * GRID_FADE_START_RATIO);
        const fadeEnd = Math.max(fadeStart + 1e-3, halfSize);
        const distance = Math.hypot(x, z);
        const fadeT = Math.min(1, Math.max(0, (distance - fadeStart) / Math.max(fadeEnd - fadeStart, 1e-3)));
        const mixedColor = baseColor.clone().lerp(backgroundColor, Math.pow(fadeT, GRID_FADE_POWER));
        target.push(mixedColor.r, mixedColor.g, mixedColor.b);
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
            if (!this._spectatorView) {
                this._stabilizeCameraDistance();
            }
        }
        if (this.renderer && this.scene && this.camera) {
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (err) {
                console.warn('3D render error:', err);
            }
        }
    }

    setSpectatorViewChangeHandler(handler) {
        this._onSpectatorViewChange = typeof handler === 'function' ? handler : null;
        this._notifySpectatorViewChange();
    }

    isSpectatorViewActive() {
        return !!this._spectatorView?.active;
    }

    exitSpectatorView() {
        this._cancelSpectatorPointerDrag();
        this._clearSeatHover();
        this._clearSeatSelection();
        this._clearSpectatorView();
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

        // Field surface (green)
        const fieldShape = buildThreeShapeFromSegments(THREE, buildFieldGeometrySegments(template, 0));
        if (fieldShape) {
            const fieldGeo = new THREE.ShapeGeometry(fieldShape);
            const fieldMat = new THREE.MeshStandardMaterial({
                color: BRAND_COLORS.field,
                roughness: 0.7,
                side: THREE.DoubleSide
            });
            const fieldMesh = /** @type {any} */ (new THREE.Mesh(fieldGeo, fieldMat));
            fieldMesh.rotation.x = -Math.PI / 2;
            fieldMesh.position.y = FIELD_SURFACE_Y;
            fieldMesh.receiveShadow = true;
            fieldMesh.renderOrder = 1;
            this.fieldGroup.add(fieldMesh);
        }

        // Runoff perimeter line
        const runoffShape = buildThreeShapeFromSegments(THREE, buildFieldGeometrySegments(template, runoff));
        if (runoffShape) {
            const runoffPoints = runoffShape.getPoints(64);
            const runoffGeo = new THREE.BufferGeometry().setFromPoints(
                runoffPoints.map(p => new THREE.Vector3(p.x, RUNOFF_LINE_Y, -p.y))
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
        const fx = 0;
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
        this._clearSeatHover();
        this._clearSeatSelection();
        this._clearSpectatorView();

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
                        opacity: 0.95,
                        polygonOffset: true,
                        polygonOffsetFactor: AISLE_POLYGON_OFFSET_FACTOR,
                        polygonOffsetUnits: AISLE_POLYGON_OFFSET_UNITS
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
                    offsetCorrection
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

    _resetCamera(_size) {
        // Optional: adjust camera based on bowl size if needed
    }

    _duplicateVertex(positions, sourceIndex) {
        if (!Array.isArray(positions) || !Number.isInteger(sourceIndex) || sourceIndex < 0) return -1;
        const sourceOffset = sourceIndex * 3;
        if (sourceOffset + 2 >= positions.length) return -1;
        positions.push(
            positions[sourceOffset],
            positions[sourceOffset + 1],
            positions[sourceOffset + 2]
        );
        return (positions.length / 3) - 1;
    }

    _appendOpenRowEndCaps(positions, indices, stripBase, pointCount) {
        if (!Array.isArray(positions) || !Array.isArray(indices) || pointCount < 1) return;

        const firstTriangle = [stripBase, stripBase + 1, stripBase + 2]
            .map((sourceIndex) => this._duplicateVertex(positions, sourceIndex));
        if (firstTriangle.every((vertexIndex) => vertexIndex >= 0)) {
            indices.push(firstTriangle[0], firstTriangle[1], firstTriangle[2]);
        }

        const lastBase = stripBase + ((pointCount - 1) * 3);
        const lastTriangle = [lastBase, lastBase + 2, lastBase + 1]
            .map((sourceIndex) => this._duplicateVertex(positions, sourceIndex));
        if (lastTriangle.every((vertexIndex) => vertexIndex >= 0)) {
            indices.push(lastTriangle[0], lastTriangle[1], lastTriangle[2]);
        }
    }

    _appendOpenStructuralEndCaps(positions, indices, stripBase, profile, pointCount) {
        if (!Array.isArray(positions) || !Array.isArray(indices) || !Array.isArray(profile) || profile.length < 3 || pointCount < 1) return;
        const contour = profile
            .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.z))
            .map((point) => new this.THREE.Vector2(point.x, point.z));
        if (contour.length < 3) return;

        const capTriangles = this.THREE.ShapeUtils.triangulateShape(contour, []);
        const endOffset = pointCount - 1;
        const startCapVertices = profile.map((_, profileIndex) =>
            this._duplicateVertex(positions, stripBase + (profileIndex * pointCount))
        );
        const endCapVertices = profile.map((_, profileIndex) =>
            this._duplicateVertex(positions, stripBase + (profileIndex * pointCount) + endOffset)
        );
        if (startCapVertices.some((vertexIndex) => vertexIndex < 0) || endCapVertices.some((vertexIndex) => vertexIndex < 0)) return;

        capTriangles.forEach((triangle) => {
            if (!Array.isArray(triangle) || triangle.length !== 3) return;
            const [a, b, c] = triangle;
            indices.push(
                startCapVertices[a],
                startCapVertices[b],
                startCapVertices[c]
            );
            indices.push(
                endCapVertices[a],
                endCapVertices[c],
                endCapVertices[b]
            );
        });
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

        const getPlanSubpathsForOffset = (offset) => buildBowlGeometrySubpaths(config, offset)
            .map((subpath) => subpath.map((point) => ({ x: point.x, z: -point.y })));

        solver.rows.forEach(row => {
            const zBottom = row.z - row.riser_height;
            const zTop = row.z;
            // Keep zero-depth geometry aligned with the 2D profile convention:
            // tread runs from (row.x - tread_depth) to row.x.
            const xFront = (row.x - row.tread_depth) - offsetCorrection;
            const xBack = row.x - offsetCorrection;

            // Generate paths (now array of subpaths)
            const pathsFront = getPlanSubpathsForOffset(xFront);
            const pathsBack = getPlanSubpathsForOffset(xBack);

            // Check valid arrays existence
            if (!pathsFront || !pathsBack || pathsFront.length === 0) return;

            const numPaths = Math.min(pathsFront.length, pathsBack.length);
            for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
                const ptsFront = pathsFront[pathIdx];
                const ptsBack = pathsBack[pathIdx];

                if (!ptsFront || !ptsBack || ptsFront.length < 2 || ptsBack.length < 2) continue;

                const n = Math.min(ptsFront.length, ptsBack.length);
                const pathIsClosed = isPlanSubpathClosed(ptsFront) && isPlanSubpathClosed(ptsBack);
                const stripBase = positions.length / 3;

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
                        const i0 = stripBase + i * 3;     // Curr Low
                        const i1 = stripBase + i * 3 + 1; // Curr High Front
                        const i2 = stripBase + i * 3 + 2; // Curr High Back

                        const j0 = stripBase + (i + 1) * 3;     // Next Low
                        const j1 = stripBase + (i + 1) * 3 + 1; // Next High Front
                        const j2 = stripBase + (i + 1) * 3 + 2; // Next High Back

                        // Riser Quad: i0 -> j0 -> j1 -> i1
                        indices.push(i0, j0, i1);
                        indices.push(j0, j1, i1);

                        // Tread Quad: i1 -> j1 -> j2 -> i2
                        indices.push(i1, j1, i2);
                        indices.push(j1, j2, i2);
                    }
                }
                if (!pathIsClosed) {
                    this._appendOpenRowEndCaps(positions, indices, stripBase, n);
                }
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
                pathCache.set(key, buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)));
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
                    tierAisleLayout,
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

    _resolveTierAisleStationRatios(pathFront, pathBack, aisle, aisleIndex, tierAisleLayout, chamferCache, aisleReferenceMap = null) {
        return resolveTierAisleStationRatios(
            pathFront,
            pathBack,
            aisle,
            aisleIndex,
            chamferCache,
            aisleReferenceMap,
            tierAisleLayout
        );
    }

    _createTierSeatPreviewMesh(
        solver,
        bowlConfig,
        tierAisleLayout,
        seatWidthIn,
        offsetCorrection = 0
    ) {
        const THREE = this.THREE;
        if (!solver || !solver.rows || solver.rows.length === 0) return null;

        const seatSizeFt = Math.max(0.1, (Number(seatWidthIn) || 0) / 12.0);
        if (seatSizeFt <= 0) return null;

        const aisles = (tierAisleLayout && Array.isArray(tierAisleLayout.aisles)) ? tierAisleLayout.aisles : [];
        const seatPlacements = [];
        const spectatorSeats = [];
        const zLift = 0.08;

        const pathCache = new Map();
        const chamferCache = new Map();
        const getPathsForOffset = (offset) => {
            const key = offset.toFixed(6);
            if (!pathCache.has(key)) {
                pathCache.set(key, buildGeometryPaths(buildBowlGeometrySegments(bowlConfig, offset)));
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
            const eyeOffset = (
                Number.isFinite(Number(row.eye_x))
                    ? Number(row.eye_x)
                    : (Number(row.x) - ((Number(row.tread_depth) || 0) * 0.5))
            ) - offsetCorrection;
            const eyePaths = getPathsForOffset(eyeOffset);
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
                        tierAisleLayout,
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
                const eyePath = eyePaths[pathIndex] || path;

                const freeIntervals = this._computeSeatFreeIntervals(path, blockedByPath[pathIndex] || []);
                if (!freeIntervals.length) continue;

                const rowZ = Number.isFinite(Number(row.z)) ? Number(row.z) : 0;
                const centerY = rowZ + (seatSizeFt * 0.5) + zLift;
                const eyeY = Number.isFinite(Number(row.eye_z))
                    ? Number(row.eye_z)
                    : (rowZ + Math.max(seatSizeFt * 0.5, Number(solver?.eyeHeight) || 0));

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
                        const eyePt = samplePathPointByRatio(eyePath, u);
                        seatPlacements.push({
                            x: pt.x,
                            y: centerY,
                            z: -pt.y,
                            yaw: Math.atan2(-pt.ty, pt.tx)
                        });
                        spectatorSeats.push({
                            tierIndex: Number.isInteger(Number(solver?.tierIndex)) ? Number(solver.tierIndex) : 0,
                            seatPosition: {
                                x: pt.x,
                                y: centerY,
                                z: -pt.y
                            },
                            eyePosition: {
                                x: eyePt.x,
                                y: eyeY,
                                z: -eyePt.y
                            },
                            lookTarget: {
                                x: 0,
                                y: FIELD_SURFACE_Y,
                                z: 0
                            }
                        });
                        dist += seatSizeFt;
                    }
                }
            }
        });

        if (!seatPlacements.length) return null;

        const material = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.72,
            metalness: 0.0,
            transparent: true,
            opacity: 0.6,
            depthWrite: true
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
        const instanceColor = new THREE.Color(SEAT_DEFAULT_COLOR);
        for (let i = 0; i < seatPlacements.length; i++) {
            const p = seatPlacements[i];
            dummy.position.set(p.x, p.y, p.z);
            dummy.rotation.set(0, p.yaw, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            mesh.setColorAt(i, instanceColor);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
        if (typeof mesh.computeBoundingSphere === 'function') mesh.computeBoundingSphere();
        mesh.userData.seatPreview = {
            count: seatPlacements.length,
            seatWidthIn: Number(seatWidthIn) || 0,
            tierIndex: solver.tierIndex,
            instances: spectatorSeats
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

    _seatRefsEqual(a, b) {
        return !!a && !!b && a.mesh === b.mesh && a.instanceId === b.instanceId;
    }

    _getSeatPreviewInstance(mesh, instanceId) {
        const instances = mesh?.userData?.seatPreview?.instances;
        if (!Array.isArray(instances)) return null;
        return instances[instanceId] || null;
    }

    _setSeatMeshInstanceColor(mesh, instanceId, colorHex) {
        if (!mesh || !mesh.isInstancedMesh || typeof mesh.setColorAt !== 'function') return;
        if (!Number.isInteger(instanceId) || instanceId < 0 || instanceId >= mesh.count) return;
        mesh.setColorAt(instanceId, new this.THREE.Color(colorHex));
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
    }

    _applySeatRefColor(seatRef, colorHex) {
        if (!seatRef) return;
        this._setSeatMeshInstanceColor(seatRef.mesh, seatRef.instanceId, colorHex);
    }

    _notifySpectatorViewChange() {
        this._onSpectatorViewChange?.({
            active: this.isSpectatorViewActive()
        });
    }

    _syncSeatCursor() {
        const cursor = this._spectatorView?.dragging
            ? 'grabbing'
            : (this._spectatorView?.active
                ? (this._spectatorView?.altKeyActive ? 'grab' : 'default')
                : (this._hoveredSeatRef ? 'pointer' : 'default'));
        if (this.renderer?.domElement?.style) {
            this.renderer.domElement.style.cursor = cursor;
        }
    }

    _setSeatHover(seatRef) {
        if (this._seatRefsEqual(this._hoveredSeatRef, seatRef)) {
            this._syncSeatCursor();
            return;
        }

        const prevHover = this._hoveredSeatRef;
        this._hoveredSeatRef = seatRef;

        if (prevHover && !this._seatRefsEqual(prevHover, this._selectedSeatRef)) {
            this._applySeatRefColor(prevHover, SEAT_DEFAULT_COLOR);
        }
        if (seatRef) {
            this._applySeatRefColor(seatRef, SEAT_HIGHLIGHT_COLOR);
        }
        this._syncSeatCursor();
    }

    _clearSeatHover() {
        this._setSeatHover(null);
    }

    _setSeatSelection(seatRef) {
        if (this._seatRefsEqual(this._selectedSeatRef, seatRef)) {
            this._syncSeatCursor();
            return;
        }

        const prevSelection = this._selectedSeatRef;
        this._selectedSeatRef = seatRef;

        if (prevSelection && !this._seatRefsEqual(prevSelection, this._hoveredSeatRef)) {
            this._applySeatRefColor(prevSelection, SEAT_DEFAULT_COLOR);
        }
        if (seatRef) {
            this._applySeatRefColor(seatRef, SEAT_HIGHLIGHT_COLOR);
        }
        this._syncSeatCursor();
    }

    _clearSeatSelection() {
        this._setSeatSelection(null);
    }

    _getSeatPickFromPointerEvent(event) {
        if (!event || !this._raycaster || !this.renderer?.domElement || !this.camera) return null;
        const seatMeshes = this.seatGroup?.children || [];
        if (!seatMeshes.length) return null;

        const rect = this.renderer.domElement.getBoundingClientRect?.();
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;

        const pointer = new this.THREE.Vector2(
            ((Number(event.clientX) - rect.left) / rect.width) * 2 - 1,
            -(((Number(event.clientY) - rect.top) / rect.height) * 2 - 1)
        );
        this._raycaster.setFromCamera(pointer, this.camera);
        const intersections = this._raycaster.intersectObjects(seatMeshes, false);

        for (let i = 0; i < intersections.length; i++) {
            const hit = intersections[i];
            if (!hit?.object?.isInstancedMesh || !Number.isInteger(hit.instanceId)) continue;
            if (!this._getSeatPreviewInstance(hit.object, hit.instanceId)) continue;
            return {
                mesh: hit.object,
                instanceId: hit.instanceId
            };
        }

        return null;
    }

    _handleSeatPointerMove(event) {
        if (this._spectatorView?.dragging) return;
        this._setSeatHover(this._getSeatPickFromPointerEvent(event));
    }

    _handleSeatClick(event) {
        if (!event || (event.button !== undefined && event.button !== 0)) return;
        if (this._spectatorView?.dragging) return;
        if (this._spectatorView?.suppressNextSeatClick) {
            this._spectatorView.suppressNextSeatClick = false;
            return;
        }

        const seatRef = this._getSeatPickFromPointerEvent(event);
        if (!seatRef) return;

        const spectatorSeat = this._getSeatPreviewInstance(seatRef.mesh, seatRef.instanceId);
        if (!spectatorSeat) return;

        this._setSeatSelection(seatRef);
        this._enterSpectatorView(spectatorSeat);
    }

    _getSpectatorDirectionFromAngles(yaw, pitch) {
        const horizontal = Math.cos(pitch);
        return new this.THREE.Vector3(
            Math.sin(yaw) * horizontal,
            Math.sin(pitch),
            Math.cos(yaw) * horizontal
        ).normalize();
    }

    _getSpectatorAnglesFromDirection(direction) {
        const safeDirection = direction?.clone?.() ?? new this.THREE.Vector3(0, 0, -1);
        if (safeDirection.lengthSq() <= 1e-9) {
            safeDirection.set(0, 0, -1);
        } else {
            safeDirection.normalize();
        }
        const horizontal = Math.hypot(safeDirection.x, safeDirection.z);
        return {
            yaw: Math.atan2(safeDirection.x, safeDirection.z),
            pitch: Math.atan2(safeDirection.y, Math.max(horizontal, 1e-6))
        };
    }

    _applySpectatorViewPose() {
        const spectatorView = this._spectatorView;
        if (!spectatorView || !this.camera || !this.controls) return;

        const direction = this._getSpectatorDirectionFromAngles(spectatorView.yaw, spectatorView.pitch);
        this.camera.position.copy(spectatorView.eyePosition);
        this.controls.target.copy(spectatorView.eyePosition).addScaledVector(direction, spectatorView.lookDistance);
        this.controls.update?.();
    }

    _captureOrbitView() {
        if (!this.camera || !this.controls) return null;
        return {
            cameraPosition: this.camera.position.clone(),
            target: this.controls.target.clone()
        };
    }

    _restoreOrbitView(orbitView) {
        if (!orbitView || !this.camera || !this.controls) return;
        this.camera.position.copy(orbitView.cameraPosition);
        this.controls.target.copy(orbitView.target);
        this._stabilizeCameraDistance();
        this.controls.update?.();
    }

    _enterSpectatorView(spectatorSeat) {
        if (!spectatorSeat || !this.THREE || !this.camera || !this.controls) return;

        const eyePosition = new this.THREE.Vector3(
            Number(spectatorSeat.eyePosition?.x) || 0,
            Number(spectatorSeat.eyePosition?.y) || 0,
            Number(spectatorSeat.eyePosition?.z) || 0
        );
        const lookTarget = new this.THREE.Vector3(
            Number(spectatorSeat.lookTarget?.x) || 0,
            Number(spectatorSeat.lookTarget?.y) || 0,
            Number(spectatorSeat.lookTarget?.z) || 0
        );
        const direction = lookTarget.clone().sub(eyePosition);
        const lookDistance = Math.max(SPECTATOR_LOOK_DISTANCE_FT, direction.length());
        const angles = this._getSpectatorAnglesFromDirection(direction);
        const previousView = this._spectatorView;
        const orbitView = previousView?.orbitView || this._captureOrbitView();
        const controlsState = previousView?.controlsState || {
            enabled: this.controls.enabled,
            enableRotate: this.controls.enableRotate,
            enablePan: this.controls.enablePan,
            enableZoom: this.controls.enableZoom
        };

        this._spectatorView = {
            active: true,
            altKeyActive: previousView?.altKeyActive ?? false,
            dragging: false,
            suppressNextSeatClick: false,
            pointerId: null,
            lastClientX: 0,
            lastClientY: 0,
            eyePosition,
            lookDistance,
            yaw: angles.yaw,
            pitch: angles.pitch,
            orbitView,
            controlsState
        };

        this.controls.enabled = false;
        this.controls.enableRotate = false;
        this.controls.enablePan = false;
        this.controls.enableZoom = false;
        this._applySpectatorViewPose();
        this._syncSeatCursor();
        this._notifySpectatorViewChange();
    }

    _clearSpectatorView() {
        const spectatorView = this._spectatorView;
        if (!spectatorView || !this.controls) {
            this._spectatorView = null;
            this._syncSeatCursor();
            this._notifySpectatorViewChange();
            return;
        }

        this._spectatorView = null;
        this.controls.enabled = spectatorView.controlsState?.enabled ?? true;
        this.controls.enableRotate = spectatorView.controlsState?.enableRotate ?? true;
        this.controls.enablePan = spectatorView.controlsState?.enablePan ?? true;
        this.controls.enableZoom = spectatorView.controlsState?.enableZoom ?? true;
        this._restoreOrbitView(spectatorView.orbitView);
        this.controls.update?.();
        this._syncSeatCursor();
        this._notifySpectatorViewChange();
    }

    _rotateSpectatorView(deltaX, deltaY) {
        const spectatorView = this._spectatorView;
        if (!spectatorView) return;

        spectatorView.yaw -= deltaX * SPECTATOR_ALT_LOOK_YAW_SPEED;
        spectatorView.pitch = Math.max(
            -SPECTATOR_MAX_PITCH_RAD,
            Math.min(SPECTATOR_MAX_PITCH_RAD, spectatorView.pitch - (deltaY * SPECTATOR_ALT_LOOK_PITCH_SPEED))
        );
        this._applySpectatorViewPose();
    }

    _cancelSpectatorPointerDrag() {
        if (!this._spectatorView) {
            this._syncSeatCursor();
            return;
        }
        const pointerId = this._spectatorView.pointerId;
        if (pointerId !== null) {
            try {
                this.renderer?.domElement?.releasePointerCapture?.(pointerId);
            } catch (error) {
                console.warn('3D spectator pointer release error:', error);
            }
        }
        this._spectatorView.dragging = false;
        this._spectatorView.pointerId = null;
        this._syncSeatCursor();
    }

    _handleSpectatorPointerDown(event) {
        if (!this._spectatorView?.active || !event?.altKey || event.button !== 0) return;
        this._spectatorView.dragging = true;
        this._spectatorView.pointerId = event.pointerId ?? null;
        this._spectatorView.lastClientX = Number(event.clientX) || 0;
        this._spectatorView.lastClientY = Number(event.clientY) || 0;
        this.renderer?.domElement?.setPointerCapture?.(event.pointerId);
        event.preventDefault?.();
        this._syncSeatCursor();
    }

    _handleSpectatorPointerMove(event) {
        const spectatorView = this._spectatorView;
        if (!spectatorView?.dragging) return;
        if (spectatorView.pointerId !== null && event?.pointerId !== undefined && spectatorView.pointerId !== event.pointerId) return;

        const nextX = Number(event.clientX) || 0;
        const nextY = Number(event.clientY) || 0;
        const dx = nextX - spectatorView.lastClientX;
        const dy = nextY - spectatorView.lastClientY;
        spectatorView.lastClientX = nextX;
        spectatorView.lastClientY = nextY;
        if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
            spectatorView.suppressNextSeatClick = true;
        }
        this._rotateSpectatorView(dx, dy);
        event.preventDefault?.();
    }

    _handleSpectatorPointerUp(event) {
        const spectatorView = this._spectatorView;
        if (!spectatorView?.dragging) return;
        if (spectatorView.pointerId !== null && event?.pointerId !== undefined && spectatorView.pointerId !== event.pointerId) return;
        this._cancelSpectatorPointerDrag();
    }

    _handleSpectatorKeyDown(event) {
        if (!event) return;
        if (event.key === 'Escape' && this._spectatorView?.active) {
            this.exitSpectatorView();
            return;
        }
        if (event.key === 'Alt' && this._spectatorView?.active) {
            this._spectatorView.altKeyActive = true;
            this._syncSeatCursor();
        }
    }

    _handleSpectatorKeyUp(event) {
        if (!event || event.key !== 'Alt' || !this._spectatorView?.active) return;
        this._spectatorView.altKeyActive = false;
        this._cancelSpectatorPointerDrag();
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
                pathCache.set(key, buildBowlGeometrySubpaths(bowlConfig, offset)
                    .map((subpath) => subpath.map((point) => ({ x: point.x, z: -point.y }))));
            }
            return pathCache.get(key);
        };

        const pathSets = profile.map(pt => getPathsForOffset(pt.x - offsetCorrection));
        if (pathSets.some(paths => !paths || paths.length === 0)) return null;

        const profileCount = profile.length;
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

            const stripBase = positions.length / 3;
            const pathIsClosed = pathSets.every((paths) => isPlanSubpathClosed(paths[pathIdx]));

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

            if (!pathIsClosed) {
                this._appendOpenStructuralEndCaps(positions, indices, stripBase, profile, n);
            }
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

    _getFitPaddingPx() {
        return {
            horizontal: 0,
            vertical: SCENE_EXTENTS_VERTICAL_PADDING_PX
        };
    }

    _getFitCameraDistance(box, direction, viewportSize) {
        if (!box || !direction || !viewportSize || !this.THREE || !this.camera) return Number.NaN;

        const { w, h } = viewportSize;
        const safeWidth = Math.max(1, Number(w) || 1);
        const safeHeight = Math.max(1, Number(h) || 1);
        const { horizontal, vertical } = this._getFitPaddingPx();
        const widthRatio = Math.max(1 / safeWidth, (safeWidth - (horizontal * 2)) / safeWidth);
        const heightRatio = Math.max(1 / safeHeight, (safeHeight - (vertical * 2)) / safeHeight);

        const forward = direction.clone().negate().normalize();
        const fallbackUp = Math.abs(forward.y) > 0.999
            ? new this.THREE.Vector3(0, 0, 1)
            : new this.THREE.Vector3(0, 1, 0);
        const cameraUp = this.camera.up?.clone?.() ?? fallbackUp.clone();
        if (Math.abs(cameraUp.dot(forward)) > 0.999) {
            cameraUp.copy(fallbackUp);
        }

        const right = new this.THREE.Vector3().crossVectors(forward, cameraUp).normalize();
        const up = new this.THREE.Vector3().crossVectors(right, forward).normalize();
        const center = box.getCenter(new this.THREE.Vector3());
        const corners = [
            new this.THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new this.THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new this.THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new this.THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new this.THREE.Vector3(box.max.x, box.min.y, box.min.z),
            new this.THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new this.THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new this.THREE.Vector3(box.max.x, box.max.y, box.max.z)
        ];

        const verticalHalfTan = Math.tan((this.camera.fov * Math.PI / 180) / 2) * heightRatio;
        const horizontalHalfTan = verticalHalfTan * (safeWidth / safeHeight) * (widthRatio / heightRatio);
        let requiredDistance = 0;

        corners.forEach((corner) => {
            const offset = corner.sub(center);
            const localX = Math.abs(offset.dot(right));
            const localY = Math.abs(offset.dot(up));
            const localZ = offset.dot(forward);

            requiredDistance = Math.max(
                requiredDistance,
                (localY / Math.max(verticalHalfTan, 1e-6)) - localZ,
                (localX / Math.max(horizontalHalfTan, 1e-6)) - localZ
            );
        });

        return requiredDistance;
    }

    _fitCameraToBowl() {
        if (!this.bowlGroup || this.bowlGroup.children.length === 0 || !this.camera || !this.controls) return;
        this._clearSpectatorView();

        const box = new this.THREE.Box3().setFromObject(this.bowlGroup);
        if (box.isEmpty()) return;

        const viewportSize = this._getViewportSize();
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

        // Get current view direction relative to the target
        const direction = new this.THREE.Vector3().subVectors(this.camera.position, this.controls.target);
        if (direction.lengthSq() < 0.0001) {
            direction.set(1, 0.6, 1); // fallback direction if camera is somehow perfectly on target
        }
        direction.normalize();

        this.camera.aspect = viewportSize.w / viewportSize.h;
        this.camera.updateProjectionMatrix();

        const fallbackFov = this.camera.fov * (Math.PI / 180);
        const fallbackDistance = (maxDim / (2 * Math.tan(fallbackFov / 2))) * 0.95;
        const rawDistance = this._getFitCameraDistance(box, direction, viewportSize);
        const safeDistance = Number.isFinite(rawDistance) && rawDistance > 0 ? rawDistance : fallbackDistance;
        const distance = Math.min(3000, Math.max(140, safeDistance));

        // Update target to the bounding box center
        this.controls.target.copy(center);

        // Position camera `distance` units away along the current view direction
        this.camera.position.copy(center).addScaledVector(direction, distance);
        this._stabilizeCameraDistance();
        this.controls.update();
    }

    getBowlGeometrySegments(bowlConfig, offset) {
        return buildBowlGeometrySegments(bowlConfig, offset);
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
        this._clearSeatHover();
        this._clearSeatSelection();
        this._clearSpectatorView();
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
            if (this._seatPointerMoveHandler) {
                this.renderer.domElement.removeEventListener('pointermove', this._seatPointerMoveHandler);
            }
            if (this._seatPointerLeaveHandler) {
                this.renderer.domElement.removeEventListener('pointerleave', this._seatPointerLeaveHandler);
            }
            if (this._seatClickHandler) {
                this.renderer.domElement.removeEventListener('click', this._seatClickHandler);
            }
            if (this._spectatorPointerDownHandler) {
                this.renderer.domElement.removeEventListener('pointerdown', this._spectatorPointerDownHandler);
            }
            if (this._spectatorPointerMoveHandler) {
                this.renderer.domElement.removeEventListener('pointermove', this._spectatorPointerMoveHandler);
            }
            if (this._spectatorPointerUpHandler) {
                this.renderer.domElement.removeEventListener('pointerup', this._spectatorPointerUpHandler);
            }
            if (this._spectatorPointerCancelHandler) {
                this.renderer.domElement.removeEventListener('pointercancel', this._spectatorPointerCancelHandler);
            }
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentNode) {
                this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
            }
        }
        if (this._spectatorKeyDownHandler) {
            window.removeEventListener('keydown', this._spectatorKeyDownHandler);
        }
        if (this._spectatorKeyUpHandler) {
            window.removeEventListener('keyup', this._spectatorKeyUpHandler);
        }
    }
}
