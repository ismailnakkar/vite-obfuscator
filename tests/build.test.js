import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build, createBuilder} from 'vite';
import {afterAll, describe, expect, it, vi} from 'vitest';
import obfuscator from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'island');
const repoRoot = join(import.meta.dirname, '..');

// Swept by prefix, so a new .tmp-* build directory cannot be missed.
afterAll(() => {
    for (const entry of readdirSync(repoRoot)) {
        if (entry.startsWith('.tmp-')) rmSync(join(repoRoot, entry), {recursive: true, force: true});
    }
});

const run = (inputs, options, outDir, minify = false, extra = {}) => build({
    root: fixtures,
    logLevel: 'silent',
    build: {
        outDir,
        emptyOutDir: true,
        manifest: true,
        minify,
        rollupOptions: {input: inputs.map((i) => join(fixtures, i))},
        ...extra,
    },
    plugins: [obfuscator({apiToken: '', islandRoots: [fixtures], ...options})],
});

const chunkNamed = (output, prefix) => output.find((o) => o.fileName.startsWith(`assets/${prefix}-`));

/**
 * Imports a built chunk in a child node process and returns each specifier that did not resolve,
 * static (the load rejects) or dynamic (an unhandled rejection). A child, because vitest resolves a
 * nested `import()` against the project root; stdout.write, because disableConsoleOutput stubs console.
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

        expect(unresolvedImportsIn(join(assets, entryFile))).toEqual([]);
    });

    it('is followed by both entries that statically share it', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-shared');

        const {output} = await run(['pair-a.js', 'pair-b.js'], {include: ['pair-a.js', 'pair-b.js']}, outDir);

        const assets = join(outDir, 'assets');
        const files = readdirSync(assets);

        expect(files.some((f) => f.startsWith('shared-'))).toBe(true);
        expect(chunkNamed(output, 'pair-a').imports).toEqual([chunkNamed(output, 'shared').fileName]);
        expect(unresolvedImportsIn(join(assets, files.find((f) => f.startsWith('pair-a-'))))).toEqual([]);
        expect(unresolvedImportsIn(join(assets, files.find((f) => f.startsWith('pair-b-'))))).toEqual([]);
    });
});

describe('a real build', () => {
    it('obfuscates the entry, rehashes it from the new bytes, and repoints the manifest', async () => {
        const plainDir = join(import.meta.dirname, '..', '.tmp-plain');
        const outDir = join(import.meta.dirname, '..', '.tmp-ok');

        // Baseline: Vite's own name for the same build without the plugin.
        await build({
            root: fixtures,
            logLevel: 'silent',
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

        const {output} = await run(['entry.js'], {include: ['entry.js']}, outDir);

        const assets = join(outDir, 'assets');
        const files = readdirSync(assets);
        const entryFile = files.find((f) => f.startsWith('entry-'));
        const code = readFileSync(join(assets, entryFile), 'utf8');

        // Only the renamed file is written, no readable twin.
        expect(files.filter((f) => /^entry-.*\.js$/.test(f))).toHaveLength(1);
        expect(files.filter((f) => /^lazy-.*\.js$/.test(f))).toHaveLength(1);

        expect(chunkNamed(output, 'entry').dynamicImports).toEqual([chunkNamed(output, 'lazy').fileName]);

        // Fails if rehashedName is a no-op.
        expect(entryFile).not.toBe(plainName);

        expect(code).not.toContain('javascript-obfuscator:vm');
        expect(code).toMatch(/_0x[0-9a-f]+/);

        const manifest = JSON.parse(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'));
        const listed = Object.values(manifest).map((e) => e.file);

        expect(listed).toContain(join('assets', entryFile));
        expect(existsSync(join(outDir, listed.find((f) => f.includes('entry-'))))).toBe(true);
    });

    it('drops the sourcemap of every obfuscated chunk', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-sourcemap');

        const warnings = [];

        await run(['entry.js'], {include: ['entry.js']}, outDir, false, {
            sourcemap: true,
            rollupOptions: {input: [join(fixtures, 'entry.js')], onwarn: (w) => warnings.push(w.message)},
        });

        expect(readdirSync(join(outDir, 'assets')).filter((f) => f.endsWith('.map'))).toEqual([]);
        expect(warnings.filter((m) => m.includes('[Obfuscator] dropped 2 sourcemap(s)'))).toHaveLength(1);
    });

    // Vite writes index.html in a normal-order generateBundle, so it names the pre-rehash file.
    it('points an HTML entry at the obfuscated file', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-html');

        await run(['index.html'], {include: ['index.html']}, outDir);

        const src = readFileSync(join(outDir, 'index.html'), 'utf8').match(/<script[^>]* src="\/([^"]+)"/)[1];

        expect(readFileSync(join(outDir, src), 'utf8')).toMatch(/_0x[0-9a-f]+/);
    });

    it('points pages that share a script at it once that script is an included input', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-pages');
        const pages = ['index.html', 'sub/page.html'];

        await expect(run(pages, {include: pages}, outDir)).rejects.toThrow(
            /match no build entry: index\.html, sub\/page\.html\. Vite drops the chunk of an HTML page/,
        );

        await run([...pages, 'entry.js'], {include: ['entry.js']}, outDir);

        for (const page of pages) {
            const src = readFileSync(join(outDir, page), 'utf8').match(/<script[^>]* src="\/(assets\/entry-[^"]+)"/)[1];

            expect(readFileSync(join(outDir, src), 'utf8')).toMatch(/_0x[0-9a-f]+/);
        }
    });

    // build.chunkImportMap writes importmap.json in a normal-order generateBundle, naming pre-rehash files.
    it('repoints the chunk import map file', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-importmap');

        await run(['index.html'], {include: ['index.html']}, outDir, false, {chunkImportMap: true});

        const files = Object.values(JSON.parse(readFileSync(join(outDir, 'importmap.json'), 'utf8')).imports);

        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(existsSync(join(outDir, file))).toBe(true);
    });

    it('repoints a manifest at a custom path, and the SSR manifest', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-manifest-path');

        await run(['entry.js'], {include: ['entry.js']}, outDir, false, {manifest: 'assets-manifest.json', ssrManifest: 'ssr.json'});

        const listed = Object.values(JSON.parse(readFileSync(join(outDir, 'assets-manifest.json'), 'utf8'))).map((e) => e.file);
        const ssrListed = Object.values(JSON.parse(readFileSync(join(outDir, 'ssr.json'), 'utf8'))).flat();

        expect(listed).toHaveLength(2);
        expect(ssrListed.length).toBeGreaterThan(0);
        for (const file of [...listed, ...ssrListed]) expect(existsSync(join(outDir, file))).toBe(true);
    });

    // An app build sharing its config keeps the top-level config.build, which misses this path.
    it('repoints a manifest set on the client environment', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-env-manifest');
        const builder = await createBuilder({
            root: fixtures,
            logLevel: 'silent',
            builder: {sharedConfigBuild: true},
            build: {outDir, emptyOutDir: true, minify: false, rolldownOptions: {input: [join(fixtures, 'entry.js')]}},
            environments: {client: {build: {manifest: 'env-manifest.json'}}},
            plugins: [obfuscator({apiToken: '', islandRoots: [fixtures], include: ['entry.js']})],
        });

        await builder.build(builder.environments.client);

        const listed = Object.values(JSON.parse(readFileSync(join(outDir, 'env-manifest.json'), 'utf8'))).map((e) => e.file);

        expect(listed).toHaveLength(2);
        for (const file of listed) expect(existsSync(join(outDir, file))).toBe(true);
    });

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

    // Stripped by a plugin: with the plugin's config, minification keeps legal comments.
    it('fails the build when a VM marker is stripped between source and chunk', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-marker');

        const stripMarkers = {
            name: 'strip-markers',
            enforce: 'post',
            renderChunk: (code) => code.replaceAll('/*! javascript-obfuscator:vm */', ''),
        };

        rmSync(outDir, {recursive: true, force: true});
        mkdirSync(join(outDir, '.vite'), {recursive: true});
        writeFileSync(join(outDir, '.vite', 'manifest.json'), '{"old":true}');

        await expect(build({
            root: fixtures,
            logLevel: 'silent',
            build: {
                outDir,
                emptyOutDir: false,
                manifest: true,
                minify: false,
                rollupOptions: {input: [join(fixtures, 'entry.js')]},
            },
            plugins: [stripMarkers, obfuscator({
                apiToken: '', islandRoots: [fixtures], include: ['entry.js'],
            })],
        })).rejects.toThrow(/VM marker\(s\) in its source modules/);

        // The lazy chunk passes first and the entry fails; nothing is written over the served files.
        expect(readdirSync(outDir)).toEqual(['.vite']);
        expect(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8')).toBe('{"old":true}');
    });
});

describe('the marker guard', () => {
    it('accepts a marked module that sits outside every island root', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-outside');

        await expect(
            run(['uses-outside.js'], {include: ['uses-outside.js']}, outDir),
        ).resolves.toBeDefined();
    });

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

    it('fails the build on a marker that sits on a plain variable', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-marked-var');

        await expect(
            run(['marked-var.js'], {include: ['marked-var.js']}, outDir),
        ).rejects.toThrow(/1 VM marker\(s\) lead no function of their own in the built chunk:\n {4}2:1 before `var banner/);
    });

    // retired()'s kept marker lands on hot(), so the marker counts still match.
    it('fails the build when a marked exported function was tree-shaken', async () => {
        const outDir = join(import.meta.dirname, '..', '.tmp-retired');

        await expect(
            run(['uses-hot.js'], {include: ['uses-hot.js']}, outDir, true),
        ).rejects.toThrow(/marked function retired \(.*retired\.js\) was tree-shaken/);
    });
});

describe('a minified build', () => {
    // Fails on the marker count if the plugin's config() hook stops keeping legal comments.
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
            plugins: [obfuscator({apiToken: '', islandRoots: [fixtures], include: ['entry.js']})],
        })).resolves.toBeDefined();
    });
});

describe('rehash: false', () => {
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
                // Passing rolldownOptions makes Vite ignore rollupOptions. comments mirrors the
                // plugin's config() hook, so obfuscation is the only difference.
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
            plugins: [mocked({apiToken: '', islandRoots: [fixtures], include: ['entry.js']})],
        })).rejects.toThrow(/could not be obfuscated after 3 attempt\(s\): the output did not parse/);

        expect(calls).toBe(3);

        vi.doUnmock('javascript-obfuscator');
    });
});
