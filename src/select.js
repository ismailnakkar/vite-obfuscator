import {endsWithPath, toPosix} from './paths.js';

export const chunksOf = (bundle) => Object.values(bundle).filter((output) => output.type === 'chunk');

const isFacadeEntry = (chunk) => chunk.isEntry && chunk.facadeModuleId !== null;

/** Chunks reached by at least one entry, and only by included ones. */
export function selectTargets(bundle, include) {
    const wanted = include.map(toPosix);
    const chunks = chunksOf(bundle);
    const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

    const included = (chunk) => isFacadeEntry(chunk)
        && wanted.some((path) => endsWithPath(toPosix(chunk.facadeModuleId), path));

    const reachedBy = new Map();
    // Seed unimported chunks too: Vite drops the facade of an HTML page whose script another page
    // shares, and that orphan script's imports would otherwise read as included-only, be renamed,
    // and 404.
    const imported = new Set(chunks.flatMap((chunk) => [...chunk.imports, ...chunk.dynamicImports]));

    for (const entry of chunks.filter((chunk) => chunk.isEntry || !imported.has(chunk.fileName))) {
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
    const ids = chunksOf(bundle).filter(isFacadeEntry).map((chunk) => toPosix(chunk.facadeModuleId));

    return include.filter((path) => !ids.some((id) => endsWithPath(id, toPosix(path))));
}
