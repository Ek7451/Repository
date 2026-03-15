import { describe, expect, it, vi } from 'vitest';

import { FieldRenderer } from '../../viz/field-renderer.js';

describe('FieldRenderer helper delegation surface', () => {
    it('preserves sport-based offset correction behavior', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getOffsetCorrection({ width: 120 }, 'Football')).toBe(0);
        expect(renderer.getOffsetCorrection({ width: 120 }, 'Baseball')).toBe(60);
        expect(renderer.getOffsetCorrection({}, 'Baseball')).toBe(0);
    });

    it('derives visual focal Y from the shared field-edge anchor and focal-X sign rules', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getVisualFocalY({ focal_y: -80 }, { x: 15 }, 'Football')).toBe(-95);
        expect(renderer.getVisualFocalY({ focal_y: -42.5 }, { x: 12 }, 'Ice Hockey')).toBe(-54.5);
        expect(renderer.getVisualFocalY({ focal_y: -80 }, { x: -20 }, 'Football')).toBe(-60);
        expect(renderer.getVisualFocalY({ focal_y: 0, field_width: 303.6 }, { x: 10 }, 'Track')).toBeCloseTo(-161.8);
        expect(renderer.getVisualFocalY({ focal_y: 0, field_radius: 325 }, { x: 5 }, 'Baseball')).toBe(-5);
        expect(renderer.getVisualFocalY(null, null, 'Soccer')).toBe(0);
    });

    it('builds tier aisle layouts only for solved tiers with metrics', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer.generateTierAisleLayout = vi.fn((solver, bowlConfig, metrics, offsetCorrection, egressParams) => ({
            solver,
            bowlConfig,
            metrics,
            offsetCorrection,
            egressParams
        }));

        const solvers = [
            { tierIndex: 0, rows: [{ x: 10, tread_depth: 3 }] },
            { tierIndex: 1, rows: [] },
            { rows: [{ x: 20, tread_depth: 4 }] }
        ];
        const tierMetricsByIndex = new Map([
            [0, { numAisles: 4 }],
            [2, { numAisles: 2 }]
        ]);

        const layouts = renderer.buildTierAisleLayouts(
            solvers,
            { width: 100 },
            tierMetricsByIndex,
            8,
            { seatsBetweenAisles: 24 }
        );

        expect(renderer.generateTierAisleLayout).toHaveBeenCalledTimes(2);
        expect(renderer.generateTierAisleLayout).toHaveBeenNthCalledWith(
            1,
            solvers[0],
            { width: 100 },
            { numAisles: 4 },
            8,
            { seatsBetweenAisles: 24 }
        );
        expect(renderer.generateTierAisleLayout).toHaveBeenNthCalledWith(
            2,
            solvers[2],
            { width: 100 },
            { numAisles: 2 },
            8,
            { seatsBetweenAisles: 24 }
        );
        expect(layouts).toHaveLength(2);
        expect(layouts[0].tierIndex).toBe(0);
        expect(layouts[1].tierIndex).toBe(2);
    });

    it('calculates row lengths from the full bowl geometry segments', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer._getBowlGeometry = vi.fn(() => ([
            { cmd: 'moveTo', x: 0, y: 0 },
            { cmd: 'lineTo', x: 3, y: 4 },
            { cmd: 'lineTo', x: 6, y: 4 },
            { cmd: 'closePath' }
        ]));

        expect(renderer.calculateRowLength({ width: 120 }, 10)).toBe(15.21110255092798);
        expect(renderer._getBowlGeometry).toHaveBeenCalledWith({ width: 120 }, 10);
    });
});
