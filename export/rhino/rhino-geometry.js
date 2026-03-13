export function createRhinoCurveFromPlanSegment(rhino, segment, elevationFt = 0) {
    if (!segment) return null;
    const start = [segment.x1, segment.y1, elevationFt];
    const end = [segment.x2, segment.y2, elevationFt];

    if (segment.kind !== 'arc' || !Number.isFinite(segment.r) || Math.abs(segment.r) < 1e-9) {
        return new rhino.LineCurve(start, end);
    }

    let startAngle = Number(segment.sa);
    let endAngle = Number(segment.ea);
    if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
        return new rhino.LineCurve(start, end);
    }

    if (segment.ccw) {
        while (endAngle < startAngle) endAngle += Math.PI * 2;
    } else {
        while (endAngle > startAngle) endAngle -= Math.PI * 2;
    }

    const midAngle = startAngle + (endAngle - startAngle) * 0.5;
    const mid = [
        segment.cx + segment.r * Math.cos(midAngle),
        segment.cy + segment.r * Math.sin(midAngle),
        elevationFt
    ];

    try {
        const arc = rhino.Arc.createFromPoints(start, mid, end);
        if (!arc) return new rhino.LineCurve(start, end);
        const curve = rhino.ArcCurve.createFromArc(arc);
        if (typeof arc?.destroy === 'function') arc.destroy();
        return curve || new rhino.LineCurve(start, end);
    } catch {
        return new rhino.LineCurve(start, end);
    }
}

export function parseBowlGeometrySubpaths(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const EPS = 1e-9;
    const subpaths = [];
    let currentPath = null;
    let currentPoint = null;
    let pathStart = null;

    const samePoint = (a, b) => {
        if (!a || !b) return false;
        return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
    };

    const ensurePath = () => {
        if (!currentPath) {
            currentPath = [];
            subpaths.push(currentPath);
        }
    };

    const pushLine = (x1, y1, x2, y2) => {
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) return;
        if (Math.abs(x1 - x2) <= EPS && Math.abs(y1 - y2) <= EPS) return;
        ensurePath();
        currentPath.push({ kind: 'line', x1, y1, x2, y2 });
        currentPoint = { x: x2, y: y2 };
    };

    const pushArc = (cmd) => {
        if (!currentPoint) return;
        const x2 = cmd.x + cmd.r * Math.cos(cmd.ea);
        const y2 = cmd.y + cmd.r * Math.sin(cmd.ea);
        if (!Number.isFinite(x2) || !Number.isFinite(y2)) return;
        ensurePath();
        currentPath.push({
            kind: 'arc',
            x1: currentPoint.x,
            y1: currentPoint.y,
            x2,
            y2,
            cx: cmd.x,
            cy: cmd.y,
            r: cmd.r,
            sa: cmd.sa,
            ea: cmd.ea,
            ccw: !!cmd.ccw
        });
        currentPoint = { x: x2, y: y2 };
    };

    for (const cmd of segments) {
        if (!cmd) continue;
        if (cmd.cmd === 'moveTo') {
            currentPath = [];
            subpaths.push(currentPath);
            currentPoint = { x: cmd.x, y: cmd.y };
            pathStart = { x: cmd.x, y: cmd.y };
            continue;
        }

        if (cmd.cmd === 'lineTo') {
            if (!currentPoint) {
                currentPoint = { x: cmd.x, y: cmd.y };
                pathStart = { x: cmd.x, y: cmd.y };
                currentPath = [];
                subpaths.push(currentPath);
                continue;
            }
            pushLine(currentPoint.x, currentPoint.y, cmd.x, cmd.y);
            continue;
        }

        if (cmd.cmd === 'arc') {
            if (!currentPoint) {
                const x1 = cmd.x + cmd.r * Math.cos(cmd.sa);
                const y1 = cmd.y + cmd.r * Math.sin(cmd.sa);
                currentPoint = { x: x1, y: y1 };
                pathStart = { x: x1, y: y1 };
                currentPath = [];
                subpaths.push(currentPath);
            }
            pushArc(cmd);
            continue;
        }

        if (cmd.cmd === 'closePath') {
            if (currentPoint && pathStart && !samePoint(currentPoint, pathStart)) {
                pushLine(currentPoint.x, currentPoint.y, pathStart.x, pathStart.y);
            }
        }
    }

    return subpaths.filter((path) => Array.isArray(path) && path.length > 0);
}

export function addRhinoModelObject(rhino, model, geometry, objectName = '', layerIndex) {
    if (!geometry || !model || typeof model.objects !== 'function') return 0;
    const objectTable = model.objects();
    if (!objectTable) return 0;

    const attrs = (typeof rhino.ObjectAttributes === 'function') ? new rhino.ObjectAttributes() : null;
    if (attrs && objectName) {
        try { attrs.name = objectName; } catch { }
    }
    if (attrs && Number.isInteger(layerIndex) && layerIndex >= 0) {
        try { attrs.layerIndex = layerIndex; } catch { }
    }

    try {
        if (typeof objectTable.add === 'function') {
            objectTable.add(geometry, attrs);
        } else if (typeof objectTable.addBrep === 'function') {
            objectTable.addBrep(geometry, attrs);
        } else if (typeof objectTable.addMesh === 'function') {
            objectTable.addMesh(geometry, attrs);
        } else {
            return 0;
        }
        return 1;
    } finally {
        if (typeof attrs?.destroy === 'function') attrs.destroy();
    }
}

export function addRhinoRuledSurfaceBrep(rhino, model, curveA, curveB, objectName = '', layerIndex) {
    if (!curveA || !curveB) return 0;

    let surface = null;
    let brep = null;
    try {
        surface = rhino.NurbsSurface.createRuledSurface(curveA, curveB);
        if (!surface) return 0;
        brep = rhino.Brep.createFromSurface(surface);
        if (!brep) return 0;
        return addRhinoModelObject(rhino, model, brep, objectName, layerIndex);
    } catch {
        return 0;
    } finally {
        if (typeof surface?.destroy === 'function') surface.destroy();
        if (typeof brep?.destroy === 'function') brep.destroy();
    }
}

export function addRhinoRuledBrepsBetweenOffsets(rhino, model, getSubpathsForOffset, offsetA, elevA, offsetB, elevB, objectName = '', layerIndex) {
    const subpathsA = getSubpathsForOffset(offsetA) || [];
    const subpathsB = getSubpathsForOffset(offsetB) || [];
    if (!subpathsA.length || !subpathsB.length) return 0;

    let count = 0;
    const pathCount = Math.min(subpathsA.length, subpathsB.length);
    for (let p = 0; p < pathCount; p++) {
        const pathA = subpathsA[p];
        const pathB = subpathsB[p];
        if (!Array.isArray(pathA) || !Array.isArray(pathB)) continue;

        const segCount = Math.min(pathA.length, pathB.length);
        for (let i = 0; i < segCount; i++) {
            const segA = pathA[i];
            const segB = pathB[i];
            if (!segA || !segB) continue;
            if (!Number.isFinite(segA.x1) || !Number.isFinite(segA.y1) || !Number.isFinite(segA.x2) || !Number.isFinite(segA.y2)) continue;
            if (!Number.isFinite(segB.x1) || !Number.isFinite(segB.y1) || !Number.isFinite(segB.x2) || !Number.isFinite(segB.y2)) continue;

            const sameStart = Math.abs(segA.x1 - segB.x1) < 1e-9 && Math.abs(segA.y1 - segB.y1) < 1e-9 && Math.abs(elevA - elevB) < 1e-9;
            const sameEnd = Math.abs(segA.x2 - segB.x2) < 1e-9 && Math.abs(segA.y2 - segB.y2) < 1e-9 && Math.abs(elevA - elevB) < 1e-9;
            if (sameStart && sameEnd) continue;

            const curveA = createRhinoCurveFromPlanSegment(rhino, segA, elevA);
            const curveB = createRhinoCurveFromPlanSegment(rhino, segB, elevB);
            if (!curveA || !curveB) {
                if (typeof curveA?.destroy === 'function') curveA.destroy();
                if (typeof curveB?.destroy === 'function') curveB.destroy();
                continue;
            }

            count += addRhinoRuledSurfaceBrep(rhino, model, curveA, curveB, objectName, layerIndex);

            if (typeof curveA.destroy === 'function') curveA.destroy();
            if (typeof curveB.destroy === 'function') curveB.destroy();
        }
    }

    return count;
}

export function getThreeObjectWorldMatrixElements(object3D) {
    if (!object3D) return null;
    if (typeof object3D.updateWorldMatrix === 'function') object3D.updateWorldMatrix(true, false);
    else if (typeof object3D.updateMatrixWorld === 'function') object3D.updateMatrixWorld(true);
    return object3D.matrixWorld && object3D.matrixWorld.elements ? object3D.matrixWorld.elements : null;
}

export function transformThreePointByMatrixElements(matrixElements, x, y, z) {
    if (!matrixElements) return { x, y, z };
    return {
        x: (matrixElements[0] * x) + (matrixElements[4] * y) + (matrixElements[8] * z) + matrixElements[12],
        y: (matrixElements[1] * x) + (matrixElements[5] * y) + (matrixElements[9] * z) + matrixElements[13],
        z: (matrixElements[2] * x) + (matrixElements[6] * y) + (matrixElements[10] * z) + matrixElements[14]
    };
}

export function toRhinoPointFromThree(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, -z, y];
}

function rhinoPointsAlmostEqual(a, b, eps = 1e-9) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return Math.abs(a[0] - b[0]) <= eps
        && Math.abs(a[1] - b[1]) <= eps
        && Math.abs(a[2] - b[2]) <= eps;
}

function rhinoPointDistance(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function rhinoTriangleArea(a, b, c) {
    if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c)) return 0;
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const cx = (aby * acz) - (abz * acy);
    const cy = (abz * acx) - (abx * acz);
    const cz = (abx * acy) - (aby * acx);
    return 0.5 * Math.sqrt((cx * cx) + (cy * cy) + (cz * cz));
}

function isRhinoRuledQuadDegenerate(a0, a1, b0, b1) {
    const lenEps = 1e-5;
    const spanEps = 1e-5;
    const areaEps = 1e-8;

    if (!a0 || !a1 || !b0 || !b1) return true;
    if (rhinoPointDistance(a0, a1) <= lenEps) return true;
    if (rhinoPointDistance(b0, b1) <= lenEps) return true;
    if (rhinoPointDistance(a0, b0) <= spanEps) return true;
    if (rhinoPointDistance(a1, b1) <= spanEps) return true;

    const area1 = rhinoTriangleArea(a0, a1, b1);
    const area2 = rhinoTriangleArea(a0, b1, b0);
    return (area1 + area2) <= areaEps;
}

export function addRhinoRuledSurfaceBrepFromPointPairs(rhino, model, a0, a1, b0, b1, objectName = '', layerIndex) {
    if (!a0 || !a1 || !b0 || !b1) return 0;
    if (rhinoPointsAlmostEqual(a0, a1) || rhinoPointsAlmostEqual(b0, b1)) return 0;
    if (isRhinoRuledQuadDegenerate(a0, a1, b0, b1)) return 0;

    let curveA = null;
    let curveB = null;
    try {
        curveA = new rhino.LineCurve(a0, a1);
        curveB = new rhino.LineCurve(b0, b1);
        return addRhinoRuledSurfaceBrep(rhino, model, curveA, curveB, objectName, layerIndex);
    } catch {
        return 0;
    } finally {
        if (typeof curveA?.destroy === 'function') curveA.destroy();
        if (typeof curveB?.destroy === 'function') curveB.destroy();
    }
}

export function exportRhinoQuadPatchBrepsFromMesh(rhino, model, mesh, objectName = '', layerIndex) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes?.position) return 0;

    const positions = mesh.geometry.attributes.position.array;
    if (!positions || positions.length < 12) return 0;

    const worldMatrix = getThreeObjectWorldMatrixElements(mesh);
    let count = 0;

    for (let i = 0; i + 11 < positions.length; i += 12) {
        const p0w = transformThreePointByMatrixElements(worldMatrix, positions[i], positions[i + 1], positions[i + 2]);
        const p1w = transformThreePointByMatrixElements(worldMatrix, positions[i + 3], positions[i + 4], positions[i + 5]);
        const p2w = transformThreePointByMatrixElements(worldMatrix, positions[i + 6], positions[i + 7], positions[i + 8]);
        const p3w = transformThreePointByMatrixElements(worldMatrix, positions[i + 9], positions[i + 10], positions[i + 11]);

        const p0 = toRhinoPointFromThree(p0w.x, p0w.y, p0w.z);
        const p1 = toRhinoPointFromThree(p1w.x, p1w.y, p1w.z);
        const p2 = toRhinoPointFromThree(p2w.x, p2w.y, p2w.z);
        const p3 = toRhinoPointFromThree(p3w.x, p3w.y, p3w.z);

        if (!p0 || !p1 || !p2 || !p3) continue;
        count += addRhinoRuledSurfaceBrepFromPointPairs(rhino, model, p0, p3, p1, p2, objectName, layerIndex);
    }

    return count;
}

export function exportRhinoSpectatorBlocksFromInstancedMesh(rhino, model, THREE, instancedMesh, objectName = '', layerIndex) {
    if (!THREE || !instancedMesh || typeof instancedMesh.getMatrixAt !== 'function') return 0;
    if (!instancedMesh.geometry || !instancedMesh.geometry.attributes?.position) return 0;

    const geometry = instancedMesh.geometry;
    if (!geometry.boundingBox && typeof geometry.computeBoundingBox === 'function') geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    if (!bbox) return 0;

    if (typeof instancedMesh.updateWorldMatrix === 'function') instancedMesh.updateWorldMatrix(true, false);
    else if (typeof instancedMesh.updateMatrixWorld === 'function') instancedMesh.updateMatrixWorld(true);

    const min = bbox.min;
    const max = bbox.max;
    const localCorners = [
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(max.x, min.y, min.z),
        new THREE.Vector3(max.x, max.y, min.z),
        new THREE.Vector3(min.x, max.y, min.z),
        new THREE.Vector3(min.x, min.y, max.z),
        new THREE.Vector3(max.x, min.y, max.z),
        new THREE.Vector3(max.x, max.y, max.z),
        new THREE.Vector3(min.x, max.y, max.z)
    ];

    const worldMatrix = new THREE.Matrix4();
    worldMatrix.copy(instancedMesh.matrixWorld);
    const instanceMatrix = new THREE.Matrix4();
    const combinedMatrix = new THREE.Matrix4();
    const temp = new THREE.Vector3();
    const faceRails = [
        [0, 4, 1, 5],
        [3, 7, 2, 6],
        [0, 3, 4, 7],
        [1, 2, 5, 6],
        [0, 3, 1, 2],
        [4, 7, 5, 6]
    ];

    const instanceCount = Math.max(0, Number(instancedMesh.count) || 0);
    let count = 0;
    for (let i = 0; i < instanceCount; i++) {
        instancedMesh.getMatrixAt(i, instanceMatrix);
        combinedMatrix.multiplyMatrices(worldMatrix, instanceMatrix);

        const corners = new Array(8);
        for (let c = 0; c < 8; c++) {
            temp.copy(localCorners[c]).applyMatrix4(combinedMatrix);
            corners[c] = toRhinoPointFromThree(temp.x, temp.y, temp.z);
        }

        for (let f = 0; f < faceRails.length; f++) {
            const rails = faceRails[f];
            count += addRhinoRuledSurfaceBrepFromPointPairs(
                rhino,
                model,
                corners[rails[0]],
                corners[rails[1]],
                corners[rails[2]],
                corners[rails[3]],
                objectName,
                layerIndex
            );
        }
    }

    return count;
}

export function createRhinoMeshFromThreeInstancedMeshInstance(rhino, THREE, instancedMesh, instanceIndex) {
    if (!THREE || !instancedMesh || !instancedMesh.isInstancedMesh || typeof instancedMesh.getMatrixAt !== 'function') return null;

    const geometry = instancedMesh.geometry;
    const positions = geometry?.attributes?.position?.array;
    if (!positions || positions.length < 9) return null;

    const instIdx = Math.floor(Number(instanceIndex));
    if (!Number.isInteger(instIdx) || instIdx < 0 || instIdx >= (Number(instancedMesh.count) || 0)) return null;

    if (typeof instancedMesh.updateWorldMatrix === 'function') instancedMesh.updateWorldMatrix(true, false);
    else if (typeof instancedMesh.updateMatrixWorld === 'function') instancedMesh.updateMatrixWorld(true);

    const rhinoMesh = new rhino.Mesh();
    const vertices = rhinoMesh.vertices();
    const faces = rhinoMesh.faces();
    const worldMatrix = new THREE.Matrix4();
    worldMatrix.copy(instancedMesh.matrixWorld);
    const instanceMatrix = new THREE.Matrix4();
    const combinedMatrix = new THREE.Matrix4();
    const temp = new THREE.Vector3();

    try {
        instancedMesh.getMatrixAt(instIdx, instanceMatrix);
        combinedMatrix.multiplyMatrices(worldMatrix, instanceMatrix);

        for (let i = 0; i < positions.length; i += 3) {
            temp.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(combinedMatrix);
            const rp = toRhinoPointFromThree(temp.x, temp.y, temp.z);
            if (!rp) {
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                return null;
            }
            vertices.add(rp[0], rp[1], rp[2]);
        }

        if (geometry.index && geometry.index.array && geometry.index.array.length >= 3) {
            const idx = geometry.index.array;
            for (let i = 0; i < idx.length; i += 3) {
                const a = Number(idx[i]);
                const b = Number(idx[i + 1]);
                const c = Number(idx[i + 2]);
                if (typeof faces.addTriFace === 'function') faces.addTriFace(a, b, c);
                else if (typeof faces.addFace === 'function') faces.addFace(a, b, c, c);
                else throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
            }
        } else {
            const vertexCount = Math.floor(positions.length / 3);
            for (let v = 0; v + 2 < vertexCount; v += 3) {
                if (typeof faces.addTriFace === 'function') faces.addTriFace(v, v + 1, v + 2);
                else if (typeof faces.addFace === 'function') faces.addFace(v, v + 1, v + 2, v + 2);
                else throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
            }
        }

        if (typeof rhinoMesh.compact === 'function') rhinoMesh.compact();
        return rhinoMesh;
    } catch {
        if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
        return null;
    }
}

export function createRhinoMeshFromThreeInstancedMesh(rhino, THREE, instancedMesh) {
    if (!THREE || !instancedMesh || !instancedMesh.isInstancedMesh || typeof instancedMesh.getMatrixAt !== 'function') return null;

    const geometry = instancedMesh.geometry;
    const positions = geometry?.attributes?.position?.array;
    if (!positions || positions.length < 9) return null;

    if (typeof instancedMesh.updateWorldMatrix === 'function') instancedMesh.updateWorldMatrix(true, false);
    else if (typeof instancedMesh.updateMatrixWorld === 'function') instancedMesh.updateMatrixWorld(true);

    const baseVertexCount = Math.floor(positions.length / 3);
    if (baseVertexCount <= 0) return null;

    const rhinoMesh = new rhino.Mesh();
    const vertices = rhinoMesh.vertices();
    const faces = rhinoMesh.faces();
    const worldMatrix = new THREE.Matrix4();
    worldMatrix.copy(instancedMesh.matrixWorld);
    const instanceMatrix = new THREE.Matrix4();
    const combinedMatrix = new THREE.Matrix4();
    const temp = new THREE.Vector3();

    const instanceCount = Math.max(0, Number(instancedMesh.count) || 0);
    try {
        for (let instIdx = 0; instIdx < instanceCount; instIdx++) {
            instancedMesh.getMatrixAt(instIdx, instanceMatrix);
            combinedMatrix.multiplyMatrices(worldMatrix, instanceMatrix);

            for (let i = 0; i < positions.length; i += 3) {
                temp.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(combinedMatrix);
                const rp = toRhinoPointFromThree(temp.x, temp.y, temp.z);
                if (!rp) {
                    if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                    return null;
                }
                vertices.add(rp[0], rp[1], rp[2]);
            }

            const vertexOffset = instIdx * baseVertexCount;
            if (geometry.index && geometry.index.array && geometry.index.array.length >= 3) {
                const idx = geometry.index.array;
                for (let i = 0; i < idx.length; i += 3) {
                    const a = vertexOffset + Number(idx[i]);
                    const b = vertexOffset + Number(idx[i + 1]);
                    const c = vertexOffset + Number(idx[i + 2]);
                    if (typeof faces.addTriFace === 'function') faces.addTriFace(a, b, c);
                    else if (typeof faces.addFace === 'function') faces.addFace(a, b, c, c);
                    else throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                }
            } else {
                for (let v = 0; v + 2 < baseVertexCount; v += 3) {
                    const a = vertexOffset + v;
                    const b = vertexOffset + v + 1;
                    const c = vertexOffset + v + 2;
                    if (typeof faces.addTriFace === 'function') faces.addTriFace(a, b, c);
                    else if (typeof faces.addFace === 'function') faces.addFace(a, b, c, c);
                    else throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
                }
            }
        }

        if (typeof rhinoMesh.compact === 'function') rhinoMesh.compact();
        return rhinoMesh;
    } catch {
        if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
        return null;
    }
}

export function createRhinoMeshFromThreeMesh(rhino, mesh) {
    if (!mesh || mesh.type !== 'Mesh' || !mesh.geometry || !mesh.geometry.attributes?.position) return null;

    const geometry = mesh.geometry;
    const positions = geometry.attributes.position.array;
    if (!positions || positions.length < 9) return null;

    const worldMatrix = getThreeObjectWorldMatrixElements(mesh);
    const rhinoMesh = new rhino.Mesh();
    const vertices = rhinoMesh.vertices();
    const faces = rhinoMesh.faces();

    for (let i = 0; i < positions.length; i += 3) {
        const worldPos = transformThreePointByMatrixElements(worldMatrix, positions[i], positions[i + 1], positions[i + 2]);
        if (!Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.y) || !Number.isFinite(worldPos.z)) {
            if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
            return null;
        }
        const rp = toRhinoPointFromThree(worldPos.x, worldPos.y, worldPos.z);
        if (!rp) {
            if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
            return null;
        }
        vertices.add(rp[0], rp[1], rp[2]);
    }

    if (geometry.index && geometry.index.array && geometry.index.array.length >= 3) {
        const idx = geometry.index.array;
        for (let i = 0; i < idx.length; i += 3) {
            const a = Number(idx[i]);
            const b = Number(idx[i + 1]);
            const c = Number(idx[i + 2]);
            if (typeof faces.addTriFace === 'function') faces.addTriFace(a, b, c);
            else if (typeof faces.addFace === 'function') faces.addFace(a, b, c, c);
            else {
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
            }
        }
    } else {
        const vertexCount = Math.floor(positions.length / 3);
        for (let i = 0; i + 2 < vertexCount; i += 3) {
            if (typeof faces.addTriFace === 'function') faces.addTriFace(i, i + 1, i + 2);
            else if (typeof faces.addFace === 'function') faces.addFace(i, i + 1, i + 2, i + 2);
            else {
                if (typeof rhinoMesh.destroy === 'function') rhinoMesh.destroy();
                throw new Error('Rhino MeshFaceList does not support addTriFace/addFace');
            }
        }
    }

    if (typeof rhinoMesh.compact === 'function') rhinoMesh.compact();
    return rhinoMesh;
}
