import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {buildObfuscatorConfig} from './config.js';
import {leakedIslandModules} from './guards.js';
import {manifestFiles, repointAssets} from './manifest.js';
import {NOTHING_SPARED_MESSAGE, leakedMessage} from './messages.js';
import {obfuscateUntilItParses} from './obfuscate.js';
import {dependenciesFirst} from './order.js';
import {rehashedName} from './rehash.js';
import {chunksOf, selectTargets, unmatchedIncludes} from './select.js';
import {spareNodeModules} from './spare.js';

const PLUGIN_NAME = 'vite-obfuscator';

function formatSize(bytes) {
    return bytes >= 1e6 ? `${+(bytes / 1e6).toFixed(2)} MB` : `${+(bytes / 1e3).toFixed(1)} KB`;
}

/**
 * Repoints imports at renamed dependencies, before obfuscation: after it, a static specifier is
 * hex-escaped and a dynamic one sits in the string array.
 */
function repointImports(code, renames) {
    for (const [from, to] of renames) {
        code = code.replaceAll(path.basename(from), path.basename(to));
    }

    return code;
}

export default function obfuscator(options = {}) {
    const {
        include = [],
        islandRoots = [],
        optionsPreset = 'low-obfuscation',
        spareNodeModules: spareVendor = false,
        rehash = true,
        maxGzipBytes = 0,
        overrides = {},
    } = options;

    if (include.length === 0 || islandRoots.length === 0) {
        throw new Error('[Obfuscator] include and islandRoots are both required: with either empty the plugin obfuscates nothing and the boundary guard passes on any input.');
    }

    const obfuscatorConfig = buildObfuscatorConfig({optionsPreset, overrides});

    // Set in configResolved: roots resolve against Vite's root, which `--root` moves away from cwd.
    let roots = [];

    function spareVendorCode(context, targets) {
        let spared = 0;

        for (const chunk of targets) {
            const result = spareNodeModules(chunk.code);

            chunk.code = result.code;
            spared += result.spans;
        }

        if (spared === 0) context.error(NOTHING_SPARED_MESSAGE);
    }

    function obfuscate(context, fileName, code) {
        try {
            return obfuscateUntilItParses({code, config: obfuscatorConfig, log: (message) => context.warn(`${fileName}: ${message}`)});
        } catch (error) {
            context.error(`${fileName} ${error.message}`);
        }
    }

    function checkSize(context, fileName, before, after) {
        const gzipBytes = gzipSync(after).length;

        context.info(`${fileName} ${formatSize(Buffer.byteLength(before))} -> ${formatSize(Buffer.byteLength(after))} (gzip ${formatSize(gzipSync(before).length)} -> ${formatSize(gzipBytes)})`);

        if (maxGzipBytes > 0 && gzipBytes > maxGzipBytes) {
            context.error(`${fileName} is ${gzipBytes} bytes gzipped, over maxGzipBytes (${maxGzipBytes}).`);
        }
    }

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
            const missing = roots.filter((root) => !existsSync(root));

            if (missing.length > 0) {
                this.error(`islandRoots not found on disk: ${missing.join(', ')}. A root that matches no module silently disables the boundary guard — check the path.`);
            }
        },

        // Post: Vite resolves __VITE_PRELOAD__ in a normal-order generateBundle.
        // An error here aborts before anything is written.
        generateBundle: {order: 'post', handler(_outputOptions, bundle) {
            const chunks = chunksOf(bundle);
            const targets = selectTargets(bundle, include);
            const leaked = leakedIslandModules(chunks, targets, roots);

            if (leaked.length > 0) {
                this.error(leakedMessage(leaked, unmatchedIncludes(bundle, include), islandRoots));
            }

            if (targets.length === 0) return;

            this.info(`🔒 Obfuscating ${targets.length} chunk(s) [${optionsPreset}]...`);

            // Every target first, so nothing to spare fails the build before any (slow) obfuscation.
            if (spareVendor) spareVendorCode(this, targets);

            const renames = new Map();
            const renamed = (fileName) => renames.get(fileName) ?? fileName;
            let droppedMaps = 0;

            for (const chunk of dependenciesFirst(targets)) {
                const fileName = chunk.fileName;
                const result = obfuscate(this, fileName, repointImports(chunk.code, renames));

                checkSize(this, fileName, chunk.code, result);

                const mapName = chunk.sourcemapFileName ?? `${fileName}.map`;

                if (bundle[mapName]) {
                    delete bundle[mapName];
                    droppedMaps++;
                }

                const rehashed = rehash ? rehashedName(fileName, result) : fileName;

                chunk.code = result;
                chunk.fileName = rehashed;
                chunk.imports = chunk.imports.map(renamed);
                chunk.dynamicImports = chunk.dynamicImports.map(renamed);
                if (rehashed !== fileName) renames.set(fileName, rehashed);

                this.info(`✓ ${fileName}${rehashed === fileName ? '' : ` → ${rehashed}`}`);
            }

            if (droppedMaps > 0) {
                this.warn(`dropped ${droppedMaps} sourcemap(s) of obfuscated chunks: each maps the readable code, not the obfuscated output, and its sourcesContent ships that readable source.`);
            }

            repointAssets(bundle, manifestFiles(this.environment.config.build), renames);
        }},
    };
}
