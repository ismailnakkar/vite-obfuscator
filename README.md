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

Legal form (`/*! … */`) — that is what survives bundling. The plugin accepts a marker on a function
declaration, a `const`/`let`/`var` holding a function or arrow function, an export of either, a
method, or an object property or class field holding one. Those are the positions it accepts, not
ones verified against the Pro VM. Markers may sit anywhere in the graph.

A marker lost or moved between source and chunk means its function ships without the VM, and
nothing else would say so. So the build fails when:

- the count of markers in your sources differs from the count in the built chunk;
- a marker in the built chunk leads no function, or shares one with another marker (e.g. one per TS
  overload signature);
- a marked function exported where it is declared (`export function f`, `export const f =`) was
  tree-shaken — its marker is kept and would land on whatever follows.

A marked function that is not exported that way and is dropped as unused cannot be detected when
what follows it is an unmarked function: that function takes the marker. Delete marked functions
you stop using.

The plugin sets `build.rolldownOptions.output.comments` to `{legal: true}`; without it neither
Vite 8's default oxc minifier nor terser keeps a marker, and no minifier-side setting brings one
back, since the comment is gone before the minifier runs. That keeps markers in the chunk, but a
minifier still moves them (Vite 8.0 releases' oxc drops some outright, which the count guard
reports):

- **oxc** keeps a marker on a function declaration, method, object property or class field in
  place. One on a `const`/`let`/`var` holding a function or arrow function does not stay: oxc
  merges consecutive declarations into one and moves the marker into a function body, its own or
  the next one's, or leaves it behind the merged declaration.
- **terser** inlines a marked function called once, and its marker falls into the caller or onto
  the next function.
- **Rolldown**, minified or not, inlines a single-use object into its caller and moves its property
  markers; a `build.target` below class fields strands a class-field marker.

The guards above catch these when the marker ends up leading no function or doubling up on one,
not when it lands alone on an unmarked function. With oxc, mark function declarations rather than
`const`/`let`/`var` bindings; to keep those bindings, or with terser, set `build.minify: false` and
minify the chunks the plugin does not obfuscate in a plugin of your own.

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
  attempts. Local obfuscation draws a fresh seed each run (unless `overrides` pins one), so it is
  retried like the Pro API.
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

## Upgrading

### From 2.x

- 3.0 fails the build on a VM marker that leads no function of its own in the built chunk, or
  shares one with another marker. 2.x passed both while the function it was written for shipped
  without the VM.
- A marker on anything but a function (a value, a class, a statement): move it onto a function
  declaration, or delete it.
- A marker the minifier moved (oxc moves one on any `const`/`let`/`var` holding a function, terser
  inlines a marked function called once): with oxc, make it a function declaration; to keep the
  binding, or with terser, set `build.minify: false` and minify the chunks the plugin does not
  obfuscate in a plugin of your own (see [VM markers](#vm-markers)).
- 3.0 fails the build when a marked function exported where it is declared was tree-shaken, since
  its marker would land on whatever follows. Delete it with its marker, or import it.
- acorn's floor rises to 8.15, which reads `using` in chunks built for a target that keeps it.

### From 1.x

- `vmTargetFunctionsMode: 'name'` is now `'root'`.
- `islandRoots` resolve against Vite's `root`, not the working directory, and a root missing on disk fails the build.
- An `include` path matches an entry on whole path segments only: `first.js` no longer matches `not-first.js`.

## Develop

```bash
npm test
```
