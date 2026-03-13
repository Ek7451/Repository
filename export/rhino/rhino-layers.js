export function ensureRhinoTierCategoryLayers(rhino, model, solvers) {
    const empty = {
        bowl: [],
        aisles: [],
        spectators: [],
        bowlByTierIndex: new Map(),
        aislesByTierIndex: new Map(),
        spectatorsByTierIndex: new Map()
    };

    if (!rhino || !model || typeof model.layers !== 'function') return empty;
    if (!Array.isArray(solvers) || solvers.length === 0) return empty;

    const layerTable = model.layers();
    if (!layerTable || typeof layerTable.add !== 'function') return empty;

    const addLayer = (name) => {
        let layer = null;
        try {
            if (typeof rhino.Layer !== 'function') return undefined;
            layer = new rhino.Layer();
            layer.name = name;
            const idx = layerTable.add(layer);
            const num = Number(idx);
            return Number.isFinite(num) ? num : undefined;
        } catch {
            return undefined;
        } finally {
            if (typeof layer?.destroy === 'function') layer.destroy();
        }
    };

    for (let i = 0; i < solvers.length; i++) {
        const solver = solvers[i];
        const rawTierIndex = Number(solver?.tierIndex);
        const tierIndex = Number.isInteger(rawTierIndex) ? rawTierIndex : i;
        const tierLabel = tierIndex + 1;

        const bowlLayerIndex = addLayer(`Tier ${tierLabel} - Bowl`);
        const aisleLayerIndex = addLayer(`Tier ${tierLabel} - Aisles`);
        const spectatorLayerIndex = addLayer(`Tier ${tierLabel} - Spectators`);

        empty.bowl.push(bowlLayerIndex);
        empty.aisles.push(aisleLayerIndex);
        empty.spectators.push(spectatorLayerIndex);

        empty.bowlByTierIndex.set(tierIndex, bowlLayerIndex);
        empty.aislesByTierIndex.set(tierIndex, aisleLayerIndex);
        empty.spectatorsByTierIndex.set(tierIndex, spectatorLayerIndex);
    }

    return empty;
}

export function getRhinoTierIndexFromObject(object3D, fallbackIndex = 0) {
    const direct = Number(object3D?.userData?.tierIndex);
    if (Number.isInteger(direct)) return direct;
    const nested = Number(object3D?.userData?.seatPreview?.tierIndex);
    if (Number.isInteger(nested)) return nested;
    return Number.isInteger(fallbackIndex) ? fallbackIndex : 0;
}

export function getRhinoTierLabel(tierIndex, fallbackIndex = 0) {
    const idx = Number.isInteger(tierIndex) ? tierIndex : (Number.isInteger(fallbackIndex) ? fallbackIndex : 0);
    return idx + 1;
}

export function getRhinoTierLayerIndex(layerSets, category, tierIndex, fallbackIndex = 0) {
    if (!layerSets || !category) return undefined;

    const mapKey = `${category}ByTierIndex`;
    const map = layerSets[mapKey];
    if (map instanceof Map && Number.isInteger(tierIndex) && map.has(tierIndex)) {
        const mapped = map.get(tierIndex);
        if (Number.isInteger(mapped) && mapped >= 0) return mapped;
    }

    const arr = Array.isArray(layerSets[category]) ? layerSets[category] : [];
    const fallback = arr[fallbackIndex];
    return (Number.isInteger(fallback) && fallback >= 0) ? fallback : undefined;
}
