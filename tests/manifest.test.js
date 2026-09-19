import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {pointManifestAt} from '../src/manifest.js';

describe('pointManifestAt', () => {
    it('rewrites both manifest locations Vite may use', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'obf-manifest-'));
        mkdirSync(join(dir, '.vite'));

        const body = JSON.stringify({'resources/js/app.js': {file: 'assets/app-OLDHASH1.js'}});
        writeFileSync(join(dir, 'manifest.json'), body);
        writeFileSync(join(dir, '.vite', 'manifest.json'), body);

        await pointManifestAt(dir, [['assets/app-OLDHASH1.js', 'assets/app-NEWHASH2.js']]);

        for (const p of [join(dir, 'manifest.json'), join(dir, '.vite', 'manifest.json')]) {
            expect(readFileSync(p, 'utf8')).toContain('assets/app-NEWHASH2.js');
            expect(readFileSync(p, 'utf8')).not.toContain('assets/app-OLDHASH1.js');
        }
    });

    it('is a no-op when no manifest exists', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'obf-manifest-'));

        await expect(pointManifestAt(dir, [['a.js', 'b.js']])).resolves.toBeUndefined();
    });
});
