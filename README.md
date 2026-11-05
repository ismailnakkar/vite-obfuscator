# @ismailnakkar/vite-obfuscator

Vite plugin that obfuscates the chunks of chosen entries with `javascript-obfuscator`, optionally
running marked functions through its Pro VM, and fails the build when protected code would ship
readable or a VM marker would be lost or moved.

## Install

```bash
npm i -D @ismailnakkar/vite-obfuscator
```

Vite 8 and `javascript-obfuscator` 5.8.1+ are peers. The VM needs an obfuscator.io Pro API token.

## Use

```js
import obfuscator from '@ismailnakkar/vite-obfuscator';
import {defineConfig} from 'vite';

export default defineConfig({
    plugins: [
        process.env.OBFUSCATE === 'true' && obfuscator({
            include: ['src/widget/index.js', 'src/widget/embed.js'],
            islandRoots: ['src/widget'],
            apiToken: process.env.OBFUSCATOR_API_TOKEN ?? '',
            vmObfuscation: true,
        }),
    ],
});
```

Gate it as above to skip it; Vite ignores a falsy plugin.

A chunk is obfuscated when at least one entry reaches it and **every** entry that reaches it is in
`include`. An `islandRoots` module bundled only into readable chunks fails the build.

When several HTML pages load the same script, Vite drops each page's own chunk, so the pages match
no entry. Add that script to `build.rolldownOptions.input` and to `include`.

| Option | Default | |
| --- | --- | --- |
| `include` | required | Entry source paths as written in `vite.config`, not entry names, no `./`. Matched as a whole-segment suffix: `'app.js'` matches every `app.js` entry. |
| `islandRoots` | required | Directories of the code to protect, relative to Vite's `root`. |
| `vmObfuscation` | `false` | Runs marked functions through the Pro VM. The build fails if `apiToken` is empty. |
| `apiToken` | `''` | Pro API token. Ignored without `vmObfuscation`. |
| `vmObfuscationThreshold` | `1` | VM only. Clamped to 0–1. |
| `timeout` | upstream's | VM only. Pro API request timeout in ms. |
| `version` | latest | VM only. The obfuscator version the Pro API runs. |
| `rehash` | `true` | Renames each obfuscated chunk after a hash of its new bytes. `false` for a script served at a fixed URL. |
| `maxGzipBytes` | `0` | Fails the build when an obfuscated chunk gzips to more bytes than this. `0` is off; each chunk's raw and gzip sizes are logged either way. |
| `optionsPreset` | `'low-obfuscation'` | `javascript-obfuscator` preset. It decides every option the plugin does not set below. |
| `spareNodeModules` | `false` | Opt-in: leaves `node_modules` code unobfuscated, for an obfuscated chunk that bundles it: it is public on npm, and obfuscating it only grows the bundle. Fails the build if no `node_modules` module is found, which includes a minified chunk (Rolldown marks module boundaries with comments a minifier drops): set `build.minify: false`, or this to `false`. Module paths must use `/` separators, as on Linux and macOS builds. |
| `seed` | unset | `javascript-obfuscator` seed, for byte-identical rebuilds; non-zero, since upstream treats `0` as unseeded. It also makes the three parse retries identical. |
| `overrides` | `{}` | `javascript-obfuscator` options, merged last: they win over the preset and the settings below. |

The plugin sets only what is unsafe on a page the app does not own, and `overrides` can change it:
`target: 'browser-no-eval'`, `disableConsoleOutput: false`, `debugProtection: false`,
`debugProtectionInterval: 0`, `selfDefending: false`. The VM options are added when `vmObfuscation` is on.

`low-obfuscation` itself turns on `selfDefending`, so the plugin turns it off. That option and
`debugProtection` break under automated browsers and open devtools, and a script that does analytics
or bot detection must still run there. Turn either on with `overrides`. Measure gzip when changing preset (`maxGzipBytes`
fails the build on a regression): in one measurement on a tracker, `high-obfuscation` was 159.6 KB and
`low-obfuscation` 33.3 KB.

## VM markers

Mark a function with a legal comment on the line above it:

```js
/*! javascript-obfuscator:vm */
export function detect() { … }
```

A marker may lead a function declaration, a `const`/`let`/`var` holding a function or arrow
function, an export of either, a method, or an object property or class field holding one. These are
the positions the plugin accepts, not ones verified against the Pro VM. Marked modules may sit
outside `islandRoots`.

The plugin sets `build.rolldownOptions.output.comments` to `{legal: true}` so markers survive
minification; a later plugin must not override it. The build can still move a marker:

- **oxc** (the default minifier) moves one on a `const`/`let`/`var`;
- **terser** inlines a marked function called once;
- **Rolldown**, minified or not, inlines a single-use object and moves its property markers.

Mark function declarations, which oxc and Rolldown leave in place. With terser, or to keep markers
on `const`/`let`/`var`, set `build.minify: false` and minify the chunks the plugin does not
obfuscate in a plugin of your own.

The build fails when a marker is lost between source and chunk, leads no function of its own, or
marks a function exported where declared (`export function f`, `export const f =`) that was
tree-shaken. Not detected: a marker that lands on an unmarked function, whether a minifier moved it
or a dropped marked function not exported where declared left it behind. Delete marked functions you
stop using.

## Build failures

Every check fails the build before anything is written, with a message that names the cause. Two
need more:

- `… bundled but NOT obfuscated`: add the importing entry to `include`, or move the module out of
  `islandRoots`.
- `… is in an import cycle between obfuscated chunks`: break the cycle.

## Output

Importers, every emitted `.html`, and the `build.manifest`, `build.ssrManifest` and
`build.chunkImportMap` files are rewritten to the rehashed names. An obfuscated chunk's sourcemap is
dropped with a warning: its `sourcesContent` would ship the readable code.

The plugin runs in a post-order `generateBundle`, so a normal-order one of your own sees readable
chunks.

Vite empties `outDir` before this runs: with `emptyOutDir` on, an in-place build serves no assets
for the whole pass (minutes with the VM) and leaves the directory empty after a failure. Build into
another directory and swap it in, or set `build.emptyOutDir: false` and prune stale assets yourself.

## Testing

The plugin runs only in `vite build`, so app tests need no fake or setup. This package's suite:
`npm test`.

## Upgrading

### From 5.x

6.0 lets the preset decide and gives safe defaults. Per option, keep the old behaviour with:

- Forced options gone: the plugin no longer sets `numbersToExpressions`, `splitStrings`,
  `transformObjectKeys`, `stringArrayThreshold: 1`, `stringArrayEncoding: ['rc4']`, `renameGlobals`, `compact`, `simplify`, `stringArray`
  over the preset. Set any you want in `overrides`, or use
  `optionsPreset: 'high-obfuscation'`, which sets most of them.
- `optionsPreset` defaults to `'low-obfuscation'`, was `'high-obfuscation'`. Output is much smaller
  and easier to read; pass the old preset and set `renameGlobals: true` in `overrides` to approximate it.
- `target` is `'browser-no-eval'`, was `'browser'`. `disableConsoleOutput`, `debugProtection`, `debugProtectionInterval`
  and `selfDefending` are off, where the old default preset turned them on. Override to restore.
- New opt-in `spareNodeModules: true` leaves `node_modules` code in an obfuscated chunk unobfuscated.
  A local plugin that wraps those spans in `javascript-obfuscator:disable` comments can be replaced by it.
- The VM options are unchanged and `vmObfuscation` is still opt-in; the base preset changes above apply to VM builds too.

### From 4.x

5.0 ignores these options (TypeScript reports them as excess properties); remove them:

- `enable`: a leftover `enable: false` now obfuscates. Gate the call instead (see [Use](#use)).
- `vmTargetFunctionsMode`, `vmTargetFunctions`, `vmExcludeFunctions`: mark functions with
  `/*! javascript-obfuscator:vm */`, now the only mode. `overrides` still reaches upstream's root
  mode, unguarded, and only a chunk with a marker reaches the VM.
- `mustContain`: check chunk content in a normal-order `generateBundle` of your own.
