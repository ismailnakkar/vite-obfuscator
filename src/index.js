import {parse} from 'acorn';
import JavaScriptObfuscator from 'javascript-obfuscator';
import {readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildObfuscatorConfig} from './config.js';
import {leakedIslandModules} from './guards.js';
import {pointManifestAt} from './manifest.js';
import {VM_COMMENT_STANDARD, countMarkers, restoreVmComments, sourceMarkers} from './markers.js';
import {rehashedName} from './rehash.js';
import {selectTargets} from './select.js';

const PLUGIN_NAME = 'vite-obfuscator';
const MAX_RETRIES = 3;
const PRO_API_TIMEOUT_MS = 300_000;

function parses(code) {
    try {
        parse(code, {ecmaVersion: 'latest', sourceType: 'module'});
        return true;
    } catch {
        return false;
    }
}

/**
 * Post-order over the target graph, so a chunk is processed only after everything it imports.
 * Renaming a chunk invalidates the specifier every importer carries, and that specifier can only be
 * repaired while it is still a plain literal — before the importer is obfuscated.
 */
function dependenciesFirst(targets) {
    const byFileName = new Map(targets.map((chunk) => [chunk.fileName, chunk]));
    const ordered = [];
    const done = new Set();
    const visiting = new Set();

    const visit = (chunk) => {
        if (!chunk || done.has(chunk.fileName)) return;

        // Rollup can emit chunks that import each other. No order repairs both, so this fails
        // loudly rather than shipping one of them with a stale specifier.
        if (visiting.has(chunk.fileName)) {
            throw new Error(`[Obfuscator] ${chunk.fileName} is in an import cycle between obfuscated chunks, which cannot be renamed safely.`);
        }

        visiting.add(chunk.fileName);
        for (const fileName of [...chunk.imports, ...chunk.dynamicImports]) visit(byFileName.get(fileName));
        visiting.delete(chunk.fileName);

        done.add(chunk.fileName);
        ordered.push(chunk);
    };

    targets.forEach(visit);

    return ordered;
}

export default function obfuscator(options = {}) {
    const {
        enable = true,
        include = [],
        islandRoots = [],
        apiToken = '',
        vmObfuscation = false,
        vmObfuscationThreshold = 1,
        vmTargetFunctionsMode = 'comment',
        vmTargetFunctions,
        vmExcludeFunctions,
        optionsPreset = 'high-obfuscation',
        rehash = true,
        mustContain = [],
        timeout = PRO_API_TIMEOUT_MS,
        version,
        overrides = {},
    } = options;

    if (!enable) {
        return {name: PLUGIN_NAME, apply: 'build'};
    }

    // Neither has a safe empty value. Without `include` nothing is selected and the plugin returns
    // having obfuscated nothing; without `islandRoots` both guards compare empty sets and pass on
    // any input. Either way an enabled build ships readable code and says nothing.
    if (include.length === 0 || islandRoots.length === 0) {
        throw new Error('[Obfuscator] include and islandRoots are both required: with either empty the plugin obfuscates nothing and both guards pass on any input.');
    }

    const useVM = vmObfuscation && apiToken.trim() !== '';
    const roots = islandRoots.map((root) => path.resolve(root));

    const standardConfig = buildObfuscatorConfig({
        optionsPreset, useVM: false, vmObfuscationThreshold,
        vmTargetFunctionsMode, vmTargetFunctions, vmExcludeFunctions, overrides,
    });
    const vmConfig = buildObfuscatorConfig({
        optionsPreset, useVM: true, vmObfuscationThreshold,
        vmTargetFunctionsMode, vmTargetFunctions, vmExcludeFunctions, overrides,
    });

    return {
        name: PLUGIN_NAME,
        apply: 'build',
        enforce: 'post',

        // Without a token the VM request falls back to standard obfuscation, silently.
        buildStart() {
            if (vmObfuscation && apiToken.trim() === '') {
                this.error('[Obfuscator] vmObfuscation is on but OBFUSCATOR_API_TOKEN is empty: every marked function would ship without the VM.');
            }
        },

        // Markers are legal comments, and Rolldown drops comments while rendering chunks — while this
        // plugin reads the file FROM disk (see writeBundle). Without this the marker-count guard fires
        // on every minified build. The plugin owns the precondition it depends on.
        //
        // Not `esbuild.legalComments`: Vite 8 deprecates that key, warns by name about the plugin
        // that set it, and honours it nowhere the oxc minifier can see. Measured on 8.3.0 at
        // minify:true — default comments keeps 0 markers, this keeps all of them.
        config() {
            return {build: {rolldownOptions: {output: {comments: {legal: true}}}}};
        },

        /**
         * writeBundle, not generateBundle: Vite resolves its `__VITE_PRELOAD__` placeholder in a
         * later post hook, so an in-memory chunk still carries it. The obfuscator treats that
         * placeholder as a global and emits a get/set pair for it; Vite then substitutes `void 0`
         * into the setter body, producing `void 0 = x` — a bundle no browser can parse. Rewriting
         * the file on disk obfuscates exactly what ships, placeholders already resolved.
         */
        async writeBundle(outputOptions, bundle) {
            const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
            const targets = selectTargets(bundle, include);

            const leaked = leakedIslandModules(chunks, targets, roots);

            if (leaked.length > 0) {
                this.error(
                    `[Obfuscator] ${leaked.length} module(s) under ${islandRoots.join(', ')} are bundled but NOT obfuscated:\n`
                    + leaked.map((id) => `    ${id}`).join('\n') + '\n\n'
                    + 'A chunk is obfuscated only when EVERY entry that reaches it is an included entry. '
                    + 'Something outside the island now imports one of these, so its chunk is shared and was spared.',
                );
            }

            if (targets.length === 0) return;

            console.log(`\n🔒 Obfuscating ${targets.length} chunk(s) [${useVM ? 'VM-protected where marked' : optionsPreset}]...`);

            const outputDir = outputOptions.dir ?? '.';
            const renames = [];
            const pending = [];

            // Every target read up front, because mustContain is answered across all of them at once
            // and has to run BEFORE any obfuscation — afterwards the identifiers it looks for are
            // mangled and every needle would appear missing.
            const sources = new Map();

            for (const chunk of targets) {
                sources.set(chunk.fileName, restoreVmComments(await readFile(path.resolve(outputDir, chunk.fileName), 'utf8')));
            }

            const absent = mustContain.filter((needle) => ![...sources.values()].some((code) => code.includes(needle)));

            if (absent.length > 0) {
                this.error(
                    `[Obfuscator] the obfuscated chunks are missing required content: ${absent.join(', ')}.\n`
                    + 'Code nothing imports is dropped by tree-shaking with no error of its own, so this is\n'
                    + 'the only thing that notices. Check the keep-alive references in the entry module.',
                );
            }

            // Nothing reaches disk in this pass. A guard firing on chunk N used to leave chunks
            // 1..N-1 already renamed with the manifest still naming the files the rename deleted —
            // and under emptyOutDir:false that directory is what the site is serving.
            for (const chunk of dependenciesFirst(targets)) {
                const filePath = path.resolve(outputDir, chunk.fileName);
                let code = sources.get(chunk.fileName);

                // A dependency handled earlier in this loop has a new name, and this chunk still
                // imports the old one. Repaired here because it can only be repaired here: once
                // obfuscated, a static specifier is hex-escaped and a dynamic one sits in the
                // string array, where no text replacement reaches either.
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
                        + '  1. the consuming Vite config overrode build.rolldownOptions.output.comments\n'
                        + '     (this plugin sets it to {legal: true}, which is what keeps these through minification)\n'
                        + '  2. the build uses a minifier this plugin cannot reach — terser needs its own\n'
                        + '     terserOptions.format.comments predicate to keep them\n'
                        + '  3. every marker sits on its own line immediately before an exported function declaration\n'
                        + '  4. the marker is the legal form, /*! … */, not /* … */\n'
                        + '  5. the marker is on the module FIRST line and the module has a dynamic import: Vite prepends\n'
                        + '     its preload import onto that same line and Rollup discards the comment with it. Put a\n'
                        + '     statement above the marker.\n',
                    );
                }

                // Comment mode rejects a chunk with no markers, so only a marked chunk goes to the VM.
                const vm = useVM && survived > 0;
                let result = null;
                let lastError = null;
                let attempts = 0;

                while (result === null && attempts < MAX_RETRIES) {
                    attempts++;

                    try {
                        const output = vm
                            ? (await JavaScriptObfuscator.obfuscatePro(
                                code,
                                vmConfig,
                                {apiToken, timeout, ...(version && {version})},
                                (message) => console.log(`   ⏳ ${chunk.fileName}: ${message}`),
                            )).getObfuscatedCode()
                            : JavaScriptObfuscator.obfuscate(code, standardConfig).getObfuscatedCode();

                        if (parses(output)) {
                            result = output;
                        } else {
                            console.warn(`   ⚠ ${chunk.fileName}: attempt ${attempts}/${MAX_RETRIES} did not parse`);
                        }
                    } catch (error) {
                        lastError = error instanceof Error ? error : new Error(String(error));
                        console.error(`   ✗ ${chunk.fileName}: attempt ${attempts}/${MAX_RETRIES} failed: ${lastError.message}`);
                    }

                    // Local obfuscation is deterministic: a rerun returns the same unparseable bytes.
                    // Only the Pro API is worth asking twice.
                    if (!vm && lastError === null) break;
                }

                if (result === null) {
                    this.error(`[Obfuscator] ${chunk.fileName} could not be obfuscated after ${attempts} attempt(s)${lastError ? `: ${lastError.message}` : ': the output did not parse'}`);
                }

                // Opt-out for a script served at a fixed URL: its name is a contract with whoever
                // embeds it, so it cannot be content-addressed.
                const rehashed = rehash ? rehashedName(chunk.fileName, result) : chunk.fileName;

                pending.push({chunk, filePath, code: result, rehashed});

                if (rehashed !== chunk.fileName) {
                    renames.push([chunk.fileName, rehashed]);
                }

                // Logged here, not in the write pass: a VM build spends minutes per chunk, and
                // batching every line to the end would leave that whole stretch silent.
                console.log(`   ✓ ${chunk.fileName}${rehashed === chunk.fileName ? '' : ` → ${rehashed}`}${survived > 0 ? ` (${survived} VM marker(s))` : ''}`);
            }

            // Every guard has passed, so the disk can move. New bytes first, manifest second, stale
            // files last: the manifest never names a file that is not there.
            for (const {code, rehashed} of pending) {
                await writeFile(path.resolve(outputDir, rehashed), code);
            }

            if (renames.length > 0) {
                await pointManifestAt(outputDir, renames);

                for (const {chunk, filePath, rehashed} of pending) {
                    if (rehashed !== chunk.fileName) await rm(filePath, {force: true});
                }
            }

            console.log('');
        },
    };
}
