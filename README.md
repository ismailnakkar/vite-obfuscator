# @ismailnakkar/vite-obfuscator

A Vite plugin that obfuscates the chunks of the entries you choose with `javascript-obfuscator`. The
build fails when code you protect would ship readable.

## Install

```bash
npm i -D @ismailnakkar/vite-obfuscator javascript-obfuscator
```

Needs Node 20.19+ or 22.12+, Vite 8 and `javascript-obfuscator` 5.8.1+ (a peer).

## Use

```js
import obfuscator from '@ismailnakkar/vite-obfuscator';
import {defineConfig} from 'vite';

export default defineConfig({
    plugins: [
        process.env.OBFUSCATE === 'true' && obfuscator({
            include: ['src/widget/index.js', 'src/widget/embed.js'],
            islandRoots: ['src/widget'],
        }),
    ],
});
```

The plugin runs only in `vite build`. Vite skips a falsy plugin, so gate it as above to turn it off.

`include` lists the entries to protect, and `islandRoots` the folders their code lives in. A chunk
is obfuscated when at least one entry reaches it and **every** entry that reaches it is in `include`.
The build fails if an `islandRoots` module ends up in a chunk that stays readable, for example because
an entry outside `include` imports it too.

When several HTML pages load the same script, Vite drops each page's own chunk, so the pages match no
entry. Add that script to `build.rolldownOptions.input` and to `include`.

## Options

| Option | Default | |
| --- | --- | --- |
| `include` | required | Entry source paths as written in `vite.config`: not entry names, no `./`. Matched as a whole-segment suffix, so `'app.js'` matches every `app.js` entry. |
| `islandRoots` | required | Folders of the code to protect, relative to Vite's `root`. Each must exist. |
| `optionsPreset` | `'low-obfuscation'` | `javascript-obfuscator` preset: `'default'`, `'low-obfuscation'`, `'medium-obfuscation'` or `'high-obfuscation'`. It decides every option the plugin does not set (see below). |
| `overrides` | `{}` | `javascript-obfuscator` options, merged last: they win over the preset and over everything the plugin sets. |
| `rehash` | `true` | Renames each obfuscated chunk after a hash of its new bytes. `false` for a script served at a fixed URL. |
| `maxGzipBytes` | `0` | Fails the build when an obfuscated chunk gzips to more bytes than this. `0` is off. Each chunk's raw and gzip sizes are logged either way. |
| `spareNodeModules` | `false` | Leaves `node_modules` code in an obfuscated chunk readable: it is public on npm, and obfuscating it only grows the bundle. Needs `build.minify: false` (a minifier drops the module comments it reads) and `/` path separators. Fails the build if it finds no `node_modules` module. |

### What the plugin sets

Only what is unsafe on a page the app does not own: `target: 'browser-no-eval'`,
`disableConsoleOutput: false`, `debugProtection: false`, `debugProtectionInterval: 0` and
`selfDefending: false`. `overrides` can change any of them.

`low-obfuscation` turns `selfDefending` on, so the plugin turns it off: it and `debugProtection` break
under automated browsers and open devtools, where a script that does analytics or bot detection must
still run. Turn either back on with `overrides`.

Measure gzip when you change the preset: in one measurement on a tracker, `high-obfuscation` was
159.6 KB and `low-obfuscation` 33.3 KB. `maxGzipBytes` catches a regression.

For byte-identical rebuilds, set a non-zero `overrides: {seed: 1234}` (upstream treats `0` as
unseeded). A seed also makes the three parse attempts identical.

## Build failures

Every check fails the build before anything is written, with a message that names the cause:

- `include` or `islandRoots` empty, or an `islandRoots` folder missing.
- `… bundled but NOT obfuscated`: an `islandRoots` module sits in a readable chunk. Add the importing
  entry to `include`, or move the module out of `islandRoots`. The message also names any `include`
  path that matches no entry.
- A chunk that cannot be obfuscated into code that parses in three attempts.
- `maxGzipBytes` exceeded, or `spareNodeModules` on with nothing to spare.
- `… is in an import cycle between obfuscated chunks`: break the cycle, since such chunks cannot be
  renamed safely.

## Output

Importers, every emitted `.html`, and the `build.manifest`, `build.ssrManifest` and
`build.chunkImportMap` files point at the rehashed names. An obfuscated chunk's sourcemap is dropped
with a warning, since its `sourcesContent` would ship the readable code.

The plugin runs in a post-order `generateBundle`, so a normal-order one of your own sees readable
chunks.

Vite empties `outDir` before this runs. With `emptyOutDir` on, an in-place build serves no assets for
the whole pass and leaves the folder empty after a failure. Build into another folder and swap it in,
or set `build.emptyOutDir: false` and prune stale assets yourself.

## Testing

The plugin runs only in `vite build`, so app tests need no fake or setup. This package's suite:
`npm test`.

## Upgrading

### From 6.x

7.0 drops the obfuscator.io Pro VM: every chunk is obfuscated locally. Per app:

- Remove `apiToken`, `vmObfuscation`, `vmObfuscationThreshold`, `timeout` and `version` from the
  `obfuscator({…})` call. 7.0 ignores them (TypeScript reports them as excess properties), so the
  plugin reads no API token.
- `/*! javascript-obfuscator:vm */` markers are plain comments now: the obfuscator drops them and
  nothing counts or places them. Delete them, and any test of your own that counts them.
- The plugin no longer sets `build.rolldownOptions.output.comments` to `{legal: true}`, which kept the
  markers. A minified build now drops legal comments (`/*! … */`, `@license`) in every chunk, as Vite
  does by default; set that option yourself to keep them.
- `seed: 1234` becomes `overrides: {seed: 1234}`.
- Log and error lines lose their `[Obfuscator]` prefix, which doubled Vite's
  `[plugin vite-obfuscator]`. The `Obfuscating` and `bundled but NOT obfuscated` texts are unchanged.
- TypeScript checks `optionsPreset` against the four presets above and `overrides` against
  `javascript-obfuscator`'s `ObfuscatorOptions`. A Pro preset fails the build either way.

### From 5.x

6.0 lets the preset decide and gives safe defaults. To keep the old behaviour, per option:

- Forced options gone: the plugin no longer sets `numbersToExpressions`, `splitStrings`,
  `transformObjectKeys`, `stringArrayThreshold: 1`, `stringArrayEncoding: ['rc4']`, `renameGlobals`,
  `compact`, `simplify` and `stringArray` over the preset. Set any you want in `overrides`, or use
  `optionsPreset: 'high-obfuscation'`, which sets most of them.
- `optionsPreset` defaults to `'low-obfuscation'`, was `'high-obfuscation'`. Output is much smaller
  and easier to read; pass the old preset and set `renameGlobals: true` in `overrides` to approximate
  it.
- `target` is `'browser-no-eval'`, was `'browser'`. `disableConsoleOutput`, `debugProtection`,
  `debugProtectionInterval` and `selfDefending` are off, where the old default preset turned them on.
  Override to restore.
- New opt-in `spareNodeModules: true` leaves `node_modules` code in an obfuscated chunk unobfuscated.
  It replaces a local plugin that wraps those spans in `javascript-obfuscator:disable` comments.
- The VM options are unchanged and `vmObfuscation` is still opt-in; the base changes above apply to VM
  builds too.

### From 4.x

5.0 ignores these options (TypeScript reports them as excess properties); remove them:

- `enable`: a leftover `enable: false` now obfuscates. Gate the call instead (see [Use](#use)).
- `vmTargetFunctionsMode`, `vmTargetFunctions`, `vmExcludeFunctions`: mark functions with
  `/*! javascript-obfuscator:vm */`, now the only mode. `overrides` still reaches upstream's root
  mode, unguarded, and only a chunk with a marker reaches the VM.
- `mustContain`: check chunk content in a normal-order `generateBundle` of your own.
