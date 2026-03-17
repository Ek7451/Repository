/**
 * Sightline Calculation Module for Seating Bowl Generator.
 * Handles sightline visualization and C-value quality assessment.
 * Ported from sightline_calc.py
 */

/**
 * Assess C-value quality and return category + color.
 * @param {number} cValueInches - C-value in inches
 * @returns {{ quality: string, color: string }}
 */
export function getCValueQuality(cValueInches) {
    // Round to 1 decimal place to match display, or 2?
    // Profile renderer uses toFixed(2).
    // If display is 3.50, it should be >= 3.5.
    // If display is 3.49 -> 3.49.
    // Let's use 2 decimal places rounding to be safe and consistent with display.
    // Note: User mentioned "If both numbers read 3.5".
    // If display is 3.5 (from 3.46?), then 3.46 -> 3.5.
    // If display is 1 decimal, we should round to 1.
    // Profile renderer line 724: `row.c_value.toFixed(2)`.
    // It displays TWO decimal places. e.g. "3.50".

    // So if it displays 3.50, it is >= 3.495.
    // If it displays 3.49, it is < 3.495.

    // The issue "rounding error" likely refers to values very close to the threshold (e.g. 3.4999 vs 3.5000).
    const rounded = Math.round(cValueInches * 100) / 100;

    if (rounded >= 4.75) {
        return { quality: "Excellent", color: "#7aae1a" };
    } else if (rounded >= 3.5) {
        return { quality: "Good", color: "#37996e" };
    } else if (rounded >= 2.4) {
        return { quality: "Acceptable", color: "#de850a" };
    } else {
        return { quality: "Poor", color: "#d1433d" };
    }
}

/**
 * Calculate sightline from eye position to focal point.
 */
function calculateSightline(eyeX, eyeZ, focalX, focalZ) {
    const dx = focalX - eyeX;
    const dz = focalZ - eyeZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const angle = (Math.atan2(dz, dx) * 180) / Math.PI;

    return {
        start: { x: eyeX, z: eyeZ },
        end: { x: focalX, z: focalZ },
        distance,
        angle,
        dx,
        dz
    };
}

/**
 * Generate points for a circle (spectator head).
 */
export function generateHeadCirclePoints(centerX, centerZ, radius, numSegments = 12) {
    const points = [];
    for (let i = 0; i <= numSegments; i++) {
        const angle = (2 * Math.PI * i) / numSegments;
        points.push({
            x: centerX + radius * Math.cos(angle),
            z: centerZ + radius * Math.sin(angle)
        });
    }
    return points;
}

/**
 * @typedef {{
 *   eye_x: number,
 *   eye_z: number,
 *   row_number: number,
 *   c_value: number
 * }} RowData
 */

export class SightlineAnalyzer {
    /**
     * @param {RowData[]} rows 
     * @param {number} focalX 
     * @param {number} focalZ 
     */
    constructor(rows, focalX, focalZ) {
        this.rows = rows;
        this.focalX = focalX;
        this.focalZ = focalZ;
        this.sightlines = [];
    }

    analyze() {
        this.sightlines = [];

        for (const row of this.rows) {
            const sightline = calculateSightline(
                row.eye_x, row.eye_z, this.focalX, this.focalZ
            );
            sightline.row_number = row.row_number;
            sightline.c_value = row.c_value;

            const quality = getCValueQuality(row.c_value);
            sightline.quality = quality.quality;
            sightline.color = quality.color;

            this.sightlines.push(sightline);
        }

        return this.sightlines;
    }

    getStatistics() {
        if (!this.rows || this.rows.length === 0) return null;

        const cValues = this.rows.map(r => r.c_value);
        const qualityCounts = { Excellent: 0, Good: 0, Acceptable: 0, Poor: 0 };

        for (const c of cValues) {
            const { quality } = getCValueQuality(c);
            qualityCounts[quality]++;
        }

        return {
            minC: Math.min(...cValues),
            maxC: Math.max(...cValues),
            avgC: cValues.reduce((a, b) => a + b, 0) / cValues.length,
            qualityDistribution: qualityCounts,
            totalRows: this.rows.length
        };
    }
}
