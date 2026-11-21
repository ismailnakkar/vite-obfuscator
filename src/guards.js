import {isWithin, toPosix} from './paths.js';

/** Island modules bundled into no target chunk, so shipped readable. */
export function leakedIslandModules(chunks, targets, roots) {
    const posixRoots = roots.map(toPosix);
    const inIsland = (id) => posixRoots.some((root) => isWithin(toPosix(id), root));
    const covered = new Set(targets.flatMap((chunk) => chunk.moduleIds).filter(inIsland));

    return [...new Set(chunks.flatMap((chunk) => chunk.moduleIds).filter(inIsland))]
        .filter((id) => !covered.has(id));
}
