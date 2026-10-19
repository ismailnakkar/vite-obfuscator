export function pointManifestAt(bundle, manifests, renames) {
    for (const [key, asset] of Object.entries(bundle)) {
        if (manifests.includes(key) || key.endsWith('.html')) {
            asset.source = [...renames].reduce((s, [from, to]) => s.replaceAll(from, to), String(asset.source));
        }
    }
}
