import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {buildObfuscatorConfig} from './config.js';
import {leakedIslandModules, leakedMessage} from './guards.js';
import {pointManifestAt} from './manifest.js';
import {
    VM_COMMENT_STANDARD, countMarkers, misplacedMarkers, restoreVmComments, shakenMarkedExports, sourceMarkers,
} from './markers.js';
import {obfuscateUntilItParses} from './obfuscate.js';
import {dependenciesFirst} from './order.js';
import {rehashedName} from './rehash.js';
import {selectTargets, unmatchedIncludes} from './select.js';
import {spareNodeModules} from './spare.js';

const PLUGIN_NAME = 'vite-obfuscator';

function formatSize(bytes) {
    return bytes >= 1e6 ? `${+(bytes / 1e6).toFixed(2)} MB` : `${+(bytes / 1e3).toFixed(1)} KB`;
}

export default function obfuscator(options = {}) {
    const {
        include = [],
        islandRoots = [],
        apiToken = '',
        vmObfuscation = false,
        vmObfuscationThreshold = 1,
        optionsPreset = 'low-obfuscation',
        spareNodeModules: spareVendor = false,
        seed,
        rehash = true,
        maxGzipBytes = 0,
        timeout,
        version,
        overrides = {},
    } = options;

    if (include.length === 0 || islandRoots.length === 0) {
        throw new Error('[Obfuscator] include and islandRoots are both required: with either empty the plugin obfuscates nothing and both guards pass on any input.');
    }

    const useVM = vmObfuscation && apiToken.trim() !== '';

    // Set in configResolved: roots resolve against Vite's root, which `--root` moves away from cwd.
    let roots = [];

    const configFor = (useVM) => buildObfuscatorConfig({optionsPreset, useVM, vmObfuscationThreshold, seed, overrides});
    const standardConfig = configFor(false);
    const vmConfig = configFor(true);

    return {
        name: PLUGIN_NAME,
        apply: 'build',
        enforce: 'post',

        configResolved(config) {
            // Realpath: Rolldown reports module ids by real path, so a symlinked root would match none.
            roots = islandRoots.map((root) => {
                const absolute = path.resolve(config.root, root);

                // realpathSync throws on a missing root; buildStart reports it.
                return existsSync(absolute) ? realpathSync(absolute) : absolute;
            });
        },

        buildStart() {
            if (vmObfuscation && apiToken.trim() === '') {
                this.error('[Obfuscator] vmObfuscation is on but apiToken is empty: every marked function would ship without the VM.');
            }

            const missing = roots.filter((root) => !existsSync(root));

            if (missing.length > 0) {
                this.error(`[Obfuscator] islandRoots not found on disk: ${missing.join(', ')}. A root that matches no module silently disables the boundary guard — check the path.`);
            }
        },

        // VM markers are legal comments, which a minified build drops without this.
        // Not `esbuild.legalComments`: Vite 8 deprecates it and the oxc minifier ignores it.
        config() {
            return {build: {rolldownOptions: {output: {comments: {legal: true}}}}};
        },

        // Post: Vite resolves __VITE_PRELOAD__ in a normal-order generateBundle.
        // An error here aborts before anything is written.
        generateBundle: {order: 'post', async handler(_outputOptions, bundle) {
            const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
            const targets = selectTargets(bundle, include);

            const leaked = leakedIslandModules(chunks, targets, roots);

            if (leaked.length > 0) {
                this.error(leakedMessage(leaked, unmatchedIncludes(bundle, include), islandRoots));
            }

            if (targets.length === 0) return;

            this.info(`🔒 Obfuscating ${targets.length} chunk(s) [${useVM ? 'VM-protected where marked' : optionsPreset}]...`);

            const renames = new Map();
            let droppedMaps = 0;

            let spared = 0;

            // Check every target first, so a guard fails before any (slow, with the VM) obfuscation.
            for (const chunk of targets) {
                const shaken = shakenMarkedExports(chunk);

                if (shaken.length > 0) {
                    this.error(
                        `[Obfuscator] ${chunk.fileName}:\n`
                        + shaken.map(({id, name}) => `    marked function ${name} (${id}) was tree-shaken; its marker would land on the next statement\n`).join('')
                        + 'Nothing imports it any more. Delete the function with its marker, or import it.',
                    );
                }

                let misplaced;

                try {
                    misplaced = misplacedMarkers(chunk.code);
                } catch (error) {
                    this.error(`[Obfuscator] ${chunk.fileName} does not parse before obfuscation: ${error.message}`);
                }

                if (misplaced.length > 0) {
                    this.error(
                        `[Obfuscator] ${chunk.fileName}: ${misplaced.length} VM marker(s) lead no function of their own in the built chunk:\n`
                        + misplaced.map(({line, column, followedBy}) => `    ${line}:${column} ${followedBy ? `before \`${followedBy}\`` : 'at the end of the chunk'}\n`).join('')
                        + 'A marker off its function is SILENT: nothing is virtualized where it was meant.\n'
                        + 'Check, in order:\n'
                        + '  1. the build moved it: oxc moves one on a const/let/var function, terser inlines a function called once (build.minify: false fixes both);\n'
                        + '     Rolldown inlines a single-use object at any minify setting — mark a function declaration\n'
                        + '  2. the marker sits on a function, a method, or a const/let/var, property or class field holding one — not a plain value\n'
                        + '  3. a marked function was dropped as unused and its marker kept\n'
                        + '  4. two markers lead the same function — keep one\n',
                    );
                }

                if (spareVendor) {
                    const result = spareNodeModules(chunk.code);

                    chunk.code = result.code;
                    spared += result.spans;
                }
            }

            if (spareVendor && spared === 0) {
                this.error(
                    '[Obfuscator] spareNodeModules is on but no node_modules module was found in any obfuscated chunk.\n'
                    + 'Rolldown marks module boundaries with comments, which a minified chunk loses: set build.minify to false,\n'
                    + 'or set spareNodeModules to false if the chunks bundle no node_modules code.',
                );
            }

            for (const chunk of dependenciesFirst(targets)) {
                let code = restoreVmComments(chunk.code);

                // Repoint imports at renamed dependencies now: once obfuscated, a static specifier is
                // hex-escaped and a dynamic one sits in the string array.
                for (const [from, to] of renames) {
                    code = code.replaceAll(path.basename(from), path.basename(to));
                }

                const expected = sourceMarkers(chunk.moduleIds);
                const survived = countMarkers(code, VM_COMMENT_STANDARD);

                if (survived !== expected) {
                    this.error(
                        `[Obfuscator] ${chunk.fileName}: ${expected} VM marker(s) in its source modules, ${survived} in the built chunk.\n`
                        + 'A lost marker is SILENT: its function would be obfuscated without the VM and ship patchable.\n'
                        + 'Check, in order:\n'
                        + '  1. a later plugin overrode build.rolldownOptions.output.comments after this one\n'
                        + '     set it to {legal: true} — that setting is what keeps markers through minification\n'
                        + '  2. every marker sits on its own line immediately before the function it marks\n'
                        + '  3. the marker is the legal form, /*! … */, not /* … */\n',
                    );
                }

                // Comment mode rejects a chunk with no markers.
                const pro = useVM && survived > 0;
                let result;

                try {
                    result = await obfuscateUntilItParses({
                        code,
                        config: pro ? vmConfig : standardConfig,
                        pro: pro && {
                            options: {apiToken, timeout, ...(version && {version})},
                            progress: (message) => this.info(`⏳ ${chunk.fileName}: ${message}`),
                        },
                        log: (message) => this.warn(`[Obfuscator] ${chunk.fileName}: ${message}`),
                    });
                } catch (error) {
                    this.error(`[Obfuscator] ${chunk.fileName} ${error.message}`);
                }

                const gzipBytes = gzipSync(result).length;

                this.info(`[Obfuscator] ${chunk.fileName} ${formatSize(Buffer.byteLength(chunk.code))} -> ${formatSize(Buffer.byteLength(result))} (gzip ${formatSize(gzipSync(chunk.code).length)} -> ${formatSize(gzipBytes)})`);

                if (maxGzipBytes > 0 && gzipBytes > maxGzipBytes) {
                    this.error(`[Obfuscator] ${chunk.fileName} is ${gzipBytes} bytes gzipped, over maxGzipBytes (${maxGzipBytes}).`);
                }

                const fileName = chunk.fileName;
                const rehashed = rehash ? rehashedName(fileName, result) : fileName;
                const mapName = chunk.sourcemapFileName ?? `${fileName}.map`;

                if (bundle[mapName]) {
                    delete bundle[mapName];
                    droppedMaps++;
                }

                chunk.code = result;
                chunk.fileName = rehashed;
                chunk.imports = chunk.imports.map((f) => renames.get(f) ?? f);
                chunk.dynamicImports = chunk.dynamicImports.map((f) => renames.get(f) ?? f);
                if (rehashed !== fileName) renames.set(fileName, rehashed);

                this.info(`✓ ${fileName}${rehashed === fileName ? '' : ` → ${rehashed}`}${survived > 0 ? ` (${survived} VM marker(s))` : ''}`);
            }

            if (droppedMaps > 0) {
                this.warn(`[Obfuscator] dropped ${droppedMaps} sourcemap(s) of obfuscated chunks: each maps the readable code, not the obfuscated output, and its sourcesContent ships that readable source.`);
            }

            const {manifest, ssrManifest, chunkImportMap, rolldownOptions} = this.environment.config.build;

            pointManifestAt(bundle, [
                manifest === true ? '.vite/manifest.json' : manifest,
                ssrManifest === true ? '.vite/ssr-manifest.json' : ssrManifest,
                // As Vite's getImportMapFilename names it.
                chunkImportMap && (rolldownOptions.experimental?.chunkImportMap?.fileName || 'importmap.json'),
            ].filter(Boolean), renames);
        }},
    };
}
