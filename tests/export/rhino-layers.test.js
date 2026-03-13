import { describe, expect, test } from 'vitest';
import {
    ensureRhinoTierCategoryLayers,
    getRhinoTierIndexFromObject,
    getRhinoTierLabel,
    getRhinoTierLayerIndex
} from '../../export/rhino/rhino-layers.js';

describe('rhino layer helpers', () => {
    test('creates predictable tier layer maps', () => {
        const addedNames = [];
        const rhino = {
            Layer: class {
                constructor() {
                    this.name = '';
                }
                destroy() {}
            }
        };
        const model = {
            layers() {
                return {
                    add(layer) {
                        addedNames.push(layer.name);
                        return addedNames.length - 1;
                    }
                };
            }
        };

        const result = ensureRhinoTierCategoryLayers(rhino, model, [{ tierIndex: 0 }, { tierIndex: 2 }]);

        expect(addedNames).toEqual([
            'Tier 1 - Bowl',
            'Tier 1 - Aisles',
            'Tier 1 - Spectators',
            'Tier 3 - Bowl',
            'Tier 3 - Aisles',
            'Tier 3 - Spectators'
        ]);
        expect(result.bowlByTierIndex.get(2)).toBe(3);
        expect(getRhinoTierLayerIndex(result, 'bowl', 2, 0)).toBe(3);
    });

    test('reads tier metadata from object userData', () => {
        expect(getRhinoTierIndexFromObject({ userData: { tierIndex: 4 } }, 0)).toBe(4);
        expect(getRhinoTierLabel(2, 0)).toBe(3);
    });
});
