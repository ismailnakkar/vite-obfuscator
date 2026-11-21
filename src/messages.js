/** Build-failure texts long enough to need a cause and a fix spelled out. */

export function leakedMessage(leaked, unmatched, islandRoots) {
    return `${leaked.length} module(s) under ${islandRoots.join(', ')} are bundled but NOT obfuscated:\n`
        + leaked.map((id) => `    ${id}`).join('\n') + '\n\n'
        + 'A chunk is obfuscated only when EVERY entry that reaches it is an included entry.\n'
        + (unmatched.length > 0
            ? `But these include paths match no build entry: ${unmatched.join(', ')}. `
              + (unmatched.some((path) => !path.endsWith('.html'))
                  ? "include takes entry SOURCE paths as written in vite.config (e.g. 'src/widget/index.js'), not entry names. "
                  : '')
              + (unmatched.some((path) => path.endsWith('.html'))
                  ? 'Vite drops the chunk of an HTML page whose script another page also loads: add that script to build.rolldownOptions.input and to include.'
                  : '')
            : 'Something outside the island now imports one of these, so its chunk is shared and was spared.');
}

export const NOTHING_SPARED_MESSAGE = 'spareNodeModules is on but no node_modules module was found in any obfuscated chunk.\n'
    + 'Rolldown marks module boundaries with comments, which a minified chunk loses: set build.minify to false,\n'
    + 'or set spareNodeModules to false if the chunks bundle no node_modules code.';
