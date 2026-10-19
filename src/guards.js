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
