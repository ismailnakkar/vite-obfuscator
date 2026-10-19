import {createHash} from 'node:crypto';

/**
 * Vite hashes names from pre-obfuscation bytes, so two builds would serve different bytes at one
 * `immutable` URL.
 */
export function rehashedName(fileName, code) {
    const hash = createHash('sha256').update(code).digest('base64url').slice(0, 8);

    return /-[A-Za-z0-9_-]{8}\.js$/.test(fileName)
        ? fileName.replace(/-[A-Za-z0-9_-]{8}\.js$/, `-${hash}.js`)
        : fileName.replace(/\.js$/, `-${hash}.js`);
}
