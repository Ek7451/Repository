export function normalizeSeatWidthIn(seatWidthIn, fallback = 20) {
    return Math.max(1, Number(seatWidthIn) || fallback);
}

export function normalizeAisleWidthFt(aisleWidthFt) {
    return Math.max(0, Number(aisleWidthFt) || 0);
}

export function seatingLengthToSeatCount(seatingLengthFt, seatWidthIn) {
    const widthIn = normalizeSeatWidthIn(seatWidthIn);
    const safeLengthFt = Math.max(0, Number(seatingLengthFt) || 0);
    return Math.max(0, Math.floor((safeLengthFt * 12.0) / widthIn));
}

export function seatingLengthInToSeatCount(seatingLengthIn, seatWidthIn) {
    const widthIn = normalizeSeatWidthIn(seatWidthIn);
    const safeLengthIn = Math.max(0, Number(seatingLengthIn) || 0);
    return Math.max(0, Math.floor(safeLengthIn / widthIn));
}

export function countSeatsFromUsableRunLengthIn({ usableRunLengthIn, seatWidthIn }) {
    return seatingLengthInToSeatCount(usableRunLengthIn, seatWidthIn);
}

export function computeUsableRunLengthIn({ totalRunLengthIn, aisleLineCount, aisleWidthIn }) {
    const totalLengthIn = Math.max(0, Number(totalRunLengthIn) || 0);
    const lineCount = Math.max(0, Math.floor(Number(aisleLineCount) || 0));
    const widthIn = Math.max(0, Number(aisleWidthIn) || 0);
    return Math.max(0, totalLengthIn - (lineCount * widthIn));
}

export function computeAverageSeatsPerBlock({ seatsPerRow, blockCount }) {
    const resolvedSeatsPerRow = Math.max(0, Number(seatsPerRow) || 0);
    const resolvedBlockCount = Math.max(1, Math.round(Number(blockCount) || 1));
    return resolvedSeatsPerRow / resolvedBlockCount;
}

export function sectionBoundaryGapToSeatingLengthFt(centerGapFt, leftAisleWidthFt, rightAisleWidthFt) {
    const leftAisleFt = normalizeAisleWidthFt(leftAisleWidthFt);
    const rightAisleFt = normalizeAisleWidthFt(rightAisleWidthFt);
    return Math.max(0, (Number(centerGapFt) || 0) - (leftAisleFt * 0.5) - (rightAisleFt * 0.5));
}

export function sectionBoundaryGapToSeatCount(centerGapFt, leftAisleWidthFt, rightAisleWidthFt, seatWidthIn) {
    const seatingGapFt = sectionBoundaryGapToSeatingLengthFt(centerGapFt, leftAisleWidthFt, rightAisleWidthFt);
    return seatingLengthToSeatCount(seatingGapFt, seatWidthIn);
}

export function sectionCenterGapToSeatCount(centerGapFt, aisleWidthFt, seatWidthIn) {
    const aisleFt = normalizeAisleWidthFt(aisleWidthFt);
    return sectionBoundaryGapToSeatCount(centerGapFt, aisleFt, aisleFt, seatWidthIn);
}

export function countSeatsFromCenterlineGapFt({ centerGapFt, aisleWidthFt, seatWidthIn }) {
    return sectionCenterGapToSeatCount(centerGapFt, aisleWidthFt, seatWidthIn);
}

export function spanGapToSeatCount(gapFt, aisleWidthFt, seatWidthIn) {
    const aisleFt = normalizeAisleWidthFt(aisleWidthFt);
    return sectionBoundaryGapToSeatCount(gapFt, aisleFt, aisleFt, seatWidthIn);
}

export function intervalLengthToSeatCount(lengthFt, seatWidthIn) {
    return seatingLengthToSeatCount(lengthFt, seatWidthIn);
}
