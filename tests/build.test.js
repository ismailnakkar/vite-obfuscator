import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {build, createBuilder} from 'vite';
import {afterAll, describe, expect, it, vi} from 'vitest';
import obfuscator from '../src/index.js';

const fixtures = join(import.meta.dirname, 'fixtures', 'island');
const repoRoot = join(import.meta.dirname, '..');
const tmp = (name) => join(repoRoot, `.tmp-${name}`);

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
        rolldownOptions: {input: inputs.map((i) => join(fixtures, i))},
        ...extra,
    },
    plugins: [obfuscator({islandRoots: [fixtures], ...options})],
});

/** Vite's own name for entry.js, built as the plugin builds it minus obfuscation. */
const plainEntryName = async (outDir) => {
    await build({
        root: fixtures,
        logLevel: 'silent',
        build: {
            outDir,
            emptyOutDir: true,
            minify: false,
            rolldownOptions: {input: [join(fixtures, 'entry.js')]},
        },
    });

    return readdirSync(join(outDir, 'assets')).find((f) => f.startsWith('entry-'));
};

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
        const outDir = tmp('dyn');

        await run(['entry.js'], {include: ['entry.js']}, outDir);

        const assets = join(outDir, 'assets');
        const entryFile = readdirSync(assets).find((f) => f.startsWith('entry-'));

        expect(unresolvedImportsIn(join(assets, entryFile))).toEqual([]);
    });

    it('is followed by both entries that statically share it', async () => {
        const outDir = tmp('shared');

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
        const plainName = await plainEntryName(tmp('plain'));
        const outDir = tmp('ok');

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

        // entry.js keeps a 6.x VM marker: a plain comment now, which the obfuscator drops.
        expect(code).not.toContain('javascript-obfuscator:vm');
        expect(code).toMatch(/_0x[0-9a-f]+/);

        const manifest = JSON.parse(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'));
        const listed = Object.values(manifest).map((e) => e.file);

        expect(listed).toContain(join('assets', entryFile));
        expect(existsSync(join(outDir, listed.find((f) => f.includes('entry-'))))).toBe(true);
    });

    it('drops the sourcemap of every obfuscated chunk', async () => {
        const outDir = tmp('sourcemap');

        const warnings = [];

        await run(['entry.js'], {include: ['entry.js']}, outDir, false, {
            sourcemap: true,
            rolldownOptions: {input: [join(fixtures, 'entry.js')], onwarn: (w) => warnings.push(w.message)},
        });

        expect(readdirSync(join(outDir, 'assets')).filter((f) => f.endsWith('.map'))).toEqual([]);
        expect(warnings).toContain(
            'dropped 2 sourcemap(s) of obfuscated chunks: each maps the readable code, not the obfuscated output, and its sourcesContent ships that readable source.',
        );
    });

    // Vite writes index.html in a normal-order generateBundle, so it names the pre-rehash file.
    it('points an HTML entry at the obfuscated file', async () => {
        const outDir = tmp('html');

        await run(['index.html'], {include: ['index.html']}, outDir);

        const src = readFileSync(join(outDir, 'index.html'), 'utf8').match(/<script[^>]* src="\/([^"]+)"/)[1];

        expect(readFileSync(join(outDir, src), 'utf8')).toMatch(/_0x[0-9a-f]+/);
    });

    it('points pages that share a script at it once that script is an included input', async () => {
        const outDir = tmp('pages');
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
        const outDir = tmp('importmap');

        await run(['index.html'], {include: ['index.html']}, outDir, false, {chunkImportMap: true});

        const files = Object.values(JSON.parse(readFileSync(join(outDir, 'importmap.json'), 'utf8')).imports);

        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(existsSync(join(outDir, file))).toBe(true);
    });

    it('repoints a manifest at a custom path, and the SSR manifest', async () => {
        const outDir = tmp('manifest-path');

        await run(['entry.js'], {include: ['entry.js']}, outDir, false, {manifest: 'assets-manifest.json', ssrManifest: 'ssr.json'});

        const listed = Object.values(JSON.parse(readFileSync(join(outDir, 'assets-manifest.json'), 'utf8'))).map((e) => e.file);
        const ssrListed = Object.values(JSON.parse(readFileSync(join(outDir, 'ssr.json'), 'utf8'))).flat();

        expect(listed).toHaveLength(2);
        expect(ssrListed.length).toBeGreaterThan(0);
        for (const file of [...listed, ...ssrListed]) expect(existsSync(join(outDir, file))).toBe(true);
    });

    // An app build sharing its config keeps the top-level config.build, which misses this path.
    it('repoints a manifest set on the client environment', async () => {
        const outDir = tmp('env-manifest');
        const builder = await createBuilder({
            root: fixtures,
            logLevel: 'silent',
            builder: {sharedConfigBuild: true},
            build: {outDir, emptyOutDir: true, minify: false, rolldownOptions: {input: [join(fixtures, 'entry.js')]}},
            environments: {client: {build: {manifest: 'env-manifest.json'}}},
            plugins: [obfuscator({islandRoots: [fixtures], include: ['entry.js']})],
        });

        await builder.build(builder.environments.client);

        const listed = Object.values(JSON.parse(readFileSync(join(outDir, 'env-manifest.json'), 'utf8'))).map((e) => e.file);

        expect(listed).toHaveLength(2);
        for (const file of listed) expect(existsSync(join(outDir, file))).toBe(true);
    });

    it('names the include that matched no entry, instead of blaming a cross-import', async () => {
        const outDir = tmp('badinclude');

        await expect(
            run(['entry.js'], {include: ['entry']}, outDir),
        ).rejects.toThrow(/match no build entry: entry/);
    });

    it('fails the build when an island module leaks into a non-island entry', async () => {
        const outDir = tmp('leak');

        await expect(
            run(['entry.js', 'site.js'], {include: ['entry.js']}, outDir),
        ).rejects.toThrow(
            `RolldownError: 2 module(s) under ${fixtures} are bundled but NOT obfuscated:\n`
            + `    ${join(fixtures, 'site.js')}\n    ${join(fixtures, 'lazy.js')}\n`,
        );
    });

    // An error in the post-order generateBundle aborts before Vite writes anything.
    it('leaves the served files alone when a chunk fails', async () => {
        const outDir = tmp('untouched');

        rmSync(outDir, {recursive: true, force: true});
        mkdirSync(join(outDir, '.vite'), {recursive: true});
        writeFileSync(join(outDir, '.vite', 'manifest.json'), '{"old":true}');

        await expect(
            run(['entry.js'], {include: ['entry.js'], maxGzipBytes: 1}, outDir, false, {emptyOutDir: false}),
        ).rejects.toThrow(/over maxGzipBytes \(1\)/);

        expect(readdirSync(outDir)).toEqual(['.vite']);
        expect(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8')).toBe('{"old":true}');
    });
});

describe('rehash: false', () => {
    it('obfuscates the chunk but leaves its filename alone', async () => {
        const plainName = await plainEntryName(tmp('fixed-plain'));
        const outDir = tmp('fixed');

        await run(['entry.js'], {include: ['entry.js'], rehash: false}, outDir);

        const assets = join(outDir, 'assets');
        const entryFile = readdirSync(assets).find((f) => f.startsWith('entry-'));

        expect(entryFile).toBe(plainName);
        expect(readFileSync(join(assets, entryFile), 'utf8')).toMatch(/_0x[0-9a-f]+/);
    });
});

describe('the size report', () => {
    const kb = (bytes) => `${+(bytes / 1e3).toFixed(1)} KB`;

    const logInto = (logs) => ({
        rolldownOptions: {input: [join(fixtures, 'entry.js')], onLog: (_level, log) => logs.push(log.message)},
    });

    it('logs raw and gzip size for each obfuscated chunk', async () => {
        const logs = [];
        const readable = new Map();

        const {output} = await build({
            root: fixtures,
            logLevel: 'silent',
            build: {outDir: tmp('size'), emptyOutDir: true, minify: false, ...logInto(logs)},
            plugins: [
                // Post, so Vite has resolved __VITE_PRELOAD__; listed first, so it runs before the obfuscator.
                {
                    name: 'keep-readable',
                    generateBundle: {order: 'post', handler(_options, bundle) {
                        for (const {fileName, code} of Object.values(bundle)) readable.set(fileName, code);
                    }},
                },
                obfuscator({islandRoots: [fixtures], include: ['entry.js'], rehash: false}),
            ],
        });

        const chunks = output.filter((o) => o.type === 'chunk');

        expect(chunks).toHaveLength(2);
        expect(logs).toContain('🔒 Obfuscating 2 chunk(s) [low-obfuscation]...');

        for (const {fileName, code} of chunks) {
            const before = readable.get(fileName);

            expect(logs).toContain(
                `${fileName} ${kb(Buffer.byteLength(before))} -> ${kb(Buffer.byteLength(code))}`
                + ` (gzip ${kb(gzipSync(before).length)} -> ${kb(gzipSync(code).length)})`,
            );
        }
    });

    it('fails the build naming the chunk when gzip exceeds maxGzipBytes', async () => {
        const outDir = tmp('budget');

        // Vite's `[plugin vite-obfuscator]` heads the error; the message adds no prefix of its own.
        await expect(
            run(['entry.js'], {include: ['entry.js'], maxGzipBytes: 1}, outDir),
        ).rejects.toThrow(/\nRolldownError: assets\/(entry|lazy)-\S+\.js is \d+ bytes gzipped, over maxGzipBytes \(1\)\.\n/);

        expect(existsSync(join(outDir, 'assets'))).toBe(false);

        // Over each chunk's gzip size, under its raw size.
        await expect(
            run(['entry.js'], {include: ['entry.js'], maxGzipBytes: 60_000}, outDir),
        ).resolves.toBeDefined();
    });

    it('does not check size when maxGzipBytes is 0', async () => {
        const logs = [];

        await expect(
            run(['entry.js'], {include: ['entry.js'], maxGzipBytes: 0}, tmp('budget-off'), false, logInto(logs)),
        ).resolves.toBeDefined();

        expect(logs.filter((message) => message.includes(' (gzip '))).toHaveLength(2);
    });

    it('prints a chunk of a million bytes or more in MB', async () => {
        vi.resetModules();

        vi.doMock('javascript-obfuscator', () => ({
            default: {obfuscate: () => ({getObfuscatedCode: () => `"${'x'.repeat(1_849_998)}"`})},
        }));

        const {default: mocked} = await import('../src/index.js');
        const logs = [];

        await build({
            root: fixtures,
            logLevel: 'silent',
            build: {outDir: tmp('size-mb'), emptyOutDir: true, minify: false, ...logInto(logs)},
            plugins: [mocked({islandRoots: [fixtures], include: ['entry.js']})],
        });

        expect(logs.filter((message) => message.includes(' -> 1.85 MB (gzip '))).toHaveLength(2);

        vi.doUnmock('javascript-obfuscator');
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
        const outDir = tmp('parse');

        await expect(build({
            root: fixtures,
            logLevel: 'silent',
            build: {outDir, emptyOutDir: true, minify: false, rolldownOptions: {input: [join(fixtures, 'entry.js')]}},
            plugins: [mocked({islandRoots: [fixtures], include: ['entry.js']})],
        })).rejects.toThrow(/\nRolldownError: assets\/(entry|lazy)-\S+\.js could not be obfuscated after 3 attempt\(s\): the output did not parse\n/);

        expect(calls).toBe(3);

        vi.doUnmock('javascript-obfuscator');
    });
});
