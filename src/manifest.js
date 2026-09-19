import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Blade resolves assets through the manifest, so a rename is only real once it lands there. */
export async function pointManifestAt(outputDir, renames) {
    for (const manifest of ['manifest.json', path.join('.vite', 'manifest.json')]) {
        const manifestPath = path.resolve(outputDir, manifest);
        let contents;

        try {
            contents = await readFile(manifestPath, 'utf8');
        } catch {
            continue;
        }

        for (const [from, to] of renames) {
            contents = contents.replaceAll(from, to);
        }

        await writeFile(manifestPath, contents);
    }
}
