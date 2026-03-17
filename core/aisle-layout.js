/**
 * Shared aisle placement + path sampling helpers for 2D and 3D renderers.
 * All geometry units are feet.
 */

const EPS = 1e-6;

function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
}

function normalizeUnit(u) {
    let out = Number(u) || 0;
    out %= 1;
    if (out < 0) out += 1;
    return out;
}

function normalizeArcDelta(sa, ea, ccw) {
    let delta = ea - sa;
    if (ccw) {
        while (delta <= 0) delta += Math.PI * 2;
    } else {
        while (delta >= 0) delta -= Math.PI * 2;
    }
    return delta;
}

function dedupeSorted(values, tol = 1e-6) {
    if (!values.length) return [];
    const out = [values[0]];
    for (let i = 1; i < values.length; i++) {
        if (Math.abs(values[i] - out[out.length - 1]) > tol) out.push(values[i]);
    }
    return out;
}

function lineDirection(part) {
    if (part.length <= EPS) return { x: 1, y: 0 };
    return {
        x: (part.x2 - part.x1) / part.length,
        y: (part.y2 - part.y1) / part.length
    };
}

function arcTangent(part, atEnd) {
    const angle = atEnd ? (part.sa + part.delta) : part.sa;
    const sign = Math.sign(part.delta) || 1;
    const tx = -Math.sin(angle) * sign;
    const ty = Math.cos(angle) * sign;
    const mag = Math.hypot(tx, ty) || 1;
    return { x: tx / mag, y: ty / mag };
}

function partStartDirection(part) {
    return part.type === 'line' ? lineDirection(part) : arcTangent(part, false);
}

function partEndDirection(part) {
    return part.type === 'line' ? lineDirection(part) : arcTangent(part, true);
}

function stationDistance(path, uA, uB) {
    let d = Math.abs(uA - uB) * path.length;
    if (path.closed) d = Math.min(d, path.length - d);
    return d;
}

function isStationValid(path, stationRecords, u, minSpacingFt) {
    if (!Number.isFinite(u)) return false;
    const candidate = path.closed ? normalizeUnit(u) : clamp01(u);
    for (let i = 0; i < stationRecords.length; i++) {
        if (stationDistance(path, candidate, stationRecords[i].u) < (minSpacingFt - 1e-4)) return false;
    }
    return true;
}

function addStationRecord(path, stationRecords, rec, tolFt = 1e-3) {
    if (!path || path.length <= EPS) return false;
    const u = path.closed ? normalizeUnit(rec.u) : clamp01(rec.u);
    for (let i = 0; i < stationRecords.length; i++) {
        if (stationDistance(path, u, stationRecords[i].u) <= tolFt) return false;
    }
    stationRecords.push({ ...rec, u });
    return true;
}

function getGaps(path, stations) {
    if (!stations.length) {
        return [{ start: 0, span: 1, length: path.length }];
    }

    const sorted = dedupeSorted(stations.slice().sort((a, b) => a - b));
    const gaps = [];

    if (path.closed) {
        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            const b = (i === sorted.length - 1) ? sorted[0] + 1 : sorted[i + 1];
            const span = b - a;
            if (span > EPS) {
                gaps.push({
                    start: normalizeUnit(a),
                    span,
                    length: span * path.length
                });
            }
        }
        return gaps;
    }

    const open = [0, ...sorted, 1];
    for (let i = 0; i < open.length - 1; i++) {
        const start = open[i];
        const end = open[i + 1];
        const span = end - start;
        if (span > EPS) {
            gaps.push({
                start,
                span,
                length: span * path.length
            });
        }
    }
    return gaps;
}

function gapCandidates(path, gap) {
    const fractions = [0.5, 0.25, 0.75, 0.125, 0.875];
    const out = [];
    for (let i = 0; i < fractions.length; i++) {
        const raw = gap.start + gap.span * fractions[i];
        out.push(path.closed ? normalizeUnit(raw) : clamp01(raw));
    }
    return dedupeSorted(out.sort((a, b) => a - b), 1e-7);
}

function localGapLength(path, stations, u) {
    if (!stations.length) return path.length;
    const sorted = dedupeSorted(stations.slice().sort((a, b) => a - b));

    if (path.closed) {
        let prev = sorted[sorted.length - 1] - 1;
        let next = sorted[0] + 1;
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i] <= u) prev = sorted[i];
            if (sorted[i] >= u) {
                next = sorted[i];
                break;
            }
        }
        return (next - prev) * path.length;
    }

    let prev = 0;
    let next = 1;
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] <= u) prev = sorted[i];
        if (sorted[i] >= u) {
            next = sorted[i];
            break;
        }
    }
    return Math.max(0, (next - prev) * path.length);
}

function nearestStationDistance(path, stationRecords, u) {
    if (!stationRecords.length) return path.length;
    let best = Infinity;
    for (let i = 0; i < stationRecords.length; i++) {
        const d = stationDistance(path, u, stationRecords[i].u);
        if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : path.length;
}

function axisClearance(path, u) {
    const pt = samplePathPointByRatio(path, u);
    return Math.min(Math.abs(pt.x), Math.abs(pt.y));
}

function isNearCenterAxes(path, u, axisExclusionFt) {
    if (!(axisExclusionFt > 0)) return false;
    return axisClearance(path, u) < axisExclusionFt;
}

function candidateScore(path, stationRecords, u) {
    const stationUs = stationRecords.map(s => s.u);
    const localGap = localGapLength(path, stationUs, u);
    const nearest = nearestStationDistance(path, stationRecords, u);
    const axis = Math.min(40, axisClearance(path, u));
    return (localGap * 1.0) + (nearest * 0.75) + (axis * 0.05);
}

function betterSingle(a, b) {
    if (!b) return true;
    if (a.score > b.score + 1e-9) return true;
    if (b.score > a.score + 1e-9) return false;
    if (a.pathIndex !== b.pathIndex) return a.pathIndex < b.pathIndex;
    return a.u < b.u;
}

function betterPair(a, b) {
    if (!b) return true;
    if (a.score > b.score + 1e-9) return true;
    if (b.score > a.score + 1e-9) return false;
    if (a.pathIndex !== b.pathIndex) return a.pathIndex < b.pathIndex;
    return a.u < b.u;
}

function isAxisAligned(dir) {
    return Math.abs(Math.abs(dir.x) - 1) < 0.08 || Math.abs(Math.abs(dir.y) - 1) < 0.08;
}

function isDiagonal(dir) {
    return Math.abs(Math.abs(dir.x) - Math.abs(dir.y)) < 0.12 &&
        Math.abs(dir.x) > 0.35 && Math.abs(dir.y) > 0.35;
}

function classifyAxisDirection(dir) {
    if (!dir) return null;
    const vx = Number.isFinite(Number(dir.tx)) ? Number(dir.tx) : Number(dir.x);
    const vy = Number.isFinite(Number(dir.ty)) ? Number(dir.ty) : Number(dir.y);
    const ax = Math.abs(vx || 0);
    const ay = Math.abs(vy || 0);
    if (ax >= 0.92 && ay <= 0.35) return 'horizontal';
    if (ay >= 0.92 && ax <= 0.35) return 'vertical';
    return null;
}

function isAxisAlignedStation(path, u) {
    const pt = samplePathPointByRatio(path, u);
    return classifyAxisDirection(pt) !== null;
}

function scoreAxisEdgeMatch(path, u, targetCoord, actualCoord, preferU) {
    const coordErr = Math.abs(actualCoord - targetCoord);
    const prefErr = Number.isFinite(preferU)
        ? stationDistance(path, u, path.closed ? normalizeUnit(preferU) : clamp01(preferU))
        : 0;
    return (coordErr * 10.0) + (prefErr * 0.08);
}

function findAxisEdgeStationByCoordinate(path, axisDir, targetCoord, sideSign = 0, preferU = NaN) {
    if (!path || !path.parts || path.length <= EPS) return NaN;
    const tol = 1e-4;
    let best = null;

    for (let i = 0; i < path.parts.length; i++) {
        const part = path.parts[i];
        if (!part || part.type !== 'line' || part.length <= EPS) continue;

        const dx = part.x2 - part.x1;
        const dy = part.y2 - part.y1;
        if (axisDir === 'horizontal') {
            if (Math.abs(dy) > tol || Math.abs(dx) <= EPS) continue;
            const yMid = (part.y1 + part.y2) * 0.5;
            if (sideSign !== 0 && Math.abs(yMid) > 0.25 && Math.sign(yMid) !== sideSign) continue;
            const minX = Math.min(part.x1, part.x2) - tol;
            const maxX = Math.max(part.x1, part.x2) + tol;
            if (targetCoord < minX || targetCoord > maxX) continue;

            const tRaw = (targetCoord - part.x1) / dx;
            const t = clamp01(tRaw);
            const x = part.x1 + dx * t;
            const dist = part.startDist + part.length * t;
            const u = path.closed ? normalizeUnit(dist / path.length) : clamp01(dist / path.length);
            const score = scoreAxisEdgeMatch(path, u, targetCoord, x, preferU);
            if (!best || score < best.score) best = { u, score };
            continue;
        }

        if (axisDir === 'vertical') {
            if (Math.abs(dx) > tol || Math.abs(dy) <= EPS) continue;
            const xMid = (part.x1 + part.x2) * 0.5;
            if (sideSign !== 0 && Math.abs(xMid) > 0.25 && Math.sign(xMid) !== sideSign) continue;
            const minY = Math.min(part.y1, part.y2) - tol;
            const maxY = Math.max(part.y1, part.y2) + tol;
            if (targetCoord < minY || targetCoord > maxY) continue;

            const tRaw = (targetCoord - part.y1) / dy;
            const t = clamp01(tRaw);
            const y = part.y1 + dy * t;
            const dist = part.startDist + part.length * t;
            const u = path.closed ? normalizeUnit(dist / path.length) : clamp01(dist / path.length);
            const score = scoreAxisEdgeMatch(path, u, targetCoord, y, preferU);
            if (!best || score < best.score) best = { u, score };
        }
    }

    return best ? best.u : NaN;
}

/**
 * Convert bowl geometry commands into one or more sampled path definitions.
 * @param {Array} segments Bowl geometry command list
 * @returns {Array}
 */
export function buildGeometryPaths(segments) {
    if (!Array.isArray(segments) || !segments.length) return [];

    const paths = [];
    let path = null;
    let cx = 0;
    let cy = 0;

    const finalizePath = () => {
        if (!path) return;
        if (path.parts.length > 0 && path.length > EPS) {
            paths.push(path);
        }
        path = null;
    };

    const ensurePath = () => {
        if (!path) {
            path = {
                parts: [],
                length: 0,
                closed: false,
                startX: cx,
                startY: cy,
                endX: cx,
                endY: cy
            };
        }
    };

    for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (!s || !s.cmd) continue;

        if (s.cmd === 'moveTo') {
            finalizePath();
            cx = s.x;
            cy = s.y;
            path = {
                parts: [],
                length: 0,
                closed: false,
                startX: cx,
                startY: cy,
                endX: cx,
                endY: cy
            };
            continue;
        }

        ensurePath();

        if (s.cmd === 'lineTo') {
            const x1 = cx;
            const y1 = cy;
            const x2 = s.x;
            const y2 = s.y;
            const len = Math.hypot(x2 - x1, y2 - y1);
            if (len > EPS) {
                path.parts.push({
                    type: 'line',
                    x1, y1, x2, y2,
                    length: len,
                    startDist: path.length
                });
                path.length += len;
            }
            cx = x2;
            cy = y2;
            path.endX = cx;
            path.endY = cy;
            continue;
        }

        if (s.cmd === 'arc') {
            const r = Math.abs(Number(s.r) || 0);
            if (r > EPS) {
                const delta = normalizeArcDelta(s.sa, s.ea, !!s.ccw);
                const len = Math.abs(delta) * r;
                if (len > EPS) {
                    path.parts.push({
                        type: 'arc',
                        cx: s.x,
                        cy: s.y,
                        r,
                        sa: s.sa,
                        delta,
                        length: len,
                        startDist: path.length
                    });
                    path.length += len;
                }
            }
            cx = s.x + r * Math.cos(s.ea);
            cy = s.y + r * Math.sin(s.ea);
            path.endX = cx;
            path.endY = cy;
            continue;
        }

        if (s.cmd === 'closePath') {
            const x1 = cx;
            const y1 = cy;
            const x2 = path.startX;
            const y2 = path.startY;
            const len = Math.hypot(x2 - x1, y2 - y1);
            if (len > EPS) {
                path.parts.push({
                    type: 'line',
                    x1, y1, x2, y2,
                    length: len,
                    startDist: path.length
                });
                path.length += len;
            }
            cx = x2;
            cy = y2;
            path.endX = cx;
            path.endY = cy;
            path.closed = true;
            finalizePath();
        }
    }

    finalizePath();
    return paths;
}

/**
 * Sample an XY point/tangent by linear distance along a path.
 * @param {Object} path
 * @param {number} distance
 * @returns {{x:number,y:number,tx:number,ty:number}}
 */
function samplePathPoint(path, distance) {
    if (!path || !path.parts || path.parts.length === 0 || path.length <= EPS) {
        return { x: 0, y: 0, tx: 1, ty: 0 };
    }

    let d = distance;
    if (path.closed) {
        d = ((d % path.length) + path.length) % path.length;
    } else {
        d = Math.max(0, Math.min(path.length, d));
    }

    for (let i = 0; i < path.parts.length; i++) {
        const part = path.parts[i];
        const start = part.startDist;
        const end = start + part.length;
        if (d <= end + EPS || i === path.parts.length - 1) {
            const local = Math.max(0, Math.min(part.length, d - start));
            const t = part.length > EPS ? (local / part.length) : 0;

            if (part.type === 'line') {
                const x = part.x1 + (part.x2 - part.x1) * t;
                const y = part.y1 + (part.y2 - part.y1) * t;
                const dir = lineDirection(part);
                return { x, y, tx: dir.x, ty: dir.y };
            }

            const a = part.sa + part.delta * t;
            const x = part.cx + part.r * Math.cos(a);
            const y = part.cy + part.r * Math.sin(a);
            const sign = Math.sign(part.delta) || 1;
            const tx = -Math.sin(a) * sign;
            const ty = Math.cos(a) * sign;
            const mag = Math.hypot(tx, ty) || 1;
            return { x, y, tx: tx / mag, ty: ty / mag };
        }
    }

    const last = path.parts[path.parts.length - 1];
    if (last.type === 'line') {
        const dir = lineDirection(last);
        return { x: last.x2, y: last.y2, tx: dir.x, ty: dir.y };
    }
    const a = last.sa + last.delta;
    const tan = arcTangent(last, true);
    return { x: last.cx + last.r * Math.cos(a), y: last.cy + last.r * Math.sin(a), tx: tan.x, ty: tan.y };
}

/**
 * Sample an XY point/tangent by normalized ratio [0..1].
 * @param {Object} path
 * @param {number} ratio
 * @returns {{x:number,y:number,tx:number,ty:number}}
 */
export function samplePathPointByRatio(path, ratio) {
    if (!path || path.length <= EPS) return { x: 0, y: 0, tx: 1, ty: 0 };
    const u = path.closed ? normalizeUnit(ratio) : clamp01(ratio);
    return samplePathPoint(path, u * path.length);
}

/**
 * Sample left/right boundary points for an aisle band at a given station.
 * @param {Object} path
 * @param {number} ratio
 * @param {number} widthFt
 * @returns {{left:Object,right:Object,center:Object}}
 */
export function sampleAisleBand(path, ratio, widthFt) {
    if (!path || path.length <= EPS) return null;
    const half = Math.max(0, Number(widthFt) || 0) * 0.5;
    const centerDist = (path.closed ? normalizeUnit(ratio) : clamp01(ratio)) * path.length;
    const center = samplePathPoint(path, centerDist);
    const left = samplePathPoint(path, centerDist - half);
    const right = samplePathPoint(path, centerDist + half);
    return { left, right, center };
}

/**
 * Detect chamfer corner stations with a stable ordinal index along the path.
 * The ordinal index is used to pair front/back chamfer points across offsets.
 * @param {Object} path
 * @returns {Array<{u:number,ordinal:number,dist:number,x:number,y:number}>}
 */
function findChamferCornerAnchors(path) {
    if (!path || !path.parts || path.parts.length < 2 || path.length <= EPS) return [];

    /** @type {Array<{u:number,ordinal?:number,dist:number,x:number,y:number}>} */
    const raw = [];
    const parts = path.parts;
    const count = parts.length;
    const startIdx = path.closed ? 0 : 1;
    const endIdx = path.closed ? count : (count - 1);

    for (let i = startIdx; i < endIdx; i++) {
        const prev = parts[(i - 1 + count) % count];
        const next = parts[i % count];
        if (!prev || !next || prev.type !== 'line' || next.type !== 'line') continue;

        const prevDir = partEndDirection(prev);
        const nextDir = partStartDirection(next);
        const chamferLike =
            (isDiagonal(prevDir) && isAxisAligned(nextDir)) ||
            (isAxisAligned(prevDir) && isDiagonal(nextDir));
        if (!chamferLike) continue;

        const dist = next.startDist;
        const u = path.closed ? normalizeUnit(dist / path.length) : clamp01(dist / path.length);
        const pt = samplePathPoint(path, dist);
        raw.push({ u, dist, x: pt.x, y: pt.y });
    }

    if (!raw.length) return [];

    raw.sort((a, b) => a.u - b.u);
    const deduped = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
        if (Math.abs(raw[i].u - deduped[deduped.length - 1].u) > 1e-5) deduped.push(raw[i]);
    }

    // Closed paths can produce one duplicate across the wrap seam (0/1).
    if (path.closed && deduped.length > 1) {
        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        if (stationDistance(path, first.u, last.u) < 1e-3) deduped.pop();
    }

    for (let i = 0; i < deduped.length; i++) {
        deduped[i].ordinal = i;
    }
    return /** @type {Array<{u:number,ordinal:number,dist:number,x:number,y:number}>} */ (deduped);
}

function getCachedChamferAnchors(path, cache) {
    if (!path) return [];
    if (!cache) return findChamferCornerAnchors(path);
    if (!cache.has(path)) cache.set(path, findChamferCornerAnchors(path));
    return cache.get(path);
}

function computeWrappedSpan(startU, endU) {
    const start = normalizeUnit(startU);
    let end = normalizeUnit(endU);
    if (end <= start + EPS) end += 1;
    return { start, end, span: end - start };
}

function interpolateWrappedU(startU, endU, t) {
    const w = computeWrappedSpan(startU, endU);
    return normalizeUnit(w.start + w.span * clamp01(t));
}

/**
 * Resolve front/back station ratios for a single aisle.
 * Forced chamfer aisles resolve by ordinal index instead of raw ratio so they
 * stay pinned to matching chamfer corners at every offset.
 * @param {Object} pathFront
 * @param {Object} pathBack
 * @param {Object} aisle
 * @param {Map} [chamferCache]
 * @returns {{uFront:number,uBack:number}|null}
 */
export function resolveAisleStationRatios(pathFront, pathBack, aisle, chamferCache = null) {
    if (!aisle) return null;

    let uFront = Number.isFinite(aisle.uFront) ? aisle.uFront : (Number.isFinite(aisle.u) ? aisle.u : NaN);
    let uBack = Number.isFinite(aisle.uBack) ? aisle.uBack : (Number.isFinite(aisle.u) ? aisle.u : NaN);

    if (Number.isFinite(aisle.cornerOrdinal)) {
        const ordinal = Math.max(0, Math.floor(aisle.cornerOrdinal));

        if (pathFront) {
            const frontAnchors = getCachedChamferAnchors(pathFront, chamferCache);
            if (ordinal < frontAnchors.length) uFront = frontAnchors[ordinal].u;
        }

        if (pathBack) {
            const backAnchors = getCachedChamferAnchors(pathBack, chamferCache);
            if (ordinal < backAnchors.length) uBack = backAnchors[ordinal].u;
        }
    }

    if (
        !Number.isFinite(aisle.cornerOrdinal) &&
        Number.isFinite(aisle.segmentIndex) &&
        Number.isFinite(aisle.segmentT)
    ) {
        const segIndex = Math.max(0, Math.floor(aisle.segmentIndex));
        const segT = clamp01(aisle.segmentT);

        if (pathFront) {
            const frontAnchors = getCachedChamferAnchors(pathFront, chamferCache);
            if (frontAnchors.length >= 2) {
                const n = frontAnchors.length;
                const i = segIndex % n;
                const j = (i + 1) % n;
                uFront = interpolateWrappedU(frontAnchors[i].u, frontAnchors[j].u, segT);
            }
        }

        if (pathBack) {
            const backAnchors = getCachedChamferAnchors(pathBack, chamferCache);
            if (backAnchors.length >= 2) {
                const n = backAnchors.length;
                const i = segIndex % n;
                const j = (i + 1) % n;
                uBack = interpolateWrappedU(backAnchors[i].u, backAnchors[j].u, segT);
            }
        }
    }

    // For distributed aisles on straight edges, preserve world X/Y coordinate
    // so front/back traces stay orthogonal to the long/side bowls.
    if (!Number.isFinite(aisle.cornerOrdinal) && pathFront && pathBack && Number.isFinite(uFront)) {
        const useBackDrivenAxis =
            Number.isFinite(aisle.segmentIndex) &&
            Number.isFinite(aisle.segmentT) &&
            Number.isFinite(uBack);

        const axisSourcePath = useBackDrivenAxis ? pathBack : pathFront;
        const axisSourceU = useBackDrivenAxis ? uBack : uFront;
        const axisPt = samplePathPointByRatio(axisSourcePath, axisSourceU);
        const axisDir = classifyAxisDirection(axisPt);

        if (axisDir === 'horizontal') {
            const sideSign = axisPt.y >= 0 ? 1 : -1;
            const targetCoord = axisPt.x;
            const frontAligned = findAxisEdgeStationByCoordinate(pathFront, 'horizontal', targetCoord, sideSign, uFront);
            const backAligned = findAxisEdgeStationByCoordinate(pathBack, 'horizontal', targetCoord, sideSign, uBack);
            if (Number.isFinite(frontAligned)) uFront = frontAligned;
            if (Number.isFinite(backAligned)) uBack = backAligned;
        } else if (axisDir === 'vertical') {
            const sideSign = axisPt.x >= 0 ? 1 : -1;
            const targetCoord = axisPt.y;
            const frontAligned = findAxisEdgeStationByCoordinate(pathFront, 'vertical', targetCoord, sideSign, uFront);
            const backAligned = findAxisEdgeStationByCoordinate(pathBack, 'vertical', targetCoord, sideSign, uBack);
            if (Number.isFinite(frontAligned)) uFront = frontAligned;
            if (Number.isFinite(backAligned)) uBack = backAligned;
        }
    }

    if (!Number.isFinite(uFront) && Number.isFinite(uBack)) uFront = uBack;
    if (!Number.isFinite(uBack) && Number.isFinite(uFront)) uBack = uFront;
    if (!Number.isFinite(uFront) || !Number.isFinite(uBack)) return null;

    if (pathFront) uFront = pathFront.closed ? normalizeUnit(uFront) : clamp01(uFront);
    if (pathBack) uBack = pathBack.closed ? normalizeUnit(uBack) : clamp01(uBack);
    return { uFront, uBack };
}

/**
 * Compute aisle station ratios from one or more paths.
 * Placement priority:
 * 1) Forced stations (e.g., chamfer corners)
 * 2) Symmetric opposite pairs on closed paths
 * 3) Single-station fill for any odd remainder
 * @param {Array} paths Output of buildGeometryPaths
 * @param {number} targetAisles
 * @param {Object} [options]
 * @returns {Array<{pathIndex:number,u:number,forced:boolean,anchorType:string,cornerOrdinal?:number}>}
 */
function computeAisleStations(paths, targetAisles, options = {}) {
    if (!Array.isArray(paths) || paths.length === 0) return [];
    const target = Math.max(0, Math.round(Number(targetAisles) || 0));

    const avoidCenterAxes = options.avoidCenterAxes !== false;
    const axisToleranceFt = Number.isFinite(options.axisToleranceFt) ? options.axisToleranceFt : 2;
    const axisExclusionFt = Number.isFinite(options.axisExclusionFt)
        ? Math.max(0, Number(options.axisExclusionFt) || 0)
        : Math.max(0, axisToleranceFt);
    const minSpacingFt = Math.max(0.1, Number(options.minSpacingFt) || 1);
    const forcedStations = Array.isArray(options.forcedStations) ? options.forcedStations : [];
    const allowOppositePairs = options.allowOppositePairs !== false;
    const axisOnlyCandidates = options.axisOnlyCandidates === true;

    const stationsByPath = paths.map(() => []);
    for (let i = 0; i < forcedStations.length; i++) {
        const fs = forcedStations[i];
        const path = paths[fs.pathIndex];
        if (!path || path.length <= EPS) continue;
        addStationRecord(path, stationsByPath[fs.pathIndex], {
            u: fs.u,
            forced: true,
            anchorType: fs.anchorType || 'forced',
            cornerOrdinal: Number.isFinite(fs.cornerOrdinal) ? Math.max(0, Math.floor(fs.cornerOrdinal)) : undefined,
            segmentIndex: Number.isFinite(fs.segmentIndex) ? Math.max(0, Math.floor(fs.segmentIndex)) : undefined,
            segmentT: Number.isFinite(fs.segmentT) ? clamp01(fs.segmentT) : undefined
        }, 1e-3);
    }

    let total = stationsByPath.reduce((sum, list) => sum + list.length, 0);
    while (total < target) {
        const remaining = target - total;
        let bestPair = null;
        let bestSingle = null;

        for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
            const path = paths[pathIndex];
            if (!path || path.length <= EPS) continue;
            const stationRecords = stationsByPath[pathIndex];
            const stationUs = stationRecords.map(s => s.u);
            const gaps = getGaps(path, stationUs).sort((a, b) => b.length - a.length);

            for (let g = 0; g < gaps.length; g++) {
                const gap = gaps[g];
                const candidates = gapCandidates(path, gap);

                for (let c = 0; c < candidates.length; c++) {
                    const u = candidates[c];
                    if (!isStationValid(path, stationRecords, u, minSpacingFt)) continue;
                    if (avoidCenterAxes && isNearCenterAxes(path, u, axisExclusionFt)) continue;
                    if (axisOnlyCandidates && !isAxisAlignedStation(path, u)) continue;

                    const score = candidateScore(path, stationRecords, u);
                    const singleCandidate = { pathIndex, u, score };
                    if (betterSingle(singleCandidate, bestSingle)) bestSingle = singleCandidate;

                    if (remaining < 2 || !allowOppositePairs || !path.closed) continue;

                    const uOpp = normalizeUnit(u + 0.5);
                    if (!isStationValid(path, stationRecords, uOpp, minSpacingFt)) continue;
                    if (avoidCenterAxes && isNearCenterAxes(path, uOpp, axisExclusionFt)) continue;
                    if (axisOnlyCandidates && !isAxisAlignedStation(path, uOpp)) continue;
                    if (stationDistance(path, u, uOpp) < (minSpacingFt - 1e-4)) continue;

                    const scoreOpp = candidateScore(path, stationRecords, uOpp);
                    const pairCandidate = {
                        pathIndex,
                        u,
                        uOpp,
                        score: score + scoreOpp + 0.75 // hard bias toward symmetry first
                    };
                    if (betterPair(pairCandidate, bestPair)) bestPair = pairCandidate;
                }
            }
        }

        // Symmetry-first: always place a valid pair if we still need at least 2.
        if (remaining >= 2 && bestPair) {
            const path = paths[bestPair.pathIndex];
            const list = stationsByPath[bestPair.pathIndex];
            const addA = addStationRecord(path, list, {
                u: bestPair.u,
                forced: false,
                anchorType: 'distributed_pair'
            }, 1e-3);
            const addB = addStationRecord(path, list, {
                u: bestPair.uOpp,
                forced: false,
                anchorType: 'distributed_pair'
            }, 1e-3);
            total += (addA ? 1 : 0) + (addB ? 1 : 0);
            if (addA || addB) continue;
        }

        if (bestSingle) {
            const path = paths[bestSingle.pathIndex];
            const list = stationsByPath[bestSingle.pathIndex];
            if (addStationRecord(path, list, {
                u: bestSingle.u,
                forced: false,
                anchorType: 'distributed_single'
            }, 1e-3)) {
                total += 1;
                continue;
            }
        }

        break;
    }

    const out = [];
    for (let pathIndex = 0; pathIndex < stationsByPath.length; pathIndex++) {
        const path = paths[pathIndex];
        const records = stationsByPath[pathIndex]
            .slice()
            .sort((a, b) => a.u - b.u);

        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const aisle = {
                pathIndex,
                u: path.closed ? normalizeUnit(r.u) : clamp01(r.u),
                forced: !!r.forced,
                anchorType: r.anchorType || (r.forced ? 'forced' : 'distributed')
            };
            if (Number.isFinite(r.cornerOrdinal)) aisle.cornerOrdinal = r.cornerOrdinal;
            if (Number.isFinite(r.segmentIndex)) aisle.segmentIndex = r.segmentIndex;
            if (Number.isFinite(r.segmentT)) aisle.segmentT = r.segmentT;
            out.push(aisle);
        }
    }

    return out;
}

function computeEvenOpenPathAisleStations(paths, targetAisles, aisleWidthFt = 0) {
    if (!Array.isArray(paths) || paths.length !== 1) return [];
    const path = paths[0];
    if (!path || path.length <= EPS || path.closed) return [];

    const target = Math.max(0, Math.round(Number(targetAisles) || 0));
    if (target <= 0) return [];
    const widthFt = Math.max(0, Number(aisleWidthFt) || 0);
    const edgeInsetU = Math.max(0, Math.min(0.5, (widthFt * 0.5) / Math.max(EPS, path.length)));

    const stations = [];
    if (target === 1) {
        stations.push(0.5);
    } else {
        const denom = target - 1;
        const startU = edgeInsetU;
        const endU = 1 - edgeInsetU;
        for (let i = 0; i < target; i++) {
            const t = i / denom;
            stations.push(startU + (endU - startU) * t);
        }
    }

    return stations.map(u => ({
        pathIndex: 0,
        u: clamp01(u),
        forced: false,
        anchorType: 'distributed_linear_even'
    }));
}

function computeEvenAislesForOpenPaths(paths, targetAisles, aisleWidthFt = 0) {
    if (!Array.isArray(paths) || !paths.length) return [];
    const out = [];
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
        const path = paths[pathIndex];
        if (!path || path.closed || path.length <= EPS) continue;
        const local = computeEvenOpenPathAisleStations([path], targetAisles, aisleWidthFt);
        for (let i = 0; i < local.length; i++) {
            out.push({
                ...local[i],
                pathIndex
            });
        }
    }
    return out;
}

function buildAllowedIntervals(minCoord, maxCoord, axisExclusionFt) {
    const a = Math.min(minCoord, maxCoord);
    const b = Math.max(minCoord, maxCoord);
    if (b - a <= EPS) return [];

    if (!(axisExclusionFt > 0)) {
        return [{ min: a, max: b, length: b - a }];
    }

    const out = [];
    const leftMax = Math.min(b, -axisExclusionFt);
    if (leftMax - a > EPS) out.push({ min: a, max: leftMax, length: leftMax - a });

    const rightMin = Math.max(a, axisExclusionFt);
    if (b - rightMin > EPS) out.push({ min: rightMin, max: b, length: b - rightMin });

    if (!out.length) {
        // If exclusion fully consumes the range, fall back to full range.
        out.push({ min: a, max: b, length: b - a });
    }
    return out;
}

function distributeCoordsEvenly(intervals, count) {
    if (!Array.isArray(intervals) || !intervals.length || count <= 0) return [];
    const total = intervals.reduce((sum, i) => sum + i.length, 0);
    if (!(total > EPS)) return [];

    const out = [];
    for (let i = 0; i < count; i++) {
        const d = total * ((i + 1) / (count + 1));
        let run = 0;
        let coord = null;

        for (let k = 0; k < intervals.length; k++) {
            const it = intervals[k];
            if (d <= run + it.length + 1e-9) {
                const local = d - run;
                coord = it.min + local;
                break;
            }
            run += it.length;
        }

        if (!Number.isFinite(coord)) coord = intervals[intervals.length - 1].max;
        out.push(coord);
    }
    return out;
}

function intervalPressure(lengthFt, count) {
    return lengthFt / (count + 1);
}

function spacingVariance(lengthFt, count, targetGapFt) {
    const gap = intervalPressure(lengthFt, Math.max(0, count));
    const delta = gap - targetGapFt;
    return delta * delta;
}

function pairAllocationBenefit(intervals, counts, i, j, targetGapFt) {
    const cI = Math.max(0, Math.floor(Number(counts[i]) || 0));
    const cJ = Math.max(0, Math.floor(Number(counts[j]) || 0));
    const beforeErr =
        spacingVariance(intervals[i].length, cI, targetGapFt) +
        spacingVariance(intervals[j].length, cJ, targetGapFt);
    const afterErr =
        spacingVariance(intervals[i].length, cI + 1, targetGapFt) +
        spacingVariance(intervals[j].length, cJ + 1, targetGapFt);
    return {
        benefit: beforeErr - afterErr,
        pressure: Math.max(
            intervalPressure(intervals[i].length, cI),
            intervalPressure(intervals[j].length, cJ)
        )
    };
}

function singleAllocationBenefit(intervals, counts, i, targetGapFt) {
    const c = Math.max(0, Math.floor(Number(counts[i]) || 0));
    const beforeErr = spacingVariance(intervals[i].length, c, targetGapFt);
    const afterErr = spacingVariance(intervals[i].length, c + 1, targetGapFt);
    return {
        benefit: beforeErr - afterErr,
        pressure: intervalPressure(intervals[i].length, c)
    };
}

function buildChamferIntervals(path, anchors, cornerCount) {
    const n = Math.max(0, Math.min(cornerCount, anchors.length));
    const out = [];
    if (!path || path.length <= EPS || n < 2) return out;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const startU = anchors[i].u;
        const endU = anchors[j].u;
        const w = computeWrappedSpan(startU, endU);
        const startPt = samplePathPointByRatio(path, startU);
        const endPt = samplePathPointByRatio(path, endU);
        const axis = classifyAxisDirection({
            x: endPt.x - startPt.x,
            y: endPt.y - startPt.y
        });

        out.push({
            index: i,
            startU,
            endU,
            span: w.span,
            length: w.span * path.length,
            startPt,
            endPt,
            axis
        });
    }

    return out;
}

function distributeIntervalTs(interval, count, axisExclusionFt, endpointBufferFt = 0) {
    if (!interval || count <= 0) return [];
    const out = [];
    const safeLen = Math.max(EPS, Number(interval.length) || 0);
    const edgeBufferT = Math.max(0, Math.min(0.45, (Math.max(0, Number(endpointBufferFt) || 0) / safeLen)));

    if (interval.axis === 'horizontal') {
        const startX = Number(interval.startPt.x) || 0;
        const endX = Number(interval.endPt.x) || 0;
        const xA = startX + (endX - startX) * edgeBufferT;
        const xB = startX + (endX - startX) * (1 - edgeBufferT);
        const minCoord = Math.min(xA, xB);
        const maxCoord = Math.max(xA, xB);
        let allowed = buildAllowedIntervals(minCoord, maxCoord, axisExclusionFt);
        let coords = distributeCoordsEvenly(allowed, count);
        if (coords.length < count) {
            allowed = buildAllowedIntervals(minCoord, maxCoord, 0);
            coords = distributeCoordsEvenly(allowed, count);
        }

        const denom = endX - startX;
        const tMin = edgeBufferT + 1e-5;
        const tMax = 1 - edgeBufferT - 1e-5;
        for (let i = 0; i < coords.length; i++) {
            let t = 0.5;
            if (Math.abs(denom) > EPS) t = (coords[i] - startX) / denom;
            t = clamp01(t);
            out.push(Math.max(tMin, Math.min(tMax, t)));
        }
        return dedupeSorted(out.sort((a, b) => a - b), 1e-6);
    }

    if (interval.axis === 'vertical') {
        const startY = Number(interval.startPt.y) || 0;
        const endY = Number(interval.endPt.y) || 0;
        const yA = startY + (endY - startY) * edgeBufferT;
        const yB = startY + (endY - startY) * (1 - edgeBufferT);
        const minCoord = Math.min(yA, yB);
        const maxCoord = Math.max(yA, yB);
        let allowed = buildAllowedIntervals(minCoord, maxCoord, axisExclusionFt);
        let coords = distributeCoordsEvenly(allowed, count);
        if (coords.length < count) {
            allowed = buildAllowedIntervals(minCoord, maxCoord, 0);
            coords = distributeCoordsEvenly(allowed, count);
        }

        const denom = endY - startY;
        const tMin = edgeBufferT + 1e-5;
        const tMax = 1 - edgeBufferT - 1e-5;
        for (let i = 0; i < coords.length; i++) {
            let t = 0.5;
            if (Math.abs(denom) > EPS) t = (coords[i] - startY) / denom;
            t = clamp01(t);
            out.push(Math.max(tMin, Math.min(tMax, t)));
        }
        return dedupeSorted(out.sort((a, b) => a - b), 1e-6);
    }

    for (let i = 1; i <= count; i++) {
        const raw = i / (count + 1);
        const t = edgeBufferT + (1 - edgeBufferT * 2) * raw;
        out.push(Math.max(edgeBufferT + 1e-5, Math.min(1 - edgeBufferT - 1e-5, t)));
    }
    return out;
}

function estimateWorstSeatsInInterval(interval, count, seatWidthIn, aisleWidthFt, axisExclusionFt, endpointBufferFt = 0) {
    if (!interval || interval.length <= EPS) return 0;
    const ts = distributeIntervalTs(interval, count, axisExclusionFt, endpointBufferFt);
    const bounds = [0, ...ts, 1].sort((a, b) => a - b);
    let worst = 0;

    for (let i = 0; i < bounds.length - 1; i++) {
        const gapFt = Math.max(0, interval.length * (bounds[i + 1] - bounds[i]));
        const seats = Math.floor(Math.max(0, (gapFt - aisleWidthFt) * 12.0) / Math.max(1, seatWidthIn));
        if (seats > worst) worst = seats;
    }

    return worst;
}

function buildChamferSymmetricStations(paths, targetAisles, options = {}) {
    if (!Array.isArray(paths) || !paths.length) return [];
    const pathIndex = Number.isFinite(options.pathIndex) ? Math.max(0, Math.floor(options.pathIndex)) : 0;
    const path = paths[pathIndex];
    if (!path || path.length <= EPS || !path.closed) return [];

    const backPath = (options.backPath && options.backPath.length > EPS) ? options.backPath : path;
    const frontAnchorsAll = findChamferCornerAnchors(path);
    const backAnchorsAll = findChamferCornerAnchors(backPath);
    const cornerCount = Math.min(frontAnchorsAll.length, backAnchorsAll.length);
    if (cornerCount < 2) {
        return computeAisleStations(paths, targetAisles, options);
    }

    const frontAnchors = frontAnchorsAll.slice(0, cornerCount);
    const backAnchors = backAnchorsAll.slice(0, cornerCount);
    const intervalsFront = buildChamferIntervals(path, frontAnchors, cornerCount);
    const intervalsBack = buildChamferIntervals(backPath, backAnchors, cornerCount);

    const forcedStations = Array.isArray(options.forcedStations)
        ? options.forcedStations.filter(fs => Math.max(0, Math.floor(Number(fs.pathIndex) || 0)) === pathIndex)
        : [];
    const widthFt = Math.max(0, Number(options.aisleWidthFt) || 0);
    const axisExclusionFt = Math.max(0, Number(options.axisExclusionFt) || 0);
    const minSpacingFt = Math.max(0.1, Number(options.minSpacingFt) || 1);
    const cornerClearanceFt = Math.max(2.0, widthFt * 1.0, minSpacingFt * 0.5);
    const safeTarget = Math.max(0, Math.round(Number(targetAisles) || 0));
    const seatWidthIn = Math.max(1, Number(options.seatWidthIn) || 20);
    const maxSeatsBetweenAisles = Number(options.maxSeatsBetweenAisles);
    const enforceMaxSeats = Number.isFinite(maxSeatsBetweenAisles) && maxSeatsBetweenAisles > 0;
    const maxGapFt = enforceMaxSeats
        ? ((maxSeatsBetweenAisles * seatWidthIn) / 12.0) + widthFt
        : Infinity;

    const isChamferInterval = (idx) => intervalsBack[idx] && intervalsBack[idx].axis === null;
    const chamferIndices = [];
    const straightIndices = [];
    for (let i = 0; i < cornerCount; i++) {
        if (isChamferInterval(i)) chamferIndices.push(i);
        else straightIndices.push(i);
    }
    const chamferIndexSet = new Set(chamferIndices);
    const hasChamferRing =
        chamferIndices.length >= 4 &&
        cornerCount % 2 === 0 &&
        (() => {
            const half = cornerCount / 2;
            for (let i = 0; i < chamferIndices.length; i++) {
                const idx = chamferIndices[i];
                const opp = (idx + half) % cornerCount;
                if (!chamferIndexSet.has(opp)) return false;
            }
            return true;
        })();

    const list = [];
    const forcedOrdinals = new Set();

    for (let i = 0; i < forcedStations.length; i++) {
        const fs = forcedStations[i];
        const ord = Number.isFinite(fs.cornerOrdinal) ? Math.max(0, Math.floor(fs.cornerOrdinal)) : NaN;
        if (Number.isFinite(ord) && ord < cornerCount) forcedOrdinals.add(ord);
        addStationRecord(path, list, {
            u: fs.u,
            forced: true,
            anchorType: fs.anchorType || 'forced_chamfer',
            cornerOrdinal: Number.isFinite(ord) && ord < cornerCount ? ord : undefined
        }, 1e-3);
    }

    // Ensure every detected chamfer corner is forced.
    for (let ord = 0; ord < cornerCount; ord++) {
        if (forcedOrdinals.has(ord)) continue;
        addStationRecord(path, list, {
            u: frontAnchors[ord].u,
            forced: true,
            anchorType: 'forced_chamfer',
            cornerOrdinal: ord
        }, 1e-3);
    }

    const forcedCount = list.length;
    const requiredCounts = new Array(cornerCount).fill(0);

    if (enforceMaxSeats && maxGapFt > EPS) {
        for (let i = 0; i < cornerCount; i++) {
            let c = 0;
            let worst = estimateWorstSeatsInInterval(intervalsBack[i], c, seatWidthIn, widthFt, axisExclusionFt, cornerClearanceFt);
            while (worst > maxSeatsBetweenAisles && c < 500) {
                c += 1;
                worst = estimateWorstSeatsInInterval(intervalsBack[i], c, seatWidthIn, widthFt, axisExclusionFt, cornerClearanceFt);
            }
            requiredCounts[i] = c;
        }
    }

    if (cornerCount % 2 === 0) {
        const half = cornerCount / 2;
        for (let i = 0; i < half; i++) {
            const j = i + half;
            const base = Math.max(requiredCounts[i], requiredCounts[j]);
            requiredCounts[i] = base;
            requiredCounts[j] = base;
        }
    }

    // Keep chamfer corner intermediate aisle demand uniform across all chamfers.
    // This prevents the "one opposite chamfer pair gets an extra aisle" outcome.
    if (hasChamferRing) {
        let chamferRequired = 0;
        for (let i = 0; i < chamferIndices.length; i++) {
            chamferRequired = Math.max(chamferRequired, requiredCounts[chamferIndices[i]]);
        }
        for (let i = 0; i < chamferIndices.length; i++) {
            requiredCounts[chamferIndices[i]] = chamferRequired;
        }
    }

    const counts = new Array(cornerCount).fill(0);
    const requiredDistributed = requiredCounts.reduce((sum, c) => sum + c, 0);
    const requestedDistributed = Math.max(0, safeTarget - forcedCount);
    // Max seats/row is a hard limit. If the requested aisle target cannot satisfy
    // the back-row seat cap (especially at chamfers), allow extra aisles.
    const desiredDistributed = (enforceMaxSeats && requiredDistributed > 0)
        ? Math.max(requestedDistributed, requiredDistributed)
        : requestedDistributed;

    const totalBackIntervalLength = intervalsBack.reduce((sum, interval) => sum + Math.max(0, interval.length), 0);
    const targetGapFt = totalBackIntervalLength > EPS
        ? totalBackIntervalLength / Math.max(1, desiredDistributed + cornerCount)
        : 0;

    let remaining = desiredDistributed;

    const canAddChamferRing = () => {
        // Only add chamfer extras when they can be applied evenly to ALL chamfers.
        if (!hasChamferRing) return false;
        if (remaining < chamferIndices.length) return false;
        return true;
    };

    // Use the requested aisle count as the baseline target, but when max seats/row
    // is enabled treat it as a hard cap requirement and add aisles if needed.
    if (enforceMaxSeats && requiredDistributed > 0 && remaining > 0) {
        if (cornerCount % 2 === 0) {
            const half = cornerCount / 2;
            while (remaining >= 2) {
                let bestIdx = -1;
                let bestNeed = -Infinity;
                let bestPressure = -Infinity;
                for (let i = 0; i < half; i++) {
                    const j = i + half;
                    if (isChamferInterval(i) && isChamferInterval(j)) continue;
                    const need = Math.max(0, requiredCounts[i] - counts[i]) + Math.max(0, requiredCounts[j] - counts[j]);
                    if (need <= 0) continue;
                    const pressure = Math.max(
                        intervalPressure(intervalsBack[i].length, counts[i]),
                        intervalPressure(intervalsBack[j].length, counts[j])
                    );
                    if (
                        need > bestNeed + 1e-9 ||
                        (Math.abs(need - bestNeed) <= 1e-9 && pressure > bestPressure + 1e-9)
                    ) {
                        bestNeed = need;
                        bestPressure = pressure;
                        bestIdx = i;
                    }
                }
                if (bestIdx < 0) break;
                counts[bestIdx] += 1;
                counts[bestIdx + half] += 1;
                remaining -= 2;
            }
        }

        // Chamfer extras are only added as a full ring so all corners stay even.
        while (canAddChamferRing()) {
            let chamferNeed = 0;
            for (let i = 0; i < chamferIndices.length; i++) {
                const idx = chamferIndices[i];
                chamferNeed = Math.max(chamferNeed, Math.max(0, requiredCounts[idx] - counts[idx]));
            }
            if (chamferNeed <= 0) break;
            for (let i = 0; i < chamferIndices.length; i++) {
                counts[chamferIndices[i]] += 1;
            }
            remaining -= chamferIndices.length;
        }

        while (remaining > 0) {
            let bestIdx = -1;
            let bestNeed = -Infinity;
            let bestPressure = -Infinity;
            for (let i = 0; i < cornerCount; i++) {
                if (isChamferInterval(i)) continue;
                const need = Math.max(0, requiredCounts[i] - counts[i]);
                if (need <= 0) continue;
                const pressure = intervalPressure(intervalsBack[i].length, counts[i]);
                if (
                    need > bestNeed + 1e-9 ||
                    (Math.abs(need - bestNeed) <= 1e-9 && pressure > bestPressure + 1e-9)
                ) {
                    bestNeed = need;
                    bestPressure = pressure;
                    bestIdx = i;
                }
            }
            if (bestIdx < 0) break;
            counts[bestIdx] += 1;
            remaining -= 1;
        }
    }

    const averagePressure = (indices) => {
        if (!indices.length) return NaN;
        let sum = 0;
        for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            sum += intervalPressure(intervalsBack[idx].length, counts[idx]);
        }
        return sum / indices.length;
    };

    const bestPairIndex = (predicate) => {
        if (cornerCount % 2 !== 0) return -1;
        const half = cornerCount / 2;
        let bestIdx = -1;
        let bestBenefit = -Infinity;
        let bestPressure = -Infinity;
        for (let i = 0; i < half; i++) {
            const j = i + half;
            if (typeof predicate === 'function' && !predicate(i, j)) continue;
            const score = pairAllocationBenefit(intervalsBack, counts, i, j, targetGapFt);
            if (
                score.benefit > bestBenefit + 1e-9 ||
                (Math.abs(score.benefit - bestBenefit) <= 1e-9 && score.pressure > bestPressure + 1e-9)
            ) {
                bestBenefit = score.benefit;
                bestPressure = score.pressure;
                bestIdx = i;
            }
        }
        return bestIdx;
    };

    const bestSingleIndex = (predicate) => {
        let bestIdx = -1;
        let bestBenefit = -Infinity;
        let bestPressure = -Infinity;
        for (let i = 0; i < cornerCount; i++) {
            if (typeof predicate === 'function' && !predicate(i)) continue;
            const score = singleAllocationBenefit(intervalsBack, counts, i, targetGapFt);
            if (
                score.benefit > bestBenefit + 1e-9 ||
                (Math.abs(score.benefit - bestBenefit) <= 1e-9 && score.pressure > bestPressure + 1e-9)
            ) {
                bestBenefit = score.benefit;
                bestPressure = score.pressure;
                bestIdx = i;
            }
        }
        return bestIdx;
    };

    while (remaining > 0) {
        let allocated = false;

        if (cornerCount % 2 === 0 && remaining >= 2) {
            const straightPair = bestPairIndex((i, j) => !isChamferInterval(i) && !isChamferInterval(j));
            const straightPressure = averagePressure(straightIndices);
            const chamferPressure = averagePressure(chamferIndices);
            const chamferRingReady =
                canAddChamferRing() &&
                Number.isFinite(straightPressure) &&
                Number.isFinite(chamferPressure) &&
                straightPressure <= chamferPressure + 1e-9;

            if (straightPair >= 0 && !chamferRingReady) {
                const half = cornerCount / 2;
                counts[straightPair] += 1;
                counts[straightPair + half] += 1;
                remaining -= 2;
                allocated = true;
            } else if (chamferRingReady) {
                for (let i = 0; i < chamferIndices.length; i++) {
                    counts[chamferIndices[i]] += 1;
                }
                remaining -= chamferIndices.length;
                allocated = true;
            } else {
                // Fallback: if no straight pair is available, keep filling evenly.
                const anyPair = bestPairIndex((i, j) => !(isChamferInterval(i) && isChamferInterval(j)));
                if (anyPair >= 0) {
                    const half = cornerCount / 2;
                    counts[anyPair] += 1;
                    counts[anyPair + half] += 1;
                    remaining -= 2;
                    allocated = true;
                }
            }
        }

        if (allocated) continue;

        // Single-aisle remainder (odd target): prefer straights first.
        const straightSingle = bestSingleIndex(i => !isChamferInterval(i));
        if (straightSingle >= 0) {
            counts[straightSingle] += 1;
            remaining -= 1;
            continue;
        }

        // Do not place a one-off aisle in a chamfer interval; that breaks
        // corner parity. If no straight interval can accept the remainder, stop.
        break;
    }

    for (let i = 0; i < cornerCount; i++) {
        const count = counts[i];
        if (count <= 0) continue;
        const intervalFront = intervalsFront[i];
        const intervalBack = intervalsBack[i];
        const ts = distributeIntervalTs(intervalBack, count, axisExclusionFt, cornerClearanceFt);

        for (let k = 0; k < ts.length; k++) {
            const t = clamp01(ts[k]);
            const u = interpolateWrappedU(intervalFront.startU, intervalFront.endU, t);
            addStationRecord(path, list, {
                u,
                forced: false,
                anchorType: 'segment_fraction',
                segmentIndex: i,
                segmentT: t
            }, Math.max(1e-3, minSpacingFt * 0.2));
        }
    }

    const desiredTotal = forcedCount + desiredDistributed;
    if (list.length < desiredTotal) {
        const keepStations = list
            .map(rec => ({
            pathIndex,
            u: rec.u,
            forced: true,
            anchorType: rec.anchorType,
            cornerOrdinal: rec.cornerOrdinal,
            segmentIndex: rec.segmentIndex,
            segmentT: rec.segmentT
            }));

        return computeAisleStations(paths, desiredTotal, {
            ...options,
            forcedStations: keepStations,
            allowOppositePairs: true,
            // Preserve chamfer parity by preventing generic fallback from
            // adding one-off diagonal (chamfer) stations.
            axisOnlyCandidates: hasChamferRing ? true : false
        });
    }

    return list
        .slice()
        .sort((a, b) => a.u - b.u)
        .map(rec => {
            const aisle = {
                pathIndex,
                u: path.closed ? normalizeUnit(rec.u) : clamp01(rec.u),
                forced: !!rec.forced,
                anchorType: rec.anchorType || (rec.forced ? 'forced' : 'distributed')
            };
            if (Number.isFinite(rec.cornerOrdinal)) aisle.cornerOrdinal = rec.cornerOrdinal;
            if (Number.isFinite(rec.segmentIndex)) aisle.segmentIndex = rec.segmentIndex;
            if (Number.isFinite(rec.segmentT)) aisle.segmentT = rec.segmentT;
            return aisle;
        });
}

function buildSectionBoundaries(paths, aisles) {
    const byPath = paths.map(() => []);
    aisles.forEach((aisle, idx) => {
        const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
        if (!byPath[pathIndex]) return;
        byPath[pathIndex].push({
            aisleIndex: idx,
            u: Number(aisle.u) || 0,
            forced: !!aisle.forced
        });
    });
    return byPath.map(entries => entries.sort((a, b) => a.u - b.u));
}

/**
 * Build a tier-level aisle layout from front-edge bowl geometry.
 * @param {Object} params
 * @returns {{aisles:Array,aisleWidthFt:number,targetAisles:number,forcedCount:number,sectionBoundaries:Array,axisExclusionFt:number}}
 */
export function buildTierAisleLayout(params) {
    const {
        frontSegments,
        backSegments = null,
        targetAisles = 0,
        aisleWidthFt = 4,
        bowlConfig = null,
        axisToleranceFt = 2,
        maxSeatsBetweenAisles = NaN,
        seatWidthIn = 20
    } = params || {};

    const paths = buildGeometryPaths(frontSegments);
    const backPaths = (Array.isArray(backSegments) && backSegments.length)
        ? buildGeometryPaths(backSegments)
        : paths;
    if (!paths.length) {
        return {
            aisles: [],
            aisleWidthFt: Math.max(0, Number(aisleWidthFt) || 0),
            targetAisles: 0,
            forcedCount: 0,
            sectionBoundaries: [],
            axisExclusionFt: Math.max(0.5, Number(axisToleranceFt) || 2)
        };
    }

    const forceChamfer = String(bowlConfig && bowlConfig.corner ? bowlConfig.corner : '').toLowerCase() === 'chamfer';
    const forcedStations = [];

    if (forceChamfer) {
        for (let i = 0; i < paths.length; i++) {
            const corners = findChamferCornerAnchors(paths[i]);
            for (let c = 0; c < corners.length; c++) {
                forcedStations.push({
                    pathIndex: i,
                    u: corners[c].u,
                    forced: true,
                    anchorType: 'forced_chamfer',
                    cornerOrdinal: corners[c].ordinal
                });
            }
        }
    }

    const safeTarget = Math.max(0, Math.round(Number(targetAisles) || 0));
    const widthFt = Math.max(0, Number(aisleWidthFt) || 0);
    const minSpacingFt = Math.max(widthFt * 1.05, 1.25);
    const axisExclusionFt = Math.max(0.5, Number(axisToleranceFt) || 2, widthFt * 0.5 + 0.25);

    let aisles = [];
    const bowlType = String(bowlConfig && bowlConfig.type ? bowlConfig.type : '').toLowerCase();
    const useIndependentSidesOpenDistribution =
        bowlType === 'sides' &&
        paths.length >= 2 &&
        paths.every(p => p && !p.closed && p.length > EPS) &&
        forcedStations.length === 0;
    const useEvenOpenPathDistribution =
        paths.length === 1 &&
        !!paths[0] &&
        !paths[0].closed &&
        forcedStations.length === 0;

    if (useIndependentSidesOpenDistribution) {
        // "Sides" mode is two independent linear runs with mirrored egress.
        aisles = computeEvenAislesForOpenPaths(paths, safeTarget, widthFt);
    } else if (useEvenOpenPathDistribution) {
        // Linear/sliced open runs treat aisle lines as edge-to-edge boundaries.
        // Rebuild the full set every time so added aisles re-space evenly.
        aisles = computeEvenOpenPathAisleStations(paths, safeTarget, widthFt);
    } else if (forceChamfer && paths.length === 1 && paths[0].closed) {
        aisles = buildChamferSymmetricStations(paths, safeTarget, {
            pathIndex: 0,
            backPath: backPaths[0] || paths[0],
            forcedStations,
            aisleWidthFt: widthFt,
            minSpacingFt,
            avoidCenterAxes: true,
            axisToleranceFt: Math.max(0.5, Number(axisToleranceFt) || 2),
            axisExclusionFt,
            allowOppositePairs: true,
            axisOnlyCandidates: true,
            maxSeatsBetweenAisles,
            seatWidthIn
        });
    } else {
        aisles = computeAisleStations(paths, safeTarget, {
            forcedStations,
            minSpacingFt,
            avoidCenterAxes: true,
            axisToleranceFt: Math.max(0.5, Number(axisToleranceFt) || 2),
            axisExclusionFt,
            allowOppositePairs: true,
            axisOnlyCandidates: forceChamfer
        });
    }

    return {
        aisles,
        aisleWidthFt: widthFt,
        targetAisles: Math.max(safeTarget, aisles.length),
        forcedCount: aisles.filter(a => a.forced).length,
        sectionBoundaries: buildSectionBoundaries(paths, aisles),
        axisExclusionFt
    };
}
