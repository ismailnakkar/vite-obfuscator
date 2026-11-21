import {parse} from 'acorn';
import JavaScriptObfuscator from 'javascript-obfuscator';

const MAX_ATTEMPTS = 3;

function parses(code) {
    try {
        parse(code, {ecmaVersion: 'latest', sourceType: 'module'});
        return true;
    } catch {
        return false;
    }
}

/**
 * Obfuscates `code` until the output parses, at most three times: unseeded, each run draws a fresh
 * seed. Throws the last failure.
 */
export function obfuscateUntilItParses({code, config, log}) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const output = JavaScriptObfuscator.obfuscate(code, config).getObfuscatedCode();

            if (parses(output)) return output;

            lastError = null;

            log(`attempt ${attempt}/${MAX_ATTEMPTS} did not parse`);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            log(`attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError.message}`);
        }
    }

    throw new Error(`could not be obfuscated after ${MAX_ATTEMPTS} attempt(s)${lastError ? `: ${lastError.message}` : ': the output did not parse'}`);
}
