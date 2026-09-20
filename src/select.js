const normalize = (p) => p.replaceAll('\\', '/');

/**
 * An include path matches an entry only on a full path SEGMENT boundary: a bare `endsWith` let
 * 'first.js' match '…/not-first.js', quietly obfuscating an entry nobody named.
 *
 * It is still a suffix match, not an exact one — 'app.js' matches any entry called app.js at any
 * depth. Write enough of the path to be unambiguous. Used by both matchers below so they cannot
 * disagree about what is included.
 */
const matchesEntry = (id, wanted) => id === wanted || id.endsWith(`/${wanted}`);

/**
 * A chunk is a target when at least one entry reaches it and EVERY entry that reaches it is an
 * included entry. A chunk shared with a non-included entry is spared, because obfuscating it would
 * obfuscate code the public site also runs.
 */
export function selectTargets(bundle, include) {
    const wanted = include.map(normalize);
    const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
    const byFileName = new Map(chunks.map((c) => [c.fileName, c]));

    const included = (chunk) => chunk.isEntry
        && chunk.facadeModuleId !== null
        && wanted.some((path) => matchesEntry(normalize(chunk.facadeModuleId), path));

    const reachedBy = new Map();

    for (const entry of chunks.filter((c) => c.isEntry)) {
        const queue = [entry.fileName];
        const seen = new Set();

        for (let fileName = queue.pop(); fileName !== undefined; fileName = queue.pop()) {
            if (seen.has(fileName)) continue;

            seen.add(fileName);
            reachedBy.set(fileName, (reachedBy.get(fileName) ?? new Set()).add(entry));

            const chunk = byFileName.get(fileName);
            if (chunk) queue.push(...chunk.imports, ...chunk.dynamicImports);
        }
    }

    return chunks.filter((chunk) => {
        const entries = [...(reachedBy.get(chunk.fileName) ?? [])];

        return entries.length > 0 && entries.every(included);
    });
}

/**
 * The include paths that match no build entry — a typo, or entry NAMES instead of source paths.
 * The inverse of the reachability match above; kept beside it so the two cannot drift apart.
 */
export function unmatchedIncludes(bundle, include) {
    const ids = Object.values(bundle)
        .filter((o) => o.type === 'chunk' && o.isEntry && o.facadeModuleId !== null)
        .map((c) => normalize(c.facadeModuleId));

    return include.filter((p) => !ids.some((id) => matchesEntry(id, normalize(p))));
}
