import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {build} from 'vite';
import {afterAll, describe, expect, it, vi} from 'vitest';
import obfuscator from '../src/index.js';
import {spareNodeModules} from '../src/spare.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'island');
const app = join(import.meta.dirname, '..', '.tmp-spare-app');

afterAll(() => rmSync(app, {recursive: true, force: true}));

describe('spareNodeModules()', () => {
    it('wraps a #region span, up to its #endregion', () => {
        const code = '//#region node_modules/a/i.js\nvar a = 1;\n//#endregion\n//#region src/m.js\nvar m = 2;\n//#endregion\n';
        const {code: out, spans} = spareNodeModules(code);

        expect(spans).toBe(1);
        expect(out).toBe(
            '/* javascript-obfuscator:disable */\n//#region node_modules/a/i.js\nvar a = 1;\n'
            + '/* javascript-obfuscator:enable */\n//#endregion\n//#region src/m.js\nvar m = 2;\n//#endregion\n',
        );
    });

    it('wraps a bare path-comment span, up to the next module header', () => {
        const code = '// node_modules/a/i.js\nvar a = 1;\n// node_modules/b/j.js\nvar b = 2;\n// resources/ts/m.ts\nvar m = 3;\n';
        const {code: out, spans} = spareNodeModules(code);

        expect(spans).toBe(1);
        expect(out).toContain('var b = 2;\n/* javascript-obfuscator:enable */\n// resources/ts/m.ts\nvar m = 3;');
    });

    it('runs a span at the end of the chunk to the end', () => {
        const {code, spans} = spareNodeModules('var m = 1;\n//#region node_modules/a/i.js\nvar a = 1;\n');

        expect(spans).toBe(1);
        expect(code.endsWith('var a = 1;\n/* javascript-obfuscator:enable */\n')).toBe(true);
    });

    it('keeps a path-like comment inside a vendor #region spared, up to its #endregion', () => {
        const code = '//#region node_modules/a/i.js\n// LICENSE.md\nvar a = 1;\n//#endregion\n//#region src/m.js\nvar m = 2;\n//#endregion\n';
        const {code: out, spans} = spareNodeModules(code);

        expect(spans).toBe(1);
        expect(out).toContain('// LICENSE.md\nvar a = 1;\n/* javascript-obfuscator:enable */\n//#endregion\n//#region src/m.js');
    });

    it('does not take a directory merely ending in node_modules for a vendor one', () => {
        expect(spareNodeModules('//#region src/my_node_modules/x.js\nvar m = 1;\n//#endregion\n').spans).toBe(0);
    });

    it('finds nothing in a chunk without node_modules', () => {
        expect(spareNodeModules('//#region src/m.js\nvar m = 1;\n//#endregion\n').spans).toBe(0);
    });
});

async function buildApp(options, minify = false) {
    mkdirSync(join(app, 'node_modules', 'vendorpkg'), {recursive: true});
    writeFileSync(join(app, 'node_modules', 'vendorpkg', 'index.js'),
        "export function vendorFn() { const vendorLocalName = 'VENDOR_LITERAL'; return vendorLocalName + Math.random(); }\n");
    writeFileSync(join(app, 'entry.js'),
        "import {vendorFn} from 'vendorpkg';\nfunction appFn() { const appLocalName = 'APP_LITERAL'; return appLocalName + vendorFn(); }\nconsole.log(appFn());\n");

    const {output} = await build({
        root: app,
        logLevel: 'silent',
        build: {write: false, minify, rolldownOptions: {input: [join(app, 'entry.js')]}},
        plugins: [obfuscator({islandRoots: [app], include: ['entry.js'], rehash: false, ...options})],
    });

    return output.find((o) => o.type === 'chunk').code;
}

describe('spareNodeModules in a build', () => {
    const nothingSpared = '\nRolldownError: spareNodeModules is on but no node_modules module was found in any obfuscated chunk.\n'
        + 'Rolldown marks module boundaries with comments, which a minified chunk loses: set build.minify to false,\n'
        + 'or set spareNodeModules to false if the chunks bundle no node_modules code.';

    it('leaves node_modules code readable and obfuscates the rest, when on', async () => {
        const code = await buildApp({spareNodeModules: true, overrides: {stringArrayThreshold: 1}});

        // Inline only where the obfuscator did not touch it; at threshold 1 it moves every other string to the array.
        expect(code).toContain("return'VENDOR_LITERAL'");
        expect(code).not.toContain("'APP_LITERAL'+");
        expect(code).not.toContain("appLocalName");
    });

    it('obfuscates node_modules code too, by default', async () => {
        const code = await buildApp({overrides: {stringArrayThreshold: 1}});

        expect(code).not.toContain("return'VENDOR_LITERAL'");
    });

    it('fails the build when on and there is nothing to spare', async () => {
        await expect(build({
            root: fixtures,
            logLevel: 'silent',
            build: {write: false, minify: false, rolldownOptions: {input: [join(fixtures, 'entry.js')]}},
            plugins: [obfuscator({islandRoots: [fixtures], include: ['entry.js'], rehash: false, spareNodeModules: true})],
        })).rejects.toThrow(nothingSpared);
    });

    it('fails the build on a minified chunk, which has lost its module headers', async () => {
        await expect(buildApp({spareNodeModules: true}, true)).rejects.toThrow(nothingSpared);
    });
});

describe('the defaults reaching the obfuscator', () => {
    it('are the low preset, browser-no-eval and no anti-debugging', async () => {
        vi.resetModules();

        const configs = [];

        vi.doMock('javascript-obfuscator', () => ({
            default: {obfuscate: (_code, config) => (configs.push(config), {getObfuscatedCode: () => 'var a;'})},
        }));

        const {default: mocked} = await import('../src/index.js');

        await build({
            root: fixtures,
            logLevel: 'silent',
            build: {write: false, minify: false, rolldownOptions: {input: [join(fixtures, 'entry.js')]}},
            plugins: [mocked({islandRoots: [fixtures], include: ['entry.js']})],
        });

        expect(configs[0]).toEqual({
            optionsPreset: 'low-obfuscation',
            target: 'browser-no-eval',
            disableConsoleOutput: false,
            debugProtection: false,
            debugProtectionInterval: 0,
            selfDefending: false,
        });

        vi.doUnmock('javascript-obfuscator');
    });

    // A 6.x config left as it was: no Pro call (the mock has no obfuscatePro), no seed.
    it('ignore the options 7.0 removed', async () => {
        vi.resetModules();

        const configs = [];

        vi.doMock('javascript-obfuscator', () => ({
            default: {obfuscate: (_code, config) => (configs.push(config), {getObfuscatedCode: () => 'var a;'})},
        }));

        const {default: mocked} = await import('../src/index.js');

        await build({
            root: fixtures,
            logLevel: 'silent',
            build: {write: false, minify: false, rolldownOptions: {input: [join(fixtures, 'entry.js')]}},
            plugins: [mocked({
                islandRoots: [fixtures], include: ['entry.js'],
                apiToken: 'token', vmObfuscation: true, vmObfuscationThreshold: 0.5, timeout: 1, version: '5.0.0', seed: 42,
            })],
        });

        expect(configs).toHaveLength(2);
        for (const config of configs) {
            expect(config).toEqual({
                optionsPreset: 'low-obfuscation',
                target: 'browser-no-eval',
                disableConsoleOutput: false,
                debugProtection: false,
                debugProtectionInterval: 0,
                selfDefending: false,
            });
        }

        vi.doUnmock('javascript-obfuscator');
    });
});

describe('a seed in overrides', () => {
    it('makes two builds byte-identical', async () => {
        const a = await buildApp({overrides: {seed: 1234}});
        const b = await buildApp({overrides: {seed: 1234}});

        expect(a).toBe(b);
    });
});
