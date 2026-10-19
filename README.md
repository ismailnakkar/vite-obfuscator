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
| `optionsPreset` | `'high-obfuscation'` | `javascript-obfuscator` preset, under the plugin's own settings. |
| `overrides` | `{}` | `javascript-obfuscator` options, merged last. |

`high-obfuscation` turns on `debugProtection` (a 4000 ms debugger loop) and `disableConsoleOutput`.
Turn them off with `overrides: {debugProtection: false, disableConsoleOutput: false}`.

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

### From 4.x

5.0 ignores these options (TypeScript reports them as excess properties); remove them:

- `enable`: a leftover `enable: false` now obfuscates. Gate the call instead (see [Use](#use)).
- `vmTargetFunctionsMode`, `vmTargetFunctions`, `vmExcludeFunctions`: mark functions with
  `/*! javascript-obfuscator:vm */`, now the only mode. `overrides` still reaches upstream's root
  mode, unguarded, and only a chunk with a marker reaches the VM.
- `mustContain`: check chunk content in a normal-order `generateBundle` of your own.
