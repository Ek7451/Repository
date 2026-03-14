import {
    addRhinoModelObject,
    addRhinoRuledBrepsBetweenOffsets,
    createRhinoMeshFromThreeInstancedMeshInstance,
    createRhinoMeshFromThreeMesh,
    exportRhinoQuadPatchBrepsFromMesh,
    exportRhinoSpectatorBlocksFromInstancedMesh,
    parseBowlGeometrySubpaths
} from './rhino-geometry.js';
import {
    ensureRhinoTierCategoryLayers,
    getRhinoTierIndexFromObject,
    getRhinoTierLabel,
    getRhinoTierLayerIndex
} from './rhino-layers.js';

const EDGE_SPORTS = ['Ice Hockey', 'Football', 'Concert', 'Soccer', 'Basketball'];

export function getRhinoExportOffsetCorrection(bowlConfig, sportName) {
    const safeWidth = Number.isFinite(bowlConfig?.width) ? bowlConfig.width : 0;
    return EDGE_SPORTS.includes(sportName) ? 0 : (safeWidth / 2);
}

function getTierArtifactMap(tierArtifacts = []) {
    const artifactMap = new Map();
    (tierArtifacts || []).forEach((artifact, index) => {
        const tierIndex = Number(artifact?.tierIndex);
        artifactMap.set(Number.isInteger(tierIndex) ? tierIndex : index, artifact);
    });
    return artifactMap;
}

function createTierSubpathLookup(tierArtifact) {
    const subpathMap = new Map();
    (tierArtifact?.bowlGeometryByOffset || []).forEach((entry) => {
        const offsetFt = Number(entry?.offsetFt);
        if (!Number.isFinite(offsetFt)) return;
        subpathMap.set(offsetFt.toFixed(6), parseBowlGeometrySubpaths(entry?.segments));
    });

    return (offset) => subpathMap.get(Number(offset).toFixed(6)) || [];
}

function exportRhinoTierSeatBreps(rhino, model, solver, offsetCorrection, tierIndex, layerIndex, tierArtifact) {
    if (!solver?.rows || solver.rows.length === 0) return 0;
    const getSubpathsForOffset = createTierSubpathLookup(tierArtifact);

    let count = 0;
    solver.rows.forEach((row) => {
        const zBottom = row.z - row.riser_height;
        const zTop = row.z;
        const frontOffset = (row.x - row.tread_depth) - offsetCorrection;
        const backOffset = row.x - offsetCorrection;

        count += addRhinoRuledBrepsBetweenOffsets(
            rhino, model, getSubpathsForOffset,
            frontOffset, zBottom, frontOffset, zTop,
            `Tier ${tierIndex + 1} Riser`, layerIndex
        );
        count += addRhinoRuledBrepsBetweenOffsets(
            rhino, model, getSubpathsForOffset,
            frontOffset, zTop, backOffset, zTop,
            `Tier ${tierIndex + 1} Tread`, layerIndex
        );
    });

    return count;
}

function exportRhinoTierStructuralBreps(rhino, model, solver, offsetCorrection, tierIndex, layerIndex, tierArtifact) {
    if (!solver?.rows || solver.rows.length === 0) return 0;
    const profile = tierArtifact?.structuralProfile;
    if (!Array.isArray(profile) || profile.length < 2) return 0;
    const getSubpathsForOffset = createTierSubpathLookup(tierArtifact);

    let count = 0;
    for (let i = 0; i < profile.length - 1; i++) {
        const a = profile[i];
        const b = profile[i + 1];
        if (!a || !b) continue;
        if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) continue;

        count += addRhinoRuledBrepsBetweenOffsets(
            rhino, model, getSubpathsForOffset,
            a.x - offsetCorrection, a.z, b.x - offsetCorrection, b.z,
            `Tier ${tierIndex + 1} Structure`, layerIndex
        );
    }

    return count;
}

function exportRhinoBrepBowl(rhino, model, solvers, bowlConfig, offsetCorrection, tierLayerIndices, tierArtifactMap) {
    if (!Array.isArray(solvers) || solvers.length === 0) return 0;

    let count = 0;
    const structuralDepthFt = Math.max(0, (Number(bowlConfig?.structuralDepth) || 0) / 12.0);

    solvers.forEach((solver, idx) => {
        if (!solver?.rows || solver.rows.length === 0) return;
        const tierLayerIndex = Array.isArray(tierLayerIndices) ? tierLayerIndices[idx] : undefined;
        const rawTierIndex = Number(solver?.tierIndex);
        const solverTierIndex = Number.isInteger(rawTierIndex) ? rawTierIndex : idx;
        const tierArtifact = tierArtifactMap instanceof Map ? tierArtifactMap.get(solverTierIndex) : null;
        if (!tierArtifact) return;

        if (structuralDepthFt > 0 && Array.isArray(tierArtifact?.structuralProfile) && tierArtifact.structuralProfile.length > 1) {
            count += exportRhinoTierStructuralBreps(
                rhino, model, solver, offsetCorrection, solverTierIndex, tierLayerIndex, tierArtifact
            );
            return;
        }

        count += exportRhinoTierSeatBreps(
            rhino, model, solver, offsetCorrection, solverTierIndex, tierLayerIndex, tierArtifact
        );
    });

    return count;
}

function exportRhinoAisleBreps(rhino, model, tierLayerSets, sceneExportData) {
    const aisleMeshes = sceneExportData?.aisleMeshes;
    if (!Array.isArray(aisleMeshes) || aisleMeshes.length === 0) return 0;

    let count = 0;
    aisleMeshes.forEach((mesh, meshIndex) => {
        if (!mesh || mesh.type !== 'Mesh') return;

        const tierIndex = getRhinoTierIndexFromObject(mesh, meshIndex);
        const layerIndex = getRhinoTierLayerIndex(tierLayerSets, 'aisles', tierIndex, meshIndex);
        const tierLabel = getRhinoTierLabel(tierIndex, meshIndex);
        count += exportRhinoQuadPatchBrepsFromMesh(rhino, model, mesh, `Tier ${tierLabel} Aisle`, layerIndex);
    });

    return count;
}

function getRhinoNativeSpectatorBlockLimit(nativeSpectatorBlockLimit) {
    if (Number.isFinite(nativeSpectatorBlockLimit) && nativeSpectatorBlockLimit >= 0) {
        return Math.floor(nativeSpectatorBlockLimit);
    }
    return 750;
}

function countRhinoSpectatorBlocksForExport(sceneExportData) {
    const seatMeshes = sceneExportData?.seatMeshes;
    if (!Array.isArray(seatMeshes) || seatMeshes.length === 0) return 0;

    let count = 0;
    seatMeshes.forEach((mesh) => {
        if (!mesh || !mesh.isInstancedMesh) return;
        count += Math.max(0, Number(mesh.count) || 0);
    });
    return count;
}

function exportRhinoSpectatorBreps(rhino, model, tierLayerSets, sceneExportData) {
    const seatMeshes = sceneExportData?.seatMeshes;
    if (!Array.isArray(seatMeshes) || seatMeshes.length === 0) return 0;

    let count = 0;
    seatMeshes.forEach((mesh, meshIndex) => {
        if (!mesh || !mesh.isInstancedMesh || typeof mesh.getMatrixAt !== 'function') return;

        const tierIndex = getRhinoTierIndexFromObject(mesh, meshIndex);
        const layerIndex = getRhinoTierLayerIndex(tierLayerSets, 'spectators', tierIndex, meshIndex);
        const tierLabel = getRhinoTierLabel(tierIndex, meshIndex);
        count += exportRhinoSpectatorBlocksFromInstancedMesh(
            rhino, model, sceneExportData.THREE, mesh, `Tier ${tierLabel} Spectator`, layerIndex
        );
    });

    return count;
}

function exportRhinoSpectatorMeshes(rhino, model, tierLayerSets, sceneExportData) {
    const seatMeshes = sceneExportData?.seatMeshes;
    if (!Array.isArray(seatMeshes) || seatMeshes.length === 0) return 0;

    let count = 0;
    seatMeshes.forEach((mesh, meshIndex) => {
        if (!mesh || !mesh.isInstancedMesh || typeof mesh.getMatrixAt !== 'function') return;

        const tierIndex = getRhinoTierIndexFromObject(mesh, meshIndex);
        const layerIndex = getRhinoTierLayerIndex(tierLayerSets, 'spectators', tierIndex, meshIndex);
        const tierLabel = getRhinoTierLabel(tierIndex, meshIndex);
        const instanceCount = Math.max(0, Number(mesh.count) || 0);
        for (let instIdx = 0; instIdx < instanceCount; instIdx++) {
            const rhinoMesh = createRhinoMeshFromThreeInstancedMeshInstance(rhino, sceneExportData.THREE, mesh, instIdx);
            if (!rhinoMesh) continue;
            count += addRhinoModelObject(rhino, model, rhinoMesh, `Tier ${tierLabel} Spectator ${instIdx + 1}`, layerIndex);
            if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
        }
    });

    return count;
}

function exportRhinoSpectatorsAdaptive(rhino, model, tierLayerSets, sceneExportData, nativeSpectatorBlockLimit) {
    const blockCount = countRhinoSpectatorBlocksForExport(sceneExportData);
    if (blockCount <= 0) return 0;

    const nativeLimit = getRhinoNativeSpectatorBlockLimit(nativeSpectatorBlockLimit);
    if (blockCount > nativeLimit) {
        console.warn(
            `Rhino spectator export: ${blockCount} blocks exceeds native Brep safe limit (${nativeLimit}); ` +
            'exporting spectators as Rhino mesh by tier to avoid rhino3dm abort.'
        );
        return exportRhinoSpectatorMeshes(rhino, model, tierLayerSets, sceneExportData);
    }

    return exportRhinoSpectatorBreps(rhino, model, tierLayerSets, sceneExportData);
}

export async function exportRhinoModel({
    rhino,
    solvers,
    bowlConfig,
    sportName,
    tierArtifacts = [],
    sceneExportData,
    nativeSpectatorBlockLimit
}) {
    const model = new rhino.File3dm();
    model.applicationName = 'Seating Bowl Study';
    model.applicationDetails = 'Generated from Seating Bowl Study';

    try {
        const settings = model.settings();
        if (settings) {
            settings.modelUnitSystem = rhino.UnitSystem.Feet;
            settings.pageUnitSystem = rhino.UnitSystem.Feet;
            settings.modelAbsoluteTolerance = 0.01;
            settings.modelAngleToleranceRadians = 0.0174533;
            settings.modelRelativeTolerance = 0.01;
        }

        const offsetCorrection = getRhinoExportOffsetCorrection(bowlConfig, sportName);
        const tierLayerSets = ensureRhinoTierCategoryLayers(rhino, model, solvers);
        const bowlTierLayerIndices = Array.isArray(tierLayerSets?.bowl) ? tierLayerSets.bowl : [];
        const tierArtifactMap = getTierArtifactMap(tierArtifacts);

        let bowlExportedCount = exportRhinoBrepBowl(
            rhino, model, solvers, bowlConfig, offsetCorrection, bowlTierLayerIndices, tierArtifactMap
        );
        let exportedCount = bowlExportedCount;
        exportedCount += exportRhinoAisleBreps(rhino, model, tierLayerSets, sceneExportData);
        exportedCount += exportRhinoSpectatorsAdaptive(
            rhino, model, tierLayerSets, sceneExportData, nativeSpectatorBlockLimit
        );

        if (bowlExportedCount === 0) {
            console.warn('Direct Brep export produced no geometry, falling back to Rhino mesh export');
            (sceneExportData?.bowlMeshes || []).forEach((mesh, meshIndex) => {
                const rhinoMesh = createRhinoMeshFromThreeMesh(rhino, mesh);
                if (!rhinoMesh) return;
                const tierIndex = getRhinoTierIndexFromObject(mesh, meshIndex);
                const layerIndex = getRhinoTierLayerIndex(tierLayerSets, 'bowl', tierIndex, meshIndex);
                const added = addRhinoModelObject(rhino, model, rhinoMesh, '', layerIndex);
                bowlExportedCount += added;
                exportedCount += added;
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
            });
        }

        if (exportedCount === 0) {
            return { bytes: null, exportedCount: 0, fileExtension: '3dm' };
        }

        return { bytes: model.toByteArray(), exportedCount, fileExtension: '3dm' };
    } finally {
        if (typeof model.destroy === 'function') model.destroy();
    }
}
