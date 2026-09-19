import {createHash} from 'node:crypto';

/**
 * Vite hashes a chunk's filename from its PRE-obfuscation content, so two builds of the same
 * source produce the same URL holding different bytes — and these URLs ship
 * `max-age=31536000, immutable`. One bad build then stays pinned in every visitor's browser with
 * no way to reach them. Re-hashing after obfuscation restores the contract the caching relies on:
 * different bytes, different URL.
 */
export function rehashedName(fileName, code) {
    const hash = createHash('sha256').update(code).digest('base64url').slice(0, 8);

    return /-[A-Za-z0-9_-]{8}\.js$/.test(fileName)
        ? fileName.replace(/-[A-Za-z0-9_-]{8}\.js$/, `-${hash}.js`)
        : fileName.replace(/\.js$/, `-${hash}.js`);
}
