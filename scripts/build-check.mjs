import path from 'node:path';
import { build } from 'esbuild';

const stripVersionQueryPlugin = {
    name: 'strip-version-query',
    setup(buildApi) {
        buildApi.onResolve({ filter: /^three$/ }, () => ({
            path: path.resolve('lib/three.module.js')
        }));

        buildApi.onResolve({ filter: /^\.\.?\// }, (args) => {
            const sanitizedPath = args.path.replace(/\?v=\d+$/, '');
            if (sanitizedPath === args.path) return null;

            return {
                path: path.resolve(args.resolveDir, sanitizedPath)
            };
        });
    }
};

await build({
    entryPoints: [
        'app.js',
        'export/dxf-exporter.js',
        'export/rhino/rhino-exporter.js'
    ],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outdir: 'dist',
    logLevel: 'silent',
    plugins: [stripVersionQueryPlugin]
});
