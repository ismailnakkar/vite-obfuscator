import {existsSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'vite';
import {afterAll, describe, expect, it, vi} from 'vitest';
import obfuscator from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'island');
const repoRoot = join(import.meta.dirname, '..');

// Every test here builds into its own .tmp-* directory at the repo root. Swept in one pass at the
// end, by prefix rather than by list, so a new fixture directory cannot be forgotten here.
afterAll(() => {
    for (const entry of readdirSync(repoRoot)) {
        if (entry.startsWith('.tmp-')) rmSync(join(repoRoot, entry), {recursive: true, force: true});
    }
});

const run = (inputs, options, outDir, minify = false) => build({
    root: fixtures,
    logLevel: 'silent',
    build: {
        outDir,
        emptyOutDir: true,
        manifest: true,
        minify,
        rollupOptions: {input: inputs.map((i) => join(fixtures, i))},
    },
    plugins: [obfuscator({enable: true, apiToken: '', islandRoots: [fixtures], ...options})],
});

/**
 * Loads a built chunk as a real ES module in a CHILD node process and reports every specifier that
 * did not resolve. A renamed-away dependency fails two different ways — a static import rejects the
 * load itself, a dynamic one rejects later as an unhandled rejection — so both are collected.
 *
 * A child, not this process: vitest routes a nested `import()` through its own module runner, which
 * resolves it against the project root instead of the importing file. Node resolves it the way a
 * browser would. `process.stdout.write`, not console.log, because the shipped preset's
 * disableConsoleOutput stubs console the moment the chunk evaluates.
 */
const unresolvedImportsIn = (file) => {
    const probe = `
        globalThis.window = {dispatchEvent() {}, addEventListener() {}};
        globalThis.document = {
            getElementsByTagName: () => [], querySelector: () => null,
            createElement: () => ({setAttribute() {}, addEventListener() {}}), head: {appendChild() {}},
        };
        const report = (e) => process.stdout.write('UNRESOLVED ' + (e && (e.url || e.message)) + '\\n');
        process.on('unhandledRejection', report);
        try {
            await import(${JSON.stringify(pathToFileURL(file).href)});
            await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
            report(error);
        }
        process.exit(0);
    `;

    const {stdout, stderr} = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {encoding: 'utf8'});

    return [...(stdout + stderr).matchAll(/^UNRESOLVED (.*)$/gm)].map((m) => m[1]);
};

describe('a renamed chunk', () => {
    it('is followed by the entry that dynamically imports it', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-dyn');

        await run(['entry.js'], {include: ['entry.js']}, outDir);

        const assets = join(outDir, 'assets');
        const entryFile = readdirSync(assets).find((f) => f.startsWith('entry-'));

        // Both chunks are targets, so both are renamed. Before the specifier rewrite this resolved
        // the PRE-rehash name and the browser got a 404 for the whole lazy chunk.
        expect(unresolvedImportsIn(join(assets, entryFile))).toEqual([]);
    });

    it('is followed by both entries that statically share it', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-shared');

        await run(['pair-a.js', 'pair-b.js'], {include: ['pair-a.js', 'pair-b.js']}, outDir);

        const assets = join(outDir, 'assets');
        const files = readdirSync(assets);

        expect(files.some((f) => f.startsWith('shared-'))).toBe(true);
        expect(unresolvedImportsIn(join(assets, files.find((f) => f.startsWith('pair-a-'))))).toEqual([]);
        expect(unresolvedImportsIn(join(assets, files.find((f) => f.startsWith('pair-b-'))))).toEqual([]);
    });
});

describe('a real build', () => {
    it('obfuscates the entry, rehashes it from the new bytes, and repoints the manifest', async () => {
        const plainDir = join(import.meta.dirname, '..', '.tmp-plain');
        const outDir = join(import.meta.dirname, '..', '.tmp-ok');

        // Baseline: the same source, same config, no plugin. Vite's own content hash.
        await build({
            root: fixtures,
            logLevel: 'silent',
            // Matches what the plugin's config() hook forces, so the ONLY difference between the two
            // builds is obfuscation + rehashing. Without this the baseline loses its marker to Vite's
            // default legalComments:'none', its content hash changes for that reason alone, and the
            // filename comparison below passes even when rehashedName is a no-op.
            esbuild: {legalComments: 'inline'},
            build: {
                outDir: plainDir,
                emptyOutDir: true,
                manifest: true,
                minify: false,
                rollupOptions: {input: [join(fixtures, 'entry.js')]},
            },
        });
        const plainName = readdirSync(join(plainDir, 'assets')).find((f) => f.startsWith('entry-'));

        await run(['entry.js'], {include: ['entry.js']}, outDir);

        const assets = join(outDir, 'assets');
        const entryFile = readdirSync(assets).find((f) => f.startsWith('entry-'));
        const code = readFileSync(join(assets, entryFile), 'utf8');

        // The bytes changed, so the URL must have changed with them. A no-op rehashedName fails here.
        expect(entryFile).not.toBe(plainName);

        // Obfuscated, and still parseable.
        expect(code).not.toContain('javascript-obfuscator:vm');
        expect(code).toMatch(/_0x[0-9a-f]+/);

        // The manifest points at the file that actually exists on disk.
        const manifest = JSON.parse(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'));
        const listed = Object.values(manifest).map((e) => e.file);

        expect(listed).toContain(join('assets', entryFile));
        expect(existsSync(join(outDir, listed.find((f) => f.includes('entry-'))))).toBe(true);
    });

    // Without this, unmatchedIncludes could be stubbed to [] — or fully inverted — and the suite
    // stayed green: the leak test below only asserts the message prefix, which never changed.
    it('names the include that matched no entry, instead of blaming a cross-import', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-badinclude');

        await expect(
            run(['entry.js'], {include: ['entry']}, outDir),
        ).rejects.toThrow(/match no build entry: entry/);
    });

    it('fails the build when an island module leaks into a non-island entry', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-leak');

        await expect(
            run(['entry.js', 'site.js'], {include: ['entry.js']}, outDir),
        ).rejects.toThrow(/are bundled but NOT obfuscated/);
    });

    // A marker present in source but gone from the chunk is exactly the silent loss the guard
    // exists to catch. Stripped by an inline plugin rather than by `minify: true`: esbuild
    // deliberately PRESERVES /*! … */ legal comments, so a minifier would not strip them and the
    // test would assert a failure that never happens.
    it('fails the build when a VM marker is stripped between source and chunk', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-marker');

        const stripMarkers = {
            name: 'strip-markers',
            enforce: 'post',
            renderChunk: (code) => code.replaceAll('/*! javascript-obfuscator:vm */', ''),
        };

        await expect(build({
            root: fixtures,
            logLevel: 'silent',
            build: {
                outDir,
                emptyOutDir: true,
                manifest: true,
                minify: false,
                rollupOptions: {input: [join(fixtures, 'entry.js')]},
            },
            plugins: [stripMarkers, obfuscator({
                enable: true, apiToken: '', islandRoots: [fixtures], include: ['entry.js'],
            })],
        })).rejects.toThrow(/VM marker\(s\) in its source modules/);

        // The guard fires on the SECOND chunk: the lazy one is processed first and passes. Nothing
        // may have moved on disk yet — under emptyOutDir:false this directory is what the site is
        // serving, so a half-applied pass would leave the manifest naming files a rename deleted.
        const assets = join(outDir, 'assets');
        const manifest = JSON.parse(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'));

        for (const entry of Object.values(manifest)) {
            expect(existsSync(join(outDir, entry.file))).toBe(true);
        }

        expect(readdirSync(assets).every((f) => !f.includes('javascript-obfuscator'))).toBe(true);
        expect(readFileSync(join(assets, readdirSync(assets).find((f) => f.startsWith('lazy-'))), 'utf8'))
            .toContain('function helper');
    });
});

describe('the marker guard', () => {
    // The two counts must be taken over the same set. While the source side was filtered by
    // islandRoots and the chunk side was not, a marked module anywhere else in the graph read as a
    // marker that appeared from nowhere, and every build died pointing at comment stripping.
    it('accepts a marked module that sits outside every island root', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-outside');

        await expect(
            run(['uses-outside.js'], {include: ['uses-outside.js']}, outDir),
        ).resolves.toBeDefined();
    });

    // Markers on non-exported `const` arrows, as a real consumer writes them. Unminified, each
    // still leads its declaration in the chunk.
    it('accepts markers on const arrow functions in an unminified build', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-arrows');

        await expect(
            run(['uses-arrows.js'], {include: ['uses-arrows.js']}, outDir),
        ).resolves.toBeDefined();
    });

    // oxc moves (8.3) or drops (8.0) the markers on the merged consts; either guard must fail the build.
    it('fails the build when minification moves arrow-function markers off their functions', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-arrows-min');

        await expect(
            run(['uses-arrows.js'], {include: ['uses-arrows.js']}, outDir, true),
        ).rejects.toThrow(/uses-arrows-.*: \d+ VM marker\(s\) (lead no function of their own|in its source modules)/);
    });

    // minify: false does not fix this one, so the message must name another way out. Here and for
    // overloads, 8.0's Rolldown drops the markers instead, which the count guard reports.
    it('names Rolldown when it inlines a single-use object and strands its property marker', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-options');

        await expect(
            run(['options.js'], {include: ['options.js']}, outDir),
        ).rejects.toThrow(/Rolldown inlines a single-use object|in its source modules/);
    });

    it('names a marker on each TS overload signature as the cause of a stacked marker', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-overload');

        await expect(
            run(['overload.ts'], {include: ['overload.ts']}, outDir),
        ).rejects.toThrow(/each TS overload signature has one|in its source modules/);
    });

    it('says a marker left at the end of the chunk is there, not before an empty string', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-trailing');

        await expect(
            run(['trailing.js'], {include: ['trailing.js']}, outDir),
        ).rejects.toThrow(/ {4}\d+:1 at the end of the chunk\n/);
    });

    it('fails the build on a marker that sits on a plain variable', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-marked-var');

        await expect(
            run(['marked-var.js'], {include: ['marked-var.js']}, outDir),
        ).rejects.toThrow(/1 VM marker\(s\) lead no function of their own in the built chunk:\n {4}2:1 before `var banner/);
    });

    // retired() is dropped but its legal comment is kept, landing on hot(): one marker in source,
    // one in the chunk, and a function nobody marked would go to the VM.
    it('fails the build when a marked exported function was tree-shaken', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-retired');

        await expect(
            run(['uses-hot.js'], {include: ['uses-hot.js']}, outDir, true),
        ).rejects.toThrow(/marked function retired \(.*retired\.js\) was tree-shaken/);
    });
});

describe('a minified build', () => {
    // Rolldown drops comments while rendering chunks, so on a minified build the plugin's config()
    // hook is the only reason any marker reaches the file it later reads off disk. Remove that hook
    // and this build dies on the marker count.
    it('keeps its markers, because the plugin sets the comment option itself', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-minified');

        await expect(build({
            root: fixtures,
            logLevel: 'silent',
            build: {
                outDir,
                emptyOutDir: true,
                manifest: true,
                minify: true,
                rollupOptions: {input: [join(fixtures, 'entry.js')]},
            },
            plugins: [obfuscator({enable: true, apiToken: '', islandRoots: [fixtures], include: ['entry.js']})],
        })).resolves.toBeDefined();
    });
});

describe('mustContain', () => {
    it('passes when the string survived into the built chunk', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-must-ok');

        await expect(
            run(['entry.js'], {include: ['entry.js'], mustContain: ['ready']}, outDir),
        ).resolves.toBeDefined();
    });

    // Code nothing imports is dropped by tree-shaking silently. This guard is the only thing that
    // notices, so it has to fire before obfuscation mangles the very name it looks for.
    it('fails the build when the string is gone', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-must-fail');

        await expect(
            run(['entry.js'], {include: ['entry.js'], mustContain: ['ready', 'aDecoyNothingImports']}, outDir),
        ).rejects.toThrow(/missing required content: aDecoyNothingImports/);
    });
});

describe('rehash: false', () => {
    // A script served at a fixed URL cannot be content-addressed — its name is a contract with
    // whoever embeds it. The bytes still change; the name must not.
    it('obfuscates the chunk but leaves its filename alone', async () => {
        const plainDir = join(import.meta.dirname, '..', '.tmp-fixed-plain');
        const outDir = join(import.meta.dirname, '..', '.tmp-fixed');

        await build({
            root: fixtures,
            logLevel: 'silent',
            build: {
                outDir: plainDir,
                emptyOutDir: true,
                minify: false,
                // input goes inside rolldownOptions: passing that key makes Vite ignore
                // rollupOptions entirely. output.comments mirrors what the plugin's config() hook
                // forces, so obfuscation is the only difference between the two builds.
                rolldownOptions: {
                    input: [join(fixtures, 'entry.js')],
                    output: {comments: {legal: true}},
                },
            },
        });
        const plainName = readdirSync(join(plainDir, 'assets')).find((f) => f.startsWith('entry-'));

        await run(['entry.js'], {include: ['entry.js'], rehash: false}, outDir);

        const assets = join(outDir, 'assets');
        const entryFile = readdirSync(assets).find((f) => f.startsWith('entry-'));

        expect(entryFile).toBe(plainName);
        expect(readFileSync(join(assets, entryFile), 'utf8')).toMatch(/_0x[0-9a-f]+/);
    });
});

describe('the parse guard', () => {
    it('fails the build on unparseable output after retrying local obfuscation', async () => {
        vi.resetModules();

        let calls = 0;

        vi.doMock('javascript-obfuscator', () => ({
            default: {
                obfuscate: () => {
                    calls++;

                    return {getObfuscatedCode: () => 'function ( {'};
                },
            },
        }));

        const {default: mocked} = await import('../src/index.js');
        const outDir = join(import.meta.dirname, '..', '.tmp-parse');

        await expect(build({
            root: fixtures,
            logLevel: 'silent',
            build: {outDir, emptyOutDir: true, minify: false, rollupOptions: {input: [join(fixtures, 'entry.js')]}},
            plugins: [mocked({enable: true, apiToken: '', islandRoots: [fixtures], include: ['entry.js']})],
        })).rejects.toThrow(/could not be obfuscated after 3 attempt\(s\): the output did not parse/);

        // Unseeded, every local run is a fresh draw, so one bad output earns a retry like the Pro API's.
        expect(calls).toBe(3);

        vi.doUnmock('javascript-obfuscator');
    });
});
