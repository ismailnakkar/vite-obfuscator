# @ismailnakkar/vite-obfuscator

Obfuscates the JavaScript a page actually ships, and fails the build when that quietly stops being
true.

Three things go wrong silently: a chunk ships readable because something outside the protected set
imported it, a function loses its VM marker in bundling and ships patchable, or the bytes change
after Vite computed the URL that names them. Each looks like a clean build. This plugin makes all
three a build failure.

## Install

```bash
npm i -D @ismailnakkar/vite-obfuscator
```

Vite 8 and `javascript-obfuscator` 5.8.1+ are peers.

## Use

```js
import obfuscator from '@ismailnakkar/vite-obfuscator';

obfuscator({
    enable: process.env.OBFUSCATE === 'true',
    include: ['src/widget/index.js', 'src/widget/embed.js'],
    islandRoots: ['src/widget'],
    apiToken: process.env.OBFUSCATOR_API_TOKEN ?? '',
    vmObfuscation: true,
})
```

| option | |
| --- | --- |
| `enable` | Defaults to **true**. False skips obfuscation entirely; the plugin is build-only either way. |
| `include` | Entry **source paths**, as written in `vite.config` — not entry names, and no `./` prefix. Required. |
| `islandRoots` | Directories holding the code to protect. Required; drives the boundary guard. |
| `apiToken` | Required for the Pro VM, *together with* `vmObfuscation`. Alone it is ignored. |
| `vmObfuscation` | Routes marked functions through the Pro VM. Needs `apiToken`; the build refuses it without one. |
| `vmObfuscationThreshold` | VM only (with `vmObfuscation` and `apiToken`). Defaults to 1, clamped to 0–1. |
| `vmTargetFunctionsMode` | VM only. `'comment'` (the default here: marker-driven; upstream's default is `'root'`) or `'root'`. Even in `'root'` mode, only chunks with at least one marker reach the VM. |
| `vmTargetFunctions`, `vmExcludeFunctions` | VM only, and only in `'root'` mode. |
| `timeout` | VM only. The Pro API request timeout in ms. Defaults to 300000. |
| `version` | VM only. The Pro API's obfuscator version. When unset, the API uses its latest. |
| `rehash` | Defaults to **true**. False for a script served at a fixed URL, whose name is a contract. |
| `mustContain` | Strings that must survive into the built chunks — a tripwire for tree-shaking. |
| `optionsPreset` | The `javascript-obfuscator` preset everything else sits on. Defaults to `'high-obfuscation'`, which turns on controlFlowFlattening (threshold 1), deadCodeInjection, debugProtection (a 4000 ms debugger loop) and disableConsoleOutput. The plugin's own settings, then `overrides`, go on top. Turn the traps off with `overrides: {debugProtection: false, disableConsoleOutput: false}`. |
| `overrides` | Merged last into the `javascript-obfuscator` options. |

A chunk is obfuscated when at least one entry reaches it and **every** entry that reaches it is in
`include`. So `include` must list every entry that reaches a shared chunk, or that chunk is shared
with something un-obfuscated and gets spared.

When several HTML pages load the same script, Vite drops each page's own chunk, so the pages match
no entry. Add that script to `build.rolldownOptions.input` and list it in `include`.

## VM markers

Mark a function for the Pro VM with a legal comment on the line above it:

```js
/*! javascript-obfuscator:vm */
export function detect() { … }
```

Legal form (`/*! … */`) — that is what survives bundling. The plugin accepts a marker on a function
declaration, a `const`/`let`/`var` holding a function or arrow function, an export of either, a
method, or an object property or class field holding one. Those are the positions it accepts, not
ones verified against the Pro VM. Markers may sit anywhere in the graph.

A marker lost or moved between source and chunk means its function ships without the VM, and
nothing else would say so. So the build fails when:

- the count of markers in your sources differs from the count in the built chunk;
- a marker in the built chunk leads no function, or shares one with another marker;
- a marked function exported where it is declared (`export function f`, `export const f =`) was
  tree-shaken — its marker is kept and would land on whatever follows.

A marker that lands alone on an unmarked function is not detected: a marked function dropped as
unused that is not exported where declared, or one a minifier moved. Delete marked functions you
stop using.

The plugin sets `build.rolldownOptions.output.comments` to `{legal: true}`; without it neither
Vite 8's default oxc minifier nor terser keeps a marker, and no minifier-side setting brings one
back, since the comment is gone before the minifier runs. That keeps markers in the chunk, but the
build can still move them:

- **oxc** moves a marker on a `const`/`let`/`var` holding a function; one on a declaration,
  method, property or class field stays in place.
- **terser** inlines a marked function called once, and its marker falls into the caller or onto
  the next function.
- **Rolldown**, minified or not, inlines a single-use object into its caller and moves its property
  markers.

With oxc, mark function declarations rather than `const`/`let`/`var` bindings; to keep those
bindings, or with terser, set `build.minify: false` and minify the chunks the plugin does not
obfuscate in a plugin of your own.

## Build failures

- **`… bundled but NOT obfuscated`** — protected code reached a chunk that is not a target. Add the
  importing entry to `include`, or move the module out.
- **`N VM marker(s) in its source modules, M in the built chunk`** — a marker was lost; the message
  lists the likely causes in order.
- **`N VM marker(s) lead no function of their own`** — a marker sits off its function in the built
  chunk, usually moved by the minifier; the message prints each position and the likely causes.
- **`marked function X … was tree-shaken`** — nothing imports it any more. Delete it with its
  marker, or import it.
- **`does not parse before obfuscation`** — acorn cannot read the built chunk; the message gives the
  position.
- **`could not be obfuscated`** — output did not parse, or the Pro API failed, on all three
  attempts.
- **`… is in an import cycle between obfuscated chunks`** — no processing order can rewrite both
  sides, so renaming would strand one. Break the cycle.
- **`missing required content: …`** — a `mustContain` string is not in the output. Nothing imports
  it, so tree-shaking dropped it silently. Check the keep-alive references in the entry.
- **`islandRoots not found on disk`** — a root path does not exist, so the boundary guard matched
  nothing and would pass on any input. Usually a typo; relative roots resolve against Vite's
  `root`, and the message prints the absolute path it tried.

## How it works

Runs in a post-order `generateBundle`, on the chunks in memory: Vite resolves `__VITE_PRELOAD__`
in its own normal-order `generateBundle`, so the code is final by then. Obfuscated bytes are
re-hashed, and the new names written into the `build.manifest` file at its configured path, every
emitted `.html` file, `build.ssrManifest` when set, and the `build.chunkImportMap` file when on, so a URL still identifies its content under
`immutable` caching. An obfuscated chunk's sourcemap is dropped, with a warning: it maps the
readable code, and its `sourcesContent` ships that code. Chunks are processed dependencies-first
and importers rewritten to the new names *before* being obfuscated, since afterwards a specifier is
hex-escaped or inside the string array. A failing guard stops the build before Rolldown writes a file.

Vite empties `outDir` before this runs. With `emptyOutDir` on, an in-place build serves no assets
for the whole pass (minutes with the VM) and leaves the directory empty after a failure. Build into
another directory and swap it in, or set `build.emptyOutDir: false` and prune stale assets yourself.

## Upgrading

### From 3.x

- Chunks are obfuscated in memory, before anything is written, so a failed build leaves no readable
  chunk behind. Vite empties `outDir` first, so build out of place and swap
  (`vite build --outDir dist-next && rm -rf dist && mv dist-next dist`),
  or set `build.emptyOutDir: false` and prune.
- 3.x with `build.sourcemap` left each obfuscated chunk's pre-rehash `.map`, readable source
  included, in `outDir`; delete any you deployed. 4.0 drops those maps and warns once per build, so
  no map for an obfuscated chunk reaches an error-tracker upload.
- The `javascript-obfuscator` peer rises to ^5.8.1. Earlier releases evaluated the skipped right
  operand of `&&`, `||` or `??` (an identifier or object literal) and shared a default-parameter
  object across calls.

### From 2.x

- 3.0 fails the build on a VM marker that leads no function in the built chunk or shares one, and
  on a marked export that was tree-shaken; 2.x passed them silently.
- Move such a marker onto a function declaration, or delete it; for one a minifier moved, see
  [VM markers](#vm-markers).
- acorn's floor rises to 8.15.

### From 1.x

- `vmTargetFunctionsMode: 'name'` is now `'root'`.
- `islandRoots` resolve against Vite's `root`, not the working directory, and a root missing on disk fails the build.
- An `include` path matches an entry on whole path segments only: `first.js` no longer matches `not-first.js`.

## Develop

```bash
npm test
```
