const normalize = (p) => p.replaceAll('\\', '/');

// Suffix match on whole segments: 'first.js' matches '…/x/first.js', not '…/not-first.js'.
// Shared by both matchers so they agree.
const matchesEntry = (id, wanted) => id === wanted || id.endsWith(`/${wanted}`);

/** Chunks reached by at least one entry, and only by included ones. */
export function selectTargets(bundle, include) {
    const wanted = include.map(normalize);
    const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
    const byFileName = new Map(chunks.map((c) => [c.fileName, c]));

    const included = (chunk) => chunk.isEntry
        && chunk.facadeModuleId !== null
        && wanted.some((path) => matchesEntry(normalize(chunk.facadeModuleId), path));

    const reachedBy = new Map();
    // Seed unimported chunks too: Vite drops the facade of an HTML page whose script another page
    // shares, and that orphan script's imports would otherwise read as included-only, be renamed,
    // and 404.
    const imported = new Set(chunks.flatMap((c) => [...c.imports, ...c.dynamicImports]));

    for (const entry of chunks.filter((c) => c.isEntry || !imported.has(c.fileName))) {
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

/** Include paths that match no entry: a typo, or entry names instead of source paths. */
export function unmatchedIncludes(bundle, include) {
    const ids = Object.values(bundle)
        .filter((o) => o.type === 'chunk' && o.isEntry && o.facadeModuleId !== null)
        .map((c) => normalize(c.facadeModuleId));

    return include.filter((p) => !ids.some((id) => matchesEntry(id, normalize(p))));
}
