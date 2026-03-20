import { describe, expect, it } from 'vitest';

import {
    intervalLengthToSeatCount,
    computeAverageSeatsPerBlock,
    computeUsableRunLengthIn,
    countSeatsFromCenterlineGapFt,
    countSeatsFromUsableRunLengthIn,
    sectionBoundaryGapToSeatCount,
    sectionCenterGapToSeatCount,
    seatingLengthInToSeatCount,
    seatingLengthToSeatCount,
    spanGapToSeatCount
} from '../../core/seat-math.js';

describe('seat math helpers', () => {
    it('counts seats from usable run length in inches', () => {
        expect(countSeatsFromUsableRunLengthIn({ usableRunLengthIn: 1200, seatWidthIn: 20 })).toBe(60);
        expect(seatingLengthInToSeatCount(399, 20)).toBe(19);
    });

    it('computes usable run length after aisle widths are removed', () => {
        expect(computeUsableRunLengthIn({ totalRunLengthIn: 1680, aisleLineCount: 5, aisleWidthIn: 48 })).toBe(1440);
    });

    it('counts seats from centerline gaps and average seats per block', () => {
        expect(countSeatsFromCenterlineGapFt({ centerGapFt: 34, aisleWidthFt: 4, seatWidthIn: 20 })).toBe(18);
        expect(seatingLengthToSeatCount(30, 20)).toBe(18);
        expect(computeAverageSeatsPerBlock({ seatsPerRow: 60, blockCount: 4 })).toBe(15);
    });

    it('counts seats from feet and inches consistently', () => {
        expect(seatingLengthToSeatCount(10, 20)).toBe(6);
        expect(seatingLengthInToSeatCount(120, 20)).toBe(6);
        expect(intervalLengthToSeatCount(10, 20)).toBe(6);
    });

    it('subtracts aisle width for center-gap and span calculations', () => {
        expect(sectionBoundaryGapToSeatCount(12, 4, 2, 20)).toBe(5);
        expect(sectionCenterGapToSeatCount(12, 4, 20)).toBe(4);
        expect(spanGapToSeatCount(12, 4, 20)).toBe(4);
    });

    it('clamps invalid values to zero-safe counts', () => {
        expect(seatingLengthToSeatCount(-5, 20)).toBe(0);
        expect(sectionCenterGapToSeatCount(2, 4, 20)).toBe(0);
    });
});
