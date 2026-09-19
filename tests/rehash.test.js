import {describe, expect, it} from 'vitest';
import {rehashedName} from '../src/rehash.js';

describe('rehashedName', () => {
    it('replaces an existing 8-character Vite hash', () => {
        const out = rehashedName('assets/frontend-D7cAgkiq.js', 'console.log(1)');

        expect(out).toMatch(/^assets\/frontend-[A-Za-z0-9_-]{8}\.js$/);
        expect(out).not.toBe('assets/frontend-D7cAgkiq.js');
    });

    it('appends a hash when the name carries none', () => {
        expect(rehashedName('assets/app.js', 'console.log(1)'))
            .toMatch(/^assets\/app-[A-Za-z0-9_-]{8}\.js$/);
    });

    it('is a pure function of the code, so identical bytes keep the same URL', () => {
        expect(rehashedName('a-AAAAAAAA.js', 'x')).toBe(rehashedName('a-AAAAAAAA.js', 'x'));
        expect(rehashedName('a-AAAAAAAA.js', 'x')).not.toBe(rehashedName('a-AAAAAAAA.js', 'y'));
    });
});
