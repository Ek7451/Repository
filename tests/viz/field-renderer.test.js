import { describe, expect, it, vi } from 'vitest';

import { FieldRenderer } from '../../viz/field-renderer.js';

describe('FieldRenderer helper delegation surface', () => {
    it('preserves sport-based offset correction behavior', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getOffsetCorrection({ width: 120 }, 'Football')).toBe(0);
        expect(renderer.getOffsetCorrection({ width: 120 }, 'Baseball')).toBe(60);
        expect(renderer.getOffsetCorrection({}, 'Baseball')).toBe(0);
    });

    it('preserves the visual focal Y adjustment rules', () => {
        const renderer = Object.create(FieldRenderer.prototype);

        expect(renderer.getVisualFocalY({ focal_y: 12 }, { x: 5 }, 'Football')).toBe(17);
        expect(renderer.getVisualFocalY({ focal_y: 12 }, { x: 5 }, 'Baseball')).toBe(5);
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

    it('derives clip ranges from bowl bounds with current outer offset semantics', () => {
        const renderer = Object.create(FieldRenderer.prototype);
        renderer._computeBowlBounds = vi.fn(() => ({
            minX: -10.2,
            maxX: 80.1,
            minY: -40.8,
            maxY: 32.2
        }));

        const clipRange = renderer.getClipPositionRange(
            [
                { rows: [{ x: 12 }, { x: 65 }] },
                { rows: [{ x: 54 }] }
            ],
            {
                width: 120,
                clip: {
                    enabled: true,
                    axis: 'Y',
                    position: 9,
                    side: 'negative'
                }
            },
            'Y',
            5
        );

        expect(renderer._computeBowlBounds).toHaveBeenCalledWith(
            {
                width: 120,
                clip: {
                    enabled: false
                }
            },
            60
        );
        expect(clipRange).toEqual({
            min: -41,
            max: 33
        });
    });
});
