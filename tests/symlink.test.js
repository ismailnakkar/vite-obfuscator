import {mkdtempSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'vite';
import {describe, expect, it} from 'vitest';
import obfuscator from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'island');

describe('a project reached through a symlink', () => {
    it('still fires the boundary guard', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'obf-sym-'));
        const linked = join(dir, 'island');

        symlinkSync(fixtures, linked);

        await expect(build({
            root: linked,
            logLevel: 'silent',
            build: {
                outDir: join(dir, 'dist'),
                emptyOutDir: true,
                minify: false,
                rolldownOptions: {input: [join(linked, 'entry.js'), join(linked, 'site.js')]},
            },
            plugins: [obfuscator({apiToken: '', islandRoots: [linked], include: ['entry.js']})],
        })).rejects.toThrow(/are bundled but NOT obfuscated/);
    });
});
