/** Targets with every chunk they import before them, so a chunk is renamed before its importers are read. */
export function dependenciesFirst(targets) {
    const byFileName = new Map(targets.map((chunk) => [chunk.fileName, chunk]));
    const ordered = [];
    const done = new Set();
    const visiting = new Set();

    const visit = (chunk) => {
        if (!chunk || done.has(chunk.fileName)) return;

        // Rolldown can emit chunks that import each other.
        if (visiting.has(chunk.fileName)) {
            throw new Error(`[Obfuscator] ${chunk.fileName} is in an import cycle between obfuscated chunks, which cannot be renamed safely.`);
        }

        visiting.add(chunk.fileName);
        for (const fileName of [...chunk.imports, ...chunk.dynamicImports]) visit(byFileName.get(fileName));
        visiting.delete(chunk.fileName);

        done.add(chunk.fileName);
        ordered.push(chunk);
    };

    targets.forEach(visit);

    return ordered;
}
