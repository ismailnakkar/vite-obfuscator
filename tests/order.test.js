import {describe, expect, it} from 'vitest';
import {dependenciesFirst} from '../src/order.js';

const chunk = (fileName, imports = []) => ({fileName, imports, dynamicImports: []});

describe('dependenciesFirst', () => {
    it('refuses chunks that import each other', () => {
        const a = chunk('assets/a.js', ['assets/b.js']);
        const b = chunk('assets/b.js', ['assets/a.js']);

        expect(() => dependenciesFirst([a, b])).toThrow(
            /^assets\/a\.js is in an import cycle between obfuscated chunks, which cannot be renamed safely\.$/,
        );
    });
});
