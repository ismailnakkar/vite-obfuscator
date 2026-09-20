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

Vite 8 and `javascript-obfuscator` 5.4.7+ are peers.

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
| `rehash` | Defaults to **true**. False for a script served at a fixed URL, whose name is a contract. |
| `mustContain` | Strings that must survive into the built chunks — a tripwire for tree-shaking. |
| `overrides` | Merged last into the `javascript-obfuscator` options. |

A chunk is obfuscated when at least one entry reaches it and **every** entry that reaches it is in
`include`. So `include` must list every entry that reaches a shared chunk, or that chunk is shared
with something un-obfuscated and gets spared.

## VM markers

Mark a function for the Pro VM with a legal comment on the line above it:

```js
/*! javascript-obfuscator:vm */
export function detect() { … }
```

Legal form (`/*! … */`) — that is what survives bundling. The plugin counts markers in your sources
and in the built chunk and fails if the two differ, because a marker lost in between means that
function ships without the VM and nothing else would say so.

You do not need to disable minification or configure your minifier: the plugin sets
`build.rolldownOptions.output.comments` to `{legal: true}`, and that alone is what carries the
markers through — measured with both Vite 8's default oxc minifier and terser. Without it, neither
keeps them, and no minifier-side setting can bring them back: the comment is already gone before
the minifier runs.

Markers may sit anywhere in the graph.

## Build failures

- **`… bundled but NOT obfuscated`** — protected code reached a chunk that is not a target. Add the
  importing entry to `include`, or move the module out.
- **`N VM marker(s) in its source modules, M in the built chunk`** — a marker was lost; the message
  lists the likely causes in order.
- **`could not be obfuscated`** — output did not parse, or the Pro API failed. Local obfuscation is
  deterministic and tried once; the Pro API is retried.
- **`… is in an import cycle between obfuscated chunks`** — no processing order can rewrite both
  sides, so renaming would strand one. Break the cycle.
- **`missing required content: …`** — a `mustContain` string is not in the output. Nothing imports
  it, so tree-shaking dropped it silently. Check the keep-alive references in the entry.
- **`islandRoots not found on disk`** — a root path does not exist, so the boundary guard matched
  nothing and would pass on any input. Usually a typo; relative roots resolve against Vite's
  `root`, and the message prints the absolute path it tried.

## How it works

Runs in `writeBundle`, on the files as written — Vite resolves `__VITE_PRELOAD__` after
`generateBundle`, so obfuscating in-memory chunks corrupts it into `void 0 = x`. Obfuscated bytes
are re-hashed and the manifest repointed, so a URL still identifies its content under `immutable`
caching. Chunks are processed dependencies-first and importers rewritten to the new names *before*
being obfuscated, since afterwards a specifier is hex-escaped or inside the string array. Nothing is
written until every chunk clears every guard.

## Develop

```bash
npm test
```
