import {createHash} from 'node:crypto';

const VITE_HASH_SUFFIX = /-[A-Za-z0-9_-]{8}\.js$/;
const JS_SUFFIX = /\.js$/;

/**
 * Vite hashes names from pre-obfuscation bytes, so two builds would serve different bytes at one
 * `immutable` URL.
 */
export function rehashedName(fileName, code) {
    const hash = createHash('sha256').update(code).digest('base64url').slice(0, 8);

    return fileName.replace(VITE_HASH_SUFFIX.test(fileName) ? VITE_HASH_SUFFIX : JS_SUFFIX, `-${hash}.js`);
}
