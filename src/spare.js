const DISABLE = '/* javascript-obfuscator:disable */';
const ENABLE = '/* javascript-obfuscator:enable */';

const VENDOR_PATH = String.raw`(?:\S*\/)?node_modules\/\S*`;

// Rolldown heads each module of an unminified chunk with `//#region path`, closed by `//#endregion`,
// so a vendor span ends at its own `//#endregion` and a path-like comment inside it stays spared.
const REGION_SPAN = new RegExp(String.raw`^[\t ]*\/\/#region ${VENDOR_PATH}$[\s\S]*?(?=^[\t ]*\/\/#endregion\b|(?![\s\S]))`, 'gm');

// Without regions a module is headed by a bare `// path` line, and a span runs to the next
// non-vendor header.
const BARE_SPAN = new RegExp(String.raw`^[\t ]*\/\/ ?${VENDOR_PATH}$[\s\S]*?(?=^[\t ]*\/\/ ?(?!(?:\S*\/)?node_modules\/)\S+\.\w+$|(?![\s\S]))`, 'gm');

const HAS_REGIONS = /^[\t ]*\/\/#region /m;

/** Wraps each node_modules module in disable/enable comments, so the obfuscator leaves it readable. */
export function spareNodeModules(code) {
    let spans = 0;
    const spared = code.replace(HAS_REGIONS.test(code) ? REGION_SPAN : BARE_SPAN, (span) => {
        spans++;

        return `${DISABLE}\n${span}${ENABLE}\n`;
    });

    return {code: spared, spans};
}
