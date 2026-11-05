const normalize = (p) => p.replaceAll('\\', '/');

/** Island modules bundled into no target chunk, so shipped readable. */
export function leakedIslandModules(chunks, targets, roots) {
    const normalized = roots.map(normalize);
    // Whole segments: '…/links-extra' is not under '…/links'.
    const inIsland = (id) => normalized.some((root) => normalize(id) === root || normalize(id).startsWith(`${root}/`));

    const covered = new Set(targets.flatMap((chunk) => chunk.moduleIds).filter(inIsland));

    return [...new Set(chunks.flatMap((chunk) => chunk.moduleIds).filter(inIsland))]
        .filter((id) => !covered.has(id));
}

/** The build-failure text for island modules bundled into no obfuscated chunk. */
export function leakedMessage(leaked, unmatched, islandRoots) {
    return `[Obfuscator] ${leaked.length} module(s) under ${islandRoots.join(', ')} are bundled but NOT obfuscated:\n`
        + leaked.map((id) => `    ${id}`).join('\n') + '\n\n'
        + 'A chunk is obfuscated only when EVERY entry that reaches it is an included entry.\n'
        + (unmatched.length > 0
            ? `But these include paths match no build entry: ${unmatched.join(', ')}. `
              + (unmatched.some((p) => !p.endsWith('.html'))
                  ? "include takes entry SOURCE paths as written in vite.config (e.g. 'src/widget/index.js'), not entry names. "
                  : '')
              + (unmatched.some((p) => p.endsWith('.html'))
                  ? 'Vite drops the chunk of an HTML page whose script another page also loads: add that script to build.rolldownOptions.input and to include.'
                  : '')
            : 'Something outside the island now imports one of these, so its chunk is shared and was spared.');
}
