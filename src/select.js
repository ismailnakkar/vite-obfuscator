const normalize = (p) => p.replaceAll('\\', '/');

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
        && wanted.some((path) => normalize(chunk.facadeModuleId).endsWith(path));

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
