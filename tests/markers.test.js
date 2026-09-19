import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    VM_COMMENT_LEGAL,
    VM_COMMENT_STANDARD,
    countMarkers,
    restoreVmComments,
    sourceMarkers,
} from '../src/markers.js';

describe('restoreVmComments', () => {
    it('rewrites every legal marker to the standard form the obfuscator selects on', () => {
        const code = `${VM_COMMENT_LEGAL}\nfn();\n${VM_COMMENT_LEGAL}\ng();`;

        expect(countMarkers(restoreVmComments(code), VM_COMMENT_STANDARD)).toBe(2);
    });

    it('leaves code with no markers untouched', () => {
        expect(restoreVmComments('const a = 1;')).toBe('const a = 1;');
    });
});

describe('sourceMarkers', () => {
    // Every module the chunk was built from, wherever it lives: the count it is compared against is
    // taken over the whole chunk, so excluding a module here would fail a build for no reason.
    it('counts markers across every module of a chunk', () => {
        const dir = mkdtempSync(join(tmpdir(), 'obf-'));
        const island = join(dir, 'island.js');
        const outside = join(dir, 'outside.js');

        writeFileSync(island, `${VM_COMMENT_LEGAL}\nexport function a() {}\n`);
        writeFileSync(outside, `${VM_COMMENT_LEGAL}\nexport function b() {}\n`);

        expect(sourceMarkers([island, outside])).toBe(2);
    });

    it('ignores a module id with no file behind it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'obf-'));
        const real = join(dir, 'real.js');

        writeFileSync(real, `${VM_COMMENT_LEGAL}\nexport function a() {}\n`);

        // Vite's own virtual modules reach here as ids with no file. Paired with a real one so the
        // assertion fails if the catch swallows the whole reduce rather than one entry.
        expect(sourceMarkers(['\0virtual:thing', real])).toBe(1);
    });
});
