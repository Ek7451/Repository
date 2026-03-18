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

function addStationRecord(path, stationRecords, rec, tolFt = 1e-3) {
    if (!path || path.length <= EPS) return false;
    const u = path.closed ? normalizeUnit(rec.u) : clamp01(rec.u);
    for (let i = 0; i < stationRecords.length; i++) {
        if (stationDistance(path, u, stationRecords[i].u) <= tolFt) return false;
    }
    stationRecords.push({ ...rec, u });
    return true;
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

function interpolatePathIntervalU(path, startU, endU, t) {
    if (path && path.closed) return interpolateWrappedU(startU, endU, t);
    const a = clamp01(startU);
    const b = clamp01(endU);
    return clamp01(a + (b - a) * clamp01(t));
}

function resolvePathIntervalT(path, startU, endU, u) {
    if (!Number.isFinite(u)) return 0;
    if (path && path.closed) {
        const w = computeWrappedSpan(startU, endU);
        let offset = normalizeUnit(u) - w.start;
        if (offset < 0) offset += 1;
        return w.span > EPS ? clamp01(offset / w.span) : 0;
    }

    const a = clamp01(startU);
    const b = clamp01(endU);
    const span = b - a;
    if (Math.abs(span) <= EPS) return 0;
    return clamp01((clamp01(u) - a) / span);
}

function isChamferTransition(prev, next) {
    if (!prev || !next || prev.type !== 'line' || next.type !== 'line') return false;
    const prevDir = partEndDirection(prev);
    const nextDir = partStartDirection(next);
    return (
        (isDiagonal(prevDir) && isAxisAligned(nextDir)) ||
        (isAxisAligned(prevDir) && isDiagonal(nextDir))
    );
}

function isChamferLikePart(part) {
    if (!part || part.type !== 'line') return false;
    return isDiagonal(partStartDirection(part));
}

/**
 * Collect stable chamfer/straight transition anchors along a path.
 * @param {Object} path
 * @returns {Array<{u:number,ordinal:number,dist:number,x:number,y:number}>}
 */
function collectTransitionAnchors(path) {
    if (!path || !path.parts || !path.parts.length || path.length <= EPS) return [];

    /** @type {Array<{u:number,ordinal?:number,dist:number,x:number,y:number}>} */
    const raw = [];
    const parts = path.parts;
    const count = parts.length;

    const pushAnchor = (dist) => {
        const safeDist = Math.max(0, Math.min(path.length, Number(dist) || 0));
        const u = path.closed ? normalizeUnit(safeDist / path.length) : clamp01(safeDist / path.length);
        const pt = samplePathPoint(path, safeDist);
        raw.push({ u, dist: safeDist, x: pt.x, y: pt.y });
    };

    if (path.closed) {
        for (let i = 0; i < count; i++) {
            const prev = parts[(i - 1 + count) % count];
            const next = parts[i % count];
            if (isChamferTransition(prev, next)) pushAnchor(next.startDist);
        }
    } else {
        for (let i = 1; i < count; i++) {
            const prev = parts[i - 1];
            const next = parts[i];
            if (isChamferTransition(prev, next)) pushAnchor(next.startDist);
        }
        if (isChamferLikePart(parts[0])) pushAnchor(0);
        if (isChamferLikePart(parts[count - 1])) pushAnchor(path.length);
    }

    if (!raw.length) return [];

    raw.sort((a, b) => a.u - b.u);
    const deduped = [raw[0]];
    for (let i = 1; i < raw.length; i++) {
        if (Math.abs(raw[i].u - deduped[deduped.length - 1].u) > 1e-5) deduped.push(raw[i]);
    }

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

function getCachedPathTopologyEntry(path, cache) {
    if (!path || !cache) return null;
    const cached = cache.get(path);
    if (cached && !Array.isArray(cached)) return cached;

    const entry = cached && Array.isArray(cached)
        ? { transitionAnchors: cached }
        : {};
    cache.set(path, entry);
    return entry;
}

function getCachedTransitionAnchors(path, cache) {
    if (!path) return [];
    if (!cache) return collectTransitionAnchors(path);

    const entry = getCachedPathTopologyEntry(path, cache);
    if (!entry.transitionAnchors) entry.transitionAnchors = collectTransitionAnchors(path);
    return entry.transitionAnchors;
}

function buildIntervalSideRecord(path, startAnchor, endAnchor) {
    if (!path || !startAnchor || !endAnchor || path.length <= EPS) return null;

    const span = path.closed
        ? computeWrappedSpan(startAnchor.u, endAnchor.u).span
        : Math.max(0, clamp01(endAnchor.u) - clamp01(startAnchor.u));
    const startPt = samplePathPointByRatio(path, startAnchor.u);
    const endPt = samplePathPointByRatio(path, endAnchor.u);
    const axis = classifyAxisDirection({
        x: endPt.x - startPt.x,
        y: endPt.y - startPt.y
    });

    return {
        startOrdinal: startAnchor.ordinal,
        endOrdinal: endAnchor.ordinal,
        startU: startAnchor.u,
        endU: endAnchor.u,
        span,
        length: span * path.length,
        startPt,
        endPt,
        axis
    };
}

function getAnchorSetsForIntervals(anchors) {
    if (Array.isArray(anchors)) {
        return { front: anchors, back: anchors };
    }

    const front = Array.isArray(anchors && anchors.front) ? anchors.front : [];
    const back = Array.isArray(anchors && anchors.back) ? anchors.back : front;
    return { front, back };
}

function buildPerimeterIntervals(pathFront, pathBack, anchors) {
    const anchorSets = getAnchorSetsForIntervals(anchors);
    const frontAnchors = anchorSets.front;
    const backAnchors = anchorSets.back;
    const closed = pathFront
        ? !!pathFront.closed
        : !!(pathBack && pathBack.closed);
    const count = Math.min(frontAnchors.length, backAnchors.length);
    if (count < 2) return [];

    const intervalCount = closed ? count : (count - 1);
    const out = [];

    for (let i = 0; i < intervalCount; i++) {
        const nextIndex = closed ? ((i + 1) % count) : (i + 1);
        const front = buildIntervalSideRecord(pathFront, frontAnchors[i], frontAnchors[nextIndex]);
        const back = buildIntervalSideRecord(pathBack, backAnchors[i], backAnchors[nextIndex]);
        const axis = back?.axis || front?.axis || null;

        out.push({
            index: i,
            closed,
            frontPath: pathFront,
            backPath: pathBack,
            front,
            back,
            axis,
            family: axis ? 'straight' : 'chamfer',
            symmetryKey: `interval:${i}`,
            oppositeIndex: null
        });
    }

    return out;
}

function buildSymmetryGroups(path, intervals, bowlConfig) {
    const list = Array.isArray(intervals) ? intervals : [];
    const bowlType = String(bowlConfig && bowlConfig.type ? bowlConfig.type : '').toLowerCase();
    const supportsOpposites =
        !!(path && path.closed) &&
        list.length >= 2 &&
        list.length % 2 === 0 &&
        (bowlType === '' || bowlType === 'full');

    for (let i = 0; i < list.length; i++) {
        list[i].symmetryKey = `interval:${list[i].index}`;
        list[i].oppositeIndex = null;
    }

    if (!supportsOpposites) return list;

    const half = list.length / 2;
    for (let i = 0; i < list.length; i++) {
        const oppositeIndex = (i + half) % list.length;
        list[i].oppositeIndex = oppositeIndex;
        list[i].symmetryKey = `opposite:${Math.min(i, oppositeIndex)}`;
    }

    return list;
}

function buildPerimeterModel(frontPaths, backPaths, bowlConfig) {
    const safeFrontPaths = Array.isArray(frontPaths) ? frontPaths : [];
    const safeBackPaths = (Array.isArray(backPaths) && backPaths.length)
        ? backPaths
        : safeFrontPaths;
    const pathCount = Math.max(safeFrontPaths.length, safeBackPaths.length);
    const paths = new Array(pathCount).fill(null);

    for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
        const frontPath = safeFrontPaths[pathIndex] || null;
        const backPath = safeBackPaths[pathIndex] || frontPath;
        if (!frontPath && !backPath) continue;

        const frontAnchorsAll = collectTransitionAnchors(frontPath);
        const backAnchorsAll = collectTransitionAnchors(backPath);
        const transitionCount = Math.min(frontAnchorsAll.length, backAnchorsAll.length);
        const frontAnchors = frontAnchorsAll.slice(0, transitionCount);
        const backAnchors = backAnchorsAll.slice(0, transitionCount);
        const intervals = buildPerimeterIntervals(frontPath, backPath, {
            front: frontAnchors,
            back: backAnchors
        });
        buildSymmetryGroups(frontPath || backPath, intervals, bowlConfig);

        paths[pathIndex] = {
            pathIndex,
            frontPath,
            backPath,
            closed: !!((frontPath && frontPath.closed) || (backPath && backPath.closed)),
            frontAnchors,
            backAnchors,
            intervals
        };
    }

    return {
        bowlType: String(bowlConfig && bowlConfig.type ? bowlConfig.type : ''),
        cornerType: String(bowlConfig && bowlConfig.corner ? bowlConfig.corner : ''),
        paths
    };
}

function getPerimeterIntervalByIndex(pathFront, pathBack, aisle, cache) {
    if (!aisle || !Number.isFinite(aisle.segmentIndex)) return null;
    const intervals = getCachedPerimeterIntervals(pathFront, pathBack, cache);
    if (!intervals.length) return null;

    const closed = pathFront
        ? !!pathFront.closed
        : !!(pathBack && pathBack.closed);
    let index = Math.max(0, Math.floor(Number(aisle.segmentIndex) || 0));
    if (closed) index %= intervals.length;
    else index = Math.min(intervals.length - 1, index);
    return intervals[index] || null;
}

function getCachedPerimeterIntervals(pathFront, pathBack, cache) {
    const sourcePath = pathFront || pathBack;
    const targetPath = pathBack || pathFront;
    if (!sourcePath || !targetPath) return [];

    if (!cache) {
        return buildPerimeterIntervals(pathFront, pathBack, {
            front: collectTransitionAnchors(pathFront),
            back: collectTransitionAnchors(pathBack)
        });
    }

    const entry = getCachedPathTopologyEntry(sourcePath, cache);
    if (!entry.intervalsByTarget) entry.intervalsByTarget = new Map();

    if (!entry.intervalsByTarget.has(targetPath)) {
        entry.intervalsByTarget.set(targetPath, buildPerimeterIntervals(pathFront, pathBack, {
            front: getCachedTransitionAnchors(pathFront, cache),
            back: getCachedTransitionAnchors(pathBack, cache)
        }));
    }

    return entry.intervalsByTarget.get(targetPath);
}

function normalizeResolvedStationRatios(pathFront, pathBack, uFront, uBack) {
    if (!Number.isFinite(uFront) && Number.isFinite(uBack)) uFront = uBack;
    if (!Number.isFinite(uBack) && Number.isFinite(uFront)) uBack = uFront;
    if (!Number.isFinite(uFront) || !Number.isFinite(uBack)) return null;

    if (pathFront) uFront = pathFront.closed ? normalizeUnit(uFront) : clamp01(uFront);
    if (pathBack) uBack = pathBack.closed ? normalizeUnit(uBack) : clamp01(uBack);
    return { uFront, uBack };
}

function normalizeAlignmentMode(mode) {
    return String(mode || '').toLowerCase() === 'perpendicular'
        ? 'perpendicular'
        : 'radial';
}

function resolveTransitionOrdinal(pathFront, pathBack, aisle, cache = null) {
    if (!aisle || !Number.isFinite(aisle.cornerOrdinal)) return null;

    let uFront = Number.isFinite(aisle.uFront) ? aisle.uFront : (Number.isFinite(aisle.u) ? aisle.u : NaN);
    let uBack = Number.isFinite(aisle.uBack) ? aisle.uBack : (Number.isFinite(aisle.u) ? aisle.u : NaN);
    const ordinal = Math.max(0, Math.floor(Number(aisle.cornerOrdinal) || 0));

    if (pathFront) {
        const frontAnchors = getCachedTransitionAnchors(pathFront, cache);
        if (ordinal < frontAnchors.length) uFront = frontAnchors[ordinal].u;
    }

    if (pathBack) {
        const backAnchors = getCachedTransitionAnchors(pathBack, cache);
        if (ordinal < backAnchors.length) uBack = backAnchors[ordinal].u;
    }

    return normalizeResolvedStationRatios(pathFront, pathBack, uFront, uBack);
}

function resolveRadialStationRatios(pathFront, pathBack, aisle, cache = null) {
    if (!aisle) return null;

    let uFront = Number.isFinite(aisle.uFront) ? aisle.uFront : (Number.isFinite(aisle.u) ? aisle.u : NaN);
    let uBack = Number.isFinite(aisle.uBack) ? aisle.uBack : (Number.isFinite(aisle.u) ? aisle.u : NaN);
    const interval = getPerimeterIntervalByIndex(pathFront, pathBack, aisle, cache);

    if (interval && Number.isFinite(aisle.segmentT)) {
        const segT = clamp01(aisle.segmentT);
        if (interval.front) {
            uFront = interpolatePathIntervalU(pathFront, interval.front.startU, interval.front.endU, segT);
        }
        if (interval.back) {
            uBack = interpolatePathIntervalU(pathBack, interval.back.startU, interval.back.endU, segT);
        }
    }

    return normalizeResolvedStationRatios(pathFront, pathBack, uFront, uBack);
}

function getIntervalSideForPath(intervalRecord, path) {
    if (!intervalRecord || !path) return null;
    if (intervalRecord.frontPath === path) return intervalRecord.front || null;
    if (intervalRecord.backPath === path) return intervalRecord.back || null;
    return null;
}

function projectPerpendicularStationToCounterpart(pathSource, pathTarget, intervalRecord, sourceU) {
    if (!pathSource || !pathTarget || !Number.isFinite(sourceU)) return NaN;

    const sourcePt = samplePathPointByRatio(pathSource, sourceU);
    const sourceSide = getIntervalSideForPath(intervalRecord, pathSource);
    const targetSide = getIntervalSideForPath(intervalRecord, pathTarget);
    const axis = sourceSide?.axis || targetSide?.axis || classifyAxisDirection(sourcePt);
    const fallbackU = targetSide
        ? interpolatePathIntervalU(
            pathTarget,
            targetSide.startU,
            targetSide.endU,
            sourceSide
                ? resolvePathIntervalT(pathSource, sourceSide.startU, sourceSide.endU, sourceU)
                : 0.5
        )
        : (pathTarget.closed ? normalizeUnit(sourceU) : clamp01(sourceU));

    if (axis === 'horizontal') {
        const sideSign = sourcePt.y >= 0 ? 1 : -1;
        const targetU = findAxisEdgeStationByCoordinate(
            pathTarget,
            'horizontal',
            sourcePt.x,
            sideSign,
            fallbackU
        );
        if (Number.isFinite(targetU)) return targetU;
    } else if (axis === 'vertical') {
        const sideSign = sourcePt.x >= 0 ? 1 : -1;
        const targetU = findAxisEdgeStationByCoordinate(
            pathTarget,
            'vertical',
            sourcePt.y,
            sideSign,
            fallbackU
        );
        if (Number.isFinite(targetU)) return targetU;
    }

    if (sourceSide && targetSide) {
        const t = resolvePathIntervalT(pathSource, sourceSide.startU, sourceSide.endU, sourceU);
        return interpolatePathIntervalU(pathTarget, targetSide.startU, targetSide.endU, t);
    }

    return fallbackU;
}

function resolvePerpendicularStationRatios(pathFront, pathBack, aisle, cache = null) {
    const radial = resolveRadialStationRatios(pathFront, pathBack, aisle, cache);
    if (!radial) return null;

    const interval = getPerimeterIntervalByIndex(pathFront, pathBack, aisle, cache);
    const useBackDrivenSource =
        Number.isFinite(aisle && aisle.segmentIndex) &&
        Number.isFinite(aisle && aisle.segmentT) &&
        pathBack &&
        Number.isFinite(radial.uBack);

    if (pathFront && pathBack) {
        if (useBackDrivenSource) {
            const projectedFront = projectPerpendicularStationToCounterpart(pathBack, pathFront, interval, radial.uBack);
            if (Number.isFinite(projectedFront)) radial.uFront = projectedFront;
        } else if (Number.isFinite(radial.uFront)) {
            const projectedBack = projectPerpendicularStationToCounterpart(pathFront, pathBack, interval, radial.uFront);
            if (Number.isFinite(projectedBack)) radial.uBack = projectedBack;
        } else if (Number.isFinite(radial.uBack)) {
            const projectedFront = projectPerpendicularStationToCounterpart(pathBack, pathFront, interval, radial.uBack);
            if (Number.isFinite(projectedFront)) radial.uFront = projectedFront;
        }
    }

    return normalizeResolvedStationRatios(pathFront, pathBack, radial.uFront, radial.uBack);
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

    const transition = resolveTransitionOrdinal(pathFront, pathBack, aisle, chamferCache);
    if (transition) return transition;

    const alignmentMode = normalizeAlignmentMode(aisle.alignmentMode);
    return alignmentMode === 'perpendicular'
        ? resolvePerpendicularStationRatios(pathFront, pathBack, aisle, chamferCache)
        : resolveRadialStationRatios(pathFront, pathBack, aisle, chamferCache);
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

function computeEvenClosedPathAisleStations(paths, targetAisles) {
    if (!Array.isArray(paths) || paths.length !== 1) return [];
    const path = paths[0];
    if (!path || !path.closed || path.length <= EPS) return [];

    const target = Math.max(0, Math.round(Number(targetAisles) || 0));
    if (target <= 0) return [];

    const out = [];
    for (let i = 0; i < target; i++) {
        out.push({
            pathIndex: 0,
            u: normalizeUnit(i / target),
            forced: false,
            anchorType: 'distributed_closed_even'
        });
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

function compareAislesByPathAndStation(a, b) {
    const pathDelta = (Number(a?.pathIndex) || 0) - (Number(b?.pathIndex) || 0);
    if (pathDelta !== 0) return pathDelta;
    return (Number(a?.u) || 0) - (Number(b?.u) || 0);
}

function getPerimeterIntervalEntries(perimeterModel, predicate = null) {
    const out = [];
    if (!perimeterModel || !Array.isArray(perimeterModel.paths)) return out;

    for (let pathIndex = 0; pathIndex < perimeterModel.paths.length; pathIndex++) {
        const pathRecord = perimeterModel.paths[pathIndex];
        if (!pathRecord || !Array.isArray(pathRecord.intervals)) continue;

        for (let i = 0; i < pathRecord.intervals.length; i++) {
            const interval = pathRecord.intervals[i];
            if (!interval) continue;

            const entry = {
                pathIndex: pathRecord.pathIndex,
                pathRecord,
                interval
            };
            if (!predicate || predicate(entry)) out.push(entry);
        }
    }

    return out;
}

function createPerimeterCountMatrix(perimeterModel, sourceCounts = null) {
    const paths = Array.isArray(perimeterModel?.paths) ? perimeterModel.paths : [];
    const out = new Array(paths.length).fill(null).map(() => []);

    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
        const length = paths[pathIndex]?.intervals?.length || 0;
        out[pathIndex] = new Array(length).fill(0);

        const sourceRow = Array.isArray(sourceCounts?.[pathIndex]) ? sourceCounts[pathIndex] : [];
        for (let i = 0; i < length; i++) {
            out[pathIndex][i] = Math.max(0, Math.floor(Number(sourceRow[i]) || 0));
        }
    }

    return out;
}

function getIntervalSide(interval) {
    return interval?.back || interval?.front || null;
}

function getIntervalLength(interval) {
    return Math.max(0, Number(getIntervalSide(interval)?.length) || 0);
}

function getIntervalMidpoint(interval) {
    const side = getIntervalSide(interval);
    return {
        x: ((Number(side?.startPt?.x) || 0) + (Number(side?.endPt?.x) || 0)) * 0.5,
        y: ((Number(side?.startPt?.y) || 0) + (Number(side?.endPt?.y) || 0)) * 0.5
    };
}

function comparePreferredIntervalEntries(a, b) {
    if (!a) return 1;
    if (!b) return -1;

    const lengthDelta = getIntervalLength(b.interval) - getIntervalLength(a.interval);
    if (Math.abs(lengthDelta) > 1e-9) return lengthDelta;

    const aMid = getIntervalMidpoint(a.interval);
    const bMid = getIntervalMidpoint(b.interval);
    if (Math.abs(bMid.y - aMid.y) > 1e-9) return bMid.y - aMid.y;
    if (Math.abs(bMid.x - aMid.x) > 1e-9) return bMid.x - aMid.x;
    if (a.pathIndex !== b.pathIndex) return a.pathIndex - b.pathIndex;
    return a.interval.index - b.interval.index;
}

function getPreferredPairMidpoint(pairEntry) {
    const first = getIntervalMidpoint(pairEntry.interval);
    const second = getIntervalMidpoint(pairEntry.opposite);
    if (second.y > first.y + 1e-9) return second;
    if (first.y > second.y + 1e-9) return first;
    if (second.x > first.x + 1e-9) return second;
    return first;
}

function comparePreferredPairEntries(a, b) {
    if (!a) return 1;
    if (!b) return -1;

    const aLength = Math.max(getIntervalLength(a.interval), getIntervalLength(a.opposite));
    const bLength = Math.max(getIntervalLength(b.interval), getIntervalLength(b.opposite));
    if (Math.abs(bLength - aLength) > 1e-9) return bLength - aLength;

    const aMid = getPreferredPairMidpoint(a);
    const bMid = getPreferredPairMidpoint(b);
    if (Math.abs(bMid.y - aMid.y) > 1e-9) return bMid.y - aMid.y;
    if (Math.abs(bMid.x - aMid.x) > 1e-9) return bMid.x - aMid.x;
    if (a.pathIndex !== b.pathIndex) return a.pathIndex - b.pathIndex;
    return a.interval.index - b.interval.index;
}

function isSymmetricClosedPathRecord(pathRecord) {
    return !!pathRecord?.closed &&
        Array.isArray(pathRecord?.intervals) &&
        pathRecord.intervals.some(interval => Number.isFinite(interval?.oppositeIndex));
}

function getStraightPairEntries(perimeterModel) {
    return getPerimeterIntervalEntries(perimeterModel, ({ pathRecord, interval }) => {
        if (!isSymmetricClosedPathRecord(pathRecord)) return false;
        if (interval?.family !== 'straight') return false;
        if (!Number.isFinite(interval?.oppositeIndex)) return false;
        if (interval.index > interval.oppositeIndex) return false;

        const opposite = pathRecord.intervals[interval.oppositeIndex];
        return !!opposite && opposite.family === 'straight';
    }).map((entry) => ({
        ...entry,
        opposite: entry.pathRecord.intervals[entry.interval.oppositeIndex]
    }));
}

function buildForcedTransitionAisles(perimeterModel) {
    const out = [];
    if (!perimeterModel || !Array.isArray(perimeterModel.paths)) return out;

    for (let pathIndex = 0; pathIndex < perimeterModel.paths.length; pathIndex++) {
        const pathRecord = perimeterModel.paths[pathIndex];
        const path = pathRecord?.frontPath || pathRecord?.backPath;
        const anchors = Array.isArray(pathRecord?.frontAnchors) ? pathRecord.frontAnchors : [];
        if (!path || !anchors.length) continue;

        for (let i = 0; i < anchors.length; i++) {
            out.push({
                pathIndex: pathRecord.pathIndex,
                u: path.closed ? normalizeUnit(anchors[i].u) : clamp01(anchors[i].u),
                forced: true,
                anchorType: 'forced_chamfer',
                cornerOrdinal: anchors[i].ordinal
            });
        }
    }

    return out.sort(compareAislesByPathAndStation);
}

function computeRequiredSegmentCounts(perimeterModel, options) {
    const counts = createPerimeterCountMatrix(perimeterModel);
    const maxSeatsBetweenAisles = Number(options?.maxSeatsBetweenAisles);
    if (!(Number.isFinite(maxSeatsBetweenAisles) && maxSeatsBetweenAisles > 0)) return counts;

    const seatWidthIn = Math.max(1, Number(options?.seatWidthIn) || 20);
    const aisleWidthFt = Math.max(0, Number(options?.aisleWidthFt) || 0);
    const axisExclusionFt = Math.max(0, Number(options?.axisExclusionFt) || 0);
    const endpointBufferFt = Math.max(0, Number(options?.endpointBufferFt) || 0);

    getPerimeterIntervalEntries(perimeterModel).forEach(({ pathIndex, interval }) => {
        const intervalSide = interval.back || interval.front;
        if (!intervalSide || intervalSide.length <= EPS) return;

        let required = 0;
        while (
            estimateWorstSeatsInInterval(
                intervalSide,
                required,
                seatWidthIn,
                aisleWidthFt,
                axisExclusionFt,
                endpointBufferFt
            ) > maxSeatsBetweenAisles &&
            required < 500
        ) {
            required += 1;
        }

        counts[pathIndex][interval.index] = required;
    });

    return counts;
}

function normalizeRequiredCountsForSymmetry(perimeterModel, requiredCounts) {
    const counts = createPerimeterCountMatrix(perimeterModel, requiredCounts);

    if (!perimeterModel || !Array.isArray(perimeterModel.paths)) return counts;
    for (let pathIndex = 0; pathIndex < perimeterModel.paths.length; pathIndex++) {
        const pathRecord = perimeterModel.paths[pathIndex];
        if (!isSymmetricClosedPathRecord(pathRecord)) continue;

        for (let i = 0; i < pathRecord.intervals.length; i++) {
            const interval = pathRecord.intervals[i];
            if (!Number.isFinite(interval?.oppositeIndex)) continue;
            if (interval.index > interval.oppositeIndex) continue;

            const mirrored = Math.max(
                counts[pathIndex][interval.index],
                counts[pathIndex][interval.oppositeIndex]
            );
            counts[pathIndex][interval.index] = mirrored;
            counts[pathIndex][interval.oppositeIndex] = mirrored;
        }
    }

    return counts;
}

function sumIntervalCounts(intervalCounts) {
    if (!Array.isArray(intervalCounts)) return 0;
    return intervalCounts.reduce(
        (sum, row) => sum + (Array.isArray(row) ? row.reduce((inner, value) => inner + Math.max(0, Math.floor(Number(value) || 0)), 0) : 0),
        0
    );
}

function choosePreferredSingleEntry(entries, intervalCounts) {
    let best = null;
    let bestPressure = -Infinity;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const currentCount = Math.max(0, Math.floor(Number(intervalCounts?.[entry.pathIndex]?.[entry.interval.index]) || 0));
        const pressure = getIntervalLength(entry.interval) / Math.max(1, currentCount + 1);

        if (
            pressure > bestPressure + 1e-9 ||
            (Math.abs(pressure - bestPressure) <= 1e-9 && comparePreferredIntervalEntries(entry, best) < 0)
        ) {
            best = entry;
            bestPressure = pressure;
        }
    }

    return best;
}

function allocateSingleEntries(entries, allocationState, remaining) {
    let left = Math.max(0, Math.floor(Number(remaining) || 0));
    if (!entries.length) return left;

    while (left > 0) {
        const best = choosePreferredSingleEntry(entries, allocationState.counts);
        if (!best) break;

        allocationState.counts[best.pathIndex][best.interval.index] += 1;
        left -= 1;
    }

    return left;
}

function allocateStraightPairs(perimeterModel, allocationState, remaining) {
    let left = Math.max(0, Math.floor(Number(remaining) || 0));
    const pairEntries = getStraightPairEntries(perimeterModel);
    if (!pairEntries.length) return left;

    while (left >= 2) {
        let best = null;
        let bestPressure = -Infinity;

        for (let i = 0; i < pairEntries.length; i++) {
            const entry = pairEntries[i];
            const currentCount = Math.max(
                0,
                Math.floor(Number(allocationState.counts?.[entry.pathIndex]?.[entry.interval.index]) || 0)
            );
            const pressure = getIntervalLength(entry.interval) / Math.max(1, currentCount + 1);

            if (
                pressure > bestPressure + 1e-9 ||
                (Math.abs(pressure - bestPressure) <= 1e-9 && comparePreferredPairEntries(entry, best) < 0)
            ) {
                best = entry;
                bestPressure = pressure;
            }
        }

        if (!best) break;
        allocationState.counts[best.pathIndex][best.interval.index] += 1;
        allocationState.counts[best.pathIndex][best.opposite.index] += 1;
        left -= 2;
    }

    return left;
}

function allocateSingleOddRemainder(perimeterModel, allocationState) {
    const straightEntries = getPerimeterIntervalEntries(perimeterModel, ({ pathRecord, interval }) =>
        isSymmetricClosedPathRecord(pathRecord) && interval?.family === 'straight'
    );
    if (!straightEntries.length) return 1;

    const best = straightEntries
        .slice()
        .sort(comparePreferredIntervalEntries)[0];
    if (!best) return 1;

    allocationState.counts[best.pathIndex][best.interval.index] += 1;
    return 0;
}

function allocateDeterministicCounts(perimeterModel, requestedDistributedCount, requiredCounts, options) {
    void options;

    const counts = createPerimeterCountMatrix(perimeterModel, requiredCounts);
    const requestedDistributed = Math.max(0, Math.round(Number(requestedDistributedCount) || 0));
    const requiredDistributed = sumIntervalCounts(counts);
    let remaining = Math.max(0, Math.max(requestedDistributed, requiredDistributed) - requiredDistributed);
    const allocationState = { counts };

    const straightEntries = getPerimeterIntervalEntries(perimeterModel, ({ interval }) => interval?.family === 'straight');
    const hasSymmetricStraightPairs = getStraightPairEntries(perimeterModel).length > 0;

    if (hasSymmetricStraightPairs) {
        remaining = allocateStraightPairs(perimeterModel, allocationState, remaining);
        if (remaining === 1) remaining = allocateSingleOddRemainder(perimeterModel, allocationState);
        else if (remaining > 0) remaining = allocateSingleEntries(straightEntries, allocationState, remaining);
    } else {
        remaining = allocateSingleEntries(straightEntries, allocationState, remaining);
    }

    if (remaining > 0) {
        const chamferEntries = getPerimeterIntervalEntries(perimeterModel, ({ interval }) => interval?.family !== 'straight');
        remaining = allocateSingleEntries(chamferEntries, allocationState, remaining);
    }

    return counts;
}

function materializeDistributedAisles(perimeterModel, intervalCounts, bowlConfig, options) {
    const axisExclusionFt = Math.max(0, Number(options?.axisExclusionFt) || 0);
    const endpointBufferFt = Math.max(0, Number(options?.endpointBufferFt) || 0);
    const pathRecords = Array.isArray(perimeterModel?.paths) ? perimeterModel.paths : [];
    const stationsByPath = pathRecords.map(() => []);

    getPerimeterIntervalEntries(perimeterModel).forEach(({ pathIndex, pathRecord, interval }) => {
        const count = Math.max(0, Math.floor(Number(intervalCounts?.[pathIndex]?.[interval.index]) || 0));
        if (count <= 0) return;

        const path = pathRecord.frontPath || pathRecord.backPath;
        const frontSide = interval.front || interval.back;
        const backSide = interval.back || interval.front;
        if (!path || !frontSide || !backSide) return;

        const ts = distributeIntervalTs(backSide, count, axisExclusionFt, endpointBufferFt);
        for (let i = 0; i < ts.length; i++) {
            const t = clamp01(ts[i]);
            const u = interpolatePathIntervalU(path, frontSide.startU, frontSide.endU, t);
            addStationRecord(path, stationsByPath[pathIndex], {
                u,
                forced: false,
                anchorType: 'segment_fraction',
                segmentIndex: interval.index,
                segmentT: t,
                alignmentMode: selectAlignmentModeForFamily(interval.family, bowlConfig)
            }, 1e-3);
        }
    });

    const out = [];
    for (let pathIndex = 0; pathIndex < stationsByPath.length; pathIndex++) {
        const path = pathRecords[pathIndex]?.frontPath || pathRecords[pathIndex]?.backPath;
        const records = stationsByPath[pathIndex]
            .slice()
            .sort((a, b) => a.u - b.u);

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            out.push({
                pathIndex,
                u: path?.closed ? normalizeUnit(record.u) : clamp01(record.u),
                forced: false,
                anchorType: record.anchorType || 'segment_fraction',
                segmentIndex: Number.isFinite(record.segmentIndex) ? Math.max(0, Math.floor(record.segmentIndex)) : undefined,
                segmentT: Number.isFinite(record.segmentT) ? clamp01(record.segmentT) : undefined,
                alignmentMode: normalizeAlignmentMode(record.alignmentMode)
            });
        }
    }

    return out.sort(compareAislesByPathAndStation);
}

function validateSeatCap(perimeterModel, aisles, options) {
    const maxSeatsBetweenAisles = Number(options?.maxSeatsBetweenAisles);
    if (!(Number.isFinite(maxSeatsBetweenAisles) && maxSeatsBetweenAisles > 0)) return true;

    const seatWidthIn = Math.max(1, Number(options?.seatWidthIn) || 20);
    const aisleWidthFt = Math.max(0, Number(options?.aisleWidthFt) || 0);
    const axisExclusionFt = Math.max(0, Number(options?.axisExclusionFt) || 0);
    const endpointBufferFt = Math.max(0, Number(options?.endpointBufferFt) || 0);
    const counts = createPerimeterCountMatrix(perimeterModel);

    for (let i = 0; i < (Array.isArray(aisles) ? aisles.length : 0); i++) {
        const aisle = aisles[i];
        if (!aisle || aisle.forced || !Number.isFinite(aisle.segmentIndex)) continue;

        const pathIndex = Math.max(0, Math.floor(Number(aisle.pathIndex) || 0));
        const intervalIndex = Math.max(0, Math.floor(Number(aisle.segmentIndex) || 0));
        if (!counts[pathIndex] || intervalIndex >= counts[pathIndex].length) continue;
        counts[pathIndex][intervalIndex] += 1;
    }

    const entries = getPerimeterIntervalEntries(perimeterModel);
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const intervalSide = entry.interval.back || entry.interval.front;
        if (!intervalSide || intervalSide.length <= EPS) continue;

        const count = Math.max(0, Math.floor(Number(counts?.[entry.pathIndex]?.[entry.interval.index]) || 0));
        const worst = estimateWorstSeatsInInterval(
            intervalSide,
            count,
            seatWidthIn,
            aisleWidthFt,
            axisExclusionFt,
            endpointBufferFt
        );
        if (worst > maxSeatsBetweenAisles) return false;
    }

    return true;
}

function getPerimeterPathRecord(perimeterModel, pathIndex) {
    if (!perimeterModel || !Array.isArray(perimeterModel.paths)) return null;
    const index = Math.max(0, Math.floor(Number(pathIndex) || 0));
    return perimeterModel.paths[index] || null;
}

function getPerimeterIntervalFromRecord(pathRecord, aisle) {
    if (!pathRecord || !Array.isArray(pathRecord.intervals) || !pathRecord.intervals.length) return null;
    if (!aisle || !Number.isFinite(aisle.segmentIndex)) return null;

    let index = Math.max(0, Math.floor(Number(aisle.segmentIndex) || 0));
    if (pathRecord.closed) index %= pathRecord.intervals.length;
    else index = Math.min(pathRecord.intervals.length - 1, index);
    return pathRecord.intervals[index] || null;
}

function inferAisleIntervalFamily(path, aisle) {
    const sampleU = Number.isFinite(aisle && aisle.uFront)
        ? aisle.uFront
        : (Number.isFinite(aisle && aisle.u) ? aisle.u : NaN);
    if (!path || !Number.isFinite(sampleU)) return 'straight';

    const pt = samplePathPointByRatio(path, sampleU);
    return classifyAxisDirection(pt) ? 'straight' : 'chamfer';
}

function selectAlignmentModeForFamily(family, bowlConfig) {
    const rawMode = family === 'straight'
        ? bowlConfig && bowlConfig.straightAisleMode
        : bowlConfig && bowlConfig.chamferAisleMode;
    return normalizeAlignmentMode(rawMode);
}

function stampDistributedAlignmentModes(aisles, perimeterModel, bowlConfig) {
    if (!Array.isArray(aisles) || !aisles.length) return [];

    return aisles.map((aisle) => {
        if (!aisle) return aisle;
        if (aisle.forced) return aisle;

        const explicitMode = String(aisle.alignmentMode || '').toLowerCase();
        if (explicitMode === 'radial' || explicitMode === 'perpendicular') {
            return {
                ...aisle,
                alignmentMode: normalizeAlignmentMode(explicitMode)
            };
        }

        const pathRecord = getPerimeterPathRecord(perimeterModel, aisle.pathIndex);
        const interval = getPerimeterIntervalFromRecord(pathRecord, aisle);
        const family = interval?.family || inferAisleIntervalFamily(pathRecord?.frontPath, aisle);

        return {
            ...aisle,
            alignmentMode: selectAlignmentModeForFamily(family, bowlConfig)
        };
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

    const perimeterModel = buildPerimeterModel(paths, backPaths, bowlConfig);
    const safeTarget = Math.max(0, Math.round(Number(targetAisles) || 0));
    const widthFt = Math.max(0, Number(aisleWidthFt) || 0);
    const minSpacingFt = Math.max(widthFt * 1.05, 1.25);
    const axisExclusionFt = Math.max(0.5, Number(axisToleranceFt) || 2, widthFt * 0.5 + 0.25);
    const endpointBufferFt = Math.max(2.0, widthFt * 1.0, minSpacingFt * 0.5);
    const forcedAisles = buildForcedTransitionAisles(perimeterModel);

    let aisles = [];
    const bowlType = String(bowlConfig && bowlConfig.type ? bowlConfig.type : '').toLowerCase();
    const useIndependentSidesOpenDistribution =
        bowlType === 'sides' &&
        paths.length >= 2 &&
        paths.every(p => p && !p.closed && p.length > EPS) &&
        forcedAisles.length === 0;
    const useEvenOpenPathDistribution =
        paths.length === 1 &&
        !!paths[0] &&
        !paths[0].closed &&
        forcedAisles.length === 0;
    const useDeterministicPerimeterAllocation =
        forcedAisles.length > 0 &&
        getPerimeterIntervalEntries(perimeterModel).length > 0;
    const useClosedEvenPathDistribution =
        paths.length === 1 &&
        !!paths[0] &&
        paths[0].closed &&
        forcedAisles.length === 0;

    if (useIndependentSidesOpenDistribution) {
        // "Sides" mode is two independent linear runs with mirrored egress.
        aisles = computeEvenAislesForOpenPaths(paths, safeTarget, widthFt);
    } else if (useEvenOpenPathDistribution) {
        // Linear/sliced open runs treat aisle lines as edge-to-edge boundaries.
        // Rebuild the full set every time so added aisles re-space evenly.
        aisles = computeEvenOpenPathAisleStations(paths, safeTarget, widthFt);
    } else if (useDeterministicPerimeterAllocation) {
        const requiredCounts = normalizeRequiredCountsForSymmetry(
            perimeterModel,
            computeRequiredSegmentCounts(perimeterModel, {
                aisleWidthFt: widthFt,
                axisExclusionFt,
                endpointBufferFt,
                maxSeatsBetweenAisles,
                seatWidthIn
            })
        );
        const intervalCounts = allocateDeterministicCounts(
            perimeterModel,
            Math.max(0, safeTarget - forcedAisles.length),
            requiredCounts,
            {
                aisleWidthFt: widthFt,
                axisExclusionFt,
                endpointBufferFt,
                maxSeatsBetweenAisles,
                seatWidthIn
            }
        );
        aisles = [
            ...forcedAisles,
            ...materializeDistributedAisles(perimeterModel, intervalCounts, bowlConfig, {
                axisExclusionFt,
                endpointBufferFt
            })
        ].sort(compareAislesByPathAndStation);

        if (!validateSeatCap(perimeterModel, aisles, {
            aisleWidthFt: widthFt,
            axisExclusionFt,
            endpointBufferFt,
            maxSeatsBetweenAisles,
            seatWidthIn
        })) {
            throw new Error('Deterministic aisle allocation violated maxSeatsBetweenAisles.');
        }
    } else if (useClosedEvenPathDistribution) {
        aisles = computeEvenClosedPathAisleStations(paths, safeTarget);
    } else {
        aisles = [];
    }

    aisles = stampDistributedAlignmentModes(aisles, perimeterModel, bowlConfig);

    return {
        aisles,
        aisleWidthFt: widthFt,
        targetAisles: Math.max(safeTarget, aisles.length),
        forcedCount: aisles.filter(a => a.forced).length,
        sectionBoundaries: buildSectionBoundaries(paths, aisles),
        axisExclusionFt
    };
}
