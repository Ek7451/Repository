import { getTemplate } from '../core/sports-templates.js';
import {
    buildActiveTierSolvers,
    buildNextTierDefaultsFromSolvers,
    buildTierMetricsByIndex
} from '../core/profile-solver.js';
import {
    buildBowlConfig,
    buildEgressParams,
    buildFieldVisibility,
    buildFocalPointFt,
    buildPrimaryTierParameters,
    buildSceneSeatPreviewOptions,
    getCustomRunoff,
    getRunoffDistance
} from '../state/app-state.js';
import { buildStatsViewModel } from './stats-panel.js';

function filterActiveSolvers(solvers = []) {
    return (solvers || []).filter((solver) => solver && Array.isArray(solver.rows) && solver.rows.length > 0);
}

function clampClipPosition(state, clipRange) {
    if (!state?.bowl || !clipRange) return null;

    let currentPosition = Number(state.bowl.clipPosition);
    if (!Number.isFinite(currentPosition)) currentPosition = 0;

    const clampedPosition = Math.max(clipRange.min, Math.min(clipRange.max, currentPosition));
    if (clampedPosition !== currentPosition) {
        state.bowl.clipPosition = clampedPosition;
    }

    return {
        min: clipRange.min,
        max: clipRange.max,
        value: clampedPosition
    };
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

    recompute({ state, fieldRenderer } = {}) {
        const template = this._resolveTemplate(state);
        const customRunoff = getCustomRunoff(state);
        const focalPointFt = buildFocalPointFt(state);
        const structuralDepth = Number(state?.bowl?.structuralDepth) || 0;
        const solvers = buildActiveTierSolvers(state?.tiers, focalPointFt);
        const activeSolvers = filterActiveSolvers(solvers);
        const bowlConfig = buildBowlConfig(state, template);
        const egressParams = buildEgressParams(state);
        const visibility = buildFieldVisibility(state);
        const seatPreviewOptions = buildSceneSeatPreviewOptions(state);

        let offsetCorrection = 0;
        let visualFocalY = 0;
        let tierMetricsByIndex = new Map();
        let tierAisleLayouts = [];
        let clipRange = null;

        if (fieldRenderer && bowlConfig) {
            offsetCorrection = fieldRenderer.getOffsetCorrection(bowlConfig, state?.sport);
            const rawClipRange = fieldRenderer.getClipPositionRange(
                solvers,
                bowlConfig,
                state?.bowl?.clipAxis,
                offsetCorrection
            );
            clipRange = clampClipPosition(state, rawClipRange);
            visualFocalY = fieldRenderer.getVisualFocalY(template, focalPointFt, state?.sport);
            tierMetricsByIndex = buildTierMetricsByIndex({
                solvers,
                bowlConfig,
                egressParams,
                offsetCorrection,
                calculateRowLength: (nextBowlConfig, offset) => fieldRenderer.calculateRowLength(nextBowlConfig, offset)
            });
            tierAisleLayouts = fieldRenderer.buildTierAisleLayouts(
                solvers,
                bowlConfig,
                tierMetricsByIndex,
                offsetCorrection,
                egressParams
            ) || [];
        }

        this._solvers = solvers;
        this._tierAisleLayouts = tierAisleLayouts;
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
            seatPreviewOptions,
            clipRange,
            offsetCorrection,
            scene3DInput: {
                template,
                customRunoff,
                focalZ: focalPointFt.z,
                solvers,
                bowlConfig,
                offsetCorrection,
                tierAisleLayouts,
                seatPreviewOptions
            },
            statsViewModel: buildStatsViewModel({
                solvers,
                focalPointFt,
                bowlConfig,
                egressParams,
                tierMetricsByIndex,
                tierAisleLayouts
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
        const template = this._resolveTemplate(state);
        const structuralDepth = Number(state?.bowl?.structuralDepth) || 0;

        return {
            stateJson: typeof state?.toJSON === 'function' ? state.toJSON() : null,
            sportName: state?.sport || '',
            template,
            solvers: this._solvers || [],
            activeSolvers: this.getActiveSolvers(),
            bowlConfig: buildBowlConfig(state, template),
            egressParams: buildEgressParams(state),
            focalPointFt: buildFocalPointFt(state),
            primaryTierParameters: buildPrimaryTierParameters(state),
            runoffDistance: getRunoffDistance(state, template),
            tierAisleLayouts: this._tierAisleLayouts || [],
            structuralDepthFt: structuralDepth / 12.0,
            offsetCorrection: Number(this._snapshot?.offsetCorrection) || 0
        };
    }

    _resolveTemplate(state) {
        const nextSport = getTemplate(state?.sport) ? state.sport : 'Football';
        if (state && nextSport !== state.sport) {
            state.sport = nextSport;
        }

        this._template = getTemplate(nextSport);
        return this._template;
    }
}
