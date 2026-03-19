import {
    buildStructuralProfileGeometry,
    getSolverTierIndex,
    buildTierMetricsByIndexFromLayouts
} from '../core/profile-solver.js';
import { buildPlanDxfExportDescriptor, buildProfileDxfExportDescriptor } from '../export/dxf-exporter.js';
import {
    buildConfigExportDescriptor,
    buildObjExportDescriptor,
    buildStudyResultsJsonExportDescriptor,
    buildTierMetricsCsvExportDescriptor
} from '../export/obj-csv-exporter.js';
import { buildRhinoExportDescriptor } from '../export/rhino/rhino-exporter.js';

export class EditorExportController {
    constructor(options = {}) {
        const settings = /** @type {{
            getExportContext?: (() => {
                stateJson?: object | null,
                sportName?: string,
                template?: object | null,
                runoffDistance?: number,
                focalPointFt?: { x: number, z: number },
                bowlConfig?: object | null,
                egressParams?: object | null,
                primaryTierParameters?: object | null,
                solvers?: Array<object>,
                activeSolvers?: Array<object>,
                tierAisleLayouts?: Array<object>,
                configurationSummary?: object | null,
                structuralDepthFt?: number,
                offsetCorrection?: number
            } | null),
            getFieldGeometryPort?: (() => object | null),
            getSceneGeometryPort?: (() => object | null)
        }} */ (options && typeof options === 'object' ? options : {});

        this._getExportContext = typeof settings.getExportContext === 'function'
            ? settings.getExportContext
            : () => null;
        this._getFieldGeometryPort = typeof settings.getFieldGeometryPort === 'function'
            ? settings.getFieldGeometryPort
            : () => null;
        this._getSceneGeometryPort = typeof settings.getSceneGeometryPort === 'function'
            ? settings.getSceneGeometryPort
            : () => null;

        this._rhino3dmPromise = null;
    }

    async buildDescriptor(kind) {
        const exportContext = this._getNormalizedExportContext();
        const solvers = exportContext.activeSolvers;
        const sportName = exportContext.sportName;

        switch (kind) {
        case 'json':
            return this._buildStudyResultsExportDescriptor(exportContext);
        case 'obj':
            return this._buildObjDescriptor(sportName);
        case 'rhino':
            return this._buildRhinoDescriptor(exportContext);
        case 'profile-dxf':
            return buildProfileDxfExportDescriptor({
                solvers,
                structuralDepthFt: exportContext.structuralDepthFt,
                structuralProfileMode: exportContext.bowlConfig?.structuralProfileMode,
                focalPointFt: exportContext.focalPointFt,
                sportName
            });
        case 'plan-dxf':
            return this._buildPlanDxfDescriptor(exportContext);
        case 'csv':
            return buildTierMetricsCsvExportDescriptor({
                solvers,
                focalPointFt: exportContext.focalPointFt,
                sportName
            });
        case 'config':
            return buildConfigExportDescriptor({
                config: exportContext.stateJson
            });
        default:
            return null;
        }
    }

    _buildObjDescriptor(sportName) {
        const sceneGeometryPort = this._getSceneGeometryPort() || null;
        const sceneExportData = sceneGeometryPort?.getExportSceneData?.() || null;

        return buildObjExportDescriptor({
            bowlMeshes: sceneExportData?.bowlMeshes || [],
            sportName,
            objectName: 'SeatingBowl'
        });
    }

    async _buildRhinoDescriptor(exportContext) {
        const sceneGeometryPort = this._getSceneGeometryPort() || null;
        const sceneExportData = sceneGeometryPort?.getExportSceneData?.() || null;
        return this._buildRhinoSceneExportDescriptor(exportContext, sceneExportData);
    }

    _buildStudyResultsExportDescriptor(exportContext) {
        return buildStudyResultsJsonExportDescriptor({
            solvers: exportContext.activeSolvers,
            sportName: exportContext.sportName,
            profileType: exportContext.stateJson?.tiers?.[0]?.profileType || 'Parabolic',
            template: exportContext.template,
            bowlConfig: exportContext.bowlConfig,
            egressParams: exportContext.egressParams,
            focalPointFt: exportContext.focalPointFt,
            primaryTierParameters: exportContext.primaryTierParameters,
            configurationSummary: exportContext.configurationSummary,
            tierArtifacts: this._buildTierRuntimeArtifacts(exportContext)
        });
    }

    _buildPlanDxfDescriptor(exportContext) {
        const tierPlanArtifacts = this._buildTierRuntimeArtifacts(exportContext).map((artifact) => ({
            tierIndex: artifact.tierIndex,
            rowGeometries: artifact.rowGeometries,
            aislePolygons: artifact.aislePolygons,
            overlayData: artifact.overlayData
        }));

        return buildPlanDxfExportDescriptor({
            template: exportContext.template,
            runoffFt: exportContext.runoffDistance,
            visualFocalXFt: exportContext.focalPointFt.x,
            tierPlanArtifacts,
            sportName: exportContext.sportName
        });
    }

    _buildTierRuntimeArtifacts(exportContext) {
        const fieldGeometryPort = this._getFieldGeometryPort();
        if (!fieldGeometryPort) return [];

        const tierLayoutMap = new Map(
            (exportContext.tierAisleLayouts || []).map((layout, index) => [getSolverTierIndex(layout, index), layout])
        );

        const tierArtifacts = (exportContext.activeSolvers || []).map((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return null;

            const tierIndex = getSolverTierIndex(solver, index);
            let tierLayout = tierLayoutMap.get(tierIndex) || null;
            if (!tierLayout) {
                tierLayout = fieldGeometryPort.generateTierAisleLayout(
                    solver,
                    exportContext.bowlConfig,
                    null,
                    exportContext.offsetCorrection,
                    exportContext.egressParams
                );
                if (tierLayout) {
                    tierLayout.tierIndex = tierIndex;
                }
            }

            const overlayData = tierLayout
                ? fieldGeometryPort.getTierSectionMetricsOverlayData(
                    solver,
                    exportContext.bowlConfig,
                    tierLayout,
                    exportContext.offsetCorrection
                )
                : { sectionLabels: [], rowSeatLabels: [] };
            const aislePolygons = tierLayout
                ? fieldGeometryPort.getTierAisleBandPolygons(
                    solver,
                    exportContext.bowlConfig,
                    tierLayout,
                    exportContext.offsetCorrection
                )
                : [];
            const rowGeometries = solver.rows.map((row) => {
                const frontOffset = (row.x - row.tread_depth) - exportContext.offsetCorrection;
                return fieldGeometryPort.getBowlGeometrySegments(exportContext.bowlConfig, frontOffset);
            });

            return {
                tierIndex,
                tierMetricsEstimate: null,
                tierLayout,
                overlayData,
                aislePolygons,
                rowGeometries
            };
        }).filter(Boolean);

        const tierMetricsByIndex = buildTierMetricsByIndexFromLayouts({
            tierLayouts: tierArtifacts.map((artifact) => artifact.tierLayout).filter(Boolean),
            egressParams: exportContext.egressParams,
            solvers: exportContext.activeSolvers
        });

        return tierArtifacts.map((artifact) => ({
            ...artifact,
            tierMetrics: tierMetricsByIndex.get(artifact.tierIndex) || null
        }));
    }

    _buildRhinoTierArtifacts(exportContext) {
        const sceneGeometryPort = this._getSceneGeometryPort();
        if (!sceneGeometryPort) return [];

        const structuralDepthFt = Math.max(0, Number(exportContext.structuralDepthFt) || 0);

        return (exportContext.activeSolvers || []).map((solver, index) => {
            if (!solver?.rows || solver.rows.length === 0) return null;

            const tierIndex = getSolverTierIndex(solver, index);
            const offsetSet = new Set();
            solver.rows.forEach((row) => {
                offsetSet.add((row.x - row.tread_depth) - exportContext.offsetCorrection);
                offsetSet.add(row.x - exportContext.offsetCorrection);
            });

            let structuralProfile = null;
            if (structuralDepthFt > 0) {
                structuralProfile = buildStructuralProfileGeometry(solver, {
                    structuralDepthFt,
                    structuralProfileMode: exportContext.bowlConfig?.structuralProfileMode,
                    tierIndex
                })?.closedProfile ?? null;
                if (Array.isArray(structuralProfile)) {
                    structuralProfile.forEach((point) => {
                        if (point && Number.isFinite(point.x)) {
                            offsetSet.add(point.x - exportContext.offsetCorrection);
                        }
                    });
                }
            }

            const bowlGeometryByOffset = Array.from(offsetSet)
                .filter((offset) => Number.isFinite(offset))
                .map((offsetFt) => ({
                    offsetFt,
                    segments: sceneGeometryPort.getBowlGeometrySegments(exportContext.bowlConfig, offsetFt)
                }));

            return {
                tierIndex,
                structuralProfile: Array.isArray(structuralProfile) ? structuralProfile : null,
                bowlGeometryByOffset
            };
        }).filter(Boolean);
    }

    async _buildRhinoSceneExportDescriptor(exportContext, sceneExportData) {
        if (!sceneExportData?.bowlMeshes?.length) {
            return buildRhinoExportDescriptor({
                sportName: exportContext.sportName,
                sceneExportData
            });
        }

        const rhino = await this._loadRhino3dm();

        return buildRhinoExportDescriptor({
            rhino,
            solvers: exportContext.activeSolvers,
            bowlConfig: exportContext.bowlConfig,
            sportName: exportContext.sportName,
            nativeSpectatorBlockLimit: Number(globalThis?.__SBS_RHINO_NATIVE_SPECTATOR_MAX_BLOCKS),
            tierArtifacts: this._buildRhinoTierArtifacts(exportContext),
            sceneExportData
        });
    }

    _getNormalizedExportContext() {
        const context = this._getExportContext();
        return {
            stateJson: context?.stateJson ?? null,
            sportName: context?.sportName ?? '',
            template: context?.template ?? null,
            runoffDistance: Number(context?.runoffDistance) || 0,
            focalPointFt: context?.focalPointFt ?? { x: 0, z: 0 },
            bowlConfig: context?.bowlConfig ?? null,
            egressParams: context?.egressParams ?? {},
            primaryTierParameters: context?.primaryTierParameters ?? null,
            solvers: Array.isArray(context?.solvers) ? context.solvers : [],
            activeSolvers: Array.isArray(context?.activeSolvers) ? context.activeSolvers : [],
            tierAisleLayouts: Array.isArray(context?.tierAisleLayouts) ? context.tierAisleLayouts : [],
            configurationSummary: context?.configurationSummary ?? null,
            structuralDepthFt: Number(context?.structuralDepthFt) || 0,
            offsetCorrection: Number(context?.offsetCorrection) || 0
        };
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
