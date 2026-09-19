const normalize = (p) => p.replaceAll('\\', '/');

/**
 * Island modules that were bundled but NOT into any target chunk. Each one shipped readable:
 * something outside the island imports it, so its chunk is shared and was spared.
 */
export function leakedIslandModules(chunks, targets, roots) {
    const normalized = roots.map(normalize);
    const inIsland = (id) => normalized.some((root) => normalize(id).startsWith(root));

    const covered = new Set(targets.flatMap((chunk) => chunk.moduleIds).filter(inIsland));

    return [...new Set(chunks.flatMap((chunk) => chunk.moduleIds).filter(inIsland))]
        .filter((id) => !covered.has(id));
}
