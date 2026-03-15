import { ProfileSolver } from '../core/profile-solver.js';
import { buildPlanDxfExportDescriptor, buildProfileDxfExportDescriptor } from '../export/dxf-exporter.js';
import {
    buildConfigExportDescriptor,
    buildObjExportDescriptor,
    buildStudyResultsJsonExportDescriptor,
    buildTierMetricsCsvExportDescriptor
} from '../export/obj-csv-exporter.js';
import { buildRhinoExportDescriptor } from '../export/rhino/rhino-exporter.js';

function getSolverTierIndex(solver, fallbackIndex = 0) {
    const tierIndex = Number(solver?.tierIndex);
    return Number.isInteger(tierIndex) ? tierIndex : fallbackIndex;
}

export class EditorExportController {
    constructor(options = {}) {
        const settings = /** @type {{
            getActiveSolvers?: (() => Array<object>),
            getBowlConfig?: (() => object | null),
            getCurrentTemplate?: (() => object | null),
            getEgressParams?: (() => object | null),
            getFieldRenderer?: (() => object | null),
            getFocalPointFt?: (() => { x: number, z: number }),
            getOffsetCorrection?: ((bowlConfig: object | null, sportName?: string) => number),
            getPrimaryTierParameters?: (() => object | null),
            getRunoffDistance?: (() => number),
            getScene3D?: (() => object | null),
            getSceneExportData?: (() => object | null),
            getSportName?: (() => string),
            getState?: (() => object | null),
            getTierAisleLayouts?: (() => Array<object>)
        }} */ (options && typeof options === 'object' ? options : {});

        this._getActiveSolvers = typeof settings.getActiveSolvers === 'function'
            ? settings.getActiveSolvers
            : () => [];
        this._getBowlConfig = typeof settings.getBowlConfig === 'function'
            ? settings.getBowlConfig
            : () => null;
        this._getCurrentTemplate = typeof settings.getCurrentTemplate === 'function'
            ? settings.getCurrentTemplate
            : () => null;
        this._getEgressParams = typeof settings.getEgressParams === 'function'
            ? settings.getEgressParams
            : () => ({});
        this._getFieldRenderer = typeof settings.getFieldRenderer === 'function'
            ? settings.getFieldRenderer
            : () => null;
        this._getFocalPointFt = typeof settings.getFocalPointFt === 'function'
            ? settings.getFocalPointFt
            : () => ({ x: 0, z: 0 });
        this._getOffsetCorrection = typeof settings.getOffsetCorrection === 'function'
            ? settings.getOffsetCorrection
            : () => 0;
        this._getPrimaryTierParameters = typeof settings.getPrimaryTierParameters === 'function'
            ? settings.getPrimaryTierParameters
            : () => null;
        this._getRunoffDistance = typeof settings.getRunoffDistance === 'function'
            ? settings.getRunoffDistance
            : () => 0;
        this._getScene3D = typeof settings.getScene3D === 'function'
            ? settings.getScene3D
            : () => null;
        this._getSceneExportData = typeof settings.getSceneExportData === 'function'
            ? settings.getSceneExportData
            : () => null;
        this._getSportName = typeof settings.getSportName === 'function'
            ? settings.getSportName
            : () => '';
        this._getState = typeof settings.getState === 'function'
            ? settings.getState
            : () => null;
        this._getTierAisleLayouts = typeof settings.getTierAisleLayouts === 'function'
            ? settings.getTierAisleLayouts
            : () => [];

        this._rhino3dmPromise = null;
    }

    async buildDescriptor(kind) {
        const state = this._getState();
        const solvers = this._getActiveSolvers();
        const sportName = this._getSportName();

        switch (kind) {
        case 'json':
            return this._buildStudyResultsExportDescriptor(solvers, sportName, state);
        case 'obj':
            return buildObjExportDescriptor({
                bowlMeshes: this._getSceneExportData()?.bowlMeshes || [],
                sportName,
                objectName: 'SeatingBowl'
            });
        case 'rhino':
            return this._buildRhinoSceneExportDescriptor(solvers, sportName);
        case 'profile-dxf':
            return buildProfileDxfExportDescriptor({
                solvers,
                structuralDepthFt: (Number(state?.bowl?.structuralDepth) || 0) / 12.0,
                focalPointFt: this._getFocalPointFt(),
                sportName
            });
        case 'plan-dxf':
            return this._buildPlanDxfDescriptor(solvers, sportName);
        case 'csv':
            return buildTierMetricsCsvExportDescriptor({
                solvers,
                focalPointFt: this._getFocalPointFt(),
                sportName
            });
        case 'config':
            return buildConfigExportDescriptor({
                config: typeof state?.toJSON === 'function' ? state.toJSON() : null
            });
        default:
            return null;
        }
    }

    _buildStudyResultsExportDescriptor(solvers, sportName, state) {
        const bowlConfig = this._getBowlConfig();
        const egressParams = this._getEgressParams();

        return buildStudyResultsJsonExportDescriptor({
            solvers,
            sportName,
            profileType: state?.tiers?.[0]?.profileType || 'Parabolic',
            template: this._getCurrentTemplate(),
            bowlConfig,
            egressParams,
            focalPointFt: this._getFocalPointFt(),
            primaryTierParameters: this._getPrimaryTierParameters(),
            tierArtifacts: this._buildTierRuntimeArtifacts(solvers, bowlConfig, egressParams, sportName)
        });
    }

    _buildPlanDxfDescriptor(solvers, sportName) {
        const bowlConfig = this._getBowlConfig();
        const egressParams = this._getEgressParams();
        const tierPlanArtifacts = this._buildTierRuntimeArtifacts(solvers, bowlConfig, egressParams, sportName).map((artifact) => ({
            tierIndex: artifact.tierIndex,
            rowGeometries: artifact.rowGeometries,
            aislePolygons: artifact.aislePolygons,
            overlayData: artifact.overlayData
        }));

        return buildPlanDxfExportDescriptor({
            template: this._getCurrentTemplate(),
            runoffFt: this._getRunoffDistance(),
            visualFocalXFt: this._getFocalPointFt().x,
            tierPlanArtifacts,
            sportName
        });
    }

    _buildTierRuntimeArtifacts(solvers, bowlConfig, egressParams, sportName) {
        const fieldRenderer = this._getFieldRenderer();
        if (!fieldRenderer) return [];

        const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);
        const tierLayoutMap = new Map(
            (this._getTierAisleLayouts() || []).map((layout, index) => [getSolverTierIndex(layout, index), layout])
        );

        return (solvers || []).map((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return null;

            const tierIndex = getSolverTierIndex(solver, index);
            const tierMetrics = ProfileSolver.calculateTierMetrics(
                solver,
                bowlConfig,
                fieldRenderer,
                egressParams,
                offsetCorrection
            );

            let tierLayout = tierLayoutMap.get(tierIndex) || null;
            if (!tierLayout && tierMetrics) {
                tierLayout = fieldRenderer.generateTierAisleLayout(
                    solver,
                    bowlConfig,
                    tierMetrics,
                    offsetCorrection,
                    egressParams
                );
                if (tierLayout) {
                    tierLayout.tierIndex = tierIndex;
                }
            }

            const overlayData = tierLayout
                ? fieldRenderer.getTierSectionMetricsOverlayData(solver, bowlConfig, tierLayout, offsetCorrection)
                : { sectionLabels: [], rowSeatLabels: [] };
            const aislePolygons = tierLayout
                ? fieldRenderer.getTierAisleBandPolygons(solver, bowlConfig, tierLayout, offsetCorrection)
                : [];
            const rowGeometries = solver.rows.map((row) => {
                const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
                return fieldRenderer.getBowlGeometrySegments(bowlConfig, frontOffset);
            });

            return {
                tierIndex,
                tierMetrics,
                tierLayout,
                overlayData,
                aislePolygons,
                rowGeometries
            };
        }).filter(Boolean);
    }

    _buildRhinoTierArtifacts(solvers, bowlConfig, sportName) {
        const scene3D = this._getScene3D();
        if (!scene3D) return [];

        const offsetCorrection = this._getOffsetCorrection(bowlConfig, sportName);
        const structuralDepthFt = Math.max(0, (Number(bowlConfig?.structuralDepth) || 0) / 12.0);

        return (solvers || []).map((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return null;

            const tierIndex = getSolverTierIndex(solver, index);
            const offsetSet = new Set();
            solver.rows.forEach((row) => {
                offsetSet.add((row.x - row.tread_depth) - offsetCorrection);
                offsetSet.add(row.x - offsetCorrection);
            });

            let structuralProfile = null;
            if (structuralDepthFt > 0 && typeof scene3D?.buildClosedStructuralProfile === 'function') {
                structuralProfile = scene3D.buildClosedStructuralProfile(solver, structuralDepthFt, tierIndex);
                if (Array.isArray(structuralProfile)) {
                    structuralProfile.forEach((point) => {
                        if (point && Number.isFinite(point.x)) {
                            offsetSet.add(point.x - offsetCorrection);
                        }
                    });
                }
            }

            const bowlGeometryByOffset = Array.from(offsetSet)
                .filter((offset) => Number.isFinite(offset))
                .map((offsetFt) => ({
                    offsetFt,
                    segments: scene3D.getBowlGeometrySegments(bowlConfig, offsetFt)
                }));

            return {
                tierIndex,
                structuralProfile: Array.isArray(structuralProfile) ? structuralProfile : null,
                bowlGeometryByOffset
            };
        }).filter(Boolean);
    }

    async _buildRhinoSceneExportDescriptor(solvers, sportName) {
        const sceneExportData = this._getSceneExportData();
        if (!sceneExportData?.bowlMeshes?.length) {
            return buildRhinoExportDescriptor({
                sportName,
                sceneExportData
            });
        }

        const bowlConfig = this._getBowlConfig();
        const rhino = await this._loadRhino3dm();

        return buildRhinoExportDescriptor({
            rhino,
            solvers,
            bowlConfig,
            sportName,
            nativeSpectatorBlockLimit: Number(globalThis?.__SBS_RHINO_NATIVE_SPECTATOR_MAX_BLOCKS),
            tierArtifacts: this._buildRhinoTierArtifacts(solvers, bowlConfig, sportName),
            sceneExportData
        });
    }

    async _loadRhino3dm() {
        if (this._rhino3dmPromise) return this._rhino3dmPromise;

        const sources = [
            { script: './lib/rhino3dm.js', base: './lib/' },
            { script: 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/rhino3dm.js', base: 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/' },
            { script: 'https://unpkg.com/rhino3dm@8.17.0/rhino3dm.js', base: 'https://unpkg.com/rhino3dm@8.17.0/' }
        ];

        const initFromGlobal = async (wasmBase) => {
            const initRhino = /** @type {any} */ (window).rhino3dm;
            if (typeof initRhino !== 'function') {
                throw new Error('rhino3dm.js did not expose window.rhino3dm');
            }
            const rhino = await initRhino({
                locateFile: (file) => `${wasmBase}${file}`
            });
            if (!rhino || typeof rhino.File3dm !== 'function') {
                throw new Error('rhino3dm initialization returned an invalid module');
            }
            return rhino;
        };

        this._rhino3dmPromise = (async () => {
            const errors = [];

            if (typeof /** @type {any} */ (window).rhino3dm === 'function') {
                for (const source of sources) {
                    try {
                        return await initFromGlobal(source.base);
                    } catch (err) {
                        errors.push(`init ${source.base}: ${err && err.message ? err.message : err}`);
                    }
                }
            }

            for (const source of sources) {
                try {
                    await this._loadScriptOnce(source.script);
                    return await initFromGlobal(source.base);
                } catch (err) {
                    errors.push(`${source.script}: ${err && err.message ? err.message : err}`);
                }
            }

            throw new Error(`unable to load rhino3dm. ${errors.join(' | ')}`);
        })().catch((err) => {
            this._rhino3dmPromise = null;
            throw err;
        });

        return this._rhino3dmPromise;
    }

    _loadScriptOnce(src) {
        const absoluteSrc = new URL(src, window.location.href).href;
        const existing = Array.from(document.querySelectorAll('script')).find((script) => script.src === absoluteSrc);
        if (existing) {
            if (existing.dataset && existing.dataset.loaded === 'true') return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load script ${absoluteSrc}`)), { once: true });
            });
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            if (/^https?:\/\//i.test(src)) {
                script.crossOrigin = 'anonymous';
                script.referrerPolicy = 'no-referrer';
            }
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            script.addEventListener('error', () => {
                reject(new Error(`Failed to load script ${src}`));
            }, { once: true });
            document.head.appendChild(script);
        });
    }
}
