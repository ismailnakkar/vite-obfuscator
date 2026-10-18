import {describe, expect, it} from 'vitest';
import {pointManifestAt} from '../src/manifest.js';

describe('pointManifestAt', () => {
    it('rewrites the configured manifests and every HTML file, and nothing else', () => {
        const body = JSON.stringify({'resources/js/app.js': {file: 'assets/app-OLDHASH1.js'}});
        const bundle = {
            'assets-manifest.json': {source: body},
            'ssr.json': {source: body},
            'index.html': {source: '<script src="/assets/app-OLDHASH1.js"></script>'},
            'manifest.json': {source: body},
        };

        pointManifestAt(bundle, ['assets-manifest.json', 'ssr.json'], [['assets/app-OLDHASH1.js', 'assets/app-NEWHASH2.js']]);

        for (const key of ['assets-manifest.json', 'ssr.json', 'index.html']) {
            expect(bundle[key].source).toContain('assets/app-NEWHASH2.js');
            expect(bundle[key].source).not.toContain('assets/app-OLDHASH1.js');
        }

        expect(bundle['manifest.json'].source).toBe(body);
    });
});
