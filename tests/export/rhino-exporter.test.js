import { describe, expect, test, vi } from 'vitest';

import { buildRhinoExportDescriptor } from '../../export/rhino/rhino-exporter.js';

describe('buildRhinoExportDescriptor', () => {
    test('returns null when there is no scene export geometry', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(buildRhinoExportDescriptor({
            sportName: 'Football',
            sceneExportData: null
        })).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('No 3D data to export');

        warnSpy.mockRestore();
    });

    test('wraps exported bytes in a download descriptor', async () => {
        const exportModel = vi.fn(async () => ({
            bytes: new Uint8Array([1, 2, 3]),
            exportedCount: 3,
            fileExtension: '3dm'
        }));

        const descriptor = await buildRhinoExportDescriptor({
            rhino: { File3dm: class {} },
            solvers: [{ rows: [{ row_number: 1 }] }],
            bowlConfig: { width: 160 },
            sportName: 'Ice Hockey',
            tierArtifacts: [],
            sceneExportData: {
                bowlMeshes: [{ type: 'Mesh' }]
            },
            exportModel
        });

        expect(exportModel).toHaveBeenCalledTimes(1);
        expect(descriptor).toMatchObject({
            filename: 'seating - study - ice-hockey.3dm',
            type: 'model/vnd.rhino'
        });
        expect(descriptor.parts).toHaveLength(1);
        expect(descriptor.parts[0]).toBeInstanceOf(Uint8Array);
    });
});
