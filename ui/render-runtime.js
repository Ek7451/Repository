import {
    buildActiveTierSolvers,
    buildNextTierDefaultsFromSolvers,
    buildTierMetricsByIndexFromLayouts
} from '../core/profile-solver.js';
import { buildConfigurationAisleSummary } from '../core/aisle-layout.js';
import {
    buildAccessibilityParams,
    buildBowlConfig,
    buildEgressParams,
    buildFieldVisibility,
    buildFocalPointFt,
    buildProfileRenderOptions,
    buildPrimaryTierParameters,
    buildSceneSeatPreviewOptions,
    getCustomRunoff,
    getRunoffDistance,
    resolveSportName,
    resolveSportTemplate
} from '../state/app-state.js';
import { buildStatsViewModel } from './stats-view-model.js';

function filterActiveSolvers(solvers = []) {
    return (solvers || []).filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
}

export class RenderRuntime {
    constructor() {
        this.reset();
    }

    reset() {
        this._template = null;
        this._solvers = [];
        this._tierAisleLayouts = [];
        this._snapshot = null;
    }

    /**
     * @param {{
     *   state?: {
     *     sport?: string,
     *     bowl?: {
     *       structuralDepth?: number
     *     },
     *     tiers?: Array<unknown>
     *   },
     *   fieldGeometryPort?: {
     *     getOffsetCorrection(bowlConfig: unknown, sport: unknown): number,
     *     getVisualFocalY(template: unknown, focalPointFt: { x: number, z: number }, sport: unknown): number,
     *     calculateRowLength(bowlConfig: unknown, offsetCorrection: number): number,
     *     buildTierAisleLayouts(
     *       solvers: unknown[],
     *       bowlConfig: unknown,
     *       tierMetricsByIndex: Map<number, unknown> | null,
     *       offsetCorrection: number,
     *       egressParams: unknown
     *     ): unknown[]
     *   } | null
     * }} [options]
     */
    recompute({ state, fieldGeometryPort } = {}) {
        const sportName = resolveSportName(state);
        const template = resolveSportTemplate(sportName);
        this._template = template;
        const customRunoff = getCustomRunoff(state);
        const focalPointFt = buildFocalPointFt(state);
        const structuralDepth = Number(state?.bowl?.structuralDepth) || 0;
        const solvers = buildActiveTierSolvers(state?.tiers, focalPointFt);
        const activeSolvers = filterActiveSolvers(solvers);
        let bowlConfig = buildBowlConfig(state, template);
        const egressParams = buildEgressParams(state);
        const visibility = buildFieldVisibility(state);
        const seatPreviewOptions = buildSceneSeatPreviewOptions(state);

        let offsetCorrection = 0;
        let visualFocalY = 0;
        let tierMetricsByIndex = new Map();
        let tierAisleLayouts = [];
        const accessibilityParams = buildAccessibilityParams(state);
        let configurationSummary = buildConfigurationAisleSummary({
            tierLayouts: tierAisleLayouts,
            accessibilityParams
        });

        if (fieldGeometryPort && bowlConfig) {
            offsetCorrection = fieldGeometryPort.getOffsetCorrection(bowlConfig, sportName);
            visualFocalY = fieldGeometryPort.getVisualFocalY(template, focalPointFt, sportName);
            tierAisleLayouts = fieldGeometryPort.buildTierAisleLayouts(
                solvers,
                bowlConfig,
                null,
                offsetCorrection,
                egressParams
            ) || [];
            configurationSummary = buildConfigurationAisleSummary({
                tierLayouts: tierAisleLayouts,
                accessibilityParams
            });
            tierMetricsByIndex = buildTierMetricsByIndexFromLayouts({
                tierLayouts: tierAisleLayouts,
                egressParams,
                solvers,
                configurationSummary
            });
        }

        this._solvers = solvers;
        this._tierAisleLayouts = tierAisleLayouts;
        const scene3DSolvers = visibility.showSeating ? solvers : null;
        const scene3DTierAisleLayouts = visibility.showSeating ? tierAisleLayouts : [];
        this._snapshot = {
            template,
            customRunoff,
            focalPointFt,
            structuralDepth,
            solvers,
            activeSolvers,
            bowlConfig,
            egressParams,
            visibility,
            visualFocalY,
            tierMetricsByIndex,
            tierAisleLayouts,
            configurationSummary,
            seatPreviewOptions,
            offsetCorrection,
            fieldRenderInput: {
                template,
                customRunoff,
                solvers,
                visibility,
                visualFocalY,
                bowlConfig,
                offsetCorrection,
                tierAisleLayouts
            },
            profileRenderInput: {
                solvers,
                focalPointFt,
                options: buildProfileRenderOptions(state, structuralDepth)
            },
            scene3DInput: {
                template,
                customRunoff,
                focalPointFt,
                focalZ: focalPointFt.z,
                solvers: scene3DSolvers,
                bowlConfig,
                offsetCorrection,
                tierAisleLayouts: scene3DTierAisleLayouts,
                seatPreviewOptions
            },
            statsViewModel: buildStatsViewModel({
                solvers,
                focalPointFt,
                bowlConfig,
                egressParams,
                tierMetricsByIndex,
                configurationSummary
            })
        };

        return this._snapshot;
    }

    getSnapshot() {
        return this._snapshot;
    }

    getActiveSolvers() {
        return filterActiveSolvers(this._solvers);
    }

    getTierDefaults(tierNum) {
        return buildNextTierDefaultsFromSolvers(this._solvers, tierNum);
    }

    getExportContext(state) {
        const sportName = resolveSportName(state);
        const template = resolveSportTemplate(sportName);
        this._template = template;
        const structuralDepth = Number(state?.bowl?.structuralDepth) || 0;

        return {
            stateJson: typeof state?.toJSON === 'function' ? state.toJSON() : null,
            sportName,
            template,
            solvers: this._solvers || [],
            activeSolvers: this.getActiveSolvers(),
            bowlConfig: buildBowlConfig(state, template),
            egressParams: buildEgressParams(state),
            focalPointFt: buildFocalPointFt(state),
            primaryTierParameters: buildPrimaryTierParameters(state),
            runoffDistance: getRunoffDistance(state, template),
            tierAisleLayouts: this._tierAisleLayouts || [],
            configurationSummary: this._snapshot?.configurationSummary || buildConfigurationAisleSummary({
                tierLayouts: this._tierAisleLayouts || [],
                accessibilityParams: buildAccessibilityParams(state)
            }),
            structuralDepthFt: structuralDepth / 12.0,
            offsetCorrection: Number(this._snapshot?.offsetCorrection) || 0
        };
    }
}
