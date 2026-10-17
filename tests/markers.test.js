import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
    VM_COMMENT_LEGAL,
    VM_COMMENT_STANDARD,
    countMarkers,
    misplacedMarkers,
    restoreVmComments,
    shakenMarkedExports,
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

describe('misplacedMarkers', () => {
    const m = VM_COMMENT_STANDARD;

    it('accepts a marker on every shape that holds a function', () => {
        const code = [
            `${m} function a() {}`,
            `${m} async function b() {}`,
            `${m} const c = () => 1;`,
            `${m} let d = function () {};`,
            `const e1 = 1, ${m} e2 = () => 2;`,
            `${m} export function f() {}`,
            `${m} export const g = async () => {};`,
            `${m} export default function () {}`,
            `class H { ${m} method() {} ${m} field = () => 1; }`,
            `const i = { ${m} method() {}, ${m} key: () => 1 };`,
            `${m}\n/*! @license MIT */\nfunction j() {}`,
        ].join('\n');

        expect(misplacedMarkers(code)).toEqual([]);
    });

    it('reports a marker on a plain value, inside a body, stacked after a statement, or doubled up', () => {
        const code = [
            `${m} var a = document.createElement('div');`,
            `function b() { ${m} return 1; }`,
            `const c = () => 1, d = () => 2\n${m}\n;`,
            // terser, after inlining a marked function called once: its marker falls onto the next.
            `${m}\n${m}\nfunction e() {}`,
        ].join('\n');

        expect(misplacedMarkers(code).map(({line, followedBy}) => [line, followedBy.slice(0, 6)])).toEqual([
            [1, 'var a '],
            [2, 'return'],
            [4, '; /* j'],
            [7, 'functi'],
        ]);
    });

    it('throws when the chunk does not parse', () => {
        expect(() => misplacedMarkers('(')).toThrow(SyntaxError);
    });
});

describe('shakenMarkedExports', () => {
    it('reads a non-ASCII export name whole, and no marked export past code behind a comment', () => {
        const dir = mkdtempSync(join(tmpdir(), 'obf-'));
        const id = join(dir, 'lib.js');

        writeFileSync(id, [
            VM_COMMENT_LEGAL,
            'export function détecter() {}',
            // The marker leads `const x`; a block comment that ran on to `/* other */` would claim f.
            `${VM_COMMENT_LEGAL} /* note */ const x = 1; /* other */`,
            'export function f() {}',
        ].join('\n'));

        expect(shakenMarkedExports({moduleIds: [id], modules: {[id]: {renderedExports: ['détecter']}}})).toEqual([]);
    });
});
