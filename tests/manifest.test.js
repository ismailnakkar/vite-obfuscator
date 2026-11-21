import {describe, expect, it} from 'vitest';
import {manifestFiles, repointAssets} from '../src/manifest.js';

describe('repointAssets', () => {
    it('rewrites the configured manifests and every HTML file, and nothing else', () => {
        const body = JSON.stringify({'resources/js/app.js': {file: 'assets/app-OLDHASH1.js'}});
        const bundle = {
            'assets-manifest.json': {source: body},
            'ssr.json': {source: body},
            'index.html': {source: '<script src="/assets/app-OLDHASH1.js"></script>'},
            'manifest.json': {source: body},
        };

        repointAssets(bundle, ['assets-manifest.json', 'ssr.json'], [['assets/app-OLDHASH1.js', 'assets/app-NEWHASH2.js']]);

        for (const key of ['assets-manifest.json', 'ssr.json', 'index.html']) {
            expect(bundle[key].source).toContain('assets/app-NEWHASH2.js');
            expect(bundle[key].source).not.toContain('assets/app-OLDHASH1.js');
        }

        expect(bundle['manifest.json'].source).toBe(body);
    });
});

describe('manifestFiles', () => {
    it('names Vite\'s default paths for a true flag, a custom path as given, and nothing when off', () => {
        const off = {manifest: false, ssrManifest: false, chunkImportMap: false, rolldownOptions: {}};

        expect(manifestFiles(off)).toEqual([]);
        expect(manifestFiles({...off, manifest: true, ssrManifest: true, chunkImportMap: true}))
            .toEqual(['.vite/manifest.json', '.vite/ssr-manifest.json', 'importmap.json']);
        expect(manifestFiles({
            manifest: 'm.json', ssrManifest: 's.json', chunkImportMap: true,
            rolldownOptions: {experimental: {chunkImportMap: {fileName: 'map.json'}}},
        })).toEqual(['m.json', 's.json', 'map.json']);
    });
});
