import {readFileSync} from 'node:fs';

// Sources use the legal-comment form so it survives bundlers; the obfuscator selects on the standard form.
export const VM_COMMENT_LEGAL = '/*! javascript-obfuscator:vm */';
export const VM_COMMENT_STANDARD = '/* javascript-obfuscator:vm */';

export function restoreVmComments(code) {
    return code.replaceAll(VM_COMMENT_LEGAL, VM_COMMENT_STANDARD);
}

export function countMarkers(code, marker) {
    return code.split(marker).length - 1;
}

/**
 * The legal-form markers a chunk's own source modules carry.
 *
 * Every module, not just the ones under an islandRoot: the surviving count this is compared against
 * is taken over the whole chunk, and filtering one side of an equality is how a marked module
 * outside the roots came to fail every build. islandRoots draws the boundary guard's line and
 * nothing else.
 */
export function sourceMarkers(moduleIds) {
    return moduleIds.reduce((total, id) => {
        try {
            return total + countMarkers(readFileSync(id, 'utf8'), VM_COMMENT_LEGAL);
        } catch {
            return total; // a virtual module has no file, and no markers either
        }
    }, 0);
}
