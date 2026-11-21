/** The files Vite writes that name chunk files, at the paths Vite gives them. */
export function manifestFiles({manifest, ssrManifest, chunkImportMap, rolldownOptions}) {
    return [
        manifest === true ? '.vite/manifest.json' : manifest,
        ssrManifest === true ? '.vite/ssr-manifest.json' : ssrManifest,
        // As Vite's getImportMapFilename names it.
        chunkImportMap && (rolldownOptions.experimental?.chunkImportMap?.fileName || 'importmap.json'),
    ].filter(Boolean);
}

/** Rewrites the manifests and every HTML file to the renamed chunk files. */
export function repointAssets(bundle, manifests, renames) {
    for (const [key, asset] of Object.entries(bundle)) {
        if (manifests.includes(key) || key.endsWith('.html')) {
            asset.source = [...renames].reduce((source, [from, to]) => source.replaceAll(from, to), String(asset.source));
        }
    }
}
